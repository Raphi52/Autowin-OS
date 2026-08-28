import { describe, expect, it } from 'vitest'
import {
  blocageDepuisReveil,
  resumerGels,
  PERIODE_BATTEMENT_MS,
  SEUIL_GEL_MS
} from './gel-detector'

describe('blocageDepuisReveil — le retard du battement EST la duree du gel', () => {
  it('ne signale rien quand le minuteur se reveille a l’heure', () => {
    expect(blocageDepuisReveil(PERIODE_BATTEMENT_MS + 12)).toBe(0)
  })

  it('ne signale rien sous le seuil : l’ordonnancement normal n’est pas un gel', () => {
    expect(blocageDepuisReveil(PERIODE_BATTEMENT_MS + SEUIL_GEL_MS - 1)).toBe(0)
  })

  it('rend le retard REEL au-dela du seuil', () => {
    expect(blocageDepuisReveil(PERIODE_BATTEMENT_MS + 5200)).toBe(5200)
  })
})

describe('resumerGels — nommer le coupable, pas le deduire', () => {
  it('classe les operations par temps de gel CUMULE', () => {
    const resume = resumerGels([
      JSON.stringify({ ts: 'a', blocageMs: 1200, operation: 'snapshot' }),
      JSON.stringify({ ts: 'b', blocageMs: 3000, operation: 'git:status' }),
      JSON.stringify({ ts: 'c', blocageMs: 1500, operation: 'snapshot' })
    ])
    expect(resume.gels).toBe(3)
    expect(resume.pireMs).toBe(3000)
    expect(resume.cumulMs).toBe(5700)
    expect(resume.parOperation[0]).toEqual({
      operation: 'git:status',
      gels: 1,
      cumulMs: 3000,
      pireMs: 3000
    })
    expect(resume.parOperation[1]?.operation).toBe('snapshot')
  })

  it('COMPTE les lignes illisibles au lieu de les jeter en silence', () => {
    const resume = resumerGels(['{pas du json', '', JSON.stringify({ blocageMs: 0 })])
    expect(resume.gels).toBe(0)
    expect(resume.lignesIllisibles).toBe(2)
  })

  it('range un gel sans operation declaree sous « inconnu »', () => {
    const resume = resumerGels([JSON.stringify({ blocageMs: 2000 })])
    expect(resume.parOperation[0]?.operation).toBe('inconnu')
  })
})
