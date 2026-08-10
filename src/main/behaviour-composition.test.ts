import { describe, expect, it } from 'vitest'
import { buildBehaviourComposition, type InfluencerField } from './behaviour-composition'
import { RoleModelConfig } from './roles'

const build = (budgetUsd: number | null = null): ReturnType<typeof buildBehaviourComposition> =>
  buildBehaviourComposition(new RoleModelConfig(), {}, undefined, budgetUsd)

const allFields = (c: ReturnType<typeof buildBehaviourComposition>): InfluencerField[] => [
  ...c.cockpit.systemPrompt,
  ...c.cockpit.retrievedContext,
  ...c.cockpit.turnContext,
  ...c.cockpit.modelSelection,
  ...c.orchestrated.systemPrompt.flatMap((p) => p.blocks),
  ...c.orchestrated.injectedContext,
  ...c.orchestrated.modelSelection,
  ...c.orchestrated.topology,
  ...c.orchestrated.regime,
  ...c.orchestrated.guardrails,
  ...c.direct.systemPrompt,
  ...c.direct.modelSelection
]

describe('buildBehaviourComposition — COMPLÉTUDE', () => {
  it('couvre les 7 phases orchestrées, chacune avec ≥1 bloc de system prompt', () => {
    const c = build()
    const phases = c.orchestrated.systemPrompt.map((p) => p.phase)
    expect(phases).toEqual(['scout', 'frame', 'terrain', 'build', 'clean', 'judge', 'kaizen'])
    for (const p of c.orchestrated.systemPrompt) expect(p.blocks.length).toBeGreaterThan(0)
  })

  it('peuple chaque catégorie A-E (aucune vide)', () => {
    const c = build()
    expect(c.orchestrated.injectedContext.length).toBeGreaterThan(0) // B
    expect(c.orchestrated.modelSelection.length).toBeGreaterThan(0) // C
    expect(c.orchestrated.topology.length).toBeGreaterThan(0) // C2
    expect(c.orchestrated.regime.length).toBeGreaterThan(0) // D
    expect(c.orchestrated.guardrails.length).toBeGreaterThan(0) // E
    expect(c.direct.systemPrompt.length).toBeGreaterThan(0)
  })

  it('trace CHAQUE influenceur à une source file:line', () => {
    for (const f of allFields(build())) {
      expect(f.source, `champ "${f.label}" sans source`).toMatch(/\.ts:\d+$/)
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.value.length).toBeGreaterThan(0)
    }
  })

  it('reflète les influenceurs clés : Brain, redirection exécution, régime, circuit-breaker, constitution', () => {
    const labels = allFields(build()).map((f) => f.label.toLowerCase())
    expect(labels.some((l) => l.includes('brain'))).toBe(true)
    expect(labels.some((l) => l.includes('redirection'))).toBe(true)
    expect(labels.some((l) => l.includes('régime') || l.includes('regime'))).toBe(true)
    expect(labels.some((l) => l.includes('circuit-breaker'))).toBe(true)
    expect(labels.some((l) => l.includes('constitution'))).toBe(true)
    expect(labels.some((l) => l.includes('graphify'))).toBe(true)
  })

  it('décrit le RAG Brain + Graphify du chat cockpit visible', () => {
    const cockpit = build().cockpit
    expect(cockpit.retrievedContext.map(({ label }) => label)).toEqual([
      'Amitel Brain signé',
      'preuves Graphify'
    ])
    expect(JSON.stringify(cockpit)).toContain('dernier message utilisateur')
    expect(JSON.stringify(cockpit)).toContain('fallback')
  })

  it('décrit tous les influenceurs variables du cockpit', () => {
    const blob = JSON.stringify(build().cockpit)
    for (const token of [
      'catalogue vivant',
      'snapshot courant',
      'historique complet',
      'pièces jointes',
      'exécutées directement',
      'directives',
      '12 itérations'
    ]) {
      expect(blob).toContain(token)
    }
  })

  it('reflète les panels vivants et la règle de quorum', () => {
    const c = buildBehaviourComposition(
      new RoleModelConfig(),
      {},
      {
        panels: {
          scout: [
            {
              slotId: 's1',
              provider: 'codex',
              modelId: 'codex:gpt-5.6',
              reasoningEffort: 'high'
            }
          ],
          frame: [],
          terrain: [
            {
              slotId: 't1',
              provider: 'claude',
              modelId: 'claude:sonnet',
              reasoningEffort: 'medium'
            }
          ],
          judge: [
            {
              slotId: 'j1',
              provider: 'claude',
              modelId: 'claude:opus',
              reasoningEffort: 'high'
            },
            {
              slotId: 'j2',
              provider: 'codex',
              modelId: 'codex:gpt-5.6',
              reasoningEffort: 'medium'
            }
          ]
        }
      }
    )
    const blob = JSON.stringify(c.orchestrated.topology)
    expect(blob).toContain('codex/codex:gpt-5.6/high')
    expect(blob).toContain('claude/claude:sonnet/medium')
    expect(blob).toContain('claude/claude:opus/high')
    expect(blob).toContain('quorum')
  })

  it('distingue provider explicite et binding de rôle dans os.chat', () => {
    const direct = JSON.stringify(build().direct)
    expect(direct).toContain('Sans provider explicite')
    expect(direct).toContain('options modèle/effort vides')
    expect(direct).toContain('binding du rôle est alors ignoré')
  })

  it('le juge n’injecte PAS la discipline de pipeline (fidèle à orchestrator.ts:527)', () => {
    const judge = build().orchestrated.systemPrompt.find((p) => p.phase === 'judge')!
    expect(judge.blocks.some((b) => b.label === 'discipline')).toBe(false)
    const build_ = build().orchestrated.systemPrompt.find((p) => p.phase === 'build')!
    expect(build_.blocks.some((b) => b.label === 'discipline')).toBe(true)
  })
})

describe('buildBehaviourComposition — EXCLUSIVITÉ (aucun non-influenceur)', () => {
  const forbidden = ['capabilit', 'graph_report', 'listclaudehooks', 'hookevents']

  it('ne mentionne AUCUN non-influenceur connu', () => {
    const blob = JSON.stringify(build()).toLowerCase()
    for (const token of forbidden) {
      expect(blob.includes(token), `non-influenceur "${token}" présent`).toBe(false)
    }
  })

  it('n’expose PAS le rôle scout scalaire dans la sélection de modèle (jamais lu par l’orchestrateur)', () => {
    const modelLabels = build().orchestrated.modelSelection.map((f) => f.label.toLowerCase())
    expect(modelLabels.some((l) => l.includes('scout'))).toBe(false)
  })
})

describe('buildBehaviourComposition — valeurs volatiles = RÈGLE, pas figées', () => {
  it('cap circuit-breaker : absence explicite ou valeur persistée', () => {
    expect(JSON.stringify(build())).toContain('aucune limite')
    const withCap = build(5)
    const cb = withCap.orchestrated.guardrails.find((f) => f.label === 'circuit-breaker coût')!
    expect(cb.value).toContain('5')
  })
})
