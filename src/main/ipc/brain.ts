/**
 * LES CANAUX DU BRAIN, sortis de `src/main/index.ts`.
 *
 * Quinze canaux, trois usages :
 *  - le GRAPHE 3D et sa navigation (lister les brains, apercu, themes, voisinage, lire un noeud) ;
 *  - la RECHERCHE, qui rend une enveloppe complete — statut, navigation, budget d'injection — et
 *    non un tableau nu, et qui ECRIT sa trace meme lancee a la main depuis la vue Knowledge ;
 *  - la BOITE DE RECEPTION du savoir : `brain-remember` depose en `inbox/`, la promotion reste a
 *    l'humain. Ces canaux sont cette main humaine.
 *
 * Deplacement MECANIQUE depuis `index.ts` : corps identiques, memes gardes d'expediteur, memes
 * plafonds. Trois protections que le demenagement n'avait pas le droit d'alleger :
 *  - toute ecriture est bornee a la racine Brain autorisee par `assertBrainVaultRoot` ;
 *  - retirer ou remplacer un savoir passe par une TRANSACTION avec compensation, jamais par une
 *    suppression seche ;
 *  - promotion, rejet, retrait et remplacement REINDEXENT ensuite, sinon le graphe montrerait
 *    encore l'ancien noeud.
 *
 * Les deux delais de frontiere (recherche 2,5 s, boite de reception 5 s) suivent leurs canaux : ils
 * n'etaient utilises que par eux.
 *
 * Ce qui RESTE dans `index.ts` : `os:outcomeLearning:*`, qui regle le MOTEUR d'apprentissage et non
 * le Brain, et `os:brainTraces`, qui lit les traces d'une conversation avec ses voisines.
 */
import { ipcMain } from 'electron'
import { brainScopeForWorkspace } from '../brain-corpus-scope'
import { AMITEL_BRAIN_ROOT } from '../viz/fs-brains'
import { buildBrainSearchEnvelope } from '../brain-search-envelope'
import {
  assertBrainVaultRoot,
  promoteInboxCandidate,
  rejectInboxCandidate,
  restoreTrashedKnowledge,
  retractKnowledgeCandidate,
  supersedeKnowledgeCandidate
} from '../brain-inbox'
import { amitelWorkspaces } from '../amitel-paths'
import { executeCurationTransaction } from '../outcome-learning-curation-transaction'
import { appendBrainTrace } from '../activity/brain-trace-spool'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import type { AutowinOS } from '../os'
import type { AppCommandBus } from '../commands'
import type { BrainWorkerClient } from '../viz/brain-worker-client'
import type { BrainSearchCoordinator } from '../viz/brain-search-coordinator'
import type { OutcomeLearningSupervisor } from '../outcome-learning-supervisor'

/** Frontiere de la RECHERCHE : au-dela, on rend la main plutot que de geler la vue. */
const BRAIN_SEARCH_BOUNDARY_TIMEOUT_MS = 2_500
/** Frontiere de la BOITE DE RECEPTION : plus permissive, elle lit des fichiers. */
const BRAIN_INBOX_BOUNDARY_TIMEOUT_MS = 5_000

/** Ce que les canaux du Brain prenaient dans `index.ts` — desormais passe explicitement. */
export type BrainIpcDeps = {
  os: AutowinOS
  bus: AppCommandBus
  brainWorker: BrainWorkerClient
  brainSearchWorker: BrainWorkerClient
  brainInboxWorker: BrainWorkerClient
  brainSearchCoordinator: BrainSearchCoordinator
  outcomeLearning: OutcomeLearningSupervisor
  /** La reprise des curations interrompues : attendue AVANT toute nouvelle mutation. */
  curationRecoveryReady: Promise<unknown>
  /** Reindexe le Brain apres une mutation, sinon le graphe montre encore l'ancien noeud. */
  invalidateBrainRuntime: () => Promise<void>
}

