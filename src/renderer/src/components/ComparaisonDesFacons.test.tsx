// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComparaisonDesFacons } from './ComparaisonDesFacons'
import type { ComparaisonDUneFacon } from '../../../shared/essai-trois-facons'

/**
 * LA CARTE DE COMPARAISON ET « GARDER CELLE-CI » (conv-1038, 2026-10-21 — idée 6).
 *
 * Une ligne par façon : son état, l'écart de code depuis la photo, ce que ses vérifications ont
 * rendu, ce qu'elle a coûté. « Garder celle-ci » publie dans main : c'est un geste qui sort du poste,
 * il se CONFIRME.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - UN SEUL clic sur « Garder celle-ci » : rien ne doit partir avant la confirmation ;
 *  - une façon sans changement, ou encore en cours : rien à garder, le bouton est éteint ;
 *  - une publication EN ATTENTE (fichier non commité dans le dossier partagé) : dite comme une
 *    attente, avec ses fichiers — ni comme un échec, ni comme une réussite ;
 *  - un pont d'avant redémarrage sans ces canaux : la carte le dit, au lieu de rester vide.
 */

const LIGNES: ComparaisonDUneFacon[] = [
  {
    id: 'B1',
    ok: true,
    bilan: { etat: 'fini', vertes: 2, rouges: 0 },
    ecart: {
      ok: true,
      fichiers: [
        { chemin: 'a.ts', ajouts: 8, retraits: 2 },
        { chemin: 'b.ts', ajouts: 2, retraits: 0 }
      ],
      ajouts: 10,
      retraits: 2
    },
    ressemblance: { etat: 'mesuree', avec: 3, part: 1, identique: true }
  },
  {
    id: 'B2',
    ok: true,
    bilan: { etat: 'fini', vertes: 0, rouges: 0 },
    ecart: { ok: true, fichiers: [], ajouts: 0, retraits: 0 },
    ressemblance: { etat: 'sans-objet', raison: 'aucun changement à comparer' }
  },
  // B3 n'a pas de ressemblance : la réponse d'un processus principal d'avant ce contrôle.
  {
    id: 'B3',
    ok: true,
    bilan: { etat: 'en-cours', vertes: 0, rouges: 1 },
    ecart: {
      ok: true,
      fichiers: [{ chemin: 'a.ts', ajouts: 1, retraits: 1 }],
      ajouts: 1,
      retraits: 1
    }
  }
]

const FACONS = [
  { id: 'B1', titre: 'Sujet — façon 1/3', rang: 1 },
  { id: 'B2', titre: 'Sujet — façon 2/3', rang: 2 },
  { id: 'B3', titre: 'Sujet — façon 3/3', rang: 3 }
]

let conteneur: HTMLElement
let racine: Root

async function rendre(api: Record<string, unknown> | undefined): Promise<void> {
  ;(window as unknown as { api?: unknown }).api = api
  await act(async () => {
    racine.render(createElement(ComparaisonDesFacons, { facons: FACONS, signature: 's1' }))
    await Promise.resolve()
  })
  await act(async () => {
    await new Promise((fin) => setTimeout(fin, 0))
  })
}

const ligne = (id: string): HTMLElement =>
  conteneur.querySelector(`[data-facon="${id}"]`) as HTMLElement

const bouton = (dans: ParentNode, texte: string): HTMLButtonElement | undefined =>
  Array.from(dans.querySelectorAll('button')).find((element) =>
    element.textContent?.includes(texte)
  ) as HTMLButtonElement | undefined

async function cliquer(element: HTMLElement | undefined): Promise<void> {
  if (!element) throw new Error('bouton introuvable')
  await act(async () => {
    element.click()
    await new Promise((fin) => setTimeout(fin, 0))
  })
}

function api(garder: unknown = vi.fn()): Record<string, unknown> {
  return {
    conversationComparerLesFacons: vi.fn().mockResolvedValue(LIGNES),
    costBreakdown: vi.fn(async (_dimension: string, id: string) =>
      id === 'B1'
        ? [
            { costUsd: 0.5, unpricedCalls: 0 },
            { costUsd: 0.25, unpricedCalls: 0 }
          ]
        : []
    ),
    conversationGarderEssai: garder
  }
}

