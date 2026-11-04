import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk,
  Usage
} from './types'
import { creerOutilsAgentDirect } from './outils-agent-direct'

/**
 * Moteur NATIF « compatible OpenAI » : parle HTTP directement à `/chat/completions`, SANS aucun CLI.
 *
 * Pourquoi (conv-1499) : les deux moteurs existants délèguent la boucle d'agent à un outil en ligne
 * de commande (Claude, Codex). Codex 0.166 refuse `wire_api="chat"` et Gemini AI Studio rend 404 sur
 * `/responses` : tout service qui ne parle QUE le format « chat completions » (Gemini, Groq, Mistral,
 * Cerebras, Ollama, LM Studio…) n'avait donc aucune voie. Ici, c'est Autowin qui mène la boucle :
 * appeler le modèle, exécuter les outils qu'il demande, lui renvoyer les résultats, recommencer.
 *
 * Les OUTILS sont injectés (`outils`), jamais codés ici : le moteur ne décide pas de la surface
 * d'action. Sans outil, c'est un moteur de chat pur — `supportsExecution` le dit honnêtement.
 */

/** Un outil que le modèle peut appeler. `parametres` = schéma JSON des arguments. */
export interface OutilAgent {
  nom: string
  description: string
  parametres: Record<string, unknown>
  executer(args: Record<string, unknown>, ctx: { signal?: AbortSignal }): Promise<string>
}

