import { forgetChatSession, loadChatSessions, saveChatSession } from './runs/chat-session-store'
import type { ProviderRegistry } from './providers/registry'
import type { RoleBinding, RoleModelConfig } from './roles'
import type { AppCommandBus, CommandResult } from './commands'
import {
  ProviderCallError,
  type Message,
  type PromptEnvelope,
  type SendOptions,
  type SendResult,
  type Usage
} from './providers/types'
import { parseModelQuestion, type ModelQuestion } from './model-questions'
import { evictedCount, rememberedFacts, sessionMemoryBlock } from './session-memory-echo'
import { buildTurnMessages } from './chat-turn-messages'
import { invokedSkillId, skillInstruction } from './skill-pipeline'
import { VisibleStreamFilter } from '../shared/stream-markup-filter'
import { randomUUID } from 'node:crypto'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { CONSTITUTION } from './constitution'
import { routeSkillRequest } from './skill-routing'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { startTurnTimer } from './turn-timing'
import { classifyMutationConfidence } from './orchestrator'
import {
  formatOrchestrationOutcome,
  isDeliveredOrchestrationOutcome,
  ORCHESTRATION_ALREADY_ISSUED_REFUSAL,
  type OrchestrationOutcome
} from '../shared/orchestration-outcome'
import type { ChatArtifact } from '../shared/artifacts'
import type { PilotEventKind } from '../shared/pilot-events'

/**
 * Boucle de PILOTAGE : un agent LLM conduit l'app lui-même.
 * Il reçoit le catalogue de commandes + l'état courant, ÉMET des appels
 * `<cmd>{"name":..,"args":..}</cmd>`, qu'on exécute sur le bus (l'UI se met à jour
 * en direct), puis on lui renvoie le résultat + le nouvel état, et il reboucle
 * jusqu'à écrire DONE (ou cap d'itérations). C'est « l'agent voit ce qu'il update ».
 */
type TurnUsage = { inputTokens: number; outputTokens: number; costUsd?: number }

/**
 * Union discriminée sur `kind` : chaque variante ne porte que ses champs REELS, non-optionnels
 * quand ils le sont vraiment. Avant, `PilotEvent` etait une interface a ~20 champs optionnels pour
 * 13 `kind` differents — rien n'empechait d'ecrire `{kind:'command'}` sans `name`, ou
 * `{kind:'result'}` sans `actionId` : l'erreur ne se voyait qu'a l'execution. Le typage devient
 * l'oracle : un site d'emission incomplet ne compile plus.
 *
 * `PilotEvent` (large, ci-dessous) reste exporte tel quel pour les consommateurs hors-perimetre
 * (preload/renderer/main index.ts) qui l'utilisent deja de façon structurelle — cette union est
 * assignable a `PilotEvent` (chaque champ requis d'une variante est un optionnel de meme nom/type
 * dans le large), donc `emit(e: PilotEvent)` continue d'accepter ces valeurs sans changement
 * d'API externe.
 */
export type PilotEventVariant =
  | { kind: 'delta'; streamId: string; text: string; iteration: number }
  | { kind: 'stream-reset'; streamId: string; iteration: number }
  | { kind: 'think'; text: string }
  /** Raisonnement LIVE du modèle pendant qu'il réfléchit — affiché, jamais persisté dans le message. */
  | { kind: 'reasoning'; text: string; iteration: number }
  | { kind: 'command'; actionId: string; name: string; args: unknown }
  | {
      kind: 'result'
      actionId: string
      name: string
      ok: boolean
      data?: unknown
      attachments?: NonNullable<Message['attachments']>
    }
  | {
      kind: 'done'
      text: string
      usage?: TurnUsage
      /**
       * Issue d'orchestration STRUCTUREE. `text` en est la mise en forme humaine ; la trace, elle,
       * a besoin des champs (gateBlocked, valid, reused) pour etre filtrable et comptable — un
       * texte libre ne se filtre pas.
       */
      outcome?: Record<string, unknown>
    }
  | { kind: 'error'; text: string; usage?: TurnUsage }
  | { kind: 'retry'; iteration: number; name: string; text: string; data: unknown }
  | { kind: 'cancellation'; iteration: number; name: string; text: string; data: unknown }
  | {
      kind: 'prompt-call'
      iteration: number
      prompt: PromptEnvelope
      response: string
      status: 'completed' | 'failed'
      error?: string
      callUsage?: Usage
      callDurationMs: number
      sessionId?: string
      /** Identite concrete rapportee par le provider, distincte du modele demande. */
      resolvedModel?: string
    }
  | { kind: 'artifact'; artifact: ChatArtifact; iteration: number }

