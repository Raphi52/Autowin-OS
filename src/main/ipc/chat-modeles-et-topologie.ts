import { observerLeMoteur } from '../app/observer-les-sources'
import { registerProfilesIpc } from './profiles'
import { registerTopologyIpc } from './topology'
import { registerRolesIpc } from './roles'
import { registerModelsIpc } from './models'
import { registerFabricIpc } from './fabric'
import { registerCapabilitiesIpc } from './capabilities'
import { registerWorkflowProfilesIpc } from './workflow-profiles'
import { ipcMain, app } from 'electron'
import { createHash } from 'node:crypto'
import type { ProviderAdapter } from '../providers/types'
import type { OrchestrationRunState } from '../runs/orchestration-state'
import { assertTrustedRendererSender } from './ipc-senders'
import type { FabricNodeSummary } from '../compute-fabric/control-plane'
import { createFabricProductBindings } from '../compute-fabric/product-bridge'
import { createCheckpointForkManifest } from '../topologie/wire-checkpoint-fork'
import { recommendShadowRoute } from '../modeles/shadow-router'
import { createShadowRoutingRuntime } from '../modeles/model-routing-shadow'
import { saveShadowRoutingPilotSetting } from '../modeles/model-routing-shadow-setting'
import { saveAgentTopology } from '../topologie/topology-disk'
import type { AgentTopology } from '../topologie/topology'
import { guardString } from './ipc-guards'
import {
  WorkflowRefusalMailbox,
  type WorkflowProfilesFile,
  activeWorkflowProfile,
  seedDefaultWorkflows
} from '../workflow/workflow-profiles'
import { overrideFor } from '../workflow/workflow-run-override'
import {
  type WorkflowGraph,
  graphDefects,
  worstCaseNodeExecutions
} from '../workflow/workflow-graph'
import type { ContexteIpcChat } from '../index'

/**
 * TOPOLOGIE ET MODÈLES : rôles, workflows, état du moteur, routage fantôme, modèles, compute
 * fabric, checkpoints, profils et capacités.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** IPC : topologie, workflows, modèles et fabric. */
