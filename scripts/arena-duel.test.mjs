import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cheminJournal,
  cleDuel,
  lireDuels,
  noterDuel,
  normaliserDuel,
  reproductibilite
} from './arena-duel.mjs'

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

  it('refuse de re-noter le meme bras du meme banc deux fois', () => {
    const r = racineTmp()
    const b = { banc: '.autowin-data/x/arena-bench-clean', bras: 'a', workflow: 'A temoin' }
    noterDuel(duel(b), r)
    expect(() => noterDuel(duel(b), r)).toThrow(/DEJA note/)
    expect(() => noterDuel(duel({ ...b, bras: 'b' }), r)).not.toThrow()
  })

  it('une re-notation explicite remplace la ligne au lieu de la doubler', () => {
    const r = racineTmp()
    const b = { banc: '.autowin-data/x/arena-bench-clean', bras: 'a', workflow: 'A temoin' }
    noterDuel(duel({ ...b, tache: 'D:/chemin/windows' }), r)
    noterDuel(duel({ ...b, tache: 'libelle corrige', remplace: true }), r)
    expect(
      readFileSync(cheminJournal(r), 'utf8').trim().split(String.fromCharCode(10))
    ).toHaveLength(2)
    const v = lireDuels({}, r)
    expect(v.duels).toHaveLength(1)
    expect(v.duels[0].tache).toBe('libelle corrige')
    expect(v.remplacees).toBe(1)
    expect(lireDuels({ brut: true }, r).duels).toHaveLength(2)
  })

  it('la cle d un duel ignore la casse et les espaces de bord', () => {
    expect(cleDuel({ banc: ' B ', bras: 'A', workflow: 'W' })).toBe(
      cleDuel({ banc: 'b', bras: 'a', workflow: 'w' })
    )
    // meme banc, meme bras, libelle du workflow corrige = LA MEME mesure
    expect(cleDuel({ banc: 'b', bras: 'a', workflow: 'A temoin' })).toBe(
      cleDuel({ banc: 'b', bras: 'a', workflow: 'A : temoin skill actuelle' })
    )
    // sans banc, seul le workflow distingue
    expect(cleDuel({ bras: 'a', workflow: 'W1' })).not.toBe(cleDuel({ bras: 'a', workflow: 'W2' }))
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
    writeFileSync(
      cheminJournal(r),
      `${readFileSync(cheminJournal(r), 'utf8')}{ceci n est pas du json\n`
    )
    const v = lireDuels({}, r)
    expect(v.duels).toHaveLength(1)
    expect(v.abimees).toBe(1)
  })
})

describe('arena-duel — reproductibilite d un banc rejoue', () => {
  const bancResidus = (banc, gagnant) => [
    {
      tache: 'banc residus v4 — shortlist du code residuel',
      workflow: 'A : skill residus',
      bras: 'a',
      banc,
      dureeMs: 1000,
      coutUsd: 5,
      verdict: gagnant === 'a' ? 'gagnant' : 'perdant'
    },
    {
      tache: 'banc residus v4 — shortlist du code residuel',
      workflow: 'X : balayage direct',
      bras: 'x',
      banc,
      dureeMs: 1000,
      coutUsd: 5,
      verdict: gagnant === 'x' ? 'gagnant' : 'perdant'
    }
  ]

  it('declare NON REPRODUCTIBLE une tache dont deux bancs designent des gagnants differents', () => {
    const r = racineTmp()
    for (const d of [...bancResidus('bench-v4', 'a'), ...bancResidus('bench-v4-rejeu', 'x')])
      noterDuel(d, r)
    const { taches } = reproductibilite({}, r)
    expect(taches).toHaveLength(1)
    expect(taches[0].reproductible).toBe(false)
    expect(taches[0].gagnants.sort()).toEqual(['a', 'x'])
    expect(taches[0].bancs).toBe(2)
  })

  it('declare REPRODUCTIBLE une tache dont les rejeux designent le meme gagnant', () => {
    const r = racineTmp()
    for (const d of [...bancResidus('bench-v4', 'a'), ...bancResidus('bench-v4-rejeu', 'a')])
      noterDuel(d, r)
    const { taches } = reproductibilite({}, r)
    expect(taches[0].reproductible).toBe(true)
    expect(taches[0].gagnants).toEqual(['a'])
  })

  it('ne se prononce PAS sur une tache jouee une seule fois — un banc unique n est pas une preuve', () => {
    const r = racineTmp()
    for (const d of bancResidus('bench-v4', 'a')) noterDuel(d, r)
    const { taches } = reproductibilite({}, r)
    expect(taches[0].reproductible).toBe(null)
    expect(taches[0].bancs).toBe(1)
  })

  it('ignore les re-notations : un meme banc re-note ne compte pas comme un rejeu', () => {
    const r = racineTmp()
    for (const d of bancResidus('bench-v4', 'a')) noterDuel(d, r)
    for (const d of bancResidus('bench-v4', 'x')) noterDuel({ ...d, remplace: true }, r)
    const { taches } = reproductibilite({}, r)
    expect(taches[0].bancs).toBe(1)
    expect(taches[0].reproductible).toBe(null)
  })
})
