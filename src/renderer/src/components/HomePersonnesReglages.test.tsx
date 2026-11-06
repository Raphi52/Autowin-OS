// @vitest-environment happy-dom
/**
 * LES DEUX LISTES DE PERSONNES DES RÉGLAGES DE L'ACCUEIL (demande utilisateur du 2026-11-05) :
 * « afficher les agents de » change la scène de ce poste ; « afficher mes agents à » envoie au processus
 * principal la liste des postes à qui mes agents sont masqués.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PresencesDesCollegues } from '../../../shared/quartier-presence'
import { lireMasquesLocaux, oublierAgentsCollegues } from '../quartier/agents-collegues'
import { reinitialiserMesAgentsMasques } from '../quartier/mes-agents-masques'
import { HomePersonnesReglages } from './HomePersonnesReglages'

const PAR_DEFAUT: NonNullable<PresencesDesCollegues['personnes']> = [
  { poste: 'bob', prenom: 'Bob', enLigne: true },
  { poste: 'carol', prenom: 'Carol', enLigne: false }
]
let presences: PresencesDesCollegues = { collegues: [], personnes: PAR_DEFAUT }

let racine: ReturnType<typeof createRoot> | null = null
let masques: string[] = []
const quartierPresenceMasques = vi.fn(async (postes: string[]) => {
  masques = postes
  return { masquerPresencePour: postes }
})

beforeEach(() => {
  masques = ['dan']
  presences = { collegues: [], personnes: PAR_DEFAUT }
  quartierPresenceMasques.mockClear()
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    presenceDesCollegues: async () => presences,
    boardDossier: async () => ({ masquerPresencePour: masques }),
    quartierPresenceMasques
  }
})

afterEach(() => {
  if (racine) act(() => racine?.unmount())
  racine = null
  document.body.innerHTML = ''
  oublierAgentsCollegues()
  reinitialiserMesAgentsMasques()
  window.localStorage.clear()
})

async function monter(): Promise<HTMLElement> {
  const conteneur = document.createElement('div')
  document.body.appendChild(conteneur)
  racine = createRoot(conteneur)
  await act(async () => {
    racine?.render(createElement(HomePersonnesReglages))
  })
  // La relecture du partage et du réglage sont des promesses : on les laisse aboutir.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return conteneur
}

const caseDe = (c: HTMLElement, id: string): HTMLInputElement => {
  const el = c.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`case absente : ${id}`)
  return el
}

describe('HomePersonnesReglages', () => {
  it('une ligne par personne, ses deux cases cochées par défaut, et qui est hors ligne', async () => {
    const c = await monter()
    expect(caseDe(c, 'home-agents-de-bob').checked).toBe(true)
    expect(caseDe(c, 'home-agents-de-carol').checked).toBe(true)
    // Une seule ligne par personne : ses deux interrupteurs sont dans la même rangée.
    const ligneBob = caseDe(c, 'home-agents-de-bob').closest('tr')
    expect(ligneBob?.contains(caseDe(c, 'home-mes-agents-a-bob'))).toBe(true)
    expect(caseDe(c, 'home-agents-de-carol').closest('tr')?.textContent).toContain('hors ligne')
    // Bob, Carol, et Dan (masqué, absent du partage) : trois lignes, pas six.
    expect(c.querySelectorAll('tbody tr')).toHaveLength(3)
    // L'en-tête compte les cases cochées : Dan ne voit pas mes agents.
    expect(c.querySelector('[data-testid="home-agents-de"]')?.textContent).toContain('3/3')
    expect(c.querySelector('[data-testid="home-mes-agents-a"]')?.textContent).toContain('2/3')
    // Peu de monde : pas de champ de recherche.
    expect(c.querySelector('[data-testid="home-personnes-recherche"]')).toBeNull()
  })

  it('décocher dans « afficher les agents de » ne touche que ce poste', async () => {
    const c = await monter()
    await act(async () => caseDe(c, 'home-agents-de-bob').click())
    expect(lireMasquesLocaux()).toEqual(['bob'])
    expect(caseDe(c, 'home-agents-de-bob').checked).toBe(false)
    expect(quartierPresenceMasques).not.toHaveBeenCalled()
  })

  it('« afficher mes agents à » envoie la liste, et garde listé un masqué absent du partage', async () => {
    const c = await monter()
    // Dan n'a plus de fichier sur le partage, mais il est masqué : il reste là pour être recoché.
    expect(caseDe(c, 'home-mes-agents-a-dan').checked).toBe(false)
    await act(async () => caseDe(c, 'home-mes-agents-a-bob').click())
    expect(quartierPresenceMasques).toHaveBeenLastCalledWith(['dan', 'bob'])
    expect(caseDe(c, 'home-mes-agents-a-bob').checked).toBe(false)
    await act(async () => caseDe(c, 'home-mes-agents-a-dan').click())
    expect(quartierPresenceMasques).toHaveBeenLastCalledWith(['bob'])
  })

  it('sans personne, ni tableau ni légende des colonnes : juste le constat', async () => {
    presences = { collegues: [], personnes: [] }
    masques = []
    const c = await monter()
    expect(c.querySelector('table')).toBeNull()
    expect(c.textContent).toContain('Aucun collègue')
    expect(c.querySelector('.home-personnes__aide')).toBeNull()
  })

  it('au-delà de six personnes, une recherche filtre sans tenir compte des accents', async () => {
    presences = {
      collegues: [],
      personnes: ['Alice', 'Bob', 'Carol', 'Dora', 'Émile', 'Fanny', 'Gaston'].map((prenom) => ({
        poste: prenom
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase(),
        prenom,
        enLigne: true
      }))
    }
    masques = []
    const c = await monter()
    const champ = c.querySelector<HTMLInputElement>('[data-testid="home-personnes-recherche"]')
    if (!champ) throw new Error('recherche absente')
    const taper = async (texte: string): Promise<void> => {
      const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      await act(async () => {
        poser?.call(champ, texte)
        champ.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await taper('emi')
    expect(c.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(caseDe(c, 'home-agents-de-emile').checked).toBe(true)
    // Les comptes portent sur toute la liste, pas sur le filtre.
    expect(c.querySelector('[data-testid="home-agents-de"]')?.textContent).toContain('7/7')
    await taper('zzz')
    expect(c.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(c.querySelector('[data-testid="home-personnes-aucune-trouvee"]')?.textContent).toContain(
      'zzz'
    )
  })
})
