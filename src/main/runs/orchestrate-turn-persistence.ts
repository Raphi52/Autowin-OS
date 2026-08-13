import type { ChatTurnEvent, ChatTurnRuntime } from '../../shared/chat-turn'
import type { Conversation } from '../store/conversations'
import type { OrchestrationStep } from '../orchestrator'
import type { ChatArtifact } from '../../shared/artifacts'

/**
 * PERSISTANCE DU TOUR pour le chemin DIRECT `os:orchestrate` (bouton « Reprendre », pilotage
 * programmatique).
 *
 * Le handler `os:orchestrate` lançait la pipeline mais n'écrivait RIEN dans la conversation : il
 * n'émettait que le ledger et `orchestrate:step` sur `emitToLiveWindows` — un canal qu'AUCUN
 * composant du renderer n'écoute. Conséquence mesurée : clic sur « Reprendre » → les providers
 * spawnent, mais zéro message, zéro carte d'activité, zéro erreur dans le fil, et rien ne survit à
 * un rechargement. Même patron que le coût jeté : produire l'information puis la PERDRE à la
 * frontière de persistance (cf. le commentaire du `done` dans `os:pilotChat`).
 *
 * On réplique donc ici le patron durable de `os:pilotChat` : `beginTurn` d'abord (obligatoire —
 * `applyTurnEvent` jette sans message assistant portant ce `turnId`), puis un couple
 * `command`/`result` par étape, puis un état TERMINAL systématique (`done` | `failed` |
 * `cancelled`), journal fichier best-effort compris.
 */
export interface OrchestrateTurnStore {
  get(id: string): Conversation | undefined
  beginTurn(
    id: string,
    user: { content: string },
    assistant: { turnId: string; runtime?: ChatTurnRuntime }
  ): unknown
  applyTurnEvent(id: string, turnId: string, event: ChatTurnEvent): unknown
}

export interface OrchestrateTurnPersistenceOptions {
  conversations: OrchestrateTurnStore
  /** `'__autonomous__'` = run sans conversation → toute la persistance est désarmée. */
  conversationId: string
  turnId: string
  runtime?: ChatTurnRuntime
  /** Réutilise le tour interrompu portant déjà `turnId`, sans ajouter une seconde paire de messages. */
  resumeExisting?: boolean
  /** Survie niveau 2 (journal fichier du tour) — best-effort, ne casse jamais le run. */
  journal?: (event: ChatTurnEvent) => void
}

export interface OrchestrateTurnPersistence {
  readonly enabled: boolean
  /** Ouvre le tour (message utilisateur = la tâche relancée + brouillon assistant). */
  begin(task: string): void
  /** Une étape de pipeline (exec/judge/gate) → carte d'action visible dans le fil. */
  step(step: OrchestrationStep): void
  /** Résultat de fichier produit pendant l’étape, affiché comme tel dans le même tour. */
  artifact(artifact: ChatArtifact): void
  /** Clôture NOMINALE : texte de livraison (si rien n'a été streamé) puis `done`. */
  succeed(result?: {
    result?: string
    valid?: boolean
    gateBlocked?: boolean
    gateReasons?: unknown
  }): void
  /** Clôture d'ÉCHEC/ANNULATION : une erreur devient VISIBLE au lieu d'être jetée par le `void`. */
  fail(error: string, aborted: boolean): void
}

const AUTONOMOUS = '__autonomous__'

