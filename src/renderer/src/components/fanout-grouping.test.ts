import { describe, it, expect } from 'vitest'
import { groupSubagentSteps, type OrchStep } from './chat-view-model'

const member = (phase: string, model: string, role = 'subagent'): OrchStep => ({
  step: role === 'judge' ? 'judge' : 'exec',
  role,
  model,
  detail: role === 'judge' ? 'vote: VALIDE' : `phase ${phase} · modèle ${model}`
})

describe('groupSubagentSteps', () => {
  it('≥2 membres consécutifs d’une même phase → un groupe fan-out', () => {
    const g = groupSubagentSteps([member('frame', 'opus'), member('frame', 'codex')])
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('fanout')
    if (g[0].kind === 'fanout') expect(g[0].steps).toHaveLength(2)
  })

  it('un step mono (sans model) reste seul', () => {
    const g = groupSubagentSteps([{ step: 'exec', role: 'subagent', detail: 'phase build', text: 'ok' }])
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('single')
  })

  it('un seul membre (run de 1) → single, pas de grille', () => {
    expect(groupSubagentSteps([member('frame', 'opus')])[0].kind).toBe('single')
  })

  it('la synthèse (rôle orchestrateur) sépare deux phases fan-outées', () => {
    const synth: OrchStep = { step: 'exec', role: 'orchestrator', model: 'orch', detail: 'synthèse frame (2 modèles)' }
    const g = groupSubagentSteps([
      member('frame', 'opus'),
      member('frame', 'codex'),
      synth,
      member('scout', 'opus'),
      member('scout', 'codex')
    ])
    // frame(fanout) + synthèse(single) + scout(fanout)
    expect(g.map((x) => x.kind)).toEqual(['fanout', 'single', 'fanout'])
  })

  it('N juges consécutifs → groupe fan-out juge', () => {
    const g = groupSubagentSteps([member('', 'j1', 'judge'), member('', 'j2', 'judge'), member('', 'j3', 'judge')])
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('fanout')
    if (g[0].kind === 'fanout') expect(g[0].steps).toHaveLength(3)
  })

  it('un gate/step sans model n’est jamais groupé (rétrocompat)', () => {
    const g = groupSubagentSteps([{ step: 'gate', detail: 'clôture autorisée' }])
    expect(g[0].kind).toBe('single')
  })
})
