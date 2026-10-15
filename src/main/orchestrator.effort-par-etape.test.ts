import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { compileExecutionQuote, type ExecutionQuote } from './execution-quote'
import type { ImportedModel } from './models'
import { Orchestrator } from './orchestrator'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig, type RoleBinding } from './roles'
import type { PipelinePhase } from './skill-pipeline'
import type { TaskRegime } from './task-regime'
import { TrustLedger } from './trust/ledger'
import type { WorkflowGraph } from './workflow-graph'

/**
 * L'EFFORT PAR ÉTAPE ARRIVE VRAIMENT AU FOURNISSEUR (conv-955).
 *
 * Avant : les 100 appels d'étapes relevés dans `prompt-observability` partaient tous à l'effort du
 * rôle (`xhigh`), build comme learn. Ces tests lisent l'effort DEMANDÉ au fournisseur, rangé par le
 * bloc de consigne de l'étape — la même clé que le comptage des traces réelles.
 */
class EffortProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  /** Effort demandé, par bloc de consigne (`consigne:clean`, `persona`…), dans l'ordre d'appel. */
  readonly demandes: { bloc: string; persona: boolean; effort?: string }[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    const noms = (options.systemBlocks ?? []).map((bloc) => bloc.name)
    this.demandes.push({
      bloc: noms.find((nom) => nom.startsWith('consigne:') || nom.startsWith('skill:')) ?? '—',
      persona: noms.includes('persona'),
      effort: options.reasoningEffort
    })
    const estJuge = options.model === 'juge'
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

  /** Effort demandé pour une étape (premier appel portant sa consigne). */
  effortDe(phase: string): string | undefined {
    return this.demandes.find((d) => d.bloc === `consigne:${phase}` && !d.persona)?.effort
  }
}

/** Le catalogue découvert : le modèle de l'exécutant déclare les efforts du CLI Claude. */
const CATALOGUE: ImportedModel[] = [
  {
    id: 'rec/ouvrier',
    provider: 'rec',
    model: 'ouvrier',
    label: 'ouvrier',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'high'
  },
  {
    id: 'rec/juge',
    provider: 'rec',
    model: 'juge',
    label: 'juge',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'high'
  }
]

function devis(regime: TaskRegime): ExecutionQuote {
  return { ...compileExecutionQuote('ajoute un export'), regime }
}

function harnais(
  opts: {
    catalogue?: ImportedModel[]
    regime?: TaskRegime
    phases?: PipelinePhase[]
    subagent?: RoleBinding
    graph?: WorkflowGraph
  } = {}
) {
  const provider = new EffortProvider()
  const quote = opts.regime ? devis(opts.regime) : undefined
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig(
      {
        subagent: opts.subagent ?? { provider: 'rec', model: 'ouvrier', reasoningEffort: 'xhigh' },
        judge: { provider: 'rec', model: 'juge', reasoningEffort: 'xhigh' },
        // La synthèse de plusieurs agents passe par le rôle orchestrateur.
        // fix-ok: cause mesuree — le test a plusieurs agents echouait (9/10) : cette synthese partait
        // sur le role orchestrateur laisse a `claude`, absent du registre du test (seul `rec` y est).
        orchestrator: { provider: 'rec', model: 'chef', reasoningEffort: 'xhigh' }
      },
      opts.catalogue
    ),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    classifyPhases: () => opts.phases ?? ['frame', 'build', 'clean'],
    ...(quote ? { currentExecutionQuote: () => quote } : {}),
    ...(opts.graph ? { currentWorkflow: () => ({ graph: opts.graph }) } : {})
  })
  /** Ce que la ligne du pipeline annonce, par étape. */
  const annonces: { phase?: string; effort?: string }[] = []
  const onPhase = (p: { step: string; phase?: string; reasoningEffort?: string }): void => {
    if (p.step === 'exec') annonces.push({ phase: p.phase, effort: p.reasoningEffort })
  }
  const lancer = (
    task = 'ajoute un export CSV des factures',
    extra: { bindingOverride?: RoleBinding; resumeOutputs?: { phase: string; text: string }[] } = {}
  ) =>
    orch.run(
      task,
      undefined,
      onPhase as never,
      undefined,
      undefined,
      undefined,
      extra.resumeOutputs ?? [],
      undefined,
      extra.bindingOverride
    )
  return { provider, annonces, lancer }
}

