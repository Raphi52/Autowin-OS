import { describe, expect, it } from 'vitest'
import {
  FILS_EN_PARALLELE_MAX,
  cleDuLancement,
  lireBlocFils,
  planDesFils,
  texteDeLaTache,
  type TacheDeFil
} from './lancer-en-fils'

const t = (titre: string, fichiers: string[] = [], demande = `fais ${titre}`): TacheDeFil => ({
  titre,
  demande,
  fichiers
})

describe('lancer-en-fils — lecture du bloc ```aw-fils', () => {
  it('lit les tâches, avec leurs fichiers', () => {
    const lu = lireBlocFils(
      JSON.stringify({
        taches: [
          { titre: 'Titre Tickets', demande: 'corrige le titre', fichiers: ['src/a.ts'] },
          { titre: 'Tri', demande: 'ajoute le tri' }
        ]
      })
    )
    expect(lu).toEqual({
      taches: [
        { titre: 'Titre Tickets', demande: 'corrige le titre', fichiers: ['src/a.ts'] },
        { titre: 'Tri', demande: 'ajoute le tri', fichiers: [] }
      ]
    })
  })

  it('refuse une source illisible au lieu de la deviner', () => {
    expect(lireBlocFils('{"taches": [')).toHaveProperty('erreur')
    expect(lireBlocFils('{}')).toHaveProperty('erreur')
    expect(lireBlocFils('{"taches": [{"titre": "x"}]}')).toHaveProperty('erreur')
    expect(lireBlocFils('{"taches": [{"titre": "", "demande": "y"}]}')).toHaveProperty('erreur')
    expect(
      lireBlocFils('{"taches": [{"titre": "x", "demande": "y", "fichiers": "a"}]}')
    ).toHaveProperty('erreur')
  })
})

describe('lancer-en-fils — le plan des fils', () => {
  it('deux tâches sur des fichiers distincts : deux fils', () => {
    const plan = planDesFils([t('A', ['src/a.ts']), t('B', ['src/b.ts'])])
    expect(plan.map((fil) => fil.taches.map((tache) => tache.titre))).toEqual([['A'], ['B']])
  })

  it('deux tâches sur le même fichier : un seul fil, la seconde à la suite', () => {
    const plan = planDesFils([t('A', ['src/a.ts']), t('B', ['src/a.ts', 'src/b.ts'])])
    expect(plan.map((fil) => fil.taches.map((tache) => tache.titre))).toEqual([['A', 'B']])
  })

  it('le lien est transitif : A–B par un fichier, B–C par un autre = un seul fil', () => {
    const plan = planDesFils([
      t('A', ['src/a.ts']),
      t('D', ['src/d.ts']),
      t('B', ['src/a.ts', 'src/b.ts']),
      t('C', ['src/b.ts'])
    ])
    expect(plan.map((fil) => fil.taches.map((tache) => tache.titre))).toEqual([
      ['A', 'B', 'C'],
      ['D']
    ])
  })

  it('un même fichier écrit autrement (antislash, ./, casse) est reconnu', () => {
    const plan = planDesFils([t('A', ['.\\src\\Vue.tsx']), t('B', ['src/vue.tsx'])])
    expect(plan).toHaveLength(1)
  })

  it('une tâche écrite deux fois ne compte qu’une fois', () => {
    const plan = planDesFils([
      t('A', ['src/a.ts'], 'corrige  le titre'),
      t('A bis', ['src/z.ts'], 'Corrige le titre'),
      t('B', ['src/b.ts'])
    ])
    expect(plan.flatMap((fil) => fil.taches.map((tache) => tache.titre))).toEqual(['A', 'B'])
  })

  it(`au plus ${FILS_EN_PARALLELE_MAX} fils : le reste passe à la suite dans ces fils`, () => {
    const plan = planDesFils(['A', 'B', 'C', 'D', 'E'].map((nom) => t(nom, [`src/${nom}.ts`])))
    expect(plan).toHaveLength(FILS_EN_PARALLELE_MAX)
    expect(plan.map((fil) => fil.taches.map((tache) => tache.titre))).toEqual([
      ['A', 'D'],
      ['B', 'E'],
      ['C']
    ])
  })

  it('une tâche sans fichier connu part seule dans son fil', () => {
    const plan = planDesFils([t('A'), t('B'), t('C', ['src/c.ts'])])
    expect(plan).toHaveLength(3)
  })

  it('moins de deux tâches : aucun plan', () => {
    expect(planDesFils([])).toEqual([])
    expect(planDesFils([t('A', ['src/a.ts'])])).toEqual([])
    expect(planDesFils([t('A', [], 'x'), t('A2', [], 'x')])).toEqual([])
  })
})

describe('lancer-en-fils — le message envoyé à chaque fil', () => {
  it('commence par la demande (une skill en tête reste reconnue) et nomme les autres tâches', () => {
    const texte = texteDeLaTache(t('A', [], '/build corrige le titre'), [t('B'), t('C')])
    expect(texte.startsWith('/build corrige le titre')).toBe(true)
    expect(texte).toContain('« B »')
    expect(texte).toContain('« C »')
    expect(texte).toMatch(/n.y touche pas/u)
  })

  it('sans autre tâche, la demande part telle quelle', () => {
    expect(texteDeLaTache(t('A', [], 'corrige le titre'), [])).toBe('corrige le titre')
  })
})

describe('lancer-en-fils — la clé du lancement', () => {
  it('deux sources identiques donnent la même clé, deux sources différentes deux clés', () => {
    expect(cleDuLancement('{"a":1}')).toBe(cleDuLancement('{"a":1}'))
    expect(cleDuLancement('{"a":1}')).not.toBe(cleDuLancement('{"a":2}'))
  })
})
