import { describe, expect, it } from 'vitest'
import {
  blocageDepuisReveil,
  resumerGels,
  PERIODE_BATTEMENT_MS,
  SEUIL_GEL_MS,
  classerGel
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

/*
 * PREUVE PAR LE CPU — un retard n'est pas une preuve de blocage.
 *
 * Journal reel du 2026-08-28 (20:37 -> 21:42) : un « gel » de 16 a 22 s TOUTES LES MINUTES, reparti
 * au hasard sur `inactif`, `demarrage:interface chargée`, `os:models:quotas`, `os:pilotChat`. Une
 * boucle reellement tenue par notre propre code ne change pas de coupable a chaque minute : le
 * process etait DESORDONNANCE (machine saturee / veille), pas bloque. Sans discriminant, /heal
 * partirait optimiser `os:models:quotas` — un alibi de plus.
 *
 * Discriminant FACTUEL : le CPU consomme par NOTRE process pendant le retard. Boucle tenue => le
 * temps est brule chez nous. Process prive de CPU => il ne l'est pas.
 */
describe('classerGel — distinguer la boucle TENUE du process PRIVE de CPU', () => {
  it('boucle tenue : 17 s de retard, 16,8 s de CPU brule chez nous', () => {
    expect(classerGel(PERIODE_BATTEMENT_MS + 17_000, 16_800).cause).toBe('boucle-tenue')
  })

  it('process prive de CPU : 17 s de retard, 40 ms de CPU — ce n’est PAS notre code', () => {
    expect(classerGel(PERIODE_BATTEMENT_MS + 17_000, 40).cause).toBe('process-prive-de-cpu')
  })

  it('sous le seuil, il n’y a pas de gel du tout', () => {
    expect(classerGel(PERIODE_BATTEMENT_MS + 10, 5).blocageMs).toBe(0)
  })

  it('l’attribution par operation IGNORE les gels non imputables a notre boucle', () => {
    const resume = resumerGels([
      JSON.stringify({
        ts: 'a',
        blocageMs: 17_000,
        operation: 'ipc:os:models:quotas',
        cause: 'process-prive-de-cpu'
      }),
      JSON.stringify({
        ts: 'b',
        blocageMs: 2_000,
        operation: 'ipc:git:graph',
        cause: 'boucle-tenue'
      })
    ])
    expect(resume.parOperation.map((o) => o.operation)).toEqual(['ipc:git:graph'])
    expect(resume.cumulMs).toBe(2_000)
    expect(resume.gelsNonImputables).toBe(1)
    expect(resume.msNonImputables).toBe(17_000)
  })

  it('un gel ANCIEN sans champ `cause` reste impute : on ne reecrit pas le passe en silence', () => {
    const resume = resumerGels([
      JSON.stringify({ ts: 'a', blocageMs: 3_000, operation: 'ipc:git:graph' })
    ])
    expect(resume.cumulMs).toBe(3_000)
    expect(resume.gelsNonImputables).toBe(0)
  })
})