describe('ComparaisonDesFacons', () => {
  beforeEach(() => {
    conteneur = document.createElement('div')
    document.body.append(conteneur)
    racine = createRoot(conteneur)
  })
  afterEach(() => {
    act(() => racine.unmount())
    conteneur.remove()
    delete (window as unknown as { api?: unknown }).api
  })

  it('une ligne par façon : état, écart, vérifications, coût', async () => {
    await rendre(api())
    const premiere = ligne('B1').textContent ?? ''
    expect(premiere).toContain('finie')
    expect(premiere).toContain('2 fichiers · +10 −2')
    expect(premiere).toContain('2 vertes')
    expect(premiere).toContain('0,75 $')
    expect(ligne('B2').textContent).toContain('aucun changement')
    expect(ligne('B3').textContent).toContain('en cours')
    expect(ligne('B3').textContent).toContain('inconnu')
  })

  /*
   * LE CONTRÔLE DE RESSEMBLANCE (conv-1057, 2026-10-22) : deux façons au même code doivent se voir
   * d'un coup d'œil, sans comparer les chiffres à la main.
   */
  it('ressemblance : une façon identique à une autre est dite et mise en évidence', async () => {
    await rendre(api())
    const premiere = ligne('B1').querySelector('[data-mesure="ressemblance"]')
    expect(premiere?.textContent).toBe('identique à la façon 3')
    expect(premiere?.classList.contains('is-proche')).toBe(true)
    const deuxieme = ligne('B2').querySelector('[data-mesure="ressemblance"]')
    expect(deuxieme?.textContent).toBe('aucun changement à comparer')
    expect(deuxieme?.classList.contains('is-proche')).toBe(false)
    expect(ligne('B3').querySelector('[data-mesure="ressemblance"]')?.textContent).toBe(
      'Autowin doit redémarrer pour la mesurer'
    )
  })

  it('rien à garder (aucun changement, ou tour en cours) : le bouton est éteint', async () => {
    await rendre(api())
    expect(bouton(ligne('B1'), 'Garder celle-ci')?.disabled).toBe(false)
    expect(bouton(ligne('B2'), 'Garder celle-ci')?.disabled).toBe(true)
    expect(bouton(ligne('B3'), 'Garder celle-ci')?.disabled).toBe(true)
  })

  it('un seul clic ne publie rien : il faut confirmer', async () => {
    const garder = vi.fn().mockResolvedValue({
      ok: true,
      etat: 'publie',
      sha: 'abcdef1234',
      fichiers: ['a.ts', 'b.ts']
    })
    await rendre(api(garder))
    await cliquer(bouton(ligne('B1'), 'Garder celle-ci'))
    expect(garder).not.toHaveBeenCalled()
    expect(conteneur.textContent).toContain('Publier cette façon dans main ?')
    await cliquer(bouton(conteneur, 'Oui, publier'))
    expect(garder).toHaveBeenCalledWith('B1')
    expect(ligne('B1').textContent).toContain('Publiée dans main (abcdef1)')
  })

  it('« Annuler » referme la confirmation sans rien envoyer', async () => {
    const garder = vi.fn()
    await rendre(api(garder))
    await cliquer(bouton(ligne('B1'), 'Garder celle-ci'))
    await cliquer(bouton(conteneur, 'Annuler'))
    expect(garder).not.toHaveBeenCalled()
    expect(conteneur.textContent).not.toContain('Publier cette façon dans main ?')
  })

  it('une publication en attente est dite comme une attente, avec ses fichiers', async () => {
    const garder = vi.fn().mockResolvedValue({
      ok: true,
      etat: 'en-attente',
      fichiers: ['a.ts'],
      detail: 'a.ts : modifié et non commité dans le dossier partagé par un autre travail.'
    })
    await rendre(api(garder))
    await cliquer(bouton(ligne('B1'), 'Garder celle-ci'))
    await cliquer(bouton(conteneur, 'Oui, publier'))
    const texte = ligne('B1').textContent ?? ''
    expect(texte).toContain('En attente')
    expect(texte).toContain('a.ts : modifié et non commité')
    expect(texte).not.toContain('Publiée dans main')
  })

  it('un refus est dit avec sa raison', async () => {
    const garder = vi.fn().mockResolvedValue({ ok: false, raison: 'conflit sur a.ts' })
    await rendre(api(garder))
    await cliquer(bouton(ligne('B1'), 'Garder celle-ci'))
    await cliquer(bouton(conteneur, 'Oui, publier'))
    expect(ligne('B1').textContent).toContain('Non publiée : conflit sur a.ts')
  })

  it('un pont sans ces canaux : la carte demande un redémarrage au lieu de rester vide', async () => {
    await rendre({})
    expect(conteneur.textContent).toContain('Autowin doit redémarrer')
  })
})