/**
 * Type LARGE historique, conserve pour la compatibilite des consommateurs hors-perimetre
 * (src/preload, src/renderer, src/main/index.ts) qui typent leurs propres event handlers dessus ou
 * le re-exportent. `AgentPilot.chat()` n'émet plus directement sur cette forme : en interne, chaque
 * évènement est construit comme `PilotEventVariant` (voir `emit()` dans `chat()`), qui est
 * structurellement assignable ici.
 */
export interface PilotEvent {
  conversationId?: string
  /**
   * Vocabulaire partagé avec le renderer (`src/shared/pilot-events.ts`). Écrit à la main des deux
   * côtés, il avait dérivé : `reasoning` et `prompt-call` manquaient côté renderer, sans que rien ne
   * le signale — la frontière IPC fait un cast non vérifié.
   */
  kind: PilotEventKind
  text?: string
  /**
   * Issue d'orchestration STRUCTUREE, portee par le `done`. `text` en est la mise en forme humaine ;
   * la trace, elle, a besoin des champs (gateBlocked, valid, reused) pour etre filtrable et
   * comptable — un texte libre ne se filtre ni ne se compte.
   */
  outcome?: Record<string, unknown>
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
  artifact?: ChatArtifact
  /** Modele concret rapporte par le provider pour un appel termine. */
  resolvedModel?: string
  /** Pieces jointes brutes du resultat, durables cote main mais retirees avant l'IPC renderer. */
  attachments?: NonNullable<Message['attachments']>
  /** Coût cumulé du tour (surfacé sur l'event 'done') → journal d'activité par conversation. */
  usage?: TurnUsage
}

/**
 * Résultat terminal d'un appel provider qui a fini pendant l'absence du main Electron. Le pilote
 * repart à l'itération enregistrée : il consomme ce résultat une fois, sans respawn équivalent.
 */
export interface RecoveredPilotProviderCall {
  iteration: number
  attempt: number
  streamId: string
  /** Préfixe déjà persisté dans le message avant le redémarrage : il ne doit pas être réémis. */
  streamedPrefix: string
  /** Résultats déjà persistés pour cette réponse provider : ne jamais rejouer leurs commandes. */
  settledActions?: RecoveredPilotActionResult[]
  result: SendResult
}

export interface RecoveredPilotActionResult {
  actionId: string
  name: string
  ok: boolean
  data?: unknown
  attachments?: NonNullable<Message['attachments']>
}