export function registerModelesEtTopologieIpc(ctx: ContexteIpcChat): void {
  const {
    agentModelsReady,
    agentTopologyPath,
    applyFabricSummaries,
    broadcast,
    bus,
    claudeAccounts,
    demarrageDuMoteurMs,
    fabricControlPlane,
    isolatedTestInstance,
    modelCatalog,
    os,
    pickPath,
    pickSavePath,
    profiles,
    shadowRoutingObservationsPath,
    shadowRoutingPilotPath,
    shadowRoutingPilotState,
    syncRuntimeTopology
  } = ctx
  // `index.ts` garde la SEULE autorité sur `agentTopology` (variable réassignée) : les modules la
  // reçoivent en lecture/écriture, jamais en valeur.
  const lireTopologie = (): AgentTopology => ctx.agentTopology
  const appliquerTopologie = (topology: AgentTopology): AgentTopology => {
    ctx.agentTopology = saveAgentTopology(agentTopologyPath, topology, ctx.agentModels)
    syncRuntimeTopology(ctx.agentTopology)
    return ctx.agentTopology
  }
  const broadcastRolesRefresh = (): void => broadcast({ type: 'refresh', scope: 'roles' })
  registerRolesIpc({
    os,
    agentModelsReady,
    lireModeles: () => ctx.agentModels,
    lireTopologie,
    appliquerTopologie,
    broadcastRolesRefresh,
    broadcastConversationsRefresh: () => broadcast({ type: 'refresh', scope: 'conversations' })
  })
  // WORKFLOWS NOMMÉS : lire, écrire, sélectionner. La sélection ne PILOTE encore rien — c'est la
  // pièce qui rend un workflow nommable et choisissable, préalable à la comparaison de plusieurs
  // façons de faire sur un même objectif.
  /**
   * Porte le workflow ACTIF jusqu'au moteur.
   *
   * Sans cet appel, `activeId` n'était qu'une préférence écrite sur disque que PERSONNE ne lisait :
   * `setActiveWorkflow` n'était sollicité que par le banc de comparaison, qui le pose puis le retire
   * aussitôt. Le graphe composé, ses personas et ses retours bornés n'avaient donc AUCUN effet sur un
   * tour de chat — la feature était entièrement décorative. On applique à l'ouverture ET à chaque
   * changement de sélection, sinon l'un des deux chemins retombe dans le même piège.
   */
  const workflowRefusalMailbox = new WorkflowRefusalMailbox()
  const appliquerWorkflowActif = (fichier: WorkflowProfilesFile): void => {
    // Un workflow imposé puis CASSÉ par une édition ne doit pas rester le workflow du chat :
    // `activeWorkflowProfile` le refuse, et le refus se dit au lieu de disparaître en silence.
    const refus = workflowRefusalMailbox.update(fichier)
    if (refus) {
      console.warn(`[workflow] ${refus.message}`)
      broadcast({
        type: 'toast',
        text: refus.message,
        noticeId: workflowRefusalMailbox.peek()?.id
      })
    }
    const actif = activeWorkflowProfile(fichier)
    const override = overrideFor(actif ?? null)
    // Activé depuis la vue = choix EXPLICITE : la proportionnalité ne doit pas l'écarter en silence.
    os.setActiveWorkflow(override ? { ...override, explicit: true } : undefined)
  }
  // Le semis d'origine précède l'application : sinon la toute première ouverture montrerait une vue
  // vide, et le moteur n'aurait rien à porter.
  appliquerWorkflowActif(seedDefaultWorkflows())

  // Les canaux des workflows nommés vivent dans src/main/ipc/workflow-profiles.ts.
  registerWorkflowProfilesIpc({
    workflowRefusalMailbox,
    appliquerWorkflowActif,
    pickPath,
    pickSavePath,
    broadcast
  })
  // La validité d'un graphe composé. Calculée côté main pour que le canevas et l'exécution partagent
  // exactement la même règle — deux vérités divergeraient tôt ou tard.
  //
  // `inertReturns` a disparu de ce contrat : depuis que l'orchestrateur MARCHE le graphe, aucun
  // retour n'est inerte. Le champ ne rendait plus qu'un tableau vide, et la mention qu'il pilotait
  // à l'écran (« le moteur ne sait pas encore le jouer ») était devenue un mensonge inatteignable.
  ipcMain.handle('os:workflowGraph:check', (event, raw: unknown) => {
    assertTrustedRendererSender(event, 'Workflow graph')
    const graph = raw as WorkflowGraph
    const defects = graphDefects(graph)
    return {
      defects,
      worstCaseNodeExecutions: defects.length ? null : worstCaseNodeExecutions(graph)
    }
  })
  /*
   * ETAT DU MOTEUR — le pied de page doit pouvoir dire que le code qui tourne n'est plus celui des
   * sources. Mesure du 2026-08-25 : `electron-vite dev` ne reconstruit PAS le processus principal,
   * donc un correctif reste invisible jusqu'a un redemarrage manuel, sans que rien ne le signale.
   *
   * On MONTRE au lieu de redemarrer : `--watch` a deja ete essaye et tuait l'application pendant le
   * travail (`dev-sans-watch.test.ts` l'interdit depuis).
   *
   * Le balayage est fait A LA DEMANDE et non au demarrage : appele une fois par ouverture de
   * fenetre, il ne coute rien, et la reponse reste fraiche si l'utilisateur laisse l'app ouverte.
   */
  ipcMain.handle('os:moteur:etat', (event) => {
    assertTrustedRendererSender(event, 'Etat du moteur')
    try {
      return observerLeMoteur(app.getAppPath(), demarrageDuMoteurMs, app.isPackaged)
    } catch {
      // Un pied de page ne fait jamais tomber l'application : sans reponse, il n'affiche rien.
      return { perime: false }
    }
  })
  ipcMain.handle('os:shadowRoutingPilot:get', (event) => {
    assertTrustedRendererSender(event, 'Pilote de routage shadow')
    return shadowRoutingPilotState()
  })
  ipcMain.handle('os:shadowRoutingPilot:set', (event, enabled: unknown) => {
    assertTrustedRendererSender(event, 'Pilote de routage shadow')
    const saved = saveShadowRoutingPilotSetting(shadowRoutingPilotPath, enabled)
    // Reconstruction IMMEDIATE : le sink de trace relit `shadowRoutingRuntime` a chaque evenement,
    // la bascule prend donc effet sans redemarrage. L'environnement garde la priorite.
    ctx.shadowRoutingRuntime = createShadowRoutingRuntime(
      shadowRoutingObservationsPath,
      process.env,
      saved.enabled
    )
    return shadowRoutingPilotState(saved)
  })
  // Reprojeter les modeles de Compute Fabric : `applyFabricSummaries` a d'autres appelants au
  // demarrage, elle reste donc dans `index.ts` et les modules la recoivent.
  const synchroniserFabric = (): void => applyFabricSummaries(fabricControlPlane.list())
  registerModelsIpc({
    os,
    modelCatalog,
    lireModeles: () => ctx.agentModels,
    lireTopologie,
    synchroniserFabric,
    isolatedTestInstance,
    // Le compte actif n'a rien à sonder de plus : c'est déjà lui que décrit le relevé général.
    compteClaudeDuReleve: (id) => {
      const compte = claudeAccounts.find(id)
      return compte && id !== claudeAccounts.active().id ? { configDir: compte.dir } : undefined
    }
  })
  registerFabricIpc({
    fabricControlPlane,
    lireFixtureIsolee: () => ctx.isolatedFabricFixtureSummary,
    synchroniserFabric,
    broadcastRolesRefresh
  })
  ipcMain.handle('app:test:fabric-fixture:install', (event) => {
    assertTrustedRendererSender(event, 'Fixture Compute Fabric')
    if (!isolatedTestInstance)
      throw new Error('Fixture Compute Fabric indisponible hors instance isolée')
    const summary: FabricNodeSummary = {
      nodeId: 'wire-node',
      trust: 'paired',
      availability: 'online',
      lastSequence: 1,
      lastManifestDigest: 'wire-manifest-digest',
      lastVerifiedAt: new Date().toISOString(),
      resources: [
        {
          id: 'wire-resource',
          nodeId: 'wire-node',
          kind: 'model',
          adapterId: 'wire-adapter',
          displayName: 'Wire local tools',
          runtimeVersion: '1.0.0',
          modes: ['local-tools'],
          capabilities: ['chat'],
          limits: { contextTokens: 4096, maxConcurrentRuns: 1 }
        }
      ]
    }
    const [model] = createFabricProductBindings(summary).models
    if (!model) throw new Error('La fixture Compute Fabric ne produit aucun modèle')
    const fixtureAdapter: ProviderAdapter = {
      id: model.provider,
      supportsExecution: false,
      async auth() {
        return true
      },
      async *send(_messages, opts = {}) {
        yield { delta: 'fixture-ok' }
        return {
          text: 'fixture-ok',
          provider: model.provider,
          model: model.model,
          systemInjected: Boolean(opts.system)
        }
      }
    }
    os.registry.register(fixtureAdapter)
    ctx.isolatedFabricFixtureSummary = summary
    ctx.agentModels = [...ctx.agentModels.filter((candidate) => candidate.id !== model.id), model]
    os.roles.setCatalog(ctx.agentModels)
    return { summary, model }
  })
  ipcMain.handle('app:test:fabric-fixture:send', async (event, execution?: unknown) => {
    assertTrustedRendererSender(event, 'Exécution fixture Compute Fabric')
    if (!isolatedTestInstance)
      throw new Error('Fixture Compute Fabric indisponible hors instance isolée')
    if (!ctx.isolatedFabricFixtureSummary) throw new Error('Fixture Compute Fabric non installée')
    if (execution !== undefined && typeof execution !== 'boolean') {
      throw new Error('Mode d’exécution fixture invalide')
    }
    return os.registry.send(
      'fabric:wire-node:wire-resource',
      [{ role: 'user', content: 'preuve Compute Fabric packagée' }],
      execution ? { execution: { cwd: os.executionWorkspace, sandbox: 'read-only' } } : {}
    )
  })
  ipcMain.handle('os:checkpointForks:list', (event) => {
    assertTrustedRendererSender(event, 'Checkpoint forks')
    return os.resumableOrchestrations().map((checkpoint) => ({
      id: checkpoint.runId,
      runId: checkpoint.runId,
      createdAt: new Date(checkpoint.updatedAt).toISOString(),
      sourceSnapshot: {
        workspaceId: os.executionWorkspace,
        baseSha: checkpoint.runtimeSnapshot ? 'runtime-snapshot' : 'legacy-checkpoint',
        contentHash: createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex')
      },
      state: checkpoint
    }))
  })
  ipcMain.handle('os:checkpointFork:create', (event, checkpointId?: unknown, forkId?: unknown) => {
    assertTrustedRendererSender(event, 'Checkpoint fork')
    const safeForkId = guardString(forkId, 'forkId')
    const checkpoints = os.resumableOrchestrations().map((checkpoint) => ({
      id: checkpoint.runId,
      runId: checkpoint.runId,
      createdAt: new Date(checkpoint.updatedAt).toISOString(),
      sourceSnapshot: {
        workspaceId: os.executionWorkspace,
        baseSha: checkpoint.runtimeSnapshot ? 'runtime-snapshot' : 'legacy-checkpoint',
        contentHash: createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex')
      },
      state: checkpoint
    }))
    const manifest = createCheckpointForkManifest(checkpoints, {
      checkpointId: guardString(checkpointId, 'checkpointId'),
      forkId: safeForkId,
      createdAt: new Date().toISOString(),
      deriveState: (state) => ({ ...state, runId: safeForkId })
    })
    os.persistCheckpointFork(structuredClone(manifest.branchState) as OrchestrationRunState, {
      checkpointId: manifest.ancestor.checkpointId,
      runId: manifest.ancestor.runId,
      checkpointCreatedAt: manifest.ancestor.checkpointCreatedAt,
      contentHash: manifest.sourceSnapshot.contentHash
    })
    return manifest
  })
  ipcMain.handle('os:shadowRoute:recommend', (event, phase?: unknown, champion?: unknown) => {
    assertTrustedRendererSender(event, 'Shadow router')
    const safePhase = guardString(phase, 'phase')
    if (!ctx.shadowRoutingRuntime.enabled) {
      return {
        status: 'insufficient-data' as const,
        confidence: 'insufficient' as const,
        phase: safePhase,
        reason:
          'Routeur shadow desactive : activez « Mesurer les routes (pilote shadow) » dans Settings > Routage pour que l app commence a mesurer quelle route tient le vert au cout le plus bas.'
      }
    }
    if (!champion || typeof champion !== 'object') throw new Error('Champion invalide')
    const route = champion as { provider?: unknown; model?: unknown }
    const samples = ctx.shadowRoutingRuntime.store.read().map((observation) => ({
      phase: observation.phase,
      provider: observation.provider,
      model: observation.model,
      cost: observation.costUsd ?? 0,
      durationMs: observation.durationMs ?? 0,
      green: observation.outcome === 'verified-success'
    }))
    return recommendShadowRoute(samples, {
      phase: safePhase,
      champion: {
        provider: guardString(route.provider, 'champion.provider'),
        model: guardString(route.model, 'champion.model')
      }
    })
  })
  registerProfilesIpc({
    os,
    profiles,
    agentModelsReady,
    lireModeles: () => ctx.agentModels,
    lireTopologie,
    appliquerTopologie,
    broadcastRolesRefresh
  })
  registerTopologyIpc({
    agentModelsReady,
    lireTopologie,
    appliquerTopologie,
    broadcastRolesRefresh
  })
  // Les canaux de l'inventaire des capacités vivent dans src/main/ipc/capabilities.ts.
  registerCapabilitiesIpc({
    lireConversationActive: () => bus.activeConversationId,
    broadcast
  })
}
