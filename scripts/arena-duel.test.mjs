import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cheminJournal, lireDuels, noterDuel, normaliserDuel } from './arena-duel.mjs'

const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

const racineTmp = () => {
  const r = mkdtempSync(join(tmpdir(), 'arena-duel-'))
  aNettoyer.push(r)
  return r
}

const duel = (extra = {}) => ({
  tache: 'ajoute --depuis a scout-rendement',
  workflow: 'frame->build->judge',
  bras: 'a',
  dureeMs: 307368,
  coutUsd: '0,6365',
  verdict: 'gagnant',
  ...extra
})

describe('arena-duel — journal des duels', () => {
  it('ajoute une ligne par bras, sans ecraser les precedentes', () => {
    const r = racineTmp()
    noterDuel(duel(), r)
    noterDuel(duel({ bras: 'b', workflow: 'build seul', verdict: 'perdant' }), r)
    const lignes = readFileSync(cheminJournal(r), 'utf8').trim().split('\n')
    expect(lignes).toHaveLength(2)
    expect(JSON.parse(lignes[1]).workflow).toBe('build seul')
  })

  it('normalise le cout en nombre meme ecrit avec une virgule', () => {
    expect(normaliserDuel(duel()).coutUsd).toBeCloseTo(0.6365, 6)
  })

  it('accepte un cout a zero (abonnement inclus) sans le deviner', () => {
    expect(normaliserDuel(duel({ coutUsd: 0 })).coutUsd).toBe(0)
  })

  it('refuse une entree qui rendrait le journal incomparable', () => {
    expect(() => normaliserDuel(duel({ tache: '   ' }))).toThrow(/tache/)
    expect(() => normaliserDuel(duel({ workflow: '' }))).toThrow(/workflow/)
    expect(() => normaliserDuel(duel({ verdict: 'excellent' }))).toThrow(/verdict/)
    expect(() => normaliserDuel(duel({ bras: 'z' }))).toThrow(/bras/)
    expect(() => normaliserDuel(duel({ dureeMs: -5 }))).toThrow(/duree-ms/)
    expect(() => normaliserDuel(duel({ coutUsd: 'gratuit' }))).toThrow(/cout-usd/)
    expect(() => normaliserDuel(duel({ dureeMs: undefined }))).toThrow(/duree-ms/)
  })

  it('rend les duels du plus recent au plus ancien, filtrables', () => {
    const r = racineTmp()
    noterDuel(duel({ tache: 'tache alpha' }), r)
    noterDuel(duel({ tache: 'tache beta', workflow: 'terrain->build' }), r)
    expect(lireDuels({}, r).duels[0].tache).toBe('tache beta')
    expect(lireDuels({ tache: 'alpha' }, r).duels).toHaveLength(1)
    expect(lireDuels({ workflow: 'terrain' }, r).duels).toHaveLength(1)
    expect(lireDuels({ limite: 1 }, r).duels).toHaveLength(1)
  })

  it('journal absent = corpus vide, pas une erreur', () => {
    const v = lireDuels({}, racineTmp())
    expect(v.duels).toEqual([])
    expect(v.abimees).toBe(0)
  })

  it('une ligne abimee est ignoree et COMPTEE, le reste survit', () => {
    const r = racineTmp()
    noterDuel(duel(), r)
    mkdirSync(join(r, '.autowin-data', 'autowin-os'), { recursive: true })
    writeFileSync(cheminJournal(r), `${readFileSync(cheminJournal(r), 'utf8')}{ceci n est pas du json\n`)
    const v = lireDuels({}, r)
    expect(v.duels).toHaveLength(1)
    expect(v.abimees).toBe(1)
  })
})