export function createOrchestrateTurnPersistence(
  options: OrchestrateTurnPersistenceOptions
): OrchestrateTurnPersistence {
  const {
    conversations,
    conversationId,
    turnId,
    runtime,
    resumeExisting = false,
    journal
  } = options
  const targeted = conversationId !== AUTONOMOUS
  let opened = false
  let closed = false
  let streamedText = ''
  /**
   * Tache du tour, retenue pour etre RECOPIEE sur chaque carte d'etape. Sans elle, le bouton
   * « Reprendre » du fil ne s'affichait jamais : il lit la tache dans `args.task` de l'action
   * interrompue, et la tache n'existait que dans le message utilisateur — auquel le composant n'a pas
   * acces. Cette chaine est la CLE de reprise (`resumableOrchestrationForTask`), donc elle voyage
   * telle quelle, sans troncature.
   */
  let openedTask = ''
  let actionIndex = 0
  let resumedActionIds: string[] = []

  const live = (): boolean => targeted && Boolean(conversations.get(conversationId))

  const emit = (event: ChatTurnEvent): void => {
    if (!opened || !live()) return
    conversations.applyTurnEvent(conversationId, turnId, event)
    try {
      journal?.(event)
    } catch {
      /* journal best-effort : ne jamais casser un tour pour une écriture de trace */
    }
  }

  return {
    get enabled() {
      return targeted
    },
    begin(task) {
      if (opened || !live()) return
      openedTask = task
      if (resumeExisting) {
        const message = conversations
          .get(conversationId)
          ?.messages.find(
            (candidate) => candidate.role === 'assistant' && candidate.turnId === turnId
          )
        if (!message) return
        resumedActionIds = (message.parts ?? [])
          .filter(
            (part) =>
              part.kind === 'action' && part.ok === undefined && typeof part.actionId === 'string'
          )
          .map((part) => (part.kind === 'action' ? part.actionId! : ''))
        opened = true
        emit({ kind: 'resumed' })
        return
      }
      conversations.beginTurn(
        conversationId,
        { content: task },
        { turnId, ...(runtime && { runtime }) }
      )
      opened = true
    },
    step(step) {
      if (!opened) return
      const actionId = `${actionIndex++}:${step.step}`
      const label = [step.role, step.provider, step.model].filter(Boolean).join(' · ')
      emit({
        kind: 'command',
        actionId,
        name: step.step,
        // `task` d'abord : c'est ce que le bouton « Reprendre » cherche pour relancer sans retaper.
        args: {
          ...(openedTask && { task: openedTask }),
          ...(label && { agent: label }),
          ...(step.detail && { detail: step.detail })
        }
      })
      emit({
        kind: 'result',
        actionId,
        name: step.step,
        ok: step.status !== 'failed' && !step.error,
        data: {
          ...(step.detail && { detail: step.detail }),
          ...(step.error && { error: step.error }),
          ...(typeof step.costUsd === 'number' && { costUsd: step.costUsd }),
          ...(typeof step.durationMs === 'number' && { durationMs: step.durationMs })
        }
      })
      // Le texte d'une phase est du contenu déjà porté par la carte `result` : on le compte comme
      // « déjà dit » pour ne JAMAIS le dupliquer dans le texte de clôture (condition stricte du
      // patron pilotChat).
      if (step.text) streamedText += step.text
    },
    artifact(artifact) {
      if (!opened || closed) return
      emit({ kind: 'artifact', artifact })
    },
    succeed(result) {
      if (!opened || closed) return
      closed = true
      const deliveryFailed = result?.gateBlocked === true || result?.valid === false
      for (const actionId of resumedActionIds)
        emit({
          kind: 'result',
          actionId,
          name: 'orchestrate',
          ok: !deliveryFailed,
          data: { resumed: true, ...(deliveryFailed && { gateBlocked: true }) }
        })
      const closing = result?.result?.trim()
      if (closing && !streamedText.trim())
        emit({ kind: 'delta', streamId: `${turnId}:closing`, text: closing })
      if (deliveryFailed) {
        const reasons = Array.isArray(result?.gateReasons)
          ? result.gateReasons.filter((reason): reason is string => typeof reason === 'string')
          : []
        emit({
          kind: 'failed',
          error: reasons.join(' ; ') || closing || 'Livraison refusée par le gate Autowin.'
        })
      } else {
        emit({ kind: 'done' })
      }
    },
    fail(error, aborted) {
      if (!opened || closed) return
      closed = true
      emit(aborted ? { kind: 'cancelled' } : { kind: 'failed', error })
    }
  }
}
