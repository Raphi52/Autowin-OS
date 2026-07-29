import type { ProviderRegistry } from './providers/registry'
import type { RoleModelConfig } from './roles'
import type { AppCommandBus } from './commands'
import type { Message, PromptEnvelope, SendOptions, Usage } from './providers/types'
import { parseModelQuestion, type ModelQuestion } from './model-questions'
import { VisibleStreamFilter } from '../shared/stream-markup-filter'
import type { ConversationAuthorityMode } from './conversation-capabilities'
import { randomUUID } from 'node:crypto'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { CONSTITUTION } from './constitution'
import { routeSkillRequest } from './skill-routing'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { startTurnTimer } from './turn-timing'
import {
  formatOrchestrationOutcome,
  type OrchestrationOutcome
} from '../shared/orchestration-outcome'

/**
 * Boucle de PILOTAGE : un agent LLM conduit l'app lui-même.
 * Il reçoit le catalogue de commandes + l'état courant, ÉMET des appels
 * `<cmd>{"name":..,"args":..}</cmd>`, qu'on exécute sur le bus (l'UI se met à jour
 * en direct), puis on lui renvoie le résultat + le nouvel état, et il reboucle
 * jusqu'à écrire DONE (ou cap d'itérations). C'est « l'agent voit ce qu'il update ».
 */
export interface PilotEvent {
  conversationId?: string
  kind:
    | 'delta'
    | 'stream-reset'
    | 'think'
    /** Raisonnement LIVE du modèle pendant qu'il réfléchit — affiché, jamais persisté dans le message. */
    | 'reasoning'
    | 'command'
    | 'result'
    | 'done'
    | 'error'
    | 'retry'
    | 'cancellation'
    | 'prompt-call'
  text?: string
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
  iteration?: number
  prompt?: PromptEnvelope
  response?: string
  status?: 'completed' | 'failed'
  error?: string
  callUsage?: Usage
  callDurationMs?: number
  sessionId?: string
  streamId?: string
  actionId?: string
  /** Coût cumulé du tour (surfacé sur l'event 'done') → journal d'activité par conversation. */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
}

const CONTROL_RE = /<(cmd|question)>\s*([\s\S]*?)\s*<\/\1>/g
const REJECTED_QUESTION_RE = /<question>[\s\S]*?(?:<\/question>|$)/gi
const REJECTED_QUESTION_MARKER = '[question modèle refusée et masquée]'

export type OrderedPilotToken =
  | { kind: 'text'; text: string }
  | { kind: 'command'; name: string; args: Record<string, unknown> }
  /**
   * Bloc `<cmd>` PRESENT mais inexploitable (JSON invalide, ou valide sans `name`). Avant, ces deux
   * cas etaient avales silencieusement : le modele croyait avoir agi, l'utilisateur recevait une
   * conclusion, et AUCUNE action n'avait eu lieu. Un faux « c'est fait » est le pire defaut possible
   * pour un agent — l'echec doit etre visible et corrigible.
   */
  | { kind: 'invalid'; raw: string; reason: string }

function filterVisibleText(raw: string): string {
  const filter = new VisibleStreamFilter()
  return filter.push(raw) + filter.finish()
}

export function parseOrderedPilotTokens(raw: string): OrderedPilotToken[] {
  const tokens: OrderedPilotToken[] = []
  let cursor = 0
  CONTROL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CONTROL_RE.exec(raw)) !== null) {
    const visible = filterVisibleText(raw.slice(cursor, match.index))
    if (visible) tokens.push({ kind: 'text', text: visible })
    if (match[1] === 'cmd') {
      const rawBlock = match[2]
      try {
        const parsed = JSON.parse(rawBlock) as {
          name?: string
          args?: Record<string, unknown>
        }
        if (parsed.name) {
          tokens.push({ kind: 'command', name: parsed.name, args: parsed.args ?? {} })
        } else {
          // JSON valide mais sans `name` : deuxieme trou silencieux du parseur d'origine.
          tokens.push({ kind: 'invalid', raw: rawBlock, reason: 'champ « name » absent' })
        }
      } catch (error) {
        tokens.push({
          kind: 'invalid',
          raw: rawBlock,
          reason: `JSON illisible : ${error instanceof Error ? error.message : String(error)}`
        })
      }
    }
    cursor = match.index + match[0].length
  }
  const trailing = filterVisibleText(raw.slice(cursor))
  if (trailing) tokens.push({ kind: 'text', text: trailing })
  return tokens
}

