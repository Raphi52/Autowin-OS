/**
 * Le TOUR DE CHAT PILOTÉ, sorti de `src/main/index.ts`.
 *
 * Pourquoi ce fichier existe : `runPilotChat` vivait à l'intérieur de `registerChatIpc()`, donc
 * dans une fermeture inaccessible. Ses sous-parties (`applyDurableEvent`, `handlePilotEvent`,
 * `persistSupervisedChatUsage`…) ne pouvaient être atteintes qu'en démarrant Electron. Le
 * déplacement est PUREMENT mécanique : le corps est identique, seules les valeurs qu'il capturait
 * dans `index.ts` deviennent des dépendances passées explicitement (`RunPilotChatDeps`).
 *
 * Une seule adaptation de forme : `watchdogEngine` est un `let` réassigné au démarrage dans
 * `index.ts` ; il est donc reçu ici comme LECTEUR (`watchdogEngine()`) et non comme valeur, sinon
 * le tour figerait la valeur `undefined` du démarrage.
 */
import { seedTraceActionOrdinal, traceActionEventId } from '../activity/trace-event'
import { emitToLiveWindows } from '../renderer-emit'
import { BrowserWindow, type WebContents } from 'electron'
import {} from 'path'
import { randomUUID } from 'node:crypto'
import type { Message, ProviderAdapter, SendResult, StreamChunk } from '../providers/types'
import { ProviderRegistry } from '../providers/registry'
import { CostCircuitBreaker } from '../cost-circuit-breaker'
import { chatTurnBudget, estCoupureBudget, CHAT_BUDGET_ABORT_PREFIX } from '../chat-turn-budget'
import { motifInactivite, terminalDuTour } from '../chat-turn-arret'
import { RoleModelConfig, type RoleBinding } from '../roles'
import { AppCommandBus } from '../commands'
import {
  CAP_ITERATIONS_TOUR,
  AgentPilot,
  type PilotEvent,
  type RecoveredPilotProviderCall
} from '../agent-pilot'
import type { RecoverableChatProviderCall } from '../runs/chat-provider-recovery'
import { boundedContinuationHistory, boundedTurnHistory } from '../chat-turn-messages'
import {
  flattenChatPartsForModel,
  type ChatTurnEvent,
  type PersistedChatPart
} from '../../shared/chat-turn'
import type { AttachmentMeta } from '../store/conversations'
import { closingTurnDelivery } from '../runs/turn-closing'
import { appendTurnEvent } from '../runs/turn-journal'
import { ouvrirTourDeChat } from '../gel-main'
import {
  closingJournalEvents,
  pilotJournalEvents,
  promptCallJournalEvents,
  type PromptJournalMemory
} from '../runs/turn-journal-enrich'
import { appendConvActivity } from '../activity/conv-activity'
import { rattacherSaisieAuTour } from '../store/journal-saisie'
import {
  persistChatUsageSettlement,
  persistRecoveredChatProviderUsage
} from '../activity/chat-usage-settlement'
import { taskUsageMetricsFromExecution } from '../activity/task-usage-metrics'
import { sameExecutionUsage, type ExecutionUsageSnapshot } from '../execution-supervisor'
import { appendPromptCall } from '../activity/prompt-observability'
import { promptCallToTraceEvents } from '../activity/prompt-call-trace'
import { pilotActionToTraceEvent } from '../activity/pilot-action-trace'
import { chatArtifactToTraceEvent } from '../activity/chat-artifact-trace'
import { reasoningToTraceEvent } from '../activity/reasoning-trace'
import { appendObservedOrchestrationOutcome } from '../activity/orchestration-outcome-trace'
import { rebaseTraceSequence } from '../activity/trace-store'
import { guardAttachments, guardString } from '../ipc-guards'
import {
  materializeChatArtifact,
  materializeUserImageArtifact,
  rechargerContenuPieceJointe
} from '../store/chat-artifact-store'
import { latestBrainTraceId } from '../activity/brain-trace-spool'
import type { TaskUsageSettlementSink } from '../task-manager/types'
import { incidentFromPilotEvent } from '../pilot-incident'

import type { AutowinOS } from '../os'
import type { ActiveChatTurns } from '../active-chat-turns'
import type { TaskStore } from '../task-manager/task-store'
import type { WatchdogEngine } from '../task-manager/watchdog-engine'
import type { TraceStore } from '../activity/trace-store'
import type { TraceLedger } from '../activity/ledger'
import type { AppEvent } from '../commands'
import type { ModelQuestion } from '../model-questions'
import { collerTexteParle } from './coller-texte-parle'

/** Ce que le tour de chat capturait dans `index.ts` — désormais passé explicitement. */
export type RunPilotChatDeps = {
  os: AutowinOS
  pilot: AgentPilot
  bus: AppCommandBus
  activeChatTurns: ActiveChatTurns
  scheduledTasks: TaskStore
  causalTrace: TraceStore
  ledger: TraceLedger
  pendingDirectives: Map<string, string[]>
  turnJournalRoot: string
  isolatedTestInstance: boolean
  broadcast: (e: AppEvent) => void
  drainPendingDirectives: (conversationId: string) => string[]
  askModelQuestion: (
    sender: WebContents,
    source: 'chat' | 'loop',
    question: ModelQuestion,
    context?: string,
    signal?: AbortSignal
  ) => Promise<string>
  notifyWatchdogWorkflowIncident: (
    incident: { kind: string; summary: string; detail: string },
    sourceConversationId?: string
  ) => void
  /** Lecteur, pas valeur : `watchdogEngine` est assigné après le démarrage. */
  watchdogEngine: () => WatchdogEngine | undefined
}

/**
 * Le tour de chat lui-même, tel que `index.ts` le câble sur ses canaux IPC.
 *
 * La signature est ÉCRITE ici plutôt que déduite de la fabrique (`ReturnType<typeof …>`) : la
 * fabrique doit annoncer son type de retour (règle eslint `explicit-function-return-type`), et un
 * alias déduit d'elle serait alors circulaire. C'est aussi le contrat que lit `index.ts`.
 */
export type RunPilotChat = (
  sender: WebContents | undefined,
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    attachments?: Message['attachments']
  }>,
  conversationId?: string,
  bindingOverride?: RoleBinding,
  recovery?: DirectChatRecovery,
  policy?: {
    readOnly: boolean
    maxIterations: number
    background?: boolean
    maxBudgetUsd?: number
  },
  onLateTaskUsageSettlement?: TaskUsageSettlementSink,
  continuation?: boolean
) => Promise<{
  ok: boolean
  cancelled: boolean
  turnId: string
  text?: string
  error?: string
  verification?: { complete: boolean; evidence: string }
  resolvedModel?: string
  knownCostUsd?: number
  totalTokens?: number
  unpricedCalls?: number
}>

export type DirectChatRecovery = {
  turnId: string
  call: RecoverableChatProviderCall
  providerCall: RecoveredPilotProviderCall
}

/**
 * LA DECISION DU VEILLEUR D'INACTIVITE, isolee pour etre testable sans horloge ni minuterie.
 *
 * Trois issues, et la nuance porte sur la deuxieme :
 *  - `patienter` : le plafond n'est pas atteint, rien a faire ;
 *  - `commande-en-vol` : le plafond est franchi MAIS une commande tourne encore — le tour attend,
 *    il n'est pas mort. L'appelant rearme le compte a rebours au lieu de couper ;
 *  - `couper` : plus rien ne tourne et le silence dure — c'est un tour REELLEMENT fige.
 *
 * Garde : `veilleur-inactivite.test.ts`.
 */
export function verdictVeilleurInactivite(etat: {
  inactifDepuisMs: number
  commandesEnVol: number
  plafondMs: number
}): 'patienter' | 'commande-en-vol' | 'couper' {
  if (etat.commandesEnVol > 0) return 'commande-en-vol'
  return etat.inactifDepuisMs < etat.plafondMs ? 'patienter' : 'couper'
}

