import { describe, expect, it, vi } from 'vitest'

vi.mock('./native-registry', () => ({
  nativeSkills: () => [
    { id: 'see' },
    { id: 'think' },
    { id: 'salvage' },
    { id: 'front-converge' }
  ]
}))

const { routeSkillRequest, knownSkillNames } = await import('./skill-routing')

describe('slash des skills hors pipeline', () => {
  it('reconnait /see comme commande explicite SANS phase (aucune orchestration)', () => {
    knownSkillNames(true)
    expect(routeSkillRequest('/see')).toEqual({
      task: '/see',
      skill: 'see',
      reason: 'explicit-skill'
    })
    expect(routeSkillRequest("/see regarde l'écran")).toEqual({
      task: "/see regarde l'écran",
      skill: 'see',
      reason: 'explicit-skill'
    })
    expect(routeSkillRequest('/front-converge le header')?.skill).toBe('front-converge')
    expect(routeSkillRequest('/see')?.explicitPhase).toBeUndefined()
  })

  it("laisse les phases du pipeline porter leur explicitPhase", () => {
    knownSkillNames(true)
    expect(routeSkillRequest('/scout des fix')?.explicitPhase).toBe('scout')
  })

  it('ignore un slash inconnu', () => {
    knownSkillNames(true)
    expect(routeSkillRequest('/inexistant fais un truc')).toBeUndefined()
  })
})
