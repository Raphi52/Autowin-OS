// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { GesteNavigateur } from '../../../shared/navigateur'
import { appliquerLangue } from '../langue'
import { FriseGestesNavigateur } from './FriseGestesNavigateur'
import { gestesDeLOnglet, rangDuGeste, tempsDepuis } from './navigateur-integre-outils'

/**
 * FRISE DES GESTES DE L'AGENT (conv-1286, maquette « 1 · Jalons », 2026-10-30).
 *
 * Entrées qui doivent faire échouer ce fichier : une frise affichée sans geste, les gestes d'un autre
 * onglet mêlés à ceux de l'onglet actif, un jalon dont la classe ne dit plus sa nature ou son état
 * (l'utilisateur lit ces points de loin), le temps compté depuis un geste qui n'est plus affiché.
 */

const T0 = 1_800_000_000_000

function geste(id: string, partiel: Partial<GesteNavigateur> = {}): GesteNavigateur {
  return {
    id,
    ongletId: 'onglet-1',
    verbe: 'clic',
    nature: 'agit',
    description: 'cliquer sur bouton « Envoyer »',
    etat: 'fait',
    debut: T0,
    ...partiel
  }
}

describe('FriseGestesNavigateur', () => {
  let racine: Root | null = null
  let conteneur: HTMLDivElement | null = null

  afterEach(async () => {
    if (racine) await act(async () => racine?.unmount())
    racine = null
    conteneur?.remove()
    conteneur = null
    appliquerLangue('fr')
  })

  async function rendre(gestes: GesteNavigateur[], ongletActif: string | null = 'onglet-1') {
    conteneur = document.createElement('div')
    document.body.append(conteneur)
    racine = createRoot(conteneur)
    await act(async () => {
      racine?.render(createElement(FriseGestesNavigateur, { gestes, ongletActif }))
    })
    return conteneur
  }

  const jalons = (): Element[] => [...conteneur!.querySelectorAll('.navigateur-jalon')]
  const verbes = (): string[] =>
    [...conteneur!.querySelectorAll('.navigateur-jalon-verbe')].map((v) => v.textContent ?? '')
  const temps = (): string[] =>
    [...conteneur!.querySelectorAll('.navigateur-jalon-temps')].map((v) => v.textContent ?? '')

  it('rien n’est rendu sans geste', async () => {
    expect((await rendre([])).childElementCount).toBe(0)
  })

  it('jumeau : les gestes d’un AUTRE onglet ne comptent pas', async () => {
    expect((await rendre([geste('g1', { ongletId: 'onglet-2' })])).childElementCount).toBe(0)
  })

  it('n’affiche que l’onglet actif, dans l’ordre des gestes', async () => {
    await rendre([
      geste('g1', { verbe: 'ouvrir' }),
      geste('g2', { verbe: 'lire', nature: 'lit', ongletId: 'onglet-2' }),
      geste('g3', { verbe: 'saisir' })
    ])
    expect(verbes()).toEqual(['ouvrir', 'saisir'])
  })

  it('un geste sans onglet (fil vide, ouverture en attente) se voit tant qu’aucun onglet n’est actif', async () => {
    await rendre([geste('g1', { verbe: 'ouvrir', ongletId: '', etat: 'prochain' })], null)
    expect(verbes()).toEqual(['ouvrir'])
  })

  it('classes : la nature, puis l’état quand il n’est pas « fait »', async () => {
    await rendre([
      geste('g1', { verbe: 'lire', nature: 'lit' }),
      geste('g2', { verbe: 'clic' }),
      geste('g3', { verbe: 'capture', nature: 'lit', etat: 'en-cours' }),
      geste('g4', { verbe: 'saisir', etat: 'prochain' }),
      geste('g5', { verbe: 'touche', etat: 'refuse' })
    ])
    expect(jalons().map((j) => [...j.classList].slice(1))).toEqual([
      ['lit'],
      ['agit'],
      ['lit', 'en-cours'],
      ['agit', 'prochain'],
      ['agit', 'refuse']
    ])
  })

  it('six gestes au plus, les derniers, et le temps part du premier AFFICHÉ', async () => {
    await rendre(
      Array.from({ length: 8 }, (_, i) =>
        geste(`g${i + 1}`, { verbe: i === 0 ? 'ouvrir' : 'clic', debut: T0 + i * 30_000 })
      )
    )
    expect(jalons()).toHaveLength(6)
    expect(verbes()).not.toContain('ouvrir')
    expect(temps()).toEqual(['0:00', '0:30', '1:00', '1:30', '2:00', '2:30'])
  })

  it('le détail du geste se lit au survol', async () => {
    await rendre([geste('g1')])
    expect(jalons()[0].getAttribute('title')).toBe('cliquer sur bouton « Envoyer »')
  })

  it('légende de la maquette, mot pour mot', async () => {
    await rendre([geste('g1')])
    expect(conteneur!.querySelector('.navigateur-frise-legende')?.textContent).toBe(
      'lit · agit · ◎ en cours · ○ prochain'
    )
  })

  it('verbes et légende suivent la langue de l’interface', async () => {
    appliquerLangue('en')
    await rendre([geste('g1', { verbe: 'defiler', nature: 'lit' })])
    expect(verbes()).toEqual(['scroll'])
    expect(conteneur!.querySelector('.navigateur-frise-legende')?.textContent).toBe(
      'reads · acts · ◎ in progress · ○ next'
    )
  })

  it('défiler garde son accent à l’écran (le verbe du contrat n’en a pas)', async () => {
    await rendre([geste('g1', { verbe: 'defiler', nature: 'lit' })])
    expect(verbes()).toEqual(['défiler'])
  })
})

