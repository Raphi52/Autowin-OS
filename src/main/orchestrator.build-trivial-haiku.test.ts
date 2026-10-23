import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { compileExecutionQuote } from './execution-quote'
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
import { RoleModelConfig, type RoleBinding, type RolesPersistes } from './roles'
import type { TaskRegime } from './task-regime'
import { TrustLedger } from './trust/ledger'

/**
 * LE BUILD DES RUNS TRIVIAUX PART SUR HAIKU (conv-1097, 2026-10-22).
 *
 * Mesure (scripts/banc-modeles-petits-defauts.mjs, 4 petits défauts réels) : Haiku 5.5 11/12 pour
 * ≈ 0,05 $ l'essai, Opus 5.5 10/12 pour ≈ 1,05 $. Décision de l'utilisateur : l'étape build d'un run
 * de régime `trivial` part sur le dernier Haiku du catalogue ; le juge garde le rôle `judge` (Opus),
 * il reste le contrôle final. Ces tests lisent le MODÈLE réellement demandé au fournisseur, par étape.
 */
class ModeleProvider implements ProviderAdapter {
  constructor(readonly id: string) {}
  readonly supportsExecution = true
  readonly demandes: { bloc: string; model?: string; effort?: string }[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    const noms = (options.systemBlocks ?? []).map((bloc) => bloc.name)
    const bloc = noms.find((nom) => nom.startsWith('consigne:')) ?? '—'
    this.demandes.push({ bloc, model: options.model, effort: options.reasoningEffort })
    const estJuge = bloc === 'consigne:judge'
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

  modeleDe(phase: string): string | undefined {
    return this.demandes.find((d) => d.bloc === `consigne:${phase}`)?.model
  }

  effortDe(phase: string): string | undefined {
    return this.demandes.find((d) => d.bloc === `consigne:${phase}`)?.effort
  }

  modelesDuJuge(): (string | undefined)[] {
    return this.demandes.filter((d) => d.bloc === 'consigne:judge').map((d) => d.model)
  }
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const modele = (model: string): ImportedModel => ({
  id: `claude/${model}`,
  provider: 'claude',
  model,
  label: model,
  reasoningEfforts: [...EFFORTS],
  defaultReasoningEffort: 'high'
})
/** Deux Haiku : c'est le PLUS RÉCENT qui doit partir, jamais un id figé dans le code. */
const CATALOGUE: ImportedModel[] = [
  modele('claude-haiku-4-5'),
  modele('claude-haiku-5-5'),
  modele('claude-opus-5-5')
]

const OPUS: RoleBinding = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'xhigh' }

function harnais(
  opts: {
    regime: TaskRegime
    catalogue?: ImportedModel[]
    subagent?: RoleBinding
    reglages?: Partial<RolesPersistes>
  } = { regime: 'trivial' }
) {
  const claude = new ModeleProvider('claude')
  const rec = new ModeleProvider('rec')
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(claude).register(rec),
    roles: new RoleModelConfig(
      {
        subagent: opts.subagent ?? OPUS,
        judge: OPUS,
        orchestrator: OPUS,
        ...opts.reglages
      },
      opts.catalogue ?? CATALOGUE
    ),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    classifyPhases: () => ['build'],
    currentExecutionQuote: () => ({
      ...compileExecutionQuote('corrige la typo du titre'),
      regime: opts.regime
    })
  })
  const lancer = (bindingOverride?: RoleBinding) =>
    orch.run(
      'corrige la typo du titre',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
      undefined,
      bindingOverride
    )
  return { claude, rec, lancer }
}

describe('resolveEtape — le build d’un run trivial part sur le dernier Haiku du catalogue', () => {
  it('trivial : build sur claude-haiku-5-5 en xhigh, le juge reste sur Opus', async () => {
    const { claude, lancer } = harnais({ regime: 'trivial' })
    await lancer()
    expect(claude.modeleDe('build')).toBe('claude-haiku-5-5')
    // Même effort que le rôle : le banc a mesuré Haiku en xhigh, pas un Haiku au rabais.
    expect(claude.effortDe('build')).toBe('xhigh')
    const juges = claude.modelesDuJuge()
    expect(juges.length).toBeGreaterThan(0)
    for (const juge of juges) expect(juge).toBe('claude-opus-5-5')
  })

  it('standard et critical : le build garde le modèle du rôle', async () => {
    for (const regime of ['standard', 'critical'] as const) {
      const { claude, lancer } = harnais({ regime })
      await lancer()
      expect(claude.modeleDe('build')).toBe('claude-opus-5-5')
    }
  })

  it('sans catalogue : l’alias haiku du CLI, résolu côté serveur', async () => {
    const { claude, lancer } = harnais({ regime: 'trivial', catalogue: [] })
    await lancer()
    expect(claude.modeleDe('build')).toBe('haiku')
  })
})

describe('ce qui garde la main sur le build trivial', () => {
  it('le réglage buildTrivialSurHaiku: false rend le build au modèle du rôle (réversible)', async () => {
    const { claude, lancer } = harnais({
      regime: 'trivial',
      reglages: { buildTrivialSurHaiku: false }
    })
    await lancer()
    expect(claude.modeleDe('build')).toBe('claude-opus-5-5')
  })

  it('un modèle imposé pour le run (binding figé) part tel quel', async () => {
    const { claude, lancer } = harnais({ regime: 'trivial' })
    await lancer({ provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' })
    expect(claude.modeleDe('build')).toBe('claude-opus-5-5')
  })

  it('un réglage explicite de l’étape build (phaseModel) passe devant', async () => {
    const { claude, lancer } = harnais({
      regime: 'trivial',
      subagent: { ...OPUS, phaseModel: { build: { reasoningEffort: 'high' } } }
    })
    await lancer()
    expect(claude.modeleDe('build')).toBe('claude-opus-5-5')
  })

  it('un rôle d’exécution sur un autre moteur garde son modèle', async () => {
    const { rec, lancer } = harnais({
      regime: 'trivial',
      subagent: { provider: 'rec', model: 'ouvrier', reasoningEffort: 'xhigh' }
    })
    await lancer()
    expect(rec.modeleDe('build')).toBe('ouvrier')
  })
})