export interface OpenAICompatConfig {
  /** Identifiant du moteur au registre, ex. `gemini`, `groq`, `ollama`. */
  id: string
  /** Base de l'API, SANS `/chat/completions`, ex. `https://api.groq.com/openai/v1`. */
  baseUrl: string
  /** Variable d'environnement qui porte la clé. Absente = service local sans clé (Ollama). */
  apiKeyEnv?: string
  defaultModel: string
  outils?: OutilAgent[]
  /**
   * Outils d'agent du DOSSIER DU RUN (lire, écrire, éditer, commande, grep, glob — conv-1502), créés
   * à chaque envoi qui porte `execution.cwd`, gardés par le script PreToolUse du moteur Claude.
   * Défaut : actifs. `false` = moteur de chat pur même en exécution.
   */
  outilsDuDossier?: boolean | ((execution: NonNullable<SendOptions['execution']>) => OutilAgent[])
  /** Garde-fou contre une boucle d'outils sans fin. */
  maxEtapes?: number
  /** Transport injectable (tests) ; seul le sous-ensemble utilisé est exigé. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  env?: NodeJS.ProcessEnv
}

interface MessageApi {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: AppelOutilApi[]
  tool_call_id?: string
}

interface AppelOutilApi {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export class OpenAICompatAdapter implements ProviderAdapter {
  readonly id: string
  readonly honoursSessionResume = false
  private readonly cfg: OpenAICompatConfig

  constructor(cfg: OpenAICompatConfig) {
    this.cfg = cfg
    this.id = cfg.id
  }

  get supportsExecution(): boolean {
    return (this.cfg.outils?.length ?? 0) > 0 || this.cfg.outilsDuDossier !== false
  }

  private outilsDe(opts: SendOptions): OutilAgent[] {
    const propres = this.cfg.outils ?? []
    const ex = opts.execution
    const fabrique = this.cfg.outilsDuDossier
    if (!ex?.cwd || fabrique === false) return propres
    const duDossier =
      typeof fabrique === 'function'
        ? fabrique(ex)
        : creerOutilsAgentDirect({ cwd: ex.cwd, sandbox: ex.sandbox, agentEnv: ex.agentEnv })
    return [...propres, ...duDossier]
  }

  private cle(): string | undefined {
    if (!this.cfg.apiKeyEnv) return undefined
    const v = (this.cfg.env ?? process.env)[this.cfg.apiKeyEnv]?.trim()
    return v || undefined
  }

  async auth(): Promise<boolean> {
    return !this.cfg.apiKeyEnv || this.cle() !== undefined
  }

  describePrompt(messages: Message[], opts: SendOptions, model?: string): PromptEnvelope {
    return {
      provider: this.id,
      model: model ?? opts.model ?? this.cfg.defaultModel,
      transport: `http ${this.cfg.baseUrl}/chat/completions`,
      system: opts.system,
      systemBlocks: opts.systemBlocks,
      contextBlocks: opts.contextBlocks,
      messages,
      options: { outils: this.outilsDe(opts).map((o) => o.nom) },
      limitation: 'pièces jointes binaires non transmises ; pas de reprise de session'
    }
  }

  async *send(messages: Message[], opts: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    const model = opts.model ?? this.cfg.defaultModel
    opts.observePrompt?.(this.describePrompt(messages, opts, model))
    if (this.cfg.apiKeyEnv && !this.cle()) {
      throw new Error(`${this.id} : clé absente — définis la variable ${this.cfg.apiKeyEnv}`)
    }
    const fil: MessageApi[] = []
    if (opts.system) fil.push({ role: 'system', content: opts.system })
    for (const m of messages) fil.push({ role: m.role, content: contenuTexte(m) })

    const outils = this.outilsDe(opts)
    const maxEtapes = this.cfg.maxEtapes ?? 25
    let texte = ''
    let raisonnement = ''
    const usage: Usage = { inputTokens: 0, outputTokens: 0 }
    let usageVu = false
    let modeleReel: string | undefined

    for (let etape = 0; etape < maxEtapes; etape++) {
      const reponse = await this.appeler(fil, model, outils, opts.signal)
      let texteEtape = ''
      const appels = new Map<number, AppelOutilApi>()
      for await (const evt of lireSse(reponse)) {
        if (evt.model) modeleReel = evt.model
        if (evt.usage) {
          usageVu = true
          usage.inputTokens += evt.usage.prompt_tokens ?? 0
          usage.outputTokens += evt.usage.completion_tokens ?? 0
        }
        const delta = evt.choices?.[0]?.delta
        if (!delta) continue
        const pense = delta.reasoning_content ?? delta.reasoning
        if (pense) {
          raisonnement += pense
          yield { delta: '', reasoning: pense }
        }
        if (delta.content) {
          texteEtape += delta.content
          yield { delta: delta.content }
        }
        for (const tc of delta.tool_calls ?? []) {
          const i = tc.index ?? 0
          const cur = appels.get(i) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
          if (tc.id) cur.id = tc.id
          if (tc.function?.name) cur.function.name += tc.function.name
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
          appels.set(i, cur)
        }
      }
      texte += texteEtape
      if (appels.size === 0) {
        return {
          text: texte,
          provider: this.id,
          systemInjected: Boolean(opts.system),
          usage: usageVu ? usage : undefined,
          thinking: raisonnement || undefined,
          model: modeleReel ?? model
        }
      }
      const liste = [...appels.values()]
      fil.push({ role: 'assistant', content: texteEtape || null, tool_calls: liste })
      for (const appel of liste) {
        yield { delta: '', status: `outil ${appel.function.name}` }
        fil.push({ role: 'tool', tool_call_id: appel.id, content: await executerAppel(outils, appel, opts.signal) })
      }
    }
    throw new Error(`${this.id} : boucle d'outils arrêtée après ${maxEtapes} étapes sans réponse finale`)
  }

  private async appeler(fil: MessageApi[], model: string, outils: OutilAgent[], signal?: AbortSignal): Promise<Response> {
    const corps: Record<string, unknown> = {
      model,
      messages: fil,
      stream: true,
      stream_options: { include_usage: true }
    }
    if (outils.length > 0) {
      corps.tools = outils.map((o) => ({
        type: 'function',
        function: { name: o.nom, description: o.description, parameters: o.parametres }
      }))
    }
    const entetes: Record<string, string> = { 'content-type': 'application/json' }
    const cle = this.cle()
    if (cle) entetes.authorization = `Bearer ${cle}`
    const rep = await (this.cfg.fetchImpl ?? fetch)(`${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify(corps),
      signal
    })
    if (!rep.ok) {
      const detail = (await rep.text().catch(() => '')).slice(0, 500)
      throw new Error(`${this.id} : HTTP ${rep.status} ${detail}`.trim())
    }
    return rep
  }
}

function contenuTexte(m: Message): string {
  const joints = (m.attachments ?? [])
    .filter((a) => a.kind === 'text')
    .map((a) => `\n\n[Pièce jointe ${a.name}]\n${a.content}`)
  return m.content + joints.join('')
}

async function executerAppel(outils: OutilAgent[], appel: AppelOutilApi, signal?: AbortSignal): Promise<string> {
  const outil = outils.find((o) => o.nom === appel.function.name)
  if (!outil) return `Erreur : outil inconnu « ${appel.function.name} ».`
  let args: Record<string, unknown>
  try {
    args = appel.function.arguments ? JSON.parse(appel.function.arguments) : {}
  } catch {
    // Rendu au modèle plutôt que levé : il peut corriger son appel à l'étape suivante.
    return `Erreur : arguments JSON invalides pour « ${outil.nom} ».`
  }
  try {
    return await outil.executer(args, { signal })
  } catch (e) {
    return `Erreur : ${e instanceof Error ? e.message : String(e)}`
  }
}

interface EvenementSse {
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string
      reasoning?: string
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
    }
  }>
}

async function* lireSse(rep: Response): AsyncGenerator<EvenementSse> {
  if (!rep.body) return
  const decodeur = new TextDecoder()
  let tampon = ''
  const lecteur = rep.body.getReader()
  for (;;) {
    const { done, value } = await lecteur.read()
    if (done) return
    tampon += decodeur.decode(value, { stream: true })
    let fin: number
    while ((fin = tampon.indexOf('\n')) >= 0) {
      const ligne = tampon.slice(0, fin).trim()
      tampon = tampon.slice(fin + 1)
      if (!ligne.startsWith('data:')) continue
      const donnee = ligne.slice(5).trim()
      if (donnee === '[DONE]') return
      try {
        yield JSON.parse(donnee) as EvenementSse
      } catch {
        // ligne partielle ou commentaire de service : ignorée
      }
    }
  }
}