export function registerBrainIpc({
  os,
  bus,
  brainWorker,
  brainSearchWorker,
  brainInboxWorker,
  brainSearchCoordinator,
  outcomeLearning,
  curationRecoveryReady,
  invalidateBrainRuntime
}: BrainIpcDeps): void {
  // --- Graphe brain 3D (données réelles disque) + workflow ---
  ipcMain.handle('os:listBrains', (event) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainWorker.request('listBrains')
  })
  ipcMain.handle('os:loadBrainGraphPreview', (event, path: string, lod?: number) => {
    assertTrustedRendererSender(event, 'Brain')
    const corpus = brainScopeForWorkspace(os.executionWorkspace).corpus
    return brainWorker.request('loadPreview', guardString(path, 'path'), lod, corpus)
  })
  ipcMain.handle('os:loadBrainThemes', (event, path: string) => {
    assertTrustedRendererSender(event, 'Brain')
    const corpus = brainScopeForWorkspace(os.executionWorkspace).corpus
    return brainWorker.request('loadThemes', guardString(path, 'path'), corpus)
  })
  ipcMain.handle('os:loadBrainThemeNodes', (event, path: string, rawThemeIds: unknown) => {
    assertTrustedRendererSender(event, 'Brain')
    if (!Array.isArray(rawThemeIds) || rawThemeIds.length > 100)
      throw new Error('IPC themeIds: tableau borné attendu')
    const themeIds = rawThemeIds.map((themeId, index) => guardString(themeId, `themeIds[${index}]`))
    const corpus = brainScopeForWorkspace(os.executionWorkspace).corpus
    return brainWorker.request('loadThemeNodes', guardString(path, 'path'), themeIds, corpus)
  })
  ipcMain.handle('os:loadBrainGraph', (event, path: string, lod?: number, community?: number) => {
    assertTrustedRendererSender(event, 'Brain')
    const corpus = brainScopeForWorkspace(os.executionWorkspace).corpus
    return brainWorker.request('loadGraph', guardString(path, 'path'), lod, community, corpus)
  })
  ipcMain.handle('os:loadBrainNeighborhood', (event, path: string, nodeId: string) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainWorker.request(
      'loadNeighborhood',
      guardString(path, 'path'),
      guardString(nodeId, 'nodeId'),
      brainScopeForWorkspace(os.executionWorkspace).corpus
    )
  })
  ipcMain.handle('os:readNodeFile', (event, path: string, vaultRoot?: string) => {
    assertTrustedRendererSender(event, 'Brain')
    const guardedVaultRoot =
      vaultRoot === undefined ? undefined : guardString(vaultRoot, 'vaultRoot')
    const corpus = brainScopeForWorkspace(os.executionWorkspace).corpus
    return brainWorker.request('readNodeFile', guardString(path, 'path'), guardedVaultRoot, corpus)
  })
  ipcMain.handle('os:searchBrain', async (event, path: string, query: string) => {
    assertTrustedRendererSender(event, 'BrainSearch')
    const selectedPath = guardString(path, 'path')
    const boundedQuery = guardString(query, 'query')
    const brainScope = brainScopeForWorkspace(os.executionWorkspace)
    const resolution = await brainSearchCoordinator.searchDetailed(selectedPath, boundedQuery, {
      authorize: (root) =>
        brainSearchWorker.requestWithTimeout(
          BRAIN_SEARCH_BOUNDARY_TIMEOUT_MS,
          'authorizeVault',
          root
        ),
      searchLocal: async (root, searchQuery) =>
        brainScope.localResults(
          await brainSearchWorker.requestWithTimeout(
            BRAIN_SEARCH_BOUNDARY_TIMEOUT_MS,
            'searchBrain',
            root,
            searchQuery,
            brainScope.corpus
          )
        ),
      retrieve: (searchQuery) => brainScope.retrieve(searchQuery),
      fuse: (local, navigation, root) =>
        brainSearchWorker.requestWithTimeout(
          BRAIN_SEARCH_BOUNDARY_TIMEOUT_MS,
          'fuseRetrieval',
          local,
          navigation,
          root
        )
    })
    // On ne rend plus un tableau nu : le STATUT (found/empty/invalid/unavailable), la NAVIGATION et le
    // BUDGET d'injection étaient calculés puis jetés ici. Le renderer ne pouvait donc pas distinguer
    // une panne d'un « rien trouvé », ni montrer ce que les plafonds avaient coupé.
    const envelope = buildBrainSearchEnvelope({
      rawQuery: boundedQuery,
      results: resolution.results,
      retrieval: resolution.retrieval
    })
    /**
     * CETTE RECHERCHE INTERROGE LE BRAIN, et n'écrivait aucune trace (constaté le 2026-08-31).
     *
     * Le spool ne voyait que les appels partis d'un run ou d'une commande du modèle. Une recherche
     * lancée par l'HUMAIN depuis la vue Knowledge passe pourtant par le même `retrieveBrainContext`,
     * le même service et les mêmes plafonds d'injection — elle était simplement absente de la liste
     * qu'Observatory présente comme « ce que le Brain a fait ».
     *
     * ATTACHE : la conversation ACTIVE du bus, comme le fait déjà l'activité de configuration. C'est
     * un point d'accrochage, pas une prétention d'origine — d'où le `kind: 'recherche'`, qui la
     * distingue d'un appel émis PAR le run. Sans conversation active la trace est tout de même
     * écrite (`conversationId` vide) : le spool est global, mieux vaut un appel non rattaché qu'un
     * appel perdu.
     */
    appendBrainTrace({
      timestamp: new Date().toISOString(),
      conversationId: bus.activeConversationId ?? '',
      kind: 'recherche',
      query: resolution.retrieval?.navigation?.query || boundedQuery,
      found: (resolution.retrieval?.status ?? 'unavailable') === 'found',
      status: resolution.retrieval?.status ?? 'unavailable',
      injectedChars: resolution.retrieval?.context?.length ?? 0,
      ...(resolution.retrieval?.navigation ? { navigation: resolution.retrieval.navigation } : {})
    })
    return envelope
  })
  // BOÎTE DE RÉCEPTION du savoir : `brain-remember` dépose en `inbox/` et laisse la promotion à
  // l'humain. Ces trois canaux sont cette main humaine, et ils sont bornés à la racine Brain autorisée.
  ipcMain.handle('os:listInbox', async (event, path: string) => {
    assertTrustedRendererSender(event, 'BrainInbox')
    const root = assertBrainVaultRoot(guardString(path, 'path'), AMITEL_BRAIN_ROOT)
    return brainInboxWorker.requestWithTimeout(
      BRAIN_INBOX_BOUNDARY_TIMEOUT_MS,
      'listInbox',
      root,
      amitelWorkspaces()
    )
  })
  ipcMain.handle('os:readInboxCandidateBody', async (event, path: string, id: string) => {
    assertTrustedRendererSender(event, 'BrainInboxBody')
    const root = assertBrainVaultRoot(guardString(path, 'path'), AMITEL_BRAIN_ROOT)
    return brainInboxWorker.requestWithTimeout(
      BRAIN_INBOX_BOUNDARY_TIMEOUT_MS,
      'readInboxCandidateBody',
      root,
      guardString(id, 'id')
    )
  })
  ipcMain.handle('os:promoteInbox', async (event, path: string, id: string) => {
    assertTrustedRendererSender(event, 'BrainInboxPromote')
    const root = assertBrainVaultRoot(guardString(path, 'path'), AMITEL_BRAIN_ROOT)
    const moved = promoteInboxCandidate(root, guardString(id, 'id'))
    // Le fichier a changé de dossier : sans réindexation, le graphe montrerait encore l'ancien nœud.
    await invalidateBrainRuntime()
    return moved
  })
  ipcMain.handle('os:rejectInbox', async (event, path: string, id: string) => {
    assertTrustedRendererSender(event, 'BrainInboxReject')
    const root = assertBrainVaultRoot(guardString(path, 'path'), AMITEL_BRAIN_ROOT)
    const moved = rejectInboxCandidate(root, guardString(id, 'id'))
    await invalidateBrainRuntime()
    return moved
  })
  ipcMain.handle('os:retractKnowledge', async (event, path: string, id: string) => {
    assertTrustedRendererSender(event, 'BrainKnowledgeRetract')
    const root = assertBrainVaultRoot(guardString(path, 'path'), AMITEL_BRAIN_ROOT)
    const knowledgeId = guardString(id, 'id')
    await curationRecoveryReady
    return executeCurationTransaction(
      outcomeLearning,
      { action: 'retract', knowledgeId },
      {
        mutate: () => {
          const moved = retractKnowledgeCandidate(root, knowledgeId)
          return { moved, knowledgeId, targetId: moved.to }
        },
        compensate: (result) => restoreTrashedKnowledge(root, result.moved.to),
        invalidate: invalidateBrainRuntime
      }
    )
  })
  ipcMain.handle(
    'os:supersedeKnowledge',
    async (event, path: string, obsoleteId: string, replacementId: string) => {
      assertTrustedRendererSender(event, 'BrainKnowledgeSupersede')
      const root = assertBrainVaultRoot(guardString(path, 'path'), AMITEL_BRAIN_ROOT)
      const oldId = guardString(obsoleteId, 'obsoleteId')
      const requestedTargetId = guardString(replacementId, 'replacementId')
      await curationRecoveryReady
      return executeCurationTransaction(
        outcomeLearning,
        { action: 'supersede', knowledgeId: oldId, requestedTargetId },
        {
          mutate: () => {
            const result = supersedeKnowledgeCandidate(root, oldId, requestedTargetId)
            return {
              moved: result.moved,
              knowledgeId: oldId,
              targetId: result.replacementId,
              rollbackId: result.moved.to
            }
          },
          compensate: (result) => restoreTrashedKnowledge(root, result.moved.to),
          invalidate: invalidateBrainRuntime
        }
      )
    }
  )
  ipcMain.handle('os:refreshBrain', async (event, path: string) => {
    assertTrustedRendererSender(event, 'BrainRefresh')
    guardString(path, 'path')
    await invalidateBrainRuntime()
    return { ok: true }
  })
}