describe("l'effort de chaque étape suit la règle quand il hérite du rôle", () => {
  it('demande difficile, rôle xhigh : clean descend en high, build et frame restent xhigh', async () => {
    const { provider, lancer } = harnais({ catalogue: CATALOGUE, regime: 'critical' })
    await lancer()
    expect(provider.effortDe('frame')).toBe('xhigh')
    expect(provider.effortDe('build')).toBe('xhigh')
    expect(provider.effortDe('clean')).toBe('high')
    expect(provider.effortDe('clean')).not.toBe(provider.effortDe('build'))
  })

  it('demande standard : frame en high, clean en medium, build toujours xhigh', async () => {
    const { provider, annonces, lancer } = harnais({ catalogue: CATALOGUE, regime: 'standard' })
    await lancer()
    expect(provider.effortDe('frame')).toBe('high')
    expect(provider.effortDe('build')).toBe('xhigh')
    expect(provider.effortDe('clean')).toBe('medium')
    // La ligne du pipeline annonce l'effort qui part, pas le réglage du rôle.
    expect(annonces.find((a) => a.phase === 'clean')?.effort).toBe('medium')
  })

  it('le juge garde le réglage de son rôle', async () => {
    const { provider, lancer } = harnais({ catalogue: CATALOGUE, regime: 'trivial' })
    await lancer()
    const juges = provider.demandes.filter((d) => d.bloc === 'consigne:judge')
    expect(juges.length).toBeGreaterThan(0)
    for (const juge of juges) expect(juge.effort).toBe('xhigh')
  })

  it('sans devis, la difficulté vient du texte de la tâche (même calcul)', async () => {
    // « pipeline » classe la demande difficile : clean en high, frame en xhigh.
    const { provider, lancer } = harnais({ catalogue: CATALOGUE })
    await lancer('revois le pipeline de facturation')
    expect(provider.effortDe('frame')).toBe('xhigh')
    expect(provider.effortDe('clean')).toBe('high')
  })

  it('le devis du run prime sur une relecture du texte — la reprise relit le même devis', async () => {
    // Texte « difficile », devis « standard » : c'est le devis enregistré qui décide.
    const { provider, lancer } = harnais({ catalogue: CATALOGUE, regime: 'standard' })
    await lancer('revois le pipeline de facturation')
    expect(provider.effortDe('clean')).toBe('medium')
  })

  it('après une reprise, clean repart au même effort qu’avant', async () => {
    const premier = harnais({ catalogue: CATALOGUE, regime: 'standard' })
    await premier.lancer()
    const repris = harnais({ catalogue: CATALOGUE, regime: 'standard' })
    await repris.lancer(undefined, {
      resumeOutputs: [
        { phase: 'frame', text: 'cadrage acquis' },
        { phase: 'build', text: 'build acquis' }
      ]
    })
    // Frame et build sont rejoués depuis l'acquis : seul clean repart chez le fournisseur.
    expect(repris.provider.effortDe('frame')).toBeUndefined()
    expect(repris.provider.effortDe('clean')).toBe(premier.provider.effortDe('clean'))
    expect(repris.provider.effortDe('clean')).toBe('medium')
  })
})

describe('ce qui garde la main sur la règle', () => {
  it('sans catalogue (liste du modèle inconnue), tout part au réglage du rôle', async () => {
    const { provider, lancer } = harnais({ regime: 'trivial' })
    await lancer()
    expect(provider.effortDe('frame')).toBe('xhigh')
    expect(provider.effortDe('clean')).toBe('xhigh')
  })

  it('un phaseModel posé pour une étape passe devant la règle', async () => {
    const { provider, lancer } = harnais({
      catalogue: CATALOGUE,
      regime: 'trivial',
      subagent: {
        provider: 'rec',
        model: 'ouvrier',
        reasoningEffort: 'xhigh',
        phaseModel: { clean: { reasoningEffort: 'max' } }
      }
    })
    await lancer()
    expect(provider.effortDe('clean')).toBe('max')
    // Les étapes sans phaseModel suivent toujours la règle.
    expect(provider.effortDe('frame')).toBe('medium')
  })

  it('un binding figé pour le run part tel quel à chaque étape', async () => {
    const { provider, lancer } = harnais({ catalogue: CATALOGUE, regime: 'trivial' })
    await lancer(undefined, {
      bindingOverride: { provider: 'rec', model: 'ouvrier', reasoningEffort: 'high' }
    })
    expect(provider.effortDe('frame')).toBe('high')
    expect(provider.effortDe('clean')).toBe('high')
  })
})

describe('plusieurs agents sur une même étape (canevas)', () => {
  const GRAPHE: WorkflowGraph = {
    entry: 'frame-1',
    nodes: [
      {
        id: 'frame-1',
        phase: 'frame',
        agents: [{ persona: 'problème' }, { persona: 'risques', reasoningEffort: 'low' }]
      },
      { id: 'build-1', phase: 'build' },
      { id: 'judge-1', phase: 'judge' }
    ],
    edges: [
      { from: 'frame-1', to: 'build-1', when: 'always' },
      { from: 'build-1', to: 'judge-1', when: 'always' }
    ]
  }

  it('un agent sans effort propre suit la règle, un agent avec effort propre garde le sien', async () => {
    const { provider, lancer } = harnais({
      catalogue: CATALOGUE,
      regime: 'standard',
      graph: GRAPHE
    })
    await lancer()
    const membres = provider.demandes.filter((d) => d.bloc === 'consigne:frame' && d.persona)
    expect(membres.map((m) => m.effort).sort()).toEqual(['high', 'low'])
    expect(provider.effortDe('build')).toBe('xhigh')
  })
})
