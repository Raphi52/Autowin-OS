import type { ProviderRegistry } from './providers/registry'
import type { RoleModelConfig } from './roles'
import type { AppCommandBus } from './commands'
import {
  MODEL_QUESTION_INSTRUCTION,
  parseModelQuestion,
  type ModelQuestion
} from './model-questions'

/**
 * Boucle de PILOTAGE : un agent LLM conduit l'app lui-même.
 * Il reçoit le catalogue de commandes + l'état courant, ÉMET des appels
 * `<cmd>{"name":..,"args":..}</cmd>`, qu'on exécute sur le bus (l'UI se met à jour
 * en direct), puis on lui renvoie le résultat + le nouvel état, et il reboucle
 * jusqu'à écrire DONE (ou cap d'itérations). C'est « l'agent voit ce qu'il update ».
 */
export interface PilotEvent {
  kind: 'think' | 'command' | 'result' | 'done' | 'error'
  text?: string
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
  /** Coût cumulé du tour (surfacé sur l'event 'done') → journal d'activité par conversation. */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
}

const CMD_RE = /<cmd>\s*(\{[\s\S]*?\})\s*<\/cmd>/g

export class AgentPilot {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly roles: RoleModelConfig,
    private readonly bus: AppCommandBus
  ) {}

  async run(goal: string, onEvent: (e: PilotEvent) => void, maxIter = 6): Promise<void> {
    const provider = this.roles.getBinding('orchestrator').provider
    const catalog = this.bus.catalog()
    const snapshot = await this.bus.snapshot()

    const system =
      `Tu PILOTES l'application "Autowin OS" via des commandes. Objectif de l'utilisateur : "${goal}".\n` +
      `Pour agir, émets une ou plusieurs commandes AU FORMAT EXACT : <cmd>{"name":"...","args":{...}}</cmd>.\n` +
      `Commandes disponibles :\n` +
      catalog
        .map((c) => `- ${c.name}(${Object.keys(c.args).join(', ')}) : ${c.description}`)
        .join('\n') +
      `\nRègles : agis par petits pas, une ou deux commandes par tour. Après exécution tu recevras le résultat + l'état. ` +
      `Quand l'objectif est atteint, réponds UNIQUEMENT "DONE: <résumé>" sans commande.`

    const convo: string[] = [`ÉTAT INITIAL:\n${JSON.stringify(snapshot)}`]

    for (let i = 0; i < maxIter; i++) {
      const res = await this.registry.send(
        provider,
        [{ role: 'user', content: `${convo.join('\n\n')}\n\nProchaine action ?` }],
        { system }
      )
      const text = res.text.trim()

      // Extraire les commandes émises par le modèle.
      const cmds: Array<{ name: string; args: Record<string, unknown> }> = []
      let m: RegExpExecArray | null
      CMD_RE.lastIndex = 0
      while ((m = CMD_RE.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(m[1]) as { name: string; args?: Record<string, unknown> }
          if (parsed.name) cmds.push({ name: parsed.name, args: parsed.args ?? {} })
        } catch {
          /* JSON de commande invalide — ignoré */
        }
      }

      const thought = text.replace(CMD_RE, '').trim()
      if (thought) onEvent({ kind: 'think', text: thought })

      if (cmds.length === 0) {
        onEvent({ kind: 'done', text: thought || 'terminé' })
        return
      }

      const results: string[] = []
      for (const c of cmds) {
        onEvent({ kind: 'command', name: c.name, args: c.args })
        const r = await this.bus.exec(c.name, c.args) // MUTE l'app + broadcast (UI live)
        onEvent({ kind: 'result', name: c.name, ok: r.ok, data: r.ok ? r.data : r.error })
        results.push(`${c.name} → ${r.ok ? JSON.stringify(r.data) : 'ERREUR ' + r.error}`)
      }

      const state = await this.bus.snapshot()
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\nÉTAT MAINTENANT:\n${JSON.stringify(state)}`)
    }
    onEvent({ kind: 'done', text: `cap d'itérations (${maxIter}) atteint` })
  }

  /**
   * Mode CONVERSATION (chat transparent) : l'agent parle À l'utilisateur ET peut
   * piloter l'app dans le même tour. Le texte hors-commande est sa réponse parlée ;
   * les `<cmd>` sont exécutées et rendues comme des actions inline. L'historique
   * complet est réinjecté pour un vrai multi-tours. Un tour peut enchaîner plusieurs
   * itérations (agir → constater → répondre) jusqu'à ce qu'il ne reste plus de commande.
   */
  async chat(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    onEvent: (e: PilotEvent) => void,
    ask?: (question: ModelQuestion) => Promise<string>,
    maxIter = 6
  ): Promise<void> {
    const provider = this.roles.getBinding('orchestrator').provider
    const catalog = this.bus.catalog()
    const snapshot = await this.bus.snapshot()

    const system =
      `Tu es l'agent d'"Autowin OS", un cockpit d'orchestration d'agents. Tu CONVERSES avec ` +
      `l'utilisateur en français, naturellement, ET tu peux PILOTER l'application toi-même.\n` +
      `Pour agir sur l'app, émets une ou plusieurs commandes AU FORMAT EXACT : ` +
      `<cmd>{"name":"...","args":{...}}</cmd>. Tout texte HORS commande est ta réponse parlée à ` +
      `l'utilisateur (il la voit dans le chat). L'UI se met à jour EN DIRECT quand tu agis.\n` +
      `Commandes disponibles :\n` +
      catalog
        .map((c) => `- ${c.name}(${Object.keys(c.args).join(', ')}) : ${c.description}`)
        .join('\n') +
      `\nRègles : réponds normalement quand c'est une simple question ; n'utilise des commandes ` +
      `QUE si l'objectif demande d'agir sur l'app. Après une commande tu reçois le résultat + le ` +
      `nouvel état et tu peux continuer. Quand tu as fini d'agir, termine par ta réponse en clair ` +
      `SANS commande.\n${MODEL_QUESTION_INSTRUCTION}`

    // Reconstruit le fil : historique de la conversation + état courant de l'app.
    const convo: string[] = [
      `ÉTAT DE L'APP:\n${JSON.stringify(snapshot)}`,
      ...history.map((m) => `${m.role === 'user' ? 'UTILISATEUR' : 'TOI'}: ${m.content}`)
    ]

    // Coût cumulé du tour (toutes les itérations LLM du même message utilisateur).
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

    for (let i = 0; i < maxIter; i++) {
      const res = await this.registry.send(
        provider,
        [{ role: 'user', content: `${convo.join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)` }],
        { system }
      )
      if (res.usage) {
        usage.inputTokens += res.usage.inputTokens
        usage.outputTokens += res.usage.outputTokens
        usage.costUsd += res.usage.costUsd ?? 0
      }
      const text = res.text.trim()
      const question = parseModelQuestion(text)
      if (question && ask) {
        const answer = await ask(question)
        convo.push(`TOI: ${text}`)
        convo.push(`UTILISATEUR: ${answer}`)
        continue
      }

      const cmds: Array<{ name: string; args: Record<string, unknown> }> = []
      let m: RegExpExecArray | null
      CMD_RE.lastIndex = 0
      while ((m = CMD_RE.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(m[1]) as { name: string; args?: Record<string, unknown> }
          if (parsed.name) cmds.push({ name: parsed.name, args: parsed.args ?? {} })
        } catch {
          /* commande invalide — ignorée */
        }
      }

      const spoken = text.replace(CMD_RE, '').trim()
      if (spoken) onEvent({ kind: 'think', text: spoken })

      if (cmds.length === 0) {
        onEvent({ kind: 'done', text: spoken, usage })
        return
      }

      const results: string[] = []
      for (const c of cmds) {
        onEvent({ kind: 'command', name: c.name, args: c.args })
        const r = await this.bus.exec(c.name, c.args)
        onEvent({ kind: 'result', name: c.name, ok: r.ok, data: r.ok ? r.data : r.error })
        results.push(`${c.name} → ${r.ok ? JSON.stringify(r.data) : 'ERREUR ' + r.error}`)
      }

      const state = await this.bus.snapshot()
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\nÉTAT MAINTENANT:\n${JSON.stringify(state)}`)
    }
    onEvent({ kind: 'done', text: '', usage })
  }
}