export function createRunPilotChat(deps: RunPilotChatDeps): RunPilotChat {
  const {
    os,
    pilot,
    bus,
    activeChatTurns,
    scheduledTasks,
    causalTrace,
    ledger,
    pendingDirectives,
    turnJournalRoot,
    isolatedTestInstance,
    broadcast,
    drainPendingDirectives,
    askModelQuestion,
    notifyWatchdogWorkflowIncident
  } = deps

  const runPilotChat: RunPilotChat = async (
    sender,
    messages,
    conversationId,
    bindingOverride,
    recovery,
    policy,
    onLateTaskUsageSettlement,
    continuation = false
  ) => {
    await os.waitUntilReady()
    const turnRuntimeBinding = bindingOverride ?? os.roles.getBinding('orchestrator')
    // Duree du tour : MESUREE de bout en bout, pour repondre a « qu'est-ce qui est lent ? » et pas
    // seulement a « qu'est-ce qui coute ? » (les deux ne coincident pas forcement).
    const turnStartedAtMs = performance.now()
    const controller = new AbortController()
    /** Veilleur d'inactivite du tour, arme plus bas et TOUJOURS eteint dans le `finally`. */
    let veilleur: ReturnType<typeof setInterval> | undefined
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })
    const turnId = recovery?.turnId ?? randomUUID()
    /*
     * LIEN SAISIE → TOUR. Le texte est journalise par le renderer AVANT l'envoi, donc avant que ce
     * tour existe : il ne pouvait porter aucun `turnId`. On pose le lien ICI, ou les deux sont
     * connus. Best-effort strict : un lien manquant ne change rien au tour.
     */
    if (conversationId && !recovery) {
      const derniere = [...messages].reverse().find((m) => m.role === 'user')
      if (derniere?.content) rattacherSaisieAuTour(conversationId, turnId, derniere.content)
    }
    // Correlation durable AVANT le spawn : apres un crash, le reglement peut retrouver l'occurrence.
    onLateTaskUsageSettlement?.({ conversationId, turnId })
    /**
     * Plafond d'un TOUR de chat. Réutilise le circuit-breaker déjà éprouvé sur l'orchestration
     * (module pur, testé) avec un seuil PROPRE au chat : un tour conversationnel n'a pas le même
     * ordre de grandeur qu'un run complet. Réglable via AUTOWIN_CHAT_USD_CAP ; défaut généreux
     * (2 $) — assez haut pour ne jamais gêner un tour légitime, assez bas pour arrêter une boucle
     * (le pire tour mesuré coûtait 2,109 $).
     */
    // Politique extraite dans `chat-turn-budget.ts` : mesuré sur conv-1149 (13/08), le défaut
    // câblé coupait une campagne légitime à 3 $ et la déguisait en `cancelled`. Sans cap explicite
    // de l'utilisateur, le trip OBSERVE (ledger) mais ne coupe plus.
    const budgetDuTour = chatTurnBudget(process.env)
    const chatBreaker = new CostCircuitBreaker(budgetDuTour.limits)
    const spoken: string[] = []
    /**
     * Les etiquettes d'action, TENUES A PART du vrai texte — et c'est un COUPLE de garanties.
     *
     * Elles existent comme dernier recours : un tour qui n'a fait qu'agir ne doit JAMAIS afficher une
     * bulle vide (defaut documente, conv-1141). Mais melangees au texte, elles se retrouvaient EN TETE
     * de reponses parfaitement redigees. Mesure le 2026-08-15 sur les conversations de sonde : 36 sur
     * 39 commencaient par « [a execute ...] », et l'utilisateur a tranche — « c'est pas du tout
     * l'experience que je veux offrir ».
     *
     * Separees, elles ne servent que quand rien d'autre n'existe. Les deux garanties tiennent alors
     * ENSEMBLE : pas d'etiquette quand une reponse existe, jamais de bulle vide quand elle n'existe pas.
     */
    const etiquettesAction: string[] = []
    let streamedSpoken = recovery?.providerCall.streamedPrefix ?? ''
    let durableResponseTextSeen = Boolean(streamedSpoken.trim())
    // Frontiere d'iteration : sert a savoir si le delta poursuit le MEME message ou en ouvre un
    // nouveau (cf. coller-texte-parle.ts). -1 = aucun delta recu encore.
    let iterationDuDernierDelta: number | undefined = -1
    /**
     * Raisonnement du modele ACCUMULE sur le tour.
     *
     * Il est emis par fragment (`agent-pilot.ts:543`) : ecrire un evenement causal par fragment
     * produirait des centaines de lignes pour un seul tour et rendrait la chronologie illisible.
     * Meme patron que `streamedSpoken` — on accumule, on ecrit une fois.
     */
    let streamedReasoning = ''
    /**
     * Memoire du prompt SYSTEME deja journalise pour ce tour : il ne se reecrit que s'il CHANGE
     * (cf. `turn-journal-enrich.ts`), sinon chaque iteration recopierait le meme socle.
     */
    const promptJournalMemory: PromptJournalMemory = {}
    let completedText = ''
    let verification: { complete: boolean; evidence: string } | undefined
    let turnUsage: { inputTokens: number; outputTokens: number; costUsd?: number } | undefined
    let turnPromptIdentity:
      { provider: string; model?: string; reasoningEffort?: string } | undefined
    let turnResolvedModel: string | undefined
    let activityLabel = 'tour agent'
    let supervisedUsage: ExecutionUsageSnapshot | undefined
    let persistedSupervisedUsage: ExecutionUsageSnapshot | undefined
    let usagePersistenceReady = false
    const persistSupervisedChatUsage = (usage: ExecutionUsageSnapshot): void => {
      if (!conversationId) return
      if (sameExecutionUsage(persistedSupervisedUsage, usage)) return
      persistedSupervisedUsage = persistChatUsageSettlement({
        conversationId,
        turnId,
        usage,
        previous: persistedSupervisedUsage,
        provider: turnPromptIdentity?.provider ?? turnRuntimeBinding.provider,
        model:
          turnResolvedModel ??
          recovery?.providerCall.result.model ??
          turnPromptIdentity?.model ??
          turnRuntimeBinding.model,
        reasoningEffort: turnPromptIdentity?.reasoningEffort ?? turnRuntimeBinding.reasoningEffort,
        label: activityLabel,
        durationMs: Math.round(performance.now() - turnStartedAtMs),
        text:
          (streamedSpoken || spoken.join('\n') || etiquettesAction.join('\n')).slice(0, 600) ||
          undefined,
        traceStore: causalTrace
      })
      broadcast({ type: 'refresh', scope: 'workflows' })
    }
    const onSupervisedUsageSettlement = (usage: ExecutionUsageSnapshot): void => {
      supervisedUsage = usage
      if (usagePersistenceReady) persistSupervisedChatUsage(usage)
      const metrics = taskUsageMetricsFromExecution(usage)
      onLateTaskUsageSettlement?.(metrics)
      if (conversationId) {
        const occurrence = scheduledTasks.reconcileUsageForTurn(conversationId, turnId, metrics)
        if (occurrence?.trigger === 'watchdog') {
          deps.watchdogEngine()?.rememberRecoveredUsage(occurrence.taskId, {
            ...metrics,
            eventId: occurrence.id,
            conversationId,
            turnId
          })
        }
      }
    }
    if (!policy?.background) await activeChatTurns.waitForInteractiveAccess()
    if (conversationId) activeChatTurns.set(conversationId, controller, completion)
    // Le lease ne protege que la frontiere controle -> enregistrement. Une fois le tour de fond
    // visible dans ActiveChatTurns, retenir l'utilisateur pendant tout l'appel provider serait a son
    // tour invasif ; il peut reprendre son travail sans que le Watchdog n'interrompe quoi que ce soit.
    if (policy?.background) activeChatTurns.releaseIdleLease()
    // A QUI IMPUTER UN GEL. Le detecteur prouve la fenetre figee sans savoir ce qui tournait : le
    // seul endroit qui le sait est ICI. Referme dans le `finally` — jamais imputer a un tour clos.
    const fermerTourPourGels = ouvrirTourDeChat({ conversationId, turnId })
    try {
      const rawMessages = Array.isArray(messages) ? messages : []
      const continuationWindow = continuation
        ? boundedContinuationHistory(rawMessages, 40)
        : undefined
      // HISTORIQUE AMNESIQUE — le modele doit revoir le RESULTAT de ses propres actions.
      //
      // Ce qui arrive ici est le `content` des messages, produit par `flattenChatParts`, qui reduit
      // une action REUSSIE a `[a execute verify]` et jette son resultat. Au tour suivant le modele
      // ne voyait ni code de sortie ni resume de ce qu'il avait lui-meme fait — alors il relancait
      // l'action pour rien.
      //
      // On reconstruit donc le contenu des messages ASSISTANT depuis leurs `parts`, avec la version
      // destinee au modele. L'affichage n'est pas touche : `message.content` reste ce qu'il etait,
      // seule l'entree du modele change. C'est l'entonnoir unique de l'historique (4 appelants).
      const partsParContenu = new Map<string, PersistedChatPart[]>()
      /*
       * IMAGES D'UN TOUR PASSE : le renderer n'a plus le binaire, le STORE l'a toujours.
       *
       * Le fil affiche est rehydrate depuis le disque, ou seule la metadonnee vit (nom, type, taille,
       * vignette) — le renderer ne peut donc envoyer qu'une vignette pour un message d'avant le
       * dernier redemarrage. Le binaire ORIGINAL, lui, est persiste a l'envoi sous `chat-artifacts/`
       * et attache a la metadonnee : on le recharge ICI, seul endroit qui voit a la fois l'historique
       * remis par le renderer et le store. Sans cela le modele lisait une vignette compressee et se
       * trompait sur ce qu'il voyait (mesure du 2026-08-27 : 3 bandes de couleur sur 4).
       */
      const metasParContenu = new Map<string, AttachmentMeta[]>()
      if (conversationId) {
        for (const stocke of os.conversations.get(conversationId)?.messages ?? []) {
          const parts = (stocke as { parts?: PersistedChatPart[] }).parts
          if (stocke.role === 'assistant' && parts?.length && typeof stocke.content === 'string') {
            partsParContenu.set(stocke.content, parts)
          }
          if (
            stocke.role === 'user' &&
            stocke.attachments?.length &&
            !metasParContenu.has(stocke.content)
          ) {
            // Premier message gagnant sur un contenu repete : la meme convention que `partsParContenu`
            // juste au-dessus. Deux messages au texte identique ET aux images differentes restent un cas
            // que cet index ne separe pas — assume, et sans consequence : l'appariement final se fait
            // sur le NOM de la piece jointe.
            metasParContenu.set(stocke.content, stocke.attachments)
          }
        }
      }
      /** Retrouve le binaire d'origine d'une piece jointe remise par le renderer, sinon `undefined`. */
      const contenuOriginal = (
        contenuDuMessage: string,
        piece: { name: string; mimeType?: string }
      ): { content: string; mimeType: string } | undefined => {
        const metas = metasParContenu.get(contenuDuMessage)
        if (!metas?.length) return undefined
        // Le renderer suffixe « (miniature) » quand il n'a que la vignette : on compare les noms nus.
        const nu = piece.name.replace(/\s*\(miniature\)\s*$/, '')
        const meta =
          metas.find((candidate) => candidate.name === nu) ??
          metas.find((candidate) => candidate.name === piece.name)
        return meta ? rechargerContenuPieceJointe(meta) : undefined
      }
      const safe = (continuationWindow?.history ?? boundedTurnHistory(rawMessages, 40)).map((m) => {
        const parts = m.role === 'assistant' ? partsParContenu.get(m.content) : undefined
        // Repli sur le contenu d'origine : un message sans `parts` retrouvables (fil hydrate,
        // message d'un ancien format) doit passer tel quel, jamais disparaitre.
        const pourLeModele = parts ? flattenChatPartsForModel(parts) || m.content : m.content
        return {
          role: m.role,
          content: guardString(pourLeModele, 'content'),
          ...(m.attachments?.length
            ? {
                attachments: guardAttachments(
                  m.role === 'user'
                    ? m.attachments.map((piece) => {
                        const original = contenuOriginal(m.content, piece)
                        return original
                          ? {
                              ...piece,
                              name: piece.name.replace(/\s*\(miniature\)\s*$/, ''),
                              mimeType: original.mimeType,
                              size: Buffer.byteLength(original.content, 'base64'),
                              content: original.content
                            }
                          : piece
                      })
                    : m.attachments
                )
              }
            : {})
        }
      })
      let traceParentId: string | undefined
      let traceSequence = conversationId ? causalTrace.nextSequence(conversationId) : 0
      let traceActionIndex = 0
      /**
       * Ordinal MONOTONE du tour pour les identifiants de trace. Distinct de `traceActionIndex`, qui est
       * remis a zero a chaque `prompt-call` et sert d'index LOCAL au bloc : s'appuyer sur lui pour un
       * identifiant produisait des doublons. Celui-ci ne redescend jamais.
       */
      // Un tour RÉCUPÉRÉ réutilise son turnId : l'ordinal doit repartir d'où la trace s'était
      // arrêtée, sinon le premier événement de la reprise duplique `…:action:0-0:…` et
      // `TraceStore.append` fait échouer le tour entier (mesuré sur conv-1147, 3,19 $ perdus).
      let traceActionOrdinal =
        recovery && conversationId
          ? seedTraceActionOrdinal(causalTrace.readConversationBestEffort(conversationId), turnId)
          : 0
      // Ordinal DEDIE aux artefacts : partager celui des actions ferait collisionner les identifiants.
      let traceArtifactOrdinal = 0
      let turnSessionId: string | undefined
      const last = safe[safe.length - 1]
      const routingUserMessageOverride = continuationWindow?.routingUserMessage
        ? guardString(continuationWindow.routingUserMessage.content, 'content')
        : undefined
      activityLabel = continuation
        ? 'reprise du tour interrompu'
        : last?.role === 'user'
          ? last.content
          : 'tour agent'
      const recoveredProviderUsage = recovery?.providerCall.result.usage
      if (
        conversationId &&
        recovery &&
        recoveredProviderUsage &&
        persistRecoveredChatProviderUsage({
          conversationId,
          usageCallId: recovery.call.token,
          provider: recovery.call.provider,
          model:
            recovery.providerCall.result.model ??
            turnPromptIdentity?.model ??
            turnRuntimeBinding.model,
          reasoningEffort:
            turnPromptIdentity?.reasoningEffort ?? turnRuntimeBinding.reasoningEffort,
          label: activityLabel,
          usage: recoveredProviderUsage
        })
      ) {
        const recoveredOccurrence = scheduledTasks.reconcileUsageForTurn(conversationId, turnId, {
          knownCostUsd: recoveredProviderUsage.costUsd,
          totalTokens: recoveredProviderUsage.inputTokens + recoveredProviderUsage.outputTokens,
          unpricedCalls: recoveredProviderUsage.costUsd === undefined ? 1 : 0,
          resolvedModel: recovery.providerCall.result.model
        })
        if (recoveredOccurrence?.trigger === 'watchdog') {
          deps.watchdogEngine()?.rememberRecoveredUsage(recoveredOccurrence.taskId, {
            eventId: recoveredOccurrence.id,
            conversationId,
            turnId,
            knownCostUsd: recoveredProviderUsage.costUsd,
            totalTokens: recoveredProviderUsage.inputTokens + recoveredProviderUsage.outputTokens,
            unpricedCalls: recoveredProviderUsage.costUsd === undefined ? 1 : 0,
            resolvedModel: recovery.providerCall.result.model
          })
        }
        broadcast({ type: 'refresh', scope: 'workflows' })
      }
      if (conversationId && recovery && os.conversations.get(conversationId)) {
        os.conversations.applyTurnEvent(conversationId, turnId, { kind: 'resumed' })
        appendTurnEvent(turnJournalRoot, conversationId, turnId, {
          kind: 'resumed',
          at: Date.now()
        })
      } else if (conversationId && continuation && os.conversations.get(conversationId)) {
        os.conversations.beginContinuationTurn(conversationId, {
          turnId,
          runtime: {
            provider: turnRuntimeBinding.provider,
            model: turnRuntimeBinding.model,
            reasoningEffort: turnRuntimeBinding.reasoningEffort
          }
        })
      } else if (conversationId && last?.role === 'user' && os.conversations.get(conversationId)) {
        os.conversations.beginTurn(
          conversationId,
          {
            content: last.content,
            attachments: last.attachments?.map(
              ({ name, mimeType, size, kind, content, thumbnail }) => {
                const metadata = {
                  name,
                  mimeType,
                  size,
                  ...(thumbnail && { thumbnail })
                }
                if (kind !== 'image') return metadata
                try {
                  return {
                    ...metadata,
                    turnId,
                    artifact: materializeUserImageArtifact(
                      { name, mimeType, size, content },
                      conversationId,
                      turnId
                    )
                  }
                } catch {
                  return {
                    ...metadata,
                    turnId,
                    originalUnavailable: true
                  }
                }
              }
            )
          },
          {
            turnId,
            runtime: {
              provider: turnRuntimeBinding.provider,
              model: turnRuntimeBinding.model,
              reasoningEffort: turnRuntimeBinding.reasoningEffort
            }
          }
        )
        // Le MESSAGE ENVOYÉ doit être visible DÈS l'envoi, pas au premier événement de réponse
        // (« je devrais directement voir notre message partir », 14/08) : le tour vient d'être
        // persisté (user + assistant streaming), on prévient la vue tout de suite.
        broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
        // ... et la LISTE aussi. Le fil seul se rafraichissait : la barre laterale garde alors un
        // `lastUserMessageAt` perime jusqu'a la FIN du tour (le seul autre refresh 'conversations',
        // dans le `finally`), donc ecrire ici ne remontait PAS la conversation en tete — constate
        // par l'utilisateur le 2026-08-30. Le tri est correct, c'est la donnee qui arrivait tard.
        broadcast({ type: 'refresh', scope: 'conversations' })
      }
      const applyDurableEvent = (pilotEvent: PilotEvent): void => {
        if (!conversationId || !os.conversations.get(conversationId)) return
        let durableEvent: ChatTurnEvent | undefined
        if (pilotEvent.kind === 'delta' && pilotEvent.text && pilotEvent.streamId)
          durableEvent = {
            kind: 'delta',
            streamId: pilotEvent.streamId,
            text: pilotEvent.text
          }
        else if (pilotEvent.kind === 'stream-reset' && pilotEvent.streamId)
          durableEvent = { kind: 'stream-reset', streamId: pilotEvent.streamId }
        else if (pilotEvent.kind === 'think' && pilotEvent.text)
          durableEvent = {
            kind: 'delta',
            streamId: `fallback:${pilotEvent.iteration ?? 0}`,
            text: pilotEvent.text
          }
        else if (pilotEvent.kind === 'command' && pilotEvent.name)
          durableEvent = {
            kind: 'command',
            actionId: pilotEvent.actionId ?? `${pilotEvent.iteration ?? 0}:${traceActionIndex}`,
            name: pilotEvent.name,
            args: pilotEvent.args,
            // Le lien de reprise vers l'action echouee que celle-ci retente. Sans cette recopie il
            // serait jete ICI, a la frontiere de persistance, comme le cout l'a deja ete.
            ...(pilotEvent.repriseProbableDe
              ? { repriseProbableDe: pilotEvent.repriseProbableDe }
              : {})
          }
        else if (pilotEvent.kind === 'result' && pilotEvent.name)
          durableEvent = {
            kind: 'result',
            actionId:
              pilotEvent.actionId ??
              `${pilotEvent.iteration ?? 0}:${Math.max(0, traceActionIndex - 1)}`,
            name: pilotEvent.name,
            ok: pilotEvent.ok,
            data: pilotEvent.data,
            ...(pilotEvent.attachments?.length
              ? { attachments: guardAttachments(pilotEvent.attachments) }
              : {})
          }
        else if (pilotEvent.kind === 'artifact' && pilotEvent.artifact)
          durableEvent = { kind: 'artifact', artifact: pilotEvent.artifact }
        else if (pilotEvent.kind === 'done') {
          /**
           * Le TEXTE du `done` doit atterrir dans le message quand rien n'a ete streame.
           *
           * Constate en essai reel (2026-07-29) : le chemin direct `orchestrate` emet sa carte de
           * livraison (statut, cout, run, resultat) UNIQUEMENT dans le `done` — aucun delta. Comme
           * seul `sessionId` etait persiste, la carte etait calculee puis JETEE, et le fil ne gardait
           * que « [a execute orchestrate] ». Meme patron que le cout jete : produire l'information
           * puis la perdre a la frontiere de persistance.
           *
           * Condition stricte pour ne JAMAIS dupliquer : on ne persiste ce texte que si aucun delta
           * n'a ete emis pendant le tour (sinon le texte du `done` reprend ce qui a deja ete dit).
           *
           * ET IL FAUT LE LIVRER AU FIL LIVE, pas seulement l'ecrire. Mesure du 2026-08-17 sur
           * `conv-1276` : tout le texte du tour tenait dans cette seule part `<turnId>:closing`, et
           * l'utilisateur ne l'a vu qu'apres avoir envoye le message SUIVANT — qui relit le store. Le
           * renderer ne recoit que `done`, dont son reducteur jette le texte (par construction, pour ne
           * pas dupliquer le streame) : un texte porte par le seul `done` n'atteignait donc JAMAIS le
           * fil vivant. Meme patron que la carte de livraison jetee ci-dessus, un cran plus loin — non
           * plus a la frontiere de persistance, mais a celle de l'AFFICHAGE.
           */
          const livraison = closingTurnDelivery(
            turnId,
            pilotEvent.text,
            durableResponseTextSeen,
            pilotEvent.outcome
          )
          if (livraison) {
            os.conversations.applyTurnEvent(conversationId, turnId, livraison.durable)
            emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event', {
              ...livraison.live,
              conversationId,
              turnId
            })
            try {
              appendTurnEvent(turnJournalRoot, conversationId, turnId, {
                kind: 'delta',
                text: livraison.durable.text,
                at: Date.now()
              })
            } catch {
              /* journal best-effort */
            }
          }
          // Le raisonnement accumule entre dans la trace ICI, une seule fois, a la cloture du tour.
          const raisonnement = streamedReasoning.trim()
          // ... et dans le TOUR lui-meme, sinon le bloc « Reflexion » du fil est vide des qu'on
          // recharge la conversation : la pensee ne vivait que le temps du stream. Une seule
          // ecriture a la cloture, pas une par delta — la vue, elle, a deja son direct.
          if (conversationId && raisonnement)
            os.conversations.applyTurnEvent(conversationId, turnId, {
              kind: 'reasoning',
              text: raisonnement
            })
          if (conversationId && raisonnement) {
            try {
              traceSequence = rebaseTraceSequence(causalTrace, conversationId, traceSequence)
              const reasoningEvent = reasoningToTraceEvent({
                id: `${turnId}:reasoning`,
                conversationId,
                turnId,
                parentId: traceParentId,
                timestamp: new Date().toISOString(),
                sequence: traceSequence++,
                text: raisonnement
              })
              causalTrace.append(reasoningEvent)
              traceParentId = reasoningEvent.id
            } catch {
              /* trace best-effort : ne jamais casser un tour pour une ecriture d'observabilite */
            }
          }
          // L'issue d'orchestration entre dans la trace comme verdict de CONTROLE type, au lieu de
          // rester du texte libre que rien ne peut filtrer ni compter.
          const issue = pilotEvent.outcome
          if (conversationId && issue && Object.keys(issue).length > 0) {
            try {
              const outcomeEvent = appendObservedOrchestrationOutcome(causalTrace, {
                conversationId,
                turnId,
                timestamp: new Date().toISOString(),
                outcome: issue
              })
              traceSequence = Math.max(traceSequence, outcomeEvent.sequence + 1)
              traceParentId = outcomeEvent.id
            } catch {
              /* trace best-effort : ne jamais casser un tour pour une ecriture d'observabilite */
            }
          }
          /**
           * ... et dans le JOURNAL de la conversation. Le raisonnement, le cout reel du tour et
           * l'issue d'orchestration n'y figuraient PAS : ils partaient dans le tour et dans le
           * trace-store (Observatory) seulement. Comme le journal est desormais ce qui est ANALYSE
           * a la place de l'Observatory, l'information doit y etre ECRITE, pas seulement produite.
           */
          try {
            for (const journalEvent of closingJournalEvents(
              {
                reasoning: raisonnement,
                usage: turnUsage ? { ...turnUsage } : undefined,
                outcome: issue
              },
              Date.now()
            ))
              appendTurnEvent(turnJournalRoot, conversationId, turnId, journalEvent)
          } catch {
            /* journal best-effort : ne jamais casser un tour pour une ecriture d'observabilite */
          }
          durableEvent = { kind: 'done', sessionId: turnSessionId }
        } else if (pilotEvent.kind === 'cancellation') durableEvent = { kind: 'cancelled' }
        if (durableEvent) {
          if (durableEvent.kind === 'result' && durableEvent.attachments?.length) {
            // La conversation n'a besoin que de la carte resultat. Le binaire brut reste dans le
            // journal de reprise borne ci-dessous, pas dans le WAL general ni dans la vue.
            const conversationEvent = { ...durableEvent }
            delete conversationEvent.attachments
            os.conversations.applyTurnEvent(conversationId, turnId, conversationEvent)
          } else {
            os.conversations.applyTurnEvent(conversationId, turnId, durableEvent)
          }
          // Survie niveau 2 : le même événement va AUSSI dans le journal fichier du tour, pour
          // pouvoir repérer/rejouer un tour resté inachevé après une fermeture complète de l'app.
          try {
            appendTurnEvent(turnJournalRoot, conversationId, turnId, {
              ...durableEvent,
              at: Date.now()
            })
          } catch {
            /* journal best-effort : ne jamais casser un tour pour une écriture de trace */
          }
        }
      }
      /**
       * VEILLEUR D'INACTIVITE — un tour qui ne finit jamais ne doit pas rester SILENCIEUX.
       *
       * Vecu par l'utilisateur : `conv-1181` le matin, `conv-1242` le soir — toutes deux figees en
       * statut `streaming`, contenu « [a execute orchestrate] », action `ok: null`. Ni reponse, ni
       * erreur, ni moyen de savoir que c'est mort. Sa demande : « ma derniere convers in app a encore
       * foire, repare pour les prochains prompts ».
       *
       * Les quatre gardes de forme posees plus tot ne peuvent RIEN ici : elles s'arment a la FIN d'un
       * tour, et ce tour n'en a pas. On surveille donc l'absence de signe de vie — tout evenement du
       * pilote (delta, action, resultat, raisonnement) en est un.
       *
       * Le plafond est volontairement LARGE : il ne s'agit pas de brider un travail long mais de
       * distinguer « long » de « MORT ». Une orchestration active emet regulierement ; un tour qui
       * n'emet plus rien pendant vingt minutes n'est plus en train de travailler.
       */
      const PLAFOND_INACTIVITE_MS = 20 * 60 * 1000
      let dernierSigneDeVie = Date.now()
      let commandesEnVol = 0
      /*
       * UNE COMMANDE QUI TOURNE EST UN SIGNE DE VIE — MEME QUAND ELLE N'EMET RIEN.
       *
       * Defaut vecu le 2026-09-04 (conv-233) : entre `command` (le depart) et `result` (l'arrivee),
       * une commande longue n'emet AUCUN evenement. Une suite de tests de 233 s, deux editions
       * coupees a 182 s et l'attente du modele ont suffi a franchir le plafond : le tour a ete tue
       * avec « aucun signe de vie depuis 20 minutes » ALORS QU'IL TRAVAILLAIT.
       *
       * On ne relache pas la garde — elle existe pour les tours REELLEMENT morts (conv-1181,
       * conv-1242 : figes sur « [a execute orchestrate] »). On la rend EXACTE. La decision elle-meme
       * vit dans `verdictVeilleurInactivite`, pour etre testable sans horloge : voir
       * `veilleur-inactivite.test.ts`.
       */
      veilleur = setInterval(() => {
        const verdict = verdictVeilleurInactivite({
          inactifDepuisMs: Date.now() - dernierSigneDeVie,
          commandesEnVol,
          plafondMs: PLAFOND_INACTIVITE_MS
        })
        // Une commande en vol REARME le compte a rebours : des qu'elle revient, il repart de zero.
        if (verdict === 'commande-en-vol') {
          dernierSigneDeVie = Date.now()
          return
        }
        if (verdict === 'patienter') return
        if (veilleur) clearInterval(veilleur)
        // Un motif NOMME, jamais un arret muet : l'utilisateur doit lire pourquoi son tour s'arrete.
        // Le motif porte le PREFIXE qui le requalifie en ECHEC plus bas — sans lui, cet arret
        // repassait pour une annulation volontaire et le motif etait jete (conv-136, 2026-09-02).
        controller.abort(motifInactivite(PLAFOND_INACTIVITE_MS))
      }, 60_000)
      veilleur.unref()

      const handlePilotEvent = (incomingPilotEvent: PilotEvent): void => {
        dernierSigneDeVie = Date.now()
        let pilotEvent = incomingPilotEvent
        if (conversationId && pilotEvent.kind === 'artifact' && pilotEvent.artifact) {
          try {
            pilotEvent = {
              ...pilotEvent,
              artifact: materializeChatArtifact(pilotEvent.artifact, conversationId, turnId)
            }
          } catch (error) {
            pilotEvent = {
              kind: 'error',
              text:
                error instanceof Error ? error.message : 'Conservation de l’artefact impossible',
              iteration: pilotEvent.iteration
            }
          }
        }
        if (conversationId) {
          const structuredIncident = incidentFromPilotEvent({
            kind: pilotEvent.kind,
            name: pilotEvent.name,
            text: pilotEvent.kind === 'prompt-call' ? pilotEvent.error : pilotEvent.text,
            ok: pilotEvent.ok,
            data: pilotEvent.data,
            status: pilotEvent.kind === 'prompt-call' ? pilotEvent.status : undefined
          })
          // ARRÊT VOULU ⇒ AUCUN incident. Le chemin du tour pilote était déjà protégé (`signal.aborted`),
          // mais pas celui de l'ORCHESTRATION : un run coupé finit rouge, et rouge valait incident. D'où
          // la boucle rapportée — couper un run kaizen en engendrait un autre.
          if (structuredIncident && !activeChatTurns.wasDeliberatelyStopped(conversationId)) {
            // Les mêmes incidents structurés alimentent les règles Watchdog. La détection existait
            // déjà (`incidentFromPilotEvent`) mais n'était exposée nulle part : elle mourait dans un
            // module invisible. On ne la réécrit pas, on la BRANCHE.
            void notifyWatchdogWorkflowIncident(structuredIncident, conversationId)
          }
        }
        if (
          pilotEvent.kind === 'result' &&
          pilotEvent.name === 'orchestrate' &&
          pilotEvent.ok !== false &&
          pilotEvent.data &&
          typeof pilotEvent.data === 'object'
        ) {
          const outcome = pilotEvent.data as Record<string, unknown>
          if (outcome.valid === true && outcome.gateBlocked !== true) {
            verification = {
              complete: true,
              evidence:
                typeof outcome.runPath === 'string'
                  ? `judge vert, RUN ${outcome.runPath}`
                  : 'judge vert et gate validée'
            }
          }
        }
        if (pilotEvent.kind === 'delta' && pilotEvent.text) {
          // Deux itérations d'un même tour sont deux MESSAGES : les coller bout à bout soudait la
          // fin de l'un au début de l'autre (« …du balayage.```html-render »), ce qui sortait le
          // bloc mis en forme en texte brut. Cf. coller-texte-parle.ts pour le défaut mesuré.
          streamedSpoken = collerTexteParle(
            streamedSpoken,
            pilotEvent.text,
            iterationDuDernierDelta === pilotEvent.iteration
          )
          iterationDuDernierDelta = pilotEvent.iteration
          durableResponseTextSeen = true
        }
        if (pilotEvent.kind === 'reasoning' && pilotEvent.text) streamedReasoning += pilotEvent.text
        if (pilotEvent.kind === 'think' && pilotEvent.text) {
          spoken.push(pilotEvent.text)
          durableResponseTextSeen = true
        }
        if (pilotEvent.kind === 'command' && pilotEvent.name)
          etiquettesAction.push(`[a exécuté ${pilotEvent.name}]`)
        // LE COMPTEUR DU VEILLEUR. Une commande part (`command`) et revient (`result`) : entre les
        // deux, le tour peut rester muet des minutes sans etre mort. `Math.max(0, …)` garde le
        // compte sain si un `result` arrive sans `command` (evenement rejoue, reprise apres crash).
        if (pilotEvent.kind === 'command') commandesEnVol += 1
        if (pilotEvent.kind === 'result') commandesEnVol = Math.max(0, commandesEnVol - 1)
        if (pilotEvent.kind === 'done' && pilotEvent.usage) turnUsage = pilotEvent.usage
        if (pilotEvent.kind === 'done' && pilotEvent.text?.trim())
          completedText = pilotEvent.text.trim()
        // Budget du TOUR de chat : le circuit-breaker de coût ne protégeait que les runs
        // orchestrés. Mesuré le 2026-07-28 : un seul tour a coûté 2,109 $ (40 itérations d'outils)
        // sans qu'aucune borne n'existe côté chat. On compte chaque appel et on COUPE au seuil.
        if (pilotEvent.kind === 'prompt-call' && pilotEvent.callUsage) {
          const tripped = chatBreaker.observe({
            step: 'exec',
            detail: 'chat',
            costUsd: pilotEvent.callUsage.costUsd,
            tokens: pilotEvent.callUsage.inputTokens + pilotEvent.callUsage.outputTokens
          } as Parameters<typeof chatBreaker.observe>[0])
          if (tripped) {
            // Le dépassement reste TOUJOURS visible ; la coupure n'est armée que par un cap
            // explicite (contrat utilisateur) — cf. chat-turn-budget.ts et conv-1149.
            const coupe = budgetDuTour.enforcement === 'blocking'
            ledger.append({
              source: 'orchestrate',
              name: 'chat-budget',
              detail: coupe
                ? `tour coupé — ${tripped.reason}`
                : `seuil d'observation dépassé (mesure seule, aucun arrêt) — ${tripped.reason}`
            })
            if (coupe) controller.abort(`${CHAT_BUDGET_ABORT_PREFIX} : ${tripped.reason}`)
          }
        }
        if (pilotEvent.kind === 'prompt-call' && pilotEvent.sessionId)
          turnSessionId = pilotEvent.sessionId
        if (pilotEvent.kind === 'prompt-call' && pilotEvent.resolvedModel)
          turnResolvedModel = pilotEvent.resolvedModel
        if (pilotEvent.kind === 'prompt-call' && pilotEvent.prompt) {
          const reasoningEffort = pilotEvent.prompt.options.reasoningEffort
          turnPromptIdentity ??= {
            provider: pilotEvent.prompt.provider,
            model: pilotEvent.prompt.model,
            reasoningEffort: typeof reasoningEffort === 'string' ? reasoningEffort : undefined
          }
        }
        if (pilotEvent.kind === 'prompt-call') {
          // `ExecutionSupervisor` a deja solde la reservation avant que le pilote emette cet
          // evenement. Persister ce snapshot MAINTENANT evite qu'un crash a l'appel suivant perde
          // le cout du precedent ; la publication terminale reste dedupliquee par snapshot.
          const settledUsage = os.executionSupervisor.currentSnapshot()
          if (settledUsage) {
            supervisedUsage = settledUsage
            persistSupervisedChatUsage(settledUsage)
          }
        }
        applyDurableEvent(pilotEvent)
        /**
         * TOUT LE RESTE DU PILOTE DANS LE JOURNAL. `applyDurableEvent` ne retient que 8 `kind` sur
         * les 14 emis ; `error`, `retry`, `provider-status`, `action-progress` et le `reasoning`
         * par iteration n'atteignaient donc AUCUN fichier — produits, puis jetes a la frontiere
         * d'ecriture. Aucun affichage ne peut montrer ce qui n'est pas ecrit : c'est ici la cause
         * du journal ou « on ne voit rien ». Un `kind` inconnu est ecrit tel quel, jamais perdu.
         */
        if (conversationId) {
          try {
            for (const journalEvent of pilotJournalEvents(pilotEvent, Date.now()))
              appendTurnEvent(turnJournalRoot, conversationId, turnId, journalEvent)
          } catch {
            /* journal best-effort : ne jamais casser un tour pour une ecriture d'observabilite */
          }
        }
        if (conversationId && pilotEvent.kind === 'prompt-call' && pilotEvent.prompt) {
          // L'APPEL PROVIDER dans le journal : prompt systeme, options, usage/cout, modele resolu,
          // duree, statut/erreur. Jusqu'ici seul le trace-store le savait — le journal ne portait
          // que les deltas de reponse, d'ou un log juge « super pauvre ».
          try {
            for (const journalEvent of promptCallJournalEvents(
              pilotEvent,
              promptJournalMemory,
              Date.now()
            ))
              appendTurnEvent(turnJournalRoot, conversationId, turnId, journalEvent)
          } catch {
            /* journal best-effort : ne jamais casser un tour pour une ecriture d'observabilite */
          }
          traceSequence = rebaseTraceSequence(causalTrace, conversationId, traceSequence)
          const promptCall = appendPromptCall({
            conversationId,
            turnId,
            brainTraceId: latestBrainTraceId(conversationId, turnId),
            iteration: pilotEvent.iteration ?? 0,
            actor: 'orchestrator',
            provider: pilotEvent.prompt.provider,
            model: pilotEvent.prompt.model,
            resolvedModel: pilotEvent.resolvedModel,
            transport: pilotEvent.prompt.transport,
            boundary: 'Autowin OS -> provider adapter',
            limitation: pilotEvent.prompt.limitation,
            system: pilotEvent.prompt.system,
            // Le chemin CHAT jetait les deux decompositions : `systemBlocks` etait pourtant calcule
            // par `agent-pilot` depuis F6, mais ce site ne le recopiait pas. L'Observatory affichait
            // donc les tours de chat — les plus nombreux — sans aucune injection nommee.
            systemBlocks: pilotEvent.prompt.systemBlocks,
            contextBlocks: pilotEvent.prompt.contextBlocks,
            messages: pilotEvent.prompt.messages,
            options: pilotEvent.prompt.options,
            response: pilotEvent.response ?? '',
            status: pilotEvent.status,
            error: pilotEvent.error,
            usage: pilotEvent.callUsage,
            durationMs: pilotEvent.callDurationMs,
            sessionId: pilotEvent.sessionId
          })
          const promptTraceEvents = promptCallToTraceEvents(
            promptCall,
            traceSequence,
            traceParentId
          )
          for (const traceEvent of promptTraceEvents) causalTrace.append(traceEvent)
          traceParentId = `${promptCall.id}:3`
          traceSequence += promptTraceEvents.length
          traceActionIndex = 0
        }
        if (
          conversationId &&
          (pilotEvent.kind === 'command' ||
            pilotEvent.kind === 'result' ||
            pilotEvent.kind === 'error' ||
            pilotEvent.kind === 'retry' ||
            pilotEvent.kind === 'cancellation')
        ) {
          traceSequence = rebaseTraceSequence(causalTrace, conversationId, traceSequence)
          traceActionIndex++
          const action = pilotActionToTraceEvent({
            // `traceActionOrdinal` et NON `traceActionIndex` : ce dernier est remis a zero a chaque
            // `prompt-call`, ce qui faisait collisionner deux `retry` d'un meme tour sur
            // `…:action:0:retry` — `TraceStore.append` jetait alors « evenement duplique » et le tour
            // entier echouait. L'ordinal, lui, ne se reinitialise jamais.
            id: traceActionEventId({
              turnId,
              kind: pilotEvent.kind,
              actionId: pilotEvent.actionId,
              iteration: pilotEvent.iteration,
              ordinal: traceActionOrdinal++
            }),
            conversationId,
            turnId,
            parentId: traceParentId,
            timestamp: new Date().toISOString(),
            sequence: traceSequence++,
            kind: pilotEvent.kind,
            name: pilotEvent.name,
            data:
              pilotEvent.kind === 'command'
                ? pilotEvent.args
                : (pilotEvent.data ?? pilotEvent.text),
            ok: pilotEvent.ok
          })
          causalTrace.append(action)
          traceParentId = action.id
        }
        /**
         * Un artefact produit par le modele entre AUSSI dans la trace causale.
         *
         * Constate le 2026-08-07 : l'artefact etait persiste dans le tour de chat et dans le journal
         * du tour, mais `src/main/activity/` ne le connaissait pas du tout — Observatory omettait
         * donc un livrable tout en pretendant montrer ce que le tour avait produit. Meme patron que
         * le cout jete : produire l'information puis la perdre a la frontiere de persistance.
         *
         * L'ecriture est best-effort : une trace n'a jamais le droit de faire echouer un tour deja
         * paye.
         */
        if (conversationId && pilotEvent.kind === 'artifact' && pilotEvent.artifact) {
          try {
            traceSequence = rebaseTraceSequence(causalTrace, conversationId, traceSequence)
            const artifactEvent = chatArtifactToTraceEvent({
              id: `${turnId}:artifact:${traceArtifactOrdinal++}`,
              conversationId,
              turnId,
              parentId: traceParentId,
              timestamp: new Date().toISOString(),
              sequence: traceSequence++,
              artifact: pilotEvent.artifact as Parameters<
                typeof chatArtifactToTraceEvent
              >[0]['artifact']
            })
            causalTrace.append(artifactEvent)
            traceParentId = artifactEvent.id
          } catch {
            /* trace best-effort : ne jamais casser un tour pour une ecriture d'observabilite */
          }
        }
        // Idem pour le flux de chat : une fenetre fermee est un non-evenement, pas une erreur du
        // tour en cours (qui est deja paye et persiste).
        const livePilotEvent = { ...pilotEvent }
        delete livePilotEvent.attachments
        emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event', {
          ...livePilotEvent,
          conversationId,
          turnId
        })
      }
      const delayedPilotFixture =
        isolatedTestInstance && safe.at(-1)?.content.startsWith('[[autowin-fixture-delayed-pilot]]')
      const autoKaizenFailureFixture =
        isolatedTestInstance &&
        safe.at(-1)?.content.startsWith('[[autowin-fixture-auto-kaizen-error]]')
      const durableStreamPrefix = '[[autowin-fixture-durable-stream]]'
      const durableStreamFixture =
        isolatedTestInstance && safe.at(-1)?.content.startsWith(durableStreamPrefix)
      if (autoKaizenFailureFixture) {
        const fixtureEvents: PilotEvent[] = [
          {
            kind: 'command',
            actionId: `${turnId}:fixture-auto-kaizen`,
            name: 'verify',
            args: { command: 'fixture rouge' }
          },
          {
            kind: 'result',
            actionId: `${turnId}:fixture-auto-kaizen`,
            name: 'verify',
            ok: false,
            data: { error: 'Exit code: 1', source: 'isolated-auto-kaizen-fixture' }
          },
          { kind: 'done', text: 'Erreur structurée de fixture transmise à Auto-Kaizen.' }
        ]
        for (const fixtureEvent of fixtureEvents) handlePilotEvent(fixtureEvent)
        broadcast({
          type: 'orchestrate-end',
          convId: conversationId,
          status: 'red',
          detail: 'Fixture isolée : orchestration rouge vérifiable de bout en bout.'
        })
      } else if (durableStreamFixture) {
        const target = safe.at(-1)?.content.slice(durableStreamPrefix.length).trim() || 'fixture'
        let fixtureCall = 0
        const fixtureProvider: ProviderAdapter = {
          id: 'autowin-durable-fixture',
          auth: async () => true,
          async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
            fixtureCall += 1
            if (fixtureCall > 1) {
              return {
                text: '',
                provider: 'autowin-durable-fixture',
                systemInjected: true
              }
            }
            const chunks = [
              'Je ',
              'réponds ',
              'progressivement.',
              '<cm',
              `d>{"name":"get_state","args":{"target":${JSON.stringify(target)},"token":"fixture-secret"}}</cmd>`,
              ' Terminé.'
            ]
            for (const delta of chunks) {
              yield { delta }
              if (!delta.startsWith('<') && !delta.startsWith('d>'))
                await new Promise((resolve) => setTimeout(resolve, 120))
            }
            return {
              text: chunks.join(''),
              provider: 'autowin-durable-fixture',
              systemInjected: true
            }
          }
        }
        const fixtureRegistry = new ProviderRegistry().register(fixtureProvider)
        const fixtureRoles = new RoleModelConfig({
          orchestrator: { provider: fixtureProvider.id, model: 'deterministic-fixture' }
        })
        const fixtureBus = {
          catalog: () => bus.catalog(),
          snapshot: () => bus.snapshot(),
          snapshotForPrompt: () => bus.snapshotForPrompt(),
          exec: async (name: string, args: Record<string, unknown>) =>
            bus.exec(name, args, conversationId, undefined, turnId)
        } as AppCommandBus
        await new AgentPilot(fixtureRegistry, fixtureRoles, fixtureBus).chat(
          safe,
          handlePilotEvent,
          undefined,
          6,
          conversationId,
          controller.signal
        )
        if (conversationId && target === 'observatory-critical-path') {
          const appendFixtureEvent = (
            id: string,
            type: 'decision' | 'tool-result' | 'gate' | 'verdict',
            status: 'pending' | 'completed',
            content: string,
            parentId?: string
          ): void => {
            causalTrace.append({
              schema: 'autowin.trace/v1',
              id,
              conversationId,
              turnId,
              ...(parentId ? { parentId } : {}),
              timestamp: new Date().toISOString(),
              sequence: causalTrace.nextSequence(conversationId),
              type,
              status,
              actor: { id: 'autowin-fixture', kind: 'system', label: 'Fixture Observatory' },
              channel: 'internal',
              payloads: [
                {
                  kind: type === 'tool-result' ? 'tool-result' : 'reasoning',
                  content
                }
              ],
              observation: { boundary: 'isolated-observatory-fixture', fidelity: 'exact' }
            })
          }
          const openId = `${turnId}:fixture-decision-open`
          appendFixtureEvent(
            openId,
            'decision',
            'pending',
            JSON.stringify({
              hypothesis: 'Le flux live doit actualiser Observatory',
              expectedSignal: 'un nouvel evenement apparait sans clic sur Actualiser'
            })
          )
          const closedId = `${turnId}:fixture-decision-closed`
          appendFixtureEvent(
            closedId,
            'decision',
            'completed',
            JSON.stringify({
              hypothesis: 'Le recu autorite est rendu',
              expectedSignal: 'la piste Autorite expose mode, risque et decision'
            })
          )
          const observationId = `${turnId}:fixture-observation`
          appendFixtureEvent(
            observationId,
            'tool-result',
            'completed',
            'Recu get_state observe',
            closedId
          )
          const gateId = `${turnId}:fixture-gate`
          appendFixtureEvent(
            gateId,
            'gate',
            'completed',
            'Signal visible et structure',
            observationId
          )
          appendFixtureEvent(
            `${turnId}:fixture-verdict`,
            'verdict',
            'completed',
            'Preuve acceptee',
            gateId
          )
        }
      } else if (delayedPilotFixture) {
        await new Promise<void>((resolve, reject) => {
          const finish = (): void => {
            controller.signal.removeEventListener('abort', cancel)
            resolve()
          }
          const cancel = (): void => {
            clearTimeout(timeout)
            reject(new Error('aborted'))
          }
          const timeout = setTimeout(finish, 600)
          if (controller.signal.aborted) cancel()
          else controller.signal.addEventListener('abort', cancel, { once: true })
        })
        const fixtureEvents = [
          { kind: 'think', text: 'événement tardif correctement routé' },
          { kind: 'command', name: 'get_state', args: { target: 'late-conversation' } },
          { kind: 'result', name: 'get_state', ok: true, data: { source: 'isolated' } },
          { kind: 'command', name: 'navigate', args: { tab: 'memory' } },
          { kind: 'result', name: 'navigate', ok: true, data: { activeTab: 'memory' } },
          { kind: 'done', text: 'fixture pilot terminée' }
        ]
        for (const fixtureEvent of fixtureEvents) handlePilotEvent(fixtureEvent as PilotEvent)
      } else
        await os.runChatTurn(
          last?.content ?? 'chat',
          controller.signal,
          () => {
            // Le supervisor peut annuler pour budget/watchdog sans que le controller UI soit lui-meme
            // aborté. Le pilote doit voir CE signal combine pour ne jamais retenter apres le cut-off.
            const supervisedSignal = os.executionSupervisor.currentSignal() ?? controller.signal
            const turnPilot = policy?.readOnly
              ? new AgentPilot(os.registry, os.roles, {
                  catalog: () => [],
                  snapshotForPrompt: async () => ({ mode: 'watchdog-read-only' }),
                  exec: async () => ({
                    ok: false,
                    error: 'Triage Watchdog en lecture seule : aucune commande autorisee.'
                  })
                } as unknown as AppCommandBus)
              : pilot
            const watchdogReadOnlyProfile = policy?.readOnly && policy.background
            const pilotSendLimits =
              policy?.maxBudgetUsd || watchdogReadOnlyProfile
                ? {
                    ...(policy?.maxBudgetUsd ? { maxBudgetUsd: policy.maxBudgetUsd } : {}),
                    ...(watchdogReadOnlyProfile
                      ? { systemProfile: 'watchdog-read-only' as const }
                      : {})
                  }
                : undefined
            return turnPilot.chat(
              safe,
              handlePilotEvent,
              (question) =>
                sender
                  ? askModelQuestion(sender, 'chat', question, 'Chat', supervisedSignal)
                  : Promise.reject(
                      new Error(
                        'Une tâche planifiée ne peut pas répondre à une question interactive du modèle.'
                      )
                    ),
              policy?.maxIterations ?? CAP_ITERATIONS_TOUR,
              conversationId,
              supervisedSignal,
              conversationId ? () => drainPendingDirectives(conversationId) : undefined,
              bindingOverride,
              turnId,
              turnRuntimeBinding,
              recovery?.providerCall,
              conversationId
                ? (link) =>
                    appendTurnEvent(turnJournalRoot, conversationId, turnId, {
                      kind: 'provider-journal',
                      ...link,
                      ...(policy ? { policy } : {}),
                      at: Date.now()
                    })
                : undefined,
              pilotSendLimits,
              routingUserMessageOverride,
              // Le cablage du tour COUPE a ete perdu sur cet arbre partage ; il sera repose a part.
              undefined,
              // Le CHAT de l'utilisateur exige l'experience soignee : bloc de cloture, aveu d'echec,
              // et jamais un plan recite au futur en guise de resultat. Sans ce drapeau, les gardes
              // restent inertes — c'est exactement ce qui a ete mesure : 0 conforme sur 8 sondes,
              // alors que les gardes existaient et etaient testees.
              true
            )
          },
          onSupervisedUsageSettlement
        )
      // Journal d'activité de la conversation : le tour de chat, avec son coût ET sa durée.
      const turnDurationMs = Math.round(performance.now() - turnStartedAtMs)
      if (conversationId) {
        const recoveredUsage = recovery?.providerCall.result.usage
        if (recovery && recoveredUsage)
          persistRecoveredChatProviderUsage({
            conversationId,
            usageCallId: recovery.call.token,
            provider: recovery.call.provider,
            model:
              turnResolvedModel ??
              recovery.providerCall.result.model ??
              turnPromptIdentity?.model ??
              turnRuntimeBinding.model,
            reasoningEffort:
              turnPromptIdentity?.reasoningEffort ?? turnRuntimeBinding.reasoningEffort,
            label: activityLabel,
            usage: recoveredUsage,
            durationMs: turnDurationMs
          })
        if (supervisedUsage) persistSupervisedChatUsage(supervisedUsage)
        else {
          appendConvActivity(conversationId, {
            kind: 'chat',
            label: activityLabel,
            provider: turnPromptIdentity?.provider ?? turnRuntimeBinding.provider,
            model: turnResolvedModel ?? turnPromptIdentity?.model ?? turnRuntimeBinding.model,
            reasoningEffort:
              turnPromptIdentity?.reasoningEffort ?? turnRuntimeBinding.reasoningEffort,
            inputTokens: turnUsage?.inputTokens,
            outputTokens: turnUsage?.outputTokens,
            costUsd: turnUsage?.costUsd,
            turnId,
            durationMs: turnDurationMs,
            text: (streamedSpoken || spoken.join('\n') || etiquettesAction.join('\n')).slice(0, 600)
          })
        }
      }
      usagePersistenceReady = true
      broadcast({ type: 'refresh', scope: 'workflows' })
      return {
        ok: true,
        cancelled: false,
        turnId,
        text:
          completedText ||
          streamedSpoken.trim() ||
          spoken.join('\n').trim() ||
          etiquettesAction.join('\n').trim(),
        verification,
        ...(turnResolvedModel ? { resolvedModel: turnResolvedModel } : {}),
        ...taskUsageMetricsFromExecution(supervisedUsage)
      }
    } catch (e) {
      /**
       * ETAT TERMINAL, journal COMPRIS. Ce catch n'ecrivait que dans le store : le journal FICHIER
       * du tour ne recevait ni `done` ni `failed`, donc le tour restait « inacheve » pour toujours
       * et la reprise automatique le rejouait a chaque demarrage — un tour ZOMBIE.
       *
       * Constate en reel le 2026-07-29 : une erreur d'API repetee (filtre de contenu) fait jeter le
       * pilote apres 2 tentatives ; le journal du tour s'arretait sur ['delta','stream-reset',
       * 'delta'] sans aucun evenement terminal. Un tour qui echoue doit se CONCLURE, pas disparaitre.
       */
      // Un abort BUDGET n'est pas un stop volontaire : le classer `cancelled` l'excluait de la
      // relance automatique et faisait porter le renoncement à l'utilisateur (conv-1149, 13/08).
      const coupureBudget = controller.signal.aborted && estCoupureBudget(controller.signal.reason)
      /*
       * TOUT ARRET QUI PORTE UNE CAUSE MACHINE EST UN ECHEC, pas une annulation.
       *
       * Seul le budget etait requalifie ; la coupure du VEILLEUR d'inactivite tombait donc dans
       * `cancelled`, et son motif — pourtant redige — etait jete. Mesure conv-136 (2026-09-02) : un
       * run de 25 min, tour coupe a 20, fil reduit a « [a execute orchestrate] », ni reponse ni
       * erreur. La decision vit maintenant dans `terminalDuTour`, pure et testee.
       */
      const terminal = terminalDuTour({
        aborted: controller.signal.aborted,
        reason: controller.signal.reason,
        erreur: e,
        motivee: coupureBudget
      })
      const coupureMotivee = terminal.kind === 'failed' && controller.signal.aborted
      if (conversationId && os.conversations.get(conversationId)) {
        os.conversations.applyTurnEvent(conversationId, turnId, terminal)
      }
      if (conversationId) {
        try {
          appendTurnEvent(turnJournalRoot, conversationId, turnId, {
            ...terminal,
            at: Date.now()
          })
        } catch {
          /* journal best-effort : ne jamais masquer l'erreur d'origine pour une ecriture de trace */
        }
      }
      if (supervisedUsage) persistSupervisedChatUsage(supervisedUsage)
      usagePersistenceReady = true
      broadcast({ type: 'refresh', scope: 'workflows' })
      // `coupureMotivee` couvre le budget ET le veilleur : le motif remonte a l'appelant, qui
      // l'affiche, au lieu de repartir en « annule » avec pour seul texte les etiquettes d'action.
      if (coupureMotivee)
        return {
          ok: false,
          cancelled: false,
          turnId,
          error: String(controller.signal.reason),
          ...(turnResolvedModel ? { resolvedModel: turnResolvedModel } : {}),
          ...taskUsageMetricsFromExecution(supervisedUsage)
        }
      if (controller.signal.aborted)
        return {
          ok: true,
          cancelled: true,
          turnId,
          text:
            completedText ||
            streamedSpoken.trim() ||
            spoken.join('\n').trim() ||
            etiquettesAction.join('\n').trim(),
          ...(turnResolvedModel ? { resolvedModel: turnResolvedModel } : {}),
          ...taskUsageMetricsFromExecution(supervisedUsage)
        }
      return {
        ok: false,
        cancelled: false,
        turnId,
        error: e instanceof Error ? e.message : String(e),
        ...(turnResolvedModel ? { resolvedModel: turnResolvedModel } : {}),
        ...taskUsageMetricsFromExecution(supervisedUsage)
      }
    } finally {
      // Le veilleur ne survit JAMAIS a son tour : un minuteur orphelin couperait un tour suivant.
      if (veilleur) clearInterval(veilleur)
      fermerTourPourGels()
      usagePersistenceReady = true
      if (supervisedUsage) persistSupervisedChatUsage(supervisedUsage)
      if (conversationId) {
        activeChatTurns.delete(conversationId, controller)
        broadcast({ type: 'refresh', scope: 'conversations' })
        if (pendingDirectives.delete(conversationId)) {
          // directives non consommées = obsolètes
          broadcast({ type: 'refresh', scope: 'directives' })
        }
      }
      resolveCompletion()
    }
  }

  return runPilotChat
}