describe('tempsDepuis — le temps sous un jalon', () => {
  it('m:ss, minutes sans zéro devant, secondes sur deux chiffres', () => {
    expect(tempsDepuis(T0, T0)).toBe('0:00')
    expect(tempsDepuis(T0 + 2_900, T0)).toBe('0:02')
    expect(tempsDepuis(T0 + 65_000, T0)).toBe('1:05')
    expect(tempsDepuis(T0 + 600_000, T0)).toBe('10:00')
  })
  it('jumeau : un geste horodaté avant l’origine reste à 0:00, jamais « -1:59 »', () => {
    expect(tempsDepuis(T0 - 5_000, T0)).toBe('0:00')
  })
})

describe('gestesDeLOnglet', () => {
  it('garde l’ordre et filtre sur l’onglet', () => {
    const a = geste('a')
    const b = geste('b', { ongletId: 'onglet-2' })
    expect(gestesDeLOnglet([a, b], 'onglet-2')).toEqual([b])
  })
  it('jumeau : aucun onglet actif → seulement les gestes sans onglet', () => {
    const a = geste('a')
    const b = geste('b', { ongletId: '' })
    expect(gestesDeLOnglet([a, b], null)).toEqual([b])
  })
})

describe('rangDuGeste — « geste N / M » du bandeau', () => {
  it('N est le geste qui attend, M le nombre de gestes de l’onglet', () => {
    expect(
      rangDuGeste([geste('a'), geste('b'), geste('c', { etat: 'prochain' }), geste('d')])
    ).toEqual({ n: 3, m: 4 })
  })
  it('deux gestes en attente : le premier, celui que « Pas suivant » va jouer', () => {
    expect(
      rangDuGeste([geste('a', { etat: 'prochain' }), geste('b', { etat: 'prochain' })])
    ).toEqual({ n: 1, m: 2 })
  })
  it('jumeau : rien n’attend → le dernier geste joué', () => {
    expect(rangDuGeste([geste('a'), geste('b')])).toEqual({ n: 2, m: 2 })
  })
  it('jumeau : aucun geste → pas de rang (le bandeau dit seulement « en pause »)', () => {
    expect(rangDuGeste([])).toBeNull()
  })
})

/*
 * happy-dom n'applique pas la feuille de style : sans ce contrôle, un jalon « lit » peint en doré
 * resterait vert ici. Le rendu réel est prouvé par la capture.
 */
describe('FriseGestesNavigateur.css — le code couleur de la frise', () => {
  const css = readFileSync('src/renderer/src/components/FriseGestesNavigateur.css', 'utf8')
  const regle = (selecteur: string): string => {
    const debut = css.indexOf(`${selecteur} {`)
    expect(debut, `règle absente : ${selecteur}`).toBeGreaterThanOrEqual(0)
    return css.slice(debut, css.indexOf('}', debut))
  }

  it('froid = lit, accent = agit, rouge = refusé : variables du thème', () => {
    expect(regle('.navigateur-jalon.lit')).toContain('var(--cyan)')
    expect(regle('.navigateur-jalon.agit')).toContain('var(--gold)')
    expect(regle('.navigateur-jalon.refuse')).toContain('var(--err)')
  })

  it('le refus l’emporte sur la nature : sa règle vient après', () => {
    expect(css.indexOf('.navigateur-jalon.refuse {')).toBeGreaterThan(
      css.indexOf('.navigateur-jalon.agit {')
    )
  })

  it('double cercle en cours, cercle creux en attente : deux dessins distincts', () => {
    const enCours = regle('.navigateur-jalon.en-cours .navigateur-jalon-point')
    const prochain = regle('.navigateur-jalon.prochain .navigateur-jalon-point')
    expect(enCours).toContain('radial-gradient')
    expect(prochain).toContain('radial-gradient')
    expect(enCours).not.toBe(prochain)
  })

  it('aucune couleur en dur : le thème décide de tout', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
  })

  it('aucune taille cachée dans `font:` : le plancher malvoyant ne la verrait pas', () => {
    expect(css).not.toMatch(/^\s*font:(?!\s*inherit)/m)
  })
})
