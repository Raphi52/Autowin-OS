import { describe, expect, it } from 'vitest'
import {
  coutDesLignes,
  estTresProche,
  faconsDuMemeEssai,
  phraseDeLaRessemblance,
  phraseDeLEcart,
  phraseDesVerifications,
  phraseDuCout
} from './trois-facons'

/**
 * LA CARTE DE COMPARAISON DES FAÇONS (conv-1038, 2026-10-21 — idée 6). Elle relie les branches d'un
 * même essai par le nom de leur copie (`essai__<fil>-<instant>-<rang>`), puis met en mots l'écart de
 * code, les vérifications et le coût de chacune.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - un AUTRE essai du même fil (autre instant) : ce ne sont pas les mêmes façons ;
 *  - un fil `conv-10` à côté de `conv-1` : une clé tirée d'un préfixe les confondrait ;
 *  - un fichier binaire (lignes inconnues) : compté comme fichier, jamais comme « 0 ligne » ;
 *  - un appel sans prix connu : le coût devient un minimum, dit comme tel.
 */

const conv = (
  id: string,
  projectPath?: string
): { id: string; title: string; projectPath?: string } => ({
  id,
  title: `Titre ${id}`,
  ...(projectPath ? { projectPath } : {})
})

const RETOURS = 'D:\\data\\retours-de-tour'

describe('faconsDuMemeEssai', () => {
  const convs = [
    conv('A', 'D:\\AutoWinOS'),
    conv('B3', `${RETOURS}\\essai__conv-1-1000-3`),
    conv('B1', `${RETOURS}\\essai__conv-1-1000-1`),
    conv('B2', `${RETOURS}\\essai__conv-1-1000-2`),
    conv('C', `${RETOURS}\\essai__conv-1-2000-1`),
    conv('D', `${RETOURS}\\essai__conv-10-1000-1`),
    conv('E')
  ]
  it('rend les façons du même essai, rangées par rang', () => {
    expect(faconsDuMemeEssai(convs, 'B2').map((facon) => [facon.id, facon.rang])).toEqual([
      ['B1', 1],
      ['B2', 2],
      ['B3', 3]
    ])
  })
  it('un autre essai du même fil, ou un fil voisin, reste à part', () => {
    expect(faconsDuMemeEssai(convs, 'C').map((facon) => facon.id)).toEqual(['C'])
    expect(faconsDuMemeEssai(convs, 'D').map((facon) => facon.id)).toEqual(['D'])
  })
  it('un fil qui n’est pas une façon n’a pas de carte', () => {
    expect(faconsDuMemeEssai(convs, 'A')).toEqual([])
    expect(faconsDuMemeEssai(convs, 'E')).toEqual([])
    expect(faconsDuMemeEssai(convs, 'inconnu')).toEqual([])
  })
})

describe('les colonnes de la carte, en mots', () => {
  it('écart : fichiers et lignes, un binaire compté à part', () => {
    expect(
      phraseDeLEcart({
        ok: true,
        fichiers: [
          { chemin: 'a.ts', ajouts: 10, retraits: 2 },
          { chemin: 'logo.png', ajouts: null, retraits: null }
        ],
        ajouts: 10,
        retraits: 2
      })
    ).toBe('2 fichiers · +10 −2 · 1 binaire')
    expect(phraseDeLEcart({ ok: true, fichiers: [], ajouts: 0, retraits: 0 })).toBe(
      'aucun changement'
    )
    expect(phraseDeLEcart({ ok: false, raison: 'photo absente' })).toBe(
      'écart illisible : photo absente'
    )
  })
  it('vérifications : vertes et rouges, ou aucune', () => {
    expect(phraseDesVerifications({ etat: 'fini', vertes: 2, rouges: 1 })).toBe(
      '2 vertes · 1 rouge'
    )
    expect(phraseDesVerifications({ etat: 'fini', vertes: 0, rouges: 0 })).toBe('aucune lancée')
  })
  it('coût : la somme des appels, un minimum si un appel n’a pas de prix', () => {
    expect(
      coutDesLignes([
        { costUsd: 0.25, unpricedCalls: 0 },
        { costUsd: 0.5, unpricedCalls: 0 }
      ])
    ).toEqual({ usd: 0.75, partiel: false })
    expect(coutDesLignes([{ costUsd: 0.25, unpricedCalls: 1 }])).toEqual({
      usd: 0.25,
      partiel: true
    })
    expect(coutDesLignes([])).toBeNull()
    expect(phraseDuCout({ usd: 0.75, partiel: false })).toBe('0,75 $')
    expect(phraseDuCout({ usd: 0.25, partiel: true })).toBe('au moins 0,25 $')
    expect(phraseDuCout(null)).toBe('inconnu')
  })

  /*
   * LA RESSEMBLANCE (conv-1057, 2026-10-22). Les arrondis qui mentiraient : 99,6 % affiché « 100 % »
   * pour deux codes qui ne sont PAS identiques, et 0,3 % affiché « 0 % » alors qu'une ligne est
   * commune.
   */
  it('ressemblance : identique, part commune, arrondis honnêtes, sans objet', () => {
    const mesuree = (part: number, identique = false) =>
      ({ etat: 'mesuree', avec: 2, part, identique }) as const
    expect(phraseDeLaRessemblance(mesuree(1, true))).toBe('identique à la façon 2')
    expect(phraseDeLaRessemblance(mesuree(0.62))).toBe('62 % de lignes communes avec la façon 2')
    expect(phraseDeLaRessemblance(mesuree(0.996))).toBe('99 % de lignes communes avec la façon 2')
    expect(phraseDeLaRessemblance(mesuree(1))).toBe('mêmes lignes que la façon 2, code différent')
    expect(phraseDeLaRessemblance(mesuree(0.003))).toBe(
      'moins de 1 % de lignes communes avec la façon 2'
    )
    expect(phraseDeLaRessemblance(mesuree(0))).toBe('aucune ligne commune avec les autres façons')
    expect(
      phraseDeLaRessemblance({ etat: 'sans-objet', raison: 'aucun changement à comparer' })
    ).toBe('aucun changement à comparer')
    expect(phraseDeLaRessemblance(undefined)).toBe('Autowin doit redémarrer pour la mesurer')
  })

  it('très proche : identique, ou au moins 80 % de lignes communes', () => {
    expect(estTresProche({ etat: 'mesuree', avec: 1, part: 1, identique: true })).toBe(true)
    expect(estTresProche({ etat: 'mesuree', avec: 1, part: 0.8, identique: false })).toBe(true)
    expect(estTresProche({ etat: 'mesuree', avec: 1, part: 0.79, identique: false })).toBe(false)
    expect(estTresProche({ etat: 'sans-objet', raison: 'x' })).toBe(false)
    expect(estTresProche(undefined)).toBe(false)
  })
})
