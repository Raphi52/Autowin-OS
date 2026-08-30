import { describe, expect, it, vi } from 'vitest'

vi.mock('./native-registry', () => ({
  nativeSkills: () => [
    { id: 'look' },
    { id: 'think' },
    { id: 'salvage' },
    { id: 'front-converge' }
  ]
}))

const { routeSkillRequest, knownSkillNames } = await import('./skill-routing')

describe('slash des skills hors pipeline', () => {
  it('reconnait /look comme commande explicite SANS phase (aucune orchestration)', () => {
    knownSkillNames(true)
    expect(routeSkillRequest('/look')).toEqual({
      task: '/look',
      skill: 'look',
      reason: 'explicit-skill'
    })
    expect(routeSkillRequest("/look regarde l'écran")).toEqual({
      task: "/look regarde l'écran",
      skill: 'look',
      reason: 'explicit-skill'
    })
    expect(routeSkillRequest('/front-converge le header')?.skill).toBe('front-converge')
    expect(routeSkillRequest('/look')?.explicitPhase).toBeUndefined()
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
