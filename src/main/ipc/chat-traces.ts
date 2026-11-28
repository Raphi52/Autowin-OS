import { ipcMain } from 'electron'
import { listConvRuns, deleteConvRun, loadConvRunTrace } from '../runs/conv-runs'
import { loadConvActivity } from '../activity/conv-activity'
import {
  loadPromptCalls,
  loadAllPromptCalls,
  summarizeCostSamples,
  applyRecoveredUsage,
  costSamplesFrom
} from '../activity/prompt-observability'
import { recoverUnpricedCallsUsage } from '../activity/cli-usage-recovery'
import { allegerTracePourGraphe, chargesDesEvenements } from '../activity/trace-allegee'
import { assertTrustedRendererSender } from './ipc-senders'
import { guardString, guardStringOrNull } from './ipc-guards'
import { readNativePreflight, filterNativePreflight } from '../activity/native-preflight'
import { nativeSpoolRoot } from '../activity/native-trace-spool'
import type { ContexteIpcChat } from '../index'

/**
 * CE QU’UN FIL A FAIT, RELU : runs du fil, fiches de demande, activité, appels de prompt, traces
 * natives et trace causale.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** IPC : runs, fiches, activité et traces d’un fil. */
export function registerTracesIpc(ctx: ContexteIpcChat): void {
  const { bus, causalTrace, diagnosticCapabilities, fichesDeDemande, headlessTestInstance, os } =
    ctx
  // --- Workflows PAR CONVERSATION : créés par ses orchestrations + RUN.md attachés ---
  ipcMain.handle('os:conversationRuns', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Conversation runs')
    const c = os.conversations.get(guardString(convId, 'convId'))
    return listConvRuns(convId, c?.runPaths ?? [])
  })
  // Les RUN.md LÉGERS (une fiche par demande) : le panneau RUN.md du fil et les post-it du Board les
  // montrent. Ils s'écrivaient sans qu'aucun écran les lise.
  ipcMain.handle('os:fichesDuFil', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Fiches du fil')
    return fichesDeDemande.fichesDuFil(guardString(convId, 'convId'))
  })
  ipcMain.handle('os:fichesDesDemandes', (event) => {
    assertTrustedRendererSender(event, 'Fiches des demandes')
    return fichesDeDemande.fichesDesDemandes()
  })
  ipcMain.handle(
    'os:conversationRuns:delete',
    async (event, rawConvId: string, rawPath: string) => {
      assertTrustedRendererSender(event, 'DeleteConversationRun')
      const convId = guardString(rawConvId, 'convId')
      const path = guardString(rawPath, 'path')
      const conversation = os.conversations.get(convId)
      if (!conversation) throw new Error(`Conversation inconnue: ${convId}`)
      const result = await deleteConvRun(convId, path, conversation.runPaths ?? [])
      if (result.kind === 'detached') os.conversations.detachRun(convId, result.attachedPath)
      return { ok: true, kind: result.kind }
    }
  )
  // Fil des sous-agents d'un run (exec/juge/gate avec contenu), pour l'affichage détaillé.
  ipcMain.handle('os:runTrace', (event, path: string) => {
    assertTrustedRendererSender(event, 'RunTrace')
    return loadConvRunTrace(guardString(path, 'path'))
  })
  // L'UI signale la conversation active → les orchestrations lancées s'y rattachent.
  ipcMain.handle('os:setActiveConversation', (event, convId: unknown) => {
    assertTrustedRendererSender(event, 'Active conversation')
    // Etat en memoire seulement, donc pas de donnee pourrie persistee -- mais une garde d'une ligne
    // vaut mieux qu'un `activeConversationId` portant un objet ou un nombre.
    bus.activeConversationId = guardStringOrNull(convId, 'convId') ?? undefined
    return { ok: true }
  })
  // Activité (scopée conversation) : timeline des étapes facturées + coût tokens.
  ipcMain.handle('os:conversationActivity', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Conversation activity')
    return loadConvActivity(guardString(convId, 'convId'))
  })
  ipcMain.handle('os:promptCalls', (event, convId: unknown) => {
    assertTrustedRendererSender(event, 'Prompt calls')
    return loadPromptCalls(guardString(convId, 'convId'))
  })
  /**
   * « Ou est passe l'argent ? » sans ecrire de script. Repartition du cout par role, modele ou
   * provider, triee par cout decroissant, avec le cacheHitRatio (un ratio proche de 0 signale un
   * contexte REECRIT au lieu d'etre relu — c'est ce symptome qui a mene a la cause racine du
   * 2026-07-28, ou 114 fichiers .jsonl avaient du etre parses a la main).
   */
  ipcMain.handle(
    'os:costBreakdown',
    (event, dimension?: 'actor' | 'model' | 'provider', convId?: string) => {
      assertTrustedRendererSender(event, 'Cost breakdown')
      const allowed = ['actor', 'model', 'provider'] as const
      const dim = allowed.includes(dimension as (typeof allowed)[number]) ? dimension : 'actor'
      const id = convId ? guardString(convId, 'convId') : undefined
      // Le cout n'a pas besoin du prompt systeme : ne pas le relire (gel mesure, voir loadPromptCalls).
      const calls = id
        ? loadPromptCalls(id, undefined, { systeme: false })
        : loadAllPromptCalls(undefined, { systeme: false })
      // LES DEUX journaux : les sous-agents les plus couteux n'existent que dans l'activite
      // (mesure : 2,83 $ vus contre ~20,70 $ reels). costSamplesFrom deduplique.
      const activity = id ? loadConvActivity(id) : []
      // Un appel tue par le watchdog meurt avant l'event `result` : le journal n'a ni tokens ni
      // prix, et l'indicateur affichait « 4,20 $ + non expose ». Ces chiffres existent dans le
      // transcript du CLI — on va les y relire avant de resumer, plutot que d'avouer une absence.
      const recovered = recoverUnpricedCallsUsage(calls)
      return summarizeCostSamples(
        applyRecoveredUsage(costSamplesFrom(calls, activity), recovered),
        dim as (typeof allowed)[number]
      )
    }
  )
  const loadNativeTraces = (): ReturnType<typeof readNativePreflight> => {
    // Spool NATIF Autowin : les traces sont écrites par Autowin lui-même (native-trace-spool) →
    // l'Observatory (RAG/injection) se peuple sur les vraies requêtes de l'app. Plus aucun fallback
    // externe (spool externe retiré).
    return readNativePreflight(nativeSpoolRoot(), 100)
  }
  ipcMain.handle('os:promptTraceSummary', (event) => {
    assertTrustedRendererSender(event, 'Native trace summary')
    // La requête brute est volontairement exclue de ce résumé IPC.

    return loadNativeTraces().map(({ request: _request, ...metadata }) => metadata)
  })
  ipcMain.handle('os:authorizeDiagnostics', (event) => {
    assertTrustedRendererSender(event, 'Diagnostics authorization')
    if (headlessTestInstance) return null
    return diagnosticCapabilities.issue(event.sender.id)
  })
  ipcMain.handle('os:promptTracesGlobal', (event, token: unknown) => {
    assertTrustedRendererSender(event, 'Native global diagnostics')
    const safeToken = guardString(token, 'capability')
    if (!diagnosticCapabilities.consume(safeToken, event.sender.id)) {
      throw new Error('Diagnostics capability denied')
    }
    return filterNativePreflight(loadNativeTraces())
  })
  ipcMain.handle('os:causalTrace', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Causal trace')
    const conversationId = guardString(convId, 'convId')
    return causalTrace.readConversation(conversationId)
  })
  // Le graphe du chat : la structure sans les contenus (relue chaque seconde en direct), puis les
  // charges de la seule étape ouverte. Voir `activity/trace-allegee.ts` pour la mesure.
  ipcMain.handle('os:causalTrace:graphe', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Causal trace graph')
    const conversationId = guardString(convId, 'convId')
    return allegerTracePourGraphe(causalTrace.readConversation(conversationId))
  })
  ipcMain.handle(
    'os:causalTrace:charges',
    (event, convId: string, eventIds: unknown, kinds: unknown) => {
      assertTrustedRendererSender(event, 'Causal trace payloads')
      const conversationId = guardString(convId, 'convId')
      return chargesDesEvenements(causalTrace.readConversation(conversationId), eventIds, kinds)
    }
  )
}