/** Barrière durable du chat direct, publiée par l'adaptateur avant son spawn. */
export interface PilotProviderJournalLink {
  provider: string
  token: string
  journalPath: string
  iteration: number
  attempt: number
  streamId: string
  requestId: string
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

/**
 * T1b — reconstruction du texte déjà streamé, FACTORISÉE. `chat()` doit émettre en `delta` le texte
 * final moins ce qui a déjà été streamé pendant l'appel provider (pour ne jamais dupliquer à
 * l'écran) — cette logique de `startsWith` vivait EN DOUBLE (cas « pas de commande » sur le texte
 * entier joint, et cas « ordered tokens » consommé token par token). Une seule fonction pure, les
 * deux mêmes 3 branches partout : le reste du texte déjà couvert par le préfixe streamé, le préfixe
 * restant à consommer, ou aucun recouvrement (le préfixe streamé ne correspond plus au texte final —
 * on ne réémet rien plutôt que de deviner).
 */
export function consumeStreamedPrefix(
  text: string,
  prefixRemaining: string
): { visible: string; prefixRemaining: string } {
  if (!prefixRemaining) return { visible: text, prefixRemaining: '' }
  if (prefixRemaining.startsWith(text)) {
    return { visible: '', prefixRemaining: prefixRemaining.slice(text.length) }
  }
  if (text.startsWith(prefixRemaining)) {
    return { visible: text.slice(prefixRemaining.length), prefixRemaining: '' }
  }
  return { visible: '', prefixRemaining: '' }
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
        // `name` doit être une STRING non vide : un `if (parsed.name)` laissait passer tout truthy
        // (`42`, `{}`, `[]`) → un token `command` portait un nom non-string, et le dispatch en aval
        // (comparaison/normalisation de nom) cassait sur une entrée qu'un modèle peut produire.
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
        if (name) {
          // `args` doit être un objet simple : un tableau/scalaire produirait un sac d'arguments
          // invalide côté exécution → on retombe sur un objet vide plutôt que de propager.
          const args =
            parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
              ? parsed.args
              : {}
          tokens.push({ kind: 'command', name, args })
        } else {
          // JSON valide mais sans `name` exploitable : deuxieme trou silencieux du parseur d'origine.
          tokens.push({
            kind: 'invalid',
            raw: rawBlock,
            reason:
              parsed.name === undefined || parsed.name === null
                ? 'champ « name » absent'
                : 'champ « name » invalide (chaîne non vide attendue)'
          })
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
    private readonly projectContext: () => string = () => '',
    /** Workspace actif, pour ne jamais relire dans un dépôt un fait provisoire appris dans un autre. */
    private readonly executionWorkspace: () => string = () => ''
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
   * L'index memoire ci-dessus est HYDRATE une fois depuis le disque, puis maintenu en miroir.
   *
   * Sans cela, le gain de la reprise de session s'evaporait a CHAQUE redemarrage de l'app : la `Map`
   * repartait vide, donc le premier tour de chaque conversation re-payait l'historique entier. Le
   * chiffrage est dans le commentaire de `chat()` plus bas (mesure du 2026-07-28 : ~79 k tokens
   * re-payes par tour, 1,85 M de `cache_write` par heure).
   *
   * TOUT est en fail-open : la persistance est un CACHE, jamais une autorite. Un disque plein, un
   * fichier verrouille ou un JSON corrompu doivent couter un renvoi d'historique — cher, jamais faux —
   * et surtout PAS casser le tour de l'utilisateur. D'ou les `try/catch` muets ici, qui seraient une
   * faute sur une frontiere de securite et sont le bon choix sur un cache.
   */
  private chatSessionsHydrated = false

  private hydrateChatSessions(): void {
    if (this.chatSessionsHydrated) return
    this.chatSessionsHydrated = true
    try {
      for (const [conversationId, record] of Object.entries(loadChatSessions())) {
        // Ne JAMAIS ecraser une entree memoire plus fraiche que le disque.
        if (!this.chatSessions.has(conversationId)) this.chatSessions.set(conversationId, record)
      }
    } catch {
      /* cache indisponible = aucune session connue : on renverra l'historique, c'est correct */
    }
  }

  private persistChatSession(conversationId: string, key: string, sessionId: string): void {
    try {
      saveChatSession(conversationId, key, sessionId)
    } catch {
      /* cache non ecrit : le prochain demarrage re-paiera l'historique, rien de faux */
    }
  }

  private forgetPersistedChatSession(conversationId: string): void {
    try {
      forgetChatSession(conversationId)
    } catch {
      /* best-effort : une entree perimee sur disque sera de toute facon rejetee par sa `key` */
    }
  }

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
    /** Directives injectées par l'utilisateur PENDANT le tour — drainées à chaque itération. */
    drainDirectives?: () => string[],
    /** Binding figé pour ce tour uniquement (ex. tâche planifiée), sans mutation du rôle global. */
    bindingOverride?: RoleBinding,
    /** Identité causale du tour créée par le contrôleur de chat. */
    turnId?: string,
    /** Snapshot du runtime affiche pour ce tour ; distinct de l'override des commandes orchestrees. */
    runtimeBinding?: RoleBinding,
    /** Appel déjà payé à reprendre sans invoquer une seconde fois le provider. */
    recoveredProviderCall?: RecoveredPilotProviderCall,
    /** Persistance du lien tour → journal avant le spawn d'un chat direct. */
    onProviderJournal?: (link: PilotProviderJournalLink) => void,
    /** Bornes provider propres a ce tour de fond, distinctes des preferences du role. */
    sendLimits?: Pick<SendOptions, 'maxBudgetUsd'> & {
      /** Profil minimal du triage automatique : aucune commande, aucun pipeline, aucun gros kit. */
      systemProfile?: 'watchdog-read-only'
    }
  ): Promise<void> {
    // Chronométrage des jalons jusqu'au PREMIER token : c'est la latence réellement perçue au clic.
    const timer = startTurnTimer('chat')
    // Frontière de typage T2 : chaque évènement construit ici doit correspondre EXACTEMENT à une
    // variante de `PilotEventVariant` (excess-property-check compris) avant d'atteindre le
    // consommateur externe `onEvent: (e: PilotEvent) => void`.
    const emit = (e: PilotEventVariant): void => onEvent(e)
    let timingWritten = false
    const binding = runtimeBinding ?? bindingOverride ?? this.roles.getBinding('orchestrator')
    const execCommand = (name: string, args: Record<string, unknown>): Promise<CommandResult> => {
      if (bindingOverride) {
        return turnId
          ? this.bus.exec(name, args, conversationId, bindingOverride, turnId)
          : this.bus.exec(name, args, conversationId, bindingOverride)
      }
      return turnId
        ? this.bus.exec(name, args, conversationId, undefined, turnId)
        : this.bus.exec(name, args, conversationId)
    }
    const provider = binding.provider
    // Autorite du tour : une demande utilisateur ne peut ouvrir qu'un run. Une reparation ou reprise
    // appartient au controleur du run courant ; un second run exige un nouveau message utilisateur.
    let orchestrationIssued = false
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
      emit({ kind: 'command', actionId, name: 'orchestrate', args })
      signal?.throwIfAborted()
      const result = await execCommand('orchestrate', args)
      emit({
        kind: 'result',
        actionId,
        name: 'orchestrate',
        ok: result.ok,
        data: result.ok ? result.data : result.error
      })
      // Le /skill vient déjà de consommer l'unique orchestration autorisée pour ce tour. Une
      // orientation arrivée pendant l'attente ne peut pas être injectée rétroactivement dans ce
      // run : surtout ne pas la transformer silencieusement en second run payant.
      const lateDirectives: string[] = []
      for (;;) {
        const directives = drainDirectives?.() ?? []
        if (!directives.length) break
        lateDirectives.push(...directives)
      }
      const directiveNotice = lateDirectives.length
        ? `\n\n⚠️ ${lateDirectives.length} orientation(s) reçue(s) après le lancement : aucun second run n'a été relancé. Renvoyez-la comme nouveau message si elle reste nécessaire.`
        : ''
      emit({
        kind: 'done',
        // Les FAITS, pas une formule : statut, validite, blocage de gate, cout, run et resultat sont
        // tous rendus par l'orchestrateur et etaient jetes (conv-76 : 18 sous-agents, 10,05 $, le fil
        // n'affichait que « Workflow Autowin execute. »).
        text:
          formatOrchestrationOutcome(
            result.ok,
            result.ok ? (result.data as OrchestrationOutcome | undefined) : undefined,
            result.ok ? undefined : String(result.error ?? '')
          ) + directiveNotice,
        outcome: result.ok
          ? ((result.data as Record<string, unknown> | undefined) ?? undefined)
          : undefined,
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
    const watchdogReadOnly = sendLimits?.systemProfile === 'watchdog-read-only'
    // Une analyse entierement lecture-seule n'a besoin ni du kit complet (~19 k caracteres), ni du
    // catalogue de commandes, ni d'un pipeline multi-agent. Le verdict est fail-closed : toute
    // clause incertaine ou toute action deja reconnue par le routeur conserve le chat pilote normal.
    const directReadOnly =
      !watchdogReadOnly &&
      !directRoute &&
      latestUserMessage !== undefined &&
      classifyMutationConfidence(latestUserMessage) === 'read-only'
    const commandFreeReadOnly = watchdogReadOnly || directReadOnly
    const providerLimits: Pick<SendOptions, 'maxBudgetUsd' | 'toolProfile'> = {
      ...(sendLimits?.maxBudgetUsd ? { maxBudgetUsd: sendLimits.maxBudgetUsd } : {}),
      ...(commandFreeReadOnly ? { toolProfile: 'watchdog-read-only' as const } : {})
    }
    const pilotage = commandFreeReadOnly ? '' : buildChatPilotagePrompt(catalog)
    /**
     * PRÉFIXE SYSTEM STABLE = condition du cache (mesure 2026-07-28 : cache_read = 0 sur 100 % des
     * appels, ~16 k de cache_write REÉCRITS à chaque tour, ~0,32 $ pour répondre une phrase).
     *
     * Le contexte Brain est un résultat de recherche qui DÉPEND du message de l'utilisateur : tant
     * qu'il était concaténé ici, le system prompt changeait à chaque tour et aucun préfixe ne pouvait
     * être réutilisé. Il est désormais passé dans le MESSAGE (voir `convo`) : même information remise
     * au modèle, mais le system redevient identique d'un tour à l'autre, donc cachable.
     */
    const systemParts = watchdogReadOnly
      ? [
          {
            name: 'watchdog-read-only',
            text:
              "Tu es le triage automatique non invasif d'Autowin OS. Reponds en francais, " +
              'directement et en moins de 250 mots. Tu observes un incident en LECTURE SEULE : ' +
              "n'emets aucune commande Autowin, ne lance aucune orchestration, ne modifie rien et " +
              'ne cree aucun worktree. Utilise au plus les lectures locales strictement necessaires. ' +
              'Si le contexte ne cite aucun artefact ou chemin precis, ne fouille pas le depot au hasard : ' +
              'distingue les faits, la cause seulement si elle est prouvee, puis la preuve manquante. ' +
              'Respecte exactement toute derniere ligne ISSUE demandee par le message utilisateur.\n'
          }
        ]
      : directReadOnly
        ? [
            {
              name: 'direct-read-only',
              text:
                "Tu es le chat direct d'Autowin OS. Reponds en francais a la demande exacte de " +
                "l'utilisateur, sans preambule inutile. Ce tour est strictement en LECTURE SEULE : " +
                "n'emets aucune balise <cmd>, aucune commande Autowin, ne lance aucune orchestration, " +
                'ne modifie rien et ne cree aucun worktree. Utilise uniquement les lectures locales ' +
                'strictement necessaires. Distingue les faits observes des deductions et respecte tout ' +
                'format de sortie explicitement demande. Si le message dit « reponds exactement X », ' +
                'ta sortie ENTIERE doit etre exactement X, sans note, explication ni mise en forme en plus.\n'
            }
          ]
        : [
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
    // Hydrate depuis le disque au premier tour du process : c'est ce qui fait survivre la reprise a
    // un redemarrage de l'app. Idempotent, et sans effet si le cache memoire est deja chaud.
    this.hydrateChatSessions()
    const known = conversationId ? this.chatSessions.get(conversationId) : undefined
    /**
     * RESUME FANTÔME — la reprise n'est armée que si l'adaptateur la TRANSMET vraiment.
     *
     * `codex` rend un `sessionId` (son `thread_id`) sans jamais l'honorer : on élidait donc le fil
     * en affirmant au modèle qu'il le connaissait « par sa session », alors qu'il démarrait à blanc.
     * Mesuré le 2026-08-04 sur 90 fils : 0 appel réellement repris, 31 prompts amputés.
     */
    const providerResumes = this.registry.honoursSessionResume?.(provider) ?? false
    const resumeSessionId =
      providerResumes && known?.key === sessionKey ? known.sessionId : undefined
    // Un détour par un autre provider/modèle ajoute des échanges absents de l'ancienne session.
    // Elle devient donc définitivement périmée, même si l'utilisateur revient ensuite au binding initial.
    if (conversationId && known && known.key !== sessionKey) {
      this.chatSessions.delete(conversationId)
      // Le disque doit oublier AUSSI : une entree perimee y survivrait au redemarrage et ferait
      // reprendre une session ouverte sous un autre binding.
      this.forgetPersistedChatSession(conversationId)
    }
    const lastUserMessage = [...history].reverse().find((m) => m.role === 'user')
    // Le contexte Brain vit ICI (et non dans le system) pour ne pas casser le préfixe cachable.
    const brainContext = retrievedContext ? `CONNAISSANCE RÉCUPÉRÉE:\n${retrievedContext}` : ''
    // ÉCHO DE MÉMOIRE — la moitié manquante de la mécanique de claude.exe : ce que le modèle a retenu
    // dans CE fil lui est remis. Ici et non dans le system, pour la même raison que le contexte Brain :
    // un contenu variable dans le préfixe tue le cache. Plafonné à ~1 500 car. — la lecture automatique
    // des fiches avait été coupée parce qu'elle pesait 552 Ko par appel.
    const executionWorkspace = this.executionWorkspace().trim()
    const memoryEcho = sessionMemoryBlock(
      rememberedFacts(conversationId, executionWorkspace || undefined),
      undefined,
      evictedCount(conversationId, executionWorkspace || undefined)
    )
    // L'assemblage vit dans `chat-turn-messages.ts` pour être testable sur sa SORTIE plutôt que grepable
    // dans ce fichier. Le tableau reste mutable : la boucle d'itérations y ajoute les tours suivants.
    /**
     * Skill invoquée en tête du message (`/remake …`) : son corps est CHARGÉ et injecté.
     *
     * Sans ça, `/remake` n'était qu'une entrée d'autocomplétion du renderer — le mot n'existait nulle
     * part dans le main, donc le modèle recevait une commande dont il n'avait jamais lu le contrat.
     * Générique par construction : toute skill du kit devient atteignable, sans nouvelle phase.
     */
    const invoked = invokedSkillId(lastUserMessage?.content ?? '')
    const skillBody = invoked ? skillInstruction(invoked) : ''
    const convo: string[] = buildTurnMessages({
      snapshot,
      brainContext,
      memoryEcho,
      skillBody,
      history,
      resumeSessionId,
      lastUserMessage: lastUserMessage?.content
    })
    const currentAttachments = history.at(-1)?.attachments

    // Coût cumulé du tour (toutes les itérations LLM du même message utilisateur).
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

    let iterationLimit = maxIter
    /**
     * T1a — POINT UNIQUE de recovery du cap d'itérations. Avant, `iterationLimit += 1` était
     * dispersé à 4 endroits distincts, chacun avec son propre garde « une seule fois » : ajouter un
     * 5ᵉ cas de recovery obligeait à deviner où placer un nouvel incrément. Chaque site nommé
     * appelle désormais cette fonction avec un motif — la logique d'incrément elle-même ne vit
     * qu'ICI, même si les gardes anti-boucle (`invalidQuestionRecoveryAvailable`, etc.) restent
     * locales à chaque cas puisqu'elles portent un sens métier différent par motif.
     */
    const recoveryReasons: Array<'late-directive' | 'invalid-question' | 'muted-turn'> = []
    const grantRecoveryIteration = (
      reason: 'late-directive' | 'invalid-question' | 'muted-turn'
    ): void => {
      recoveryReasons.push(reason)
      iterationLimit += 1
    }
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
    let commandAttachments: NonNullable<Message['attachments']> = []
    for (let i = recoveredProviderCall?.iteration ?? 0; i < iterationLimit; i++) {
      // Pilotage continu : les directives envoyées PENDANT le tour entrent au prochain
      // point d'itération (priorité immédiate, sans attendre la fin du tour).
      for (const directive of drainDirectives?.() ?? []) {
        convo.push(`UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${directive}`)
      }
      const iterationAttachments = [
        ...(i === 0 ? (currentAttachments ?? []) : []),
        ...commandAttachments
      ]
      commandAttachments = []
      const messages: Message[] = [
        {
          role: 'user',
          content: `${convo.join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)`,
          ...(iterationAttachments.length ? { attachments: iterationAttachments } : {})
        }
      ]
      let prompt = this.registry.describePrompt(
        provider,
        messages,
        {
          system,
          systemBlocks,
          model: binding.model,
          reasoningEffort: binding.reasoningEffort,
          ...providerLimits
        },
        binding.model
      )
      prompt.systemBlocks = systemBlocks
      let attempt =
        recoveredProviderCall && i === recoveredProviderCall.iteration
          ? recoveredProviderCall.attempt
          : 0
      const requestId = randomUUID()
      const options: SendOptions = {
        system,
        systemBlocks,
        model: binding.model,
        reasoningEffort: binding.reasoningEffort,
        ...providerLimits,
        // Repris seulement au PREMIER appel du tour : les itérations suivantes chaînent déjà sur la
        // session que ce tour vient d'ouvrir (voir la mémorisation après réception).
        ...(resumeSessionId && i === 0 ? { resumeSessionId } : {}),
        observePrompt: (observed) => {
          observed.systemBlocks = systemBlocks
          prompt = observed
        },
        signal,
        requestId,
        ...(onProviderJournal
          ? {
              onJournal: (token: string, journalPath: string) => {
                const streamId = `${i}:${attempt}`
                onProviderJournal({
                  provider,
                  token,
                  journalPath,
                  iteration: i,
                  attempt,
                  streamId,
                  requestId
                })
              }
            }
          : {})
      }
      const recoveredHere =
        recoveredProviderCall && i === recoveredProviderCall.iteration
          ? recoveredProviderCall
          : undefined
      let res: SendResult | undefined = recoveredHere?.result
      let callStartedAt = performance.now()
      let successfulStreamedPrefix = recoveredHere?.streamedPrefix ?? ''
      let successfulAttempt = recoveredHere?.attempt ?? 0
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
            emit({ kind: 'delta', streamId, text: segment.text, iteration: i })
          }
        }
        try {
          callStartedAt = performance.now()
          timer.mark(`send${i}:start`)
          let sawFirstChunk = false
          res = await this.registry.send(provider, messages, options, (chunk) => {
            // Raisonnement : canal SÉPARÉ, diffusé en direct, hors du texte de la réponse.
            if (chunk.reasoning) {
              emit({ kind: 'reasoning', text: chunk.reasoning, iteration: i })
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
            emit({
              kind: 'cancellation',
              iteration: i,
              name: provider,
              text: 'Annulation demandée par utilisateur',
              data: { reason: signal.reason ?? 'user' }
            })
            throw error
          }
          emit({
            kind: 'prompt-call',
            iteration: i,
            prompt,
            response: '',
            status: 'failed',
            error: message,
            ...(error instanceof ProviderCallError && error.usage
              ? { callUsage: error.usage }
              : {}),
            ...(error instanceof ProviderCallError && error.resolvedModel
              ? { resolvedModel: error.resolvedModel }
              : {}),
            callDurationMs: performance.now() - callStartedAt
          })
          if (error instanceof ProviderCallError && !error.retryable) throw error
          if (attempt >= 1) throw error
          if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
          attempt += 1
          emit({
            kind: 'retry',
            iteration: i,
            name: provider,
            text: message,
            data: { attempt, maxAttempts: 2 }
          })
        }
      }
      emit({
        kind: 'prompt-call',
        iteration: i,
        prompt,
        response: res.text.replace(REJECTED_QUESTION_RE, REJECTED_QUESTION_MARKER),
        status: 'completed',
        callUsage: res.usage,
        callDurationMs: performance.now() - callStartedAt,
        sessionId: res.sessionId,
        ...(res.model ? { resolvedModel: res.model } : {})
      })
      // Mémorise la session pour que le PROCHAIN tour la reprenne au lieu de re-payer l'historique.
      // PERSISTÉ sur disque en plus du cache mémoire : sans ça, le prochain démarrage de l'app oublie
      // la session et re-paie l'historique entier — le gain de la reprise s'évaporait à chaque
      // relance. Le cache mémoire reste la source rapide ; le disque est le filet.
      if (conversationId) {
        if (res.sessionId && providerResumes) {
          this.chatSessions.set(conversationId, { key: sessionKey, sessionId: res.sessionId })
          this.persistChatSession(conversationId, sessionKey, res.sessionId)
        } else {
          // Un provider qui ne rend pas de nouvelle session ne garantit pas que ce tour appartient
          // à la précédente. La conserver ferait élider un historique qu'il n'a peut-être jamais reçu.
          this.chatSessions.delete(conversationId)
          this.forgetPersistedChatSession(conversationId)
        }
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
          emit({ kind: 'stream-reset', streamId: `${i}:${successfulAttempt}`, iteration: i })
        }
        grantRecoveryIteration('late-directive')
        continue
      }
      for (const artifact of res.artifacts ?? []) {
        emit({ kind: 'artifact', artifact, iteration: i })
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
          grantRecoveryIteration('invalid-question')
          invalidQuestionRecoveryAvailable = false
          continue
        }
        emit({ kind: 'done', text: '', usage })
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
      const onlyAuxiliaryRemember =
        hasCommand &&
        Boolean(spoken) &&
        ordered.every(
          (token) =>
            token.kind === 'text' || (token.kind === 'command' && token.name === 'remember')
        )

      // Defense en profondeur : le profil provider retire deja les outils d'ecriture, mais une
      // balise de commande peut encore apparaitre comme simple texte genere. Dans un tour declare
      // lecture-seule elle n'atteint JAMAIS le bus, meme si le modele ignore son system prompt.
      if (commandFreeReadOnly && hasCommand) {
        emit({
          kind: 'done',
          text:
            spoken ||
            'Reponse bloquee : le modele a tente une commande pendant un tour en lecture seule.',
          usage
        })
        return
      }

      if (!hasCommand) {
        if (!successfulStreamedPrefix && spoken) emit({ kind: 'think', text: spoken })
        else if (successfulStreamedPrefix) {
          const visible = ordered
            .filter(
              (token): token is Extract<OrderedPilotToken, { kind: 'text' }> =>
                token.kind === 'text'
            )
            .map((token) => token.text)
            .join('')
          const { visible: remainder } = consumeStreamedPrefix(visible, successfulStreamedPrefix)
          if (remainder)
            emit({
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
          grantRecoveryIteration('muted-turn')
          convo.push(
            'SYSTÈME: tu as agi mais tu n’as rien dit — l’utilisateur ne voit que des étiquettes ' +
              'd’action, il ne peut pas savoir ce qui a été fait. Conclus MAINTENANT en clair, SANS ' +
              'aucune commande : ce que tu as fait, ce que cela a produit (résultats/exit codes ' +
              'observés), et ce qui reste. Si une action a échoué, dis-le explicitement.'
          )
          continue
        }
        emit({ kind: 'done', text: spoken, usage })
        return
      }

      const results: string[] = []
      let commandIndex = 0
      let tokenIndex = 0
      let streamedPrefixRemaining = successfulStreamedPrefix
      for (const token of ordered) {
        signal?.throwIfAborted()
        if (token.kind === 'text') {
          const consumed = consumeStreamedPrefix(token.text, streamedPrefixRemaining)
          const visible = consumed.visible
          streamedPrefixRemaining = consumed.prefixRemaining
          if (visible)
            emit({
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
          emit({ kind: 'command', actionId, name: 'commande illisible', args: {} })
          emit({
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
        const settledAction = recoveredHere?.settledActions?.find(
          (action) => action.actionId === actionId && action.name === token.name
        )
        if (!settledAction) emit({ kind: 'command', actionId, name: token.name, args: token.args })
        if (token.name === 'orchestrate' && orchestrationIssued) {
          const refusal = ORCHESTRATION_ALREADY_ISSUED_REFUSAL
          emit({
            kind: 'result',
            actionId,
            name: token.name,
            ok: false,
            data: refusal
          })
          results.push(`${token.name} → ERREUR ${refusal}`)
          tokenIndex += 1
          continue
        }
        if (token.name === 'orchestrate') orchestrationIssued = true
        signal?.throwIfAborted()
        const r: CommandResult = settledAction
          ? settledAction.ok
            ? {
                ok: true,
                data: settledAction.data,
                ...(settledAction.attachments?.length
                  ? { attachments: settledAction.attachments }
                  : {})
              }
            : {
                ok: false,
                error: String(settledAction.data ?? 'échec déjà journalisé'),
                ...(settledAction.attachments?.length
                  ? { attachments: settledAction.attachments }
                  : {})
              }
          : await execCommand(token.name, token.args)
        if (r.attachments?.length) commandAttachments.push(...r.attachments)
        if (!settledAction)
          emit({
            kind: 'result',
            actionId,
            name: token.name,
            ok: r.ok,
            data: r.ok ? r.data : r.error,
            ...(r.attachments?.length ? { attachments: r.attachments } : {})
          })
        // `orchestrate` rend déjà l'issue AUTORITATIVE du pipeline complet : build, juge, gate,
        // publication et fermeture du RUN. Redemander au modèle de l'interpréter coûtait un appel
        // supplémentaire et, pire, lui faisait parfois suivre le rapport PROVISOIRE du worker
        // (« RUN open, lance judge ») alors que le gate venait de fermer et publier le run. On clôt
        // donc mécaniquement le tour sur le résultat structuré, comme le chemin `/skill` explicite.
        if (token.name === 'orchestrate') {
          const outcome = r.ok ? (r.data as OrchestrationOutcome | undefined) : undefined
          const deliveryClosed = r.ok && isDeliveredOrchestrationOutcome(outcome ?? {})
          const closureNotice = deliveryClosed
            ? 'Clôture Autowin : gate validé, RUN fermé green ; aucune autre orchestration ni aucun second judge ne sont nécessaires dans ce tour.'
            : 'Clôture Autowin : résultat terminal rendu ; aucune autre orchestration n’est relancée dans ce tour.'
          emit({
            kind: 'done',
            text: `${formatOrchestrationOutcome(
              r.ok,
              outcome,
              r.ok ? undefined : String(r.error ?? '')
            )}\n\n${closureNotice}`,
            outcome: r.ok
              ? ((r.data as Record<string, unknown> | undefined) ?? undefined)
              : undefined,
            usage
          })
          return
        }
        results.push(`${token.name} → ${r.ok ? JSON.stringify(r.data) : 'ERREUR ' + r.error}`)
        tokenIndex += 1
      }

      // `remember` est une écriture auxiliaire : son résultat est déjà visible dans la carte action.
      // Quand le modèle a livré sa réponse dans le même message, repayer une génération uniquement
      // pour commenter un refus déterministe (type/locator/SHA) ne peut améliorer le travail rendu.
      if (onlyAuxiliaryRemember) {
        emit({ kind: 'done', text: '', usage })
        return
      }

      const state = await this.bus.snapshotForPrompt()
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\nÉTAT MAINTENANT:\n${JSON.stringify(state)}`)
    }
    const capError = `Cap d'itérations (${maxIter}) atteint sans réponse finale`
    emit({
      kind: 'error',
      text: capError,
      usage
    })
    throw new Error(capError)
  }
}
