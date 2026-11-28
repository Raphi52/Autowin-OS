import { emitToLiveWindows } from '../app/renderer-emit'
import { BrowserWindow } from 'electron'
import {
  issueDeCloture,
  issueDuResultat,
  annoncerLaFinDuTour,
  type RunPilotChat,
  type ObservateurFinDeTour
} from '../chat/run-pilot-chat'
import type { IssueDuTour } from '../../shared/plan-de-lots'
import type { ChatTurnEvent } from '../../shared/chat-turn'
import { appendTurnEvent, readTurnJournal, isTurnFinished } from '../runs/turn-journal'
import {
  type RecoverableChatProviderCall,
  waitForRecoverableChatProviderExit,
  recoverCompletedChatProviderCall,
  reglagesDeReprise,
  streamedPrefixForProviderCall,
  listRecoverableChatProviderCallsAsync
} from '../runs/chat-provider-recovery'
import { relayerAppelChatRepris } from '../runs/relais-appel-repris'
import { rendreUltrathinkTape } from '../chat/ultrathink-du-tour'
import type { SuiviDesPlans } from './chat-boites'
import type { ContexteIpcChat } from '../index'

/**
 * LES APPELS DE CHAT QUI ONT SURVÉCU AU PROCESSUS PRINCIPAL : réservés, attendus jusqu’à leur
 * preuve de sortie, puis repris dans leur fil.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `reprendreLesAppelsDuChat` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesRepriseDesAppels {
  suiviDesPlans: SuiviDesPlans
  tourCompteDesReception: RunPilotChat
  observateurDesPlans: ObservateurFinDeTour
}

/** La reprise des appels de chat au démarrage. */
export function reprendreLesAppelsDuChat(
  ctx: ContexteIpcChat,
  deps: DependancesRepriseDesAppels
): void {
  const {
    activeChatTurns,
    appelsChatReconnusAuChargement,
    broadcast,
    debutInventaireAppelsChat,
    drainPendingDirectives,
    os,
    turnJournalRoot
  } = ctx
  const { suiviDesPlans, tourCompteDesReception, observateurDesPlans } = deps
  /**
   * Reprend les appels de chat dont le CLI a survécu au main. La réservation (`setRecovered`) fait
   * refuser un nouveau message par `os:pilotChat` et répondre « actif » à la sonde de l'écran,
   * qui adopte alors le tour (`reconcilierTourNonClos`) pendant qu'on attend la preuve `.exit.json`.
   * Aucun timeout ne transforme une ignorance en relance : seule une sortie certifiée est traitée.
   */
  const reprendreAppelChat = (call: RecoverableChatProviderCall): void => {
    const recoveryController = new AbortController()
    let resolveRecovery!: () => void
    const recoveryCompletion = new Promise<void>((resolve) => {
      resolveRecovery = resolve
    })
    activeChatTurns.setRecovered(call.conversationId, recoveryController, recoveryCompletion)
    // Le plan de lots suit cet agent. Les appels reconnus au chargement passent ici avant
    // que le coordinateur existe : il lira alors cette réservation lui-même (`tourActif`).
    suiviDesPlans.coordinateur?.agentRepris(call.conversationId, call.turnId)
    setImmediate(() => {
      void (async () => {
        // L'issue, annoncée aux plans de lots APRÈS le relâchement de la réservation.
        let issueDeReprise: IssueDuTour | undefined
        try {
          // Pendant l'attente, le fil voit ce que fait le CLI : actions et étapes (
          // est resté 20 min sans une ligne après le redémarrage de 20:01). Arrêté avant la suite.
          const relais = relayerAppelChatRepris(call, {
            racineJournaux: turnJournalRoot,
            actionsEnregistrees: () =>
              [...(os.conversations.get(call.conversationId)?.messages ?? [])]
                .reverse()
                .find((message) => message.role === 'assistant' && message.turnId === call.turnId)
                ?.actionsLog,
            enregistrer: (lines) => {
              if (os.conversations.get(call.conversationId))
                os.conversations.applyTurnEvent(call.conversationId, call.turnId, {
                  kind: 'actions-log',
                  lines
                })
            },
            versLeFil: (event) =>
              emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event', {
                ...event,
                conversationId: call.conversationId,
                turnId: call.turnId
              })
          })
          const terminal = await waitForRecoverableChatProviderExit(call.journalPath, {
            signal: recoveryController.signal,
            fallbackActivityAt: call.updatedAt
          }).finally(() => relais.arreter())

          const closeWithoutRecovery = (event: ChatTurnEvent): void => {
            issueDeReprise = issueDeCloture(event)
            if (os.conversations.get(call.conversationId)) {
              os.conversations.applyTurnEvent(call.conversationId, call.turnId, event)
            }
            appendTurnEvent(turnJournalRoot, call.conversationId, call.turnId, {
              ...event,
              at: Date.now()
            })
            broadcast({ type: 'refresh', scope: 'conversations' })
          }
          if (terminal.kind === 'aborted') {
            closeWithoutRecovery({ kind: 'cancelled' })
            return
          }
          if (terminal.kind === 'stale') {
            closeWithoutRecovery({ kind: 'interrupted' })
            return
          }
          const { exitCode } = terminal
          if (exitCode !== 0) {
            closeWithoutRecovery({
              kind: 'failed',
              error: `Appel provider détaché terminé avec le code ${exitCode ?? 'inconnu'}`
            })
            return
          }

          const events = readTurnJournal(turnJournalRoot, call.conversationId, call.turnId)
          if (isTurnFinished(events)) {
            const clos = [...events].reverse().find((e) => isTurnFinished([e]))
            issueDeReprise = issueDeCloture(clos ?? { kind: 'done' })
            return
          }
          const result = recoverCompletedChatProviderCall(call.provider, call.journalPath)
          if (!result) {
            closeWithoutRecovery({
              kind: 'failed',
              error: 'Sortie provider certifiée mais résultat terminal illisible ou incomplet'
            })
            return
          }

          const conversation = os.conversations.get(call.conversationId)
          const assistantIndex = conversation?.messages.findIndex(
            (message) => message.role === 'assistant' && message.turnId === call.turnId
          )
          if (!conversation || assistantIndex === undefined || assistantIndex < 1) {
            issueDeReprise = { ok: false, erreur: 'conversation ou tour d’origine introuvable' }
            appendTurnEvent(turnJournalRoot, call.conversationId, call.turnId, {
              kind: 'failed',
              error: 'Conversation ou tour d’origine introuvable pour la reprise',
              at: Date.now()
            })
            return
          }
          const assistant = conversation.messages[assistantIndex]
          const messages = conversation.messages
            .slice(0, assistantIndex)
            .filter(
              (message): message is typeof message & { role: 'user' | 'assistant' } =>
                message.role === 'user' || message.role === 'assistant'
            )
            .map((message) => ({ role: message.role, content: message.content }))
          // Le modèle du chat repart avec le chat ; seul un réglage réellement imposé au tour
          // d'origine est rejoué sur ses commandes. L'imposer à tort figeait l'effort des runs
          // lancés par ce tour (`reglagesDeReprise`).
          const reglages = reglagesDeReprise(call, assistant.runtime)
          // Rejoué SANS l'annonce de `runPilotChat` : elle partirait réservation encore tenue.
          const rejoue = await tourCompteDesReception(
            undefined,
            messages,
            call.conversationId,
            reglages.bindingOverride,
            {
              turnId: call.turnId,
              call,
              runtimeBinding: reglages.runtimeBinding,
              providerCall: {
                iteration: call.iteration,
                attempt: call.attempt,
                streamId: call.streamId,
                streamedPrefix: streamedPrefixForProviderCall(events, call.streamId),
                ...(call.settledActions?.length ? { settledActions: call.settledActions } : {}),
                result
              }
            },
            call.policy
          )
          issueDeReprise = issueDuResultat(rejoue)
        } catch (error) {
          issueDeReprise = {
            ok: false,
            erreur: error instanceof Error ? error.message : String(error)
          }
          console.warn('[resume-chat-provider] reprise impossible :', call.turnId, error)
        } finally {
          activeChatTurns.delete(call.conversationId, recoveryController)
          /*
           * ORIENTATIONS TAPÉES PENDANT LA REPRISE : rendues à l'écran, jamais perdues.
           * L'écran voit désormais un tour repris comme occupé, donc ce qu'on tape part en
           * orientation (`os:pilotChat:inject`). Quand la reprise se termine SANS rejouer de tour
           * (arrêt, CLI en échec, journal muet), aucun `finally` de `runPilotChat` ne les rend :
           * on le fait ici, avec le même signal. Après un rejeu, la file est déjà vide.
           */
          const orphelines = drainPendingDirectives(call.conversationId)
          rendreUltrathinkTape(call.conversationId, orphelines)
          if (orphelines.length) {
            broadcast({
              type: 'directives-orphelines',
              convId: call.conversationId,
              textes: orphelines
            })
          }
          resolveRecovery()
          // Après `delete` : le fil ne compte plus « occupé », un chef repris peut être réveillé.
          if (issueDeReprise)
            annoncerLaFinDuTour(observateurDesPlans, call.conversationId, {
              ...issueDeReprise,
              repris: true
            })
        }
      })()
    })
  }
  // Les appels reconnus au chargement (message resté « en cours ») réservent leur conversation
  // TOUT DE SUITE, avant la fenêtre : c'est eux que l'utilisateur voit tourner.
  for (const call of appelsChatReconnusAuChargement.values()) reprendreAppelChat(call)
  // Le reste — tour inachevé dont le message n'était pas « en cours » sur disque — vient de
  // l'inventaire NON bloquant. La fenêtre est ouverte entre-temps : un tour lancé depuis doit
  // garder la main, et son propre journal (touché après le chargement) n'est pas un survivant.
  void listRecoverableChatProviderCallsAsync(turnJournalRoot).then(
    (calls) => {
      for (const call of calls) {
        if (appelsChatReconnusAuChargement.has(call.turnId)) continue
        if (call.updatedAt >= debutInventaireAppelsChat) continue
        if (activeChatTurns.get(call.conversationId)) continue
        reprendreAppelChat(call)
      }
    },
    (erreur) => console.warn('[resume-chat-provider] inventaire impossible :', erreur)
  )
}
