import { describe, expect, it } from 'vitest'
import {
  decideRead,
  executeRead,
  rechercherDansFichiers,
  RANGE_MAX,
  CORRESPONDANCES_MAX
} from './read-file-command'

/**
 * La lecture qui manquait au catalogue : un agent pouvait ÉDITER sans pouvoir LIRE (mesuré sur les
 * runs du scout de veille, conv-1154/1155/1156). Mêmes bornes que l'écriture.
 */
const ws = 'C:/ws'

describe('decideRead — les refus', () => {
  it('refuse hors workspace, traversée et zones interdites', () => {
    expect(decideRead({ path: '../secret.txt' }, ws)).toMatchObject({ allowed: false })
    expect(decideRead({ path: 'C:/ailleurs/x.ts' }, ws)).toMatchObject({ allowed: false })
    expect(decideRead({ path: '.git/config' }, ws)).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('protégé')
    })
    expect(decideRead({ path: '.autowin-data/autowin-os/auth.json' }, ws)).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('sensible')
    })
    expect(decideRead({}, ws)).toMatchObject({ allowed: false })
    expect(decideRead({ path: 'src/a.ts' }, undefined)).toMatchObject({ allowed: false })
  })

  it('accepte un chemin du workspace et borne la plage', () => {
    const d = decideRead({ path: 'src/a.ts', from: 10, lines: 100000 }, ws)
    expect(d).toMatchObject({ allowed: true, from: 10, count: RANGE_MAX })
  })

  it('les traces de données restent lisibles : .autowin-data n’est pas une zone interdite', () => {
    expect(decideRead({ path: '.autowin-data/autowin-os/cost.jsonl' }, ws)).toMatchObject({
      allowed: true
    })
  })
})

describe('executeRead — lignes numérotées, citables avec ancrage', () => {
  const decision = decideRead({ path: 'src/a.ts', from: 2, lines: 2 }, ws)
  it('rend la plage demandée, numérotée, et dit si elle est tronquée', () => {
    if (!decision.allowed) throw new Error('décision attendue positive')
    const lu = executeRead(decision, () => 'un\ndeux\ntrois\nquatre')
    expect(lu).toMatchObject({ contenu: '2→deux\n3→trois', totalLignes: 4, tronque: true })
  })
  it('un fichier absent est une erreur NOMMÉE', () => {
    if (!decision.allowed) throw new Error('décision attendue positive')
    expect(executeRead(decision, () => null)).toMatchObject({
      erreur: expect.stringContaining('introuvable')
    })
  })
})

describe('rechercherDansFichiers — bornée et sourde aux zones interdites', () => {
  it('trouve avec chemin:ligne, saute les zones interdites, tronque au plafond', () => {
    const fichiers = ['src/a.ts', '.git/config', 'src/b.ts']
    const lire = (chemin: string): string =>
      chemin === 'src/a.ts' ? 'rien\nmotif ici' : 'motif partout'
    const r = rechercherDansFichiers('motif', fichiers, lire)
    expect(r.correspondances).toEqual([
      { chemin: 'src/a.ts', ligne: 2, texte: 'motif ici' },
      { chemin: 'src/b.ts', ligne: 1, texte: 'motif partout' }
    ])
    const beaucoup = rechercherDansFichiers(
      'x',
      Array.from({ length: 200 }, (_, i) => `src/f${i}.ts`),
      () => 'x'
    )
    expect(beaucoup.correspondances).toHaveLength(CORRESPONDANCES_MAX)
    expect(beaucoup.tronque).toBe(true)
  })
  it('un motif invalide rend une erreur nommée, pas un crash', () => {
    expect(rechercherDansFichiers('([', ['src/a.ts'], () => 'x').erreur).toContain('illisible')
  })
})