function waitForAnswer(answer: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return answer
  if (signal.aborted) return Promise.reject(new Error(String(signal.reason ?? 'aborted')))
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error(String(signal.reason ?? 'aborted')))
    signal.addEventListener('abort', abort, { once: true })
    answer.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export class AgentPilot {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly roles: RoleModelConfig,
    private readonly bus: AppCommandBus,
    private readonly retrieveContext?: (query: string) => Promise<string>,
    /**
     * Contexte projet plié (CLAUDE.md/AGENTS.md du workspace), MÊME source que les phases
     * orchestrées (context-files). Défaut vide → le chat reste fonctionnel sans workspace.
     */
    private readonly projectContext: () => string = () => ''
  ) {}

  /**
   * Sessions CLI du CHAT, par conversation (levier coût — mesure 2026-07-28 : 1,85 M de tokens de
   * cache_write en 1h, ~79 k de contexte re-payé à chaque tour). Même levier que le session-resume
   * chaîné de l'orchestrateur : quand le provider rend un sessionId, le tour suivant REPREND cette
   * session — l'historique est déjà connu du CLI, on n'envoie donc que le nouveau message.
   *
   * La clé inclut provider+modèle : un changement de binding INVALIDE la session (reprendre une
   * session ouverte avec un autre modèle n'a pas de sens). Cache mémoire volontairement : le gain
   * visé est intra-session d'app (les tours consécutifs), et une session CLI ne survit de toute
   * façon pas indéfiniment — pas de sessionId réutilisable ⇒ retour au comportement actuel.
   */
  private readonly chatSessions = new Map<string, { key: string; sessionId: string }>()

  /**
   * Mode CONVERSATION (chat transparent) : l'agent parle À l'utilisateur ET peut
   * piloter l'app dans le même tour. Le texte hors-commande est sa réponse parlée ;
   * les `<cmd>` sont exécutées et rendues comme des actions inline. L'historique
   * complet est réinjecté pour un vrai multi-tours. Un tour peut enchaîner plusieurs
   * itérations (agir → constater → répondre) jusqu'à ce qu'il ne reste plus de commande.
   */
  async chat(
    history: Message[],
    onEvent: (e: PilotEvent) => void,
    ask?: (question: ModelQuestion) => Promise<string>,
    /**
     * Cap d'iterations d'un tour. Releve de 6 a 12 le 2026-07-29 : sur un blocage reel, l'agent avait
     * consomme 4 iterations en `edit_file` rates avant meme de pouvoir chercher une autre voie, puis
     * s'est arrete sur « cap atteint sans reponse finale » — en laissant des mutations partielles.
     * La regle anti-abandon lui demande desormais de CHERCHER, ESSAYER puis NETTOYER : il faut de quoi
     * le faire. Le cout reste borne par le budget du tour (AUTOWIN_CHAT_USD_CAP), qui coupe sur la
     * depense reelle plutot que sur un compteur aveugle.
     */
    maxIter = 12,
    conversationId?: string,
    signal?: AbortSignal,
    authorityMode: ConversationAuthorityMode = 'ask',
    /** Directives injectées par l'utilisateur PENDANT le tour — drainées à chaque itération. */
    drainDirectives?: () => string[]
  ): Promise<void> {
    // Chronométrage des jalons jusqu'au PREMIER token : c'est la latence réellement perçue au clic.
    const timer = startTurnTimer('chat')
    let timingWritten = false
    const binding = this.roles.getBinding('orchestrator')
    const provider = binding.provider
    const catalog = this.bus.catalog()
    const snapshot = await this.bus.snapshotForPrompt()
    timer.mark('snapshot')

    const latestUserMessage = [...history]
      .reverse()
      .find((message) => message.role === 'user')?.content
    const directRoute = latestUserMessage ? routeSkillRequest(latestUserMessage) : undefined
    // COURT-CIRCUIT reserve a la demande EXPLICITE (« /scout … », « /build … »).
    //
    // L'ancienne branche heuristique (`workspace-action`, deduite d'un verbe + une cible) est RETIREE.
    // MESURE sur 251 messages reels : elle se declenchait 8 fois, dont 6 a tort — precision 25 %,
    // rappel 2 % — alors que le MODELE a decide correctement dans 101 cas. Deviner dans le code
    // court-circuitait `chat()` AVANT le modele, donc aucune consigne de prompt ne pouvait corriger
    // l'erreur : c'est le mecanisme exact de la regression du 2026-07-28, qui etait toujours arme.
    // Une commande explicite, elle, ne devine RIEN : l'utilisateur a nomme la phase.
    if (directRoute?.reason === 'explicit-skill') {
      const actionId = 'route:0'
      const args = { task: directRoute.task }
      onEvent({ kind: 'command', actionId, name: 'orchestrate', args })
      signal?.throwIfAborted()
      const result = await this.bus.exec('orchestrate', args, conversationId, authorityMode)
      onEvent({
        kind: 'result',
        actionId,
        name: 'orchestrate',
        ok: result.ok,
        data: result.ok ? result.data : result.error
      })
      // Une orientation peut arriver pendant l'orchestration longue. On vide la file jusqu'à un
      // point stable avant de clore le tour : aucune directive déjà acquittée ne peut être perdue.
      let followUpIndex = 0
      for (;;) {
        const directives = drainDirectives?.() ?? []
        if (!directives.length) break
        for (const directive of directives) {
          const followUpActionId = `route:follow-up:${followUpIndex++}`
          const followUpArgs = { task: directive }
          onEvent({
            kind: 'command',
            actionId: followUpActionId,
            name: 'orchestrate',
            args: followUpArgs
          })
          const followUp = await this.bus.exec(
            'orchestrate',
            followUpArgs,
            conversationId,
            authorityMode
          )
          onEvent({
            kind: 'result',
            actionId: followUpActionId,
            name: 'orchestrate',
            ok: followUp.ok,
            data: followUp.ok ? followUp.data : followUp.error
          })
        }
      }
      onEvent({
        kind: 'done',
        // Les FAITS, pas une formule : statut, validite, blocage de gate, cout, run et resultat sont
        // tous rendus par l'orchestrateur et etaient jetes (conv-76 : 18 sous-agents, 10,05 $, le fil
        // n'affichait que « Workflow Autowin execute. »).
        text: formatOrchestrationOutcome(
          result.ok,
          result.ok ? (result.data as OrchestrationOutcome | undefined) : undefined,
          result.ok ? undefined : String(result.error ?? '')
        ),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
      })
      return
    }
    const retrievedContext =
      this.retrieveContext && latestUserMessage
        ? await this.retrieveContext(latestUserMessage).catch(() => '')
        : ''
    timer.mark('ragBrain')

    // MÊME config que les phases orchestrées : la CONSTITUTION (soul/réflexes) est la source
    // UNIQUE partagée ; le chat y ajoute seulement ce qui lui est propre (pilotage par commandes).
    const pilotage = buildChatPilotagePrompt(catalog)
    /**
     * PRÉFIXE SYSTEM STABLE = condition du cache (mesure 2026-07-28 : cache_read = 0 sur 100 % des
     * appels, ~16 k de cache_write REÉCRITS à chaque tour, ~0,32 $ pour répondre une phrase).
     *
     * Le contexte Brain est un résultat de recherche qui DÉPEND du message de l'utilisateur : tant
     * qu'il était concaténé ici, le system prompt changeait à chaque tour et aucun préfixe ne pouvait
     * être réutilisé. Il est désormais passé dans le MESSAGE (voir `convo`) : même information remise
     * au modèle, mais le system redevient identique d'un tour à l'autre, donc cachable.
     */
    const systemParts = [
      { name: 'constitution', text: CONSTITUTION },
      { name: 'pilotage', text: pilotage },
      { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
      { name: 'projectContext', text: this.projectContext() }
    ]
    const system = systemParts.map((p) => p.text).join('')
    const systemBlocks = systemParts
      .filter((p) => p.text)
      .map((p) => ({ name: p.name, chars: p.text.length }))

    // Reconstruit le fil : historique de la conversation + état courant de l'app.
    // Session-resume du CHAT (levier coût) : si la conversation a déjà une session CLI ouverte avec
    // le MÊME binding, on la reprend — l'historique y est déjà, on n'envoie donc que le dernier
    // message + l'état courant de l'app (qui, lui, a pu changer). Sinon : fil complet, inchangé.
    const sessionKey = `${provider}:${binding.model ?? ''}`
    const known = conversationId ? this.chatSessions.get(conversationId) : undefined
    const resumeSessionId = known?.key === sessionKey ? known.sessionId : undefined
    const lastUserMessage = [...history].reverse().find((m) => m.role === 'user')
    // Le contexte Brain vit ICI (et non dans le system) pour ne pas casser le préfixe cachable.
    const brainContext = retrievedContext ? `CONNAISSANCE RÉCUPÉRÉE:\n${retrievedContext}` : ''
    const convo: string[] = resumeSessionId
      ? [
          `ÉTAT DE L'APP:\n${JSON.stringify(snapshot)}`,
          brainContext,
          `Suite de NOTRE conversation en cours (tu en connais déjà l'historique par ta session : ne le redemande pas).`,
          `UTILISATEUR: ${lastUserMessage?.content ?? ''}`
        ]
      : [
          `ÉTAT DE L'APP:\n${JSON.stringify(snapshot)}`,
          brainContext,
          ...history.map((m) => `${m.role === 'user' ? 'UTILISATEUR' : 'TOI'}: ${m.content}`)
        ]
    // Une entrée vide (pas de contexte Brain récupéré) ne doit pas laisser de trou dans le prompt.
    const convoFiltered = convo.filter((entry) => entry.trim().length > 0)
    convo.length = 0
    convo.push(...convoFiltered)
    const currentAttachments = history.at(-1)?.attachments

    // Coût cumulé du tour (toutes les itérations LLM du même message utilisateur).
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

    let iterationLimit = maxIter
    let invalidQuestionRecoveryAvailable = true
    /**
     * TOUR MUET — un tour qui n'a produit que des etiquettes d'action est inexploitable.
     *
     * Constate sur conv-76 (2026-07-29) : trois messages assistant de 40 a 64 caracteres, contenant
     * uniquement « [a execute edit_file] [a execute verify] ». L'utilisateur ne pouvait pas savoir ce
     * qui avait ete fait — il a cru que les sous-agents ne se lançaient plus alors que 18 appels
     * avaient tourne pour 10,05 $. Le prompt demande deja de conclure ; le modele ne le fait pas
     * toujours. On le rend donc MECANIQUE : si le tour se termine sans un mot alors qu'il a AGI, on
     * redemande explicitement la conclusion. Une seule fois, comme la reprise de question invalide.
     */
    let anyActionExecuted = false
    /**
     * A-t-il parle A UN MOMENT du tour ? La question porte sur le TOUR ENTIER, pas sur la derniere
     * iteration : un tour « Avant. <action> Apres. » suivi d'une reponse vide a deja tout dit, le
     * relancer serait du bavardage paye. (Bug attrape par agent-pilot.streaming.test.ts.)
     */
    let anySpokenText = false
    let conclusionRecoveryAvailable = true
    for (let i = 0; i < iterationLimit; i++) {
      // Pilotage continu : les directives envoyées PENDANT le tour entrent au prochain
      // point d'itération (priorité immédiate, sans attendre la fin du tour).
      for (const directive of drainDirectives?.() ?? []) {
        convo.push(`UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${directive}`)
      }
      const messages: Message[] = [
        {
          role: 'user',
          content: `${convo.join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)`,
          ...(i === 0 && currentAttachments?.length ? { attachments: currentAttachments } : {})
        }
      ]
      let prompt = this.registry.describePrompt(
        provider,
        messages,
        {
          system,
          systemBlocks,
          model: binding.model,
          reasoningEffort: binding.reasoningEffort
        },
        binding.model
      )
      prompt.systemBlocks = systemBlocks
      const options: SendOptions = {
        system,
        systemBlocks,
        model: binding.model,
        reasoningEffort: binding.reasoningEffort,
        // Repris seulement au PREMIER appel du tour : les itérations suivantes chaînent déjà sur la
        // session que ce tour vient d'ouvrir (voir la mémorisation après réception).
        ...(resumeSessionId && i === 0 ? { resumeSessionId } : {}),
        observePrompt: (observed) => {
          observed.systemBlocks = systemBlocks
          prompt = observed
        },
        signal,
        requestId: randomUUID()
      }
      let res
      let attempt = 0
      let callStartedAt = performance.now()
      let successfulStreamedPrefix = ''
      let successfulAttempt = 0
      while (!res) {
        const streamId = `${i}:${attempt}`
        const visibleFilter = new VisibleStreamFilter()
        let attemptStreamedPrefix = ''
        let commandBoundarySeen = false
        const emitVisiblePrefix = (
          segments: ReturnType<VisibleStreamFilter['pushSegments']>
        ): void => {
          for (const segment of segments) {
            if (segment.kind === 'control') {
              if (segment.control === 'cmd') commandBoundarySeen = true
              continue
            }
            if (commandBoundarySeen || !segment.text) continue
            attemptStreamedPrefix += segment.text
            onEvent({ kind: 'delta', streamId, text: segment.text, iteration: i })
          }
        }
        try {
          callStartedAt = performance.now()
          timer.mark(`send${i}:start`)
          let sawFirstChunk = false
          res = await this.registry.send(provider, messages, options, (chunk) => {
            // Raisonnement : canal SÉPARÉ, diffusé en direct, hors du texte de la réponse.
            if (chunk.reasoning) {
              onEvent({ kind: 'reasoning', text: chunk.reasoning, iteration: i })
              return
            }
            if (!sawFirstChunk) {
              sawFirstChunk = true
              timer.mark(`send${i}:firstToken`) // ← fin de la latence PERÇUE
              if (!timingWritten) {
                timingWritten = true
                timer.end({ provider, model: binding.model }) // persiste les jalons du 1er token
              }
            }
            emitVisiblePrefix(visibleFilter.pushSegments(chunk.delta))
          })
          timer.mark(`send${i}:done`)
          emitVisiblePrefix(visibleFilter.finishSegments())
          successfulStreamedPrefix = attemptStreamedPrefix
          successfulAttempt = attempt
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (signal?.aborted) {
            onEvent({
              kind: 'cancellation',
              iteration: i,
              name: provider,
              text: 'Annulation demandée par utilisateur',
              data: { reason: signal.reason ?? 'user' }
            })
            throw error
          }
          onEvent({
            kind: 'prompt-call',
            iteration: i,
            prompt,
            response: '',
            status: 'failed',
            error: message,
            callDurationMs: performance.now() - callStartedAt
          })
          if (attempt >= 1) throw error
          if (attemptStreamedPrefix) onEvent({ kind: 'stream-reset', streamId, iteration: i })
          attempt += 1
          onEvent({
            kind: 'retry',
            iteration: i,
            name: provider,
            text: message,
            data: { attempt, maxAttempts: 2 }
          })
        }
      }
      onEvent({
        kind: 'prompt-call',
        iteration: i,
        prompt,
        response: res.text.replace(REJECTED_QUESTION_RE, REJECTED_QUESTION_MARKER),
        status: 'completed',
        callUsage: res.usage,
        callDurationMs: performance.now() - callStartedAt,
        sessionId: res.sessionId
      })
      // Mémorise la session pour que le PROCHAIN tour la reprenne au lieu de re-payer l'historique.
      if (conversationId && res.sessionId) {
        this.chatSessions.set(conversationId, { key: sessionKey, sessionId: res.sessionId })
      }
      if (res.usage) {
        usage.inputTokens += res.usage.inputTokens
        usage.outputTokens += res.usage.outputTokens
        usage.costUsd += res.usage.costUsd ?? 0
      }
      // Dernière barrière avant d'interpréter/clore la réponse : une directive arrivée pendant
      // l'appel provider invalide cette réponse devenue obsolète. On la réinjecte dans un nouvel
      // appel du MÊME tour. Entre ce drain vide et les branches synchrones ci-dessous, aucun IPC ne
      // peut s'intercaler : l'ACK immédiat reste donc sans fenêtre de perte en fin de tour.
      const lateDirectives = drainDirectives?.() ?? []
      if (lateDirectives.length) {
        for (const directive of lateDirectives) {
          convo.push(
            `UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${directive}`
          )
        }
        if (successfulStreamedPrefix) {
          onEvent({ kind: 'stream-reset', streamId: `${i}:${successfulAttempt}`, iteration: i })
        }
        iterationLimit += 1
        continue
      }
      const rejectedQuestion = /<question>/i.test(res.text)
      const text = res.text.replace(REJECTED_QUESTION_RE, REJECTED_QUESTION_MARKER).trim()
      const question = parseModelQuestion(text)
      if (question && ask) {
        const answer = await waitForAnswer(ask(question), signal)
        convo.push(`TOI: ${text}`)
        convo.push(`UTILISATEUR: ${answer}`)
        continue
      }
      if (!question && rejectedQuestion) {
        convo.push(`TOI: ${REJECTED_QUESTION_MARKER}`)
        convo.push(
          'SYSTÈME: question refusée — aucun motif de blocage autorisé et vérifiable. ' +
            'Continue de façon autonome avec une hypothèse raisonnable, sans solliciter l’utilisateur.'
        )
        if (invalidQuestionRecoveryAvailable) {
          iterationLimit += 1
          invalidQuestionRecoveryAvailable = false
          continue
        }
        onEvent({ kind: 'done', text: '', usage })
        return
      }

      const ordered = parseOrderedPilotTokens(res.text)
      const spoken = ordered
        .filter(
          (token): token is Extract<OrderedPilotToken, { kind: 'text' }> => token.kind === 'text'
        )
        .map((token) => token.text)
        .join('')
        .trim()
      if (spoken) anySpokenText = true
      const hasCommand = ordered.some((token) => token.kind === 'command')

      if (!hasCommand) {
        if (!successfulStreamedPrefix && spoken) onEvent({ kind: 'think', text: spoken })
        else if (successfulStreamedPrefix) {
          const visible = ordered
            .filter(
              (token): token is Extract<OrderedPilotToken, { kind: 'text' }> =>
                token.kind === 'text'
            )
            .map((token) => token.text)
            .join('')
          const remainder = visible.startsWith(successfulStreamedPrefix)
            ? visible.slice(successfulStreamedPrefix.length)
            : ''
          if (remainder)
            onEvent({
              kind: 'delta',
              streamId: `${i}:${successfulAttempt}:remainder`,
              text: remainder,
              iteration: i
            })
        }
        // Le tour a AGI mais n'a rien dit : on redemande la conclusion plutot que de livrer des
        // etiquettes nues. Borne a une relance pour ne jamais boucler.
        if (!anySpokenText && anyActionExecuted && conclusionRecoveryAvailable) {
          conclusionRecoveryAvailable = false
          iterationLimit += 1
          convo.push(
            'SYSTÈME: tu as agi mais tu n’as rien dit — l’utilisateur ne voit que des étiquettes ' +
              'd’action, il ne peut pas savoir ce qui a été fait. Conclus MAINTENANT en clair, SANS ' +
              'aucune commande : ce que tu as fait, ce que cela a produit (résultats/exit codes ' +
              'observés), et ce qui reste. Si une action a échoué, dis-le explicitement.'
          )
          continue
        }
        onEvent({ kind: 'done', text: spoken, usage })
        return
      }

      const results: string[] = []
      let commandIndex = 0
      let tokenIndex = 0
      let streamedPrefixRemaining = successfulStreamedPrefix
      for (const token of ordered) {
        signal?.throwIfAborted()
        if (token.kind === 'text') {
          let visible = token.text
          if (streamedPrefixRemaining) {
            if (streamedPrefixRemaining.startsWith(visible)) {
              streamedPrefixRemaining = streamedPrefixRemaining.slice(visible.length)
              visible = ''
            } else if (visible.startsWith(streamedPrefixRemaining)) {
              visible = visible.slice(streamedPrefixRemaining.length)
              streamedPrefixRemaining = ''
            } else {
              visible = ''
              streamedPrefixRemaining = ''
            }
          }
          if (visible)
            onEvent({
              kind: 'delta',
              streamId: `${i}:${successfulAttempt}:ordered:${tokenIndex}`,
              text: visible,
              iteration: i
            })
          tokenIndex += 1
          continue
        }

        if (token.kind === 'invalid') {
          /**
           * Bloc `<cmd>` inexploitable. Avant, il disparaissait sans trace : le modele croyait avoir
           * agi, l'utilisateur lisait une conclusion, et rien ne s'etait produit. Desormais l'echec
           * est (a) VISIBLE dans le fil et (b) REINJECTE au modele pour qu'il corrige au tour
           * suivant. Aucune action n'est inventee : on signale, on ne devine pas l'intention.
           */
          const actionId = `${i}:${commandIndex++}`
          onEvent({ kind: 'command', actionId, name: 'commande illisible', args: {} })
          onEvent({
            kind: 'result',
            actionId,
            name: 'commande illisible',
            ok: false,
            data: `${token.reason} — aucune action n'a été exécutée`
          })
          results.push(
            `COMMANDE ILLISIBLE (${token.reason}) — AUCUNE action executee. Bloc recu : ` +
              `${token.raw.slice(0, 300)}. Re-emets une commande VALIDE au format exact ` +
              `<cmd>{"name":"...","args":{...}}</cmd>, ou reponds sans commande.`
          )
          tokenIndex += 1
          continue
        }

        const actionId = `${i}:${commandIndex++}`
        anyActionExecuted = true
        onEvent({ kind: 'command', actionId, name: token.name, args: token.args })
        signal?.throwIfAborted()
        const r = await this.bus.exec(token.name, token.args, conversationId, authorityMode)
        onEvent({
          kind: 'result',
          actionId,
          name: token.name,
          ok: r.ok,
          data: r.ok ? r.data : r.error
        })
        results.push(`${token.name} → ${r.ok ? JSON.stringify(r.data) : 'ERREUR ' + r.error}`)
        tokenIndex += 1
      }

      const state = await this.bus.snapshotForPrompt()
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\nÉTAT MAINTENANT:\n${JSON.stringify(state)}`)
    }
    const capError = `Cap d'itérations (${maxIter}) atteint sans réponse finale`
    onEvent({
      kind: 'error',
      text: capError,
      usage
    })
    throw new Error(capError)
  }
}
