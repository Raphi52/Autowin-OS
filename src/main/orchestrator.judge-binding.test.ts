import { describe, expect, it } from 'vitest'
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { WorkflowGraph } from './workflow-graph'

/**
 * UN NŒUD `judge` DOIT RÉPONDRE AU RÔLE `judge`, PAS AU RÔLE `subagent`.
 *
 * Mesuré sur la version committée le 2026-08-05 : `resolvePhaseFanOut('judge')` honore bien les agents
 * COMPOSÉS sur le nœud, mais quand le nœud n'en porte aucun — le cas par défaut — le repli est le
 * binding `subagent` (orchestrator.ts:1493 pour le chemin décomposé, `subBinding` pour le séquentiel).
 * Le rôle `judge` configuré était donc purement ignoré, et l'exécutant se jugeait lui-même avec son
 * propre modèle. Faire évaluer un livrable par le modèle qui l'a produit n'est pas une vérification.
 */
class TracingProvider implements ProviderAdapter {
  readonly id = 'tracing'
  readonly supportsExecution = true
  /** Les modèles réellement demandés, par appel — la preuve de QUI a tourné. */
  readonly modelesDemandes: (string | undefined)[] = []

  // L'interface impose un AsyncGenerator pour le streaming ; ce faux provider répond d'un bloc.
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    this.modelesDemandes.push(options.model)
    const estJuge = options.model === 'juge-dedie'
    return {
      text: estJuge ? 'VALIDE' : 'travail fait',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: estJuge
        ? undefined
        : [
            { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
            {
              type: 'command_execution',
              kind: 'verification',
              status: 'completed',
              ok: true,
              summary: 'v'
            }
          ]
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

/** build ─always─▶ judge — le nœud judge ne porte AUCUN agent composé : c'est le cas par défaut. */
const GRAPHE: WorkflowGraph = {
  entry: 'build-1',
  nodes: [
    { id: 'build-1', phase: 'build' },
    { id: 'judge-1', phase: 'judge' }
  ],
  edges: [{ from: 'build-1', to: 'judge-1', when: 'always' }]
}

function harnais() {
  const provider = new TracingProvider()
  /** Ce que le moteur ANNONCE par phase : rôle et modèle effectifs. */
  const annonces: { phase?: string; role?: string; model?: string }[] = []
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: ['build'],
    currentWorkflow: () => ({ graph: GRAPHE })
  })
  const onPhase = (p: { step: string; phase?: string; role?: string; model?: string }): void => {
    if (p.step !== 'exec') return
    annonces.push({ phase: p.phase, role: p.role, model: p.model })
  }
  const lancer = () =>
    orch.run('modifie le projet', undefined, onPhase as never, undefined, undefined, undefined, [])
  return { provider, annonces, lancer }
}

describe('un nœud judge est jugé par le rôle judge, pas par l’exécutant', () => {
  it('le nœud judge tourne sur le MODÈLE du rôle judge', async () => {
    const { annonces, lancer } = harnais()
    await lancer()
    const dujuge = annonces.find((a) => a.phase === 'judge')
    expect(dujuge).toBeDefined()
    // Avant : 'ouvrier' — le modèle de l'exécutant, donc un auto-jugement.
    expect(dujuge?.model).toBe('juge-dedie')
  })

  it('le nœud judge est annoncé avec le RÔLE judge (l’Observatory ne mentait plus qu’à moitié)', async () => {
    const { annonces, lancer } = harnais()
    await lancer()
    expect(annonces.find((a) => a.phase === 'judge')?.role).toBe('judge')
  })

  it('une phase d’EXÉCUTION garde le rôle et le modèle du subagent', async () => {
    const { annonces, lancer } = harnais()
    await lancer()
    const dubuild = annonces.find((a) => a.phase === 'build')
    // Discriminant : si ce test casse, tout le run a été rerouté vers le juge.
    expect(dubuild?.model).toBe('ouvrier')
    expect(dubuild?.role).toBe('subagent')
  })

  it('le modèle du juge est réellement DEMANDÉ au provider, pas seulement affiché', async () => {
    const { provider, lancer } = harnais()
    await lancer()
    // `toContain` était un FAUX VERT : la trace valait déjà ["ouvrier","ouvrier","juge-dedie"] avant
    // tout correctif — le seul `juge-dedie` venant du GATE FINAL, qui utilise correctement le rôle.
    // Ce qui manquait, c'était l'appel du NŒUD. On compte donc : 1 avant (gate seul), 2 après.
    const appelsDuJuge = provider.modelesDemandes.filter((m) => m === 'juge-dedie').length
    expect(appelsDuJuge).toBeGreaterThanOrEqual(2)
  })
})
