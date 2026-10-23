// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'
import { RiviereDuProjet } from './RiviereDuProjet'
import { CLE_ETATS_MANUELS_CARTE } from './etats-manuels-carte'
import type { BilanDeVerification } from './verification-du-board'

/**
 * LES BOUTONS « VÉRIFIER » DU BOARD (conv-1136, 2026-10-23 : « un bouton pour tout vérifier et un
 * bouton vérifier sur un post it pour le faire quitter la ligne à vérifier », « et vérifier
 * manuellement »). Fichier à part : les autres tests de la rivière sont édités par d'autres fils.
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : « Tout vérifier » qui part sans confirmation, qui vise un
 * post-it hors de la ligne ou qui ne dit pas combien ; « Vérifier » qui n'envoie pas le fil du
 * post-it ; « Vérifié à la main » qui laisse le post-it dans la ligne ou le compte comme prouvé ;
 * des boutons sur un post-it qui n'est pas « À vérifier ».
 */

const MAINTENANT = new Date(2026, 9, 23, 15, 0).getTime()
const HEURE = 3_600_000

const demande = (
  conversationId: string,
  statut: StatutDemande,
  debut: number
): DemandeDeLaCarte => ({
  conversationId,
  conversationTitre: `Fil ${conversationId}`,
  rang: 1,
  titre: `demande ${conversationId}`,
  statut,
  constat: 'fini sans vérification',
  debut,
  demandeur: { cle: 'raph@x', nom: 'Raph', origine: 'journal' }
})

function carte(): CarteDesBesoins {
  const demandes = [
    demande('conv-1', 'sans-preuve', MAINTENANT - 2 * HEURE),
    demande('conv-2', 'sans-preuve', MAINTENANT - 3 * HEURE),
    demande('conv-3', 'prouve', MAINTENANT - 4 * HEURE)
  ]
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: 3,
    demandes,
    runsBloques: [],
    comptes: { prouve: 1, refuse: 0, 'en-cours': 0, 'sans-preuve': 2 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 3,
    demandeurs: [{ cle: 'raph@x', nom: 'Raph', demandes: 3 }],
    demandesJournalisees: 3,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

describe('RiviereDuProjet — vérifier depuis le Board', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  beforeEach(() => window.localStorage.removeItem(CLE_ETATS_MANUELS_CARTE))
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
  })

  const bilanOk = (ids: readonly string[]): BilanDeVerification => ({
    lances: [...ids],
    echecs: []
  })

  async function monter(
    verifier?: (ids: readonly string[]) => Promise<BilanDeVerification>
  ): Promise<HTMLDivElement> {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(
        createElement(RiviereDuProjet, {
          carte: carte(),
          ouvrir: vi.fn(),
          ...(verifier ? { verifier } : {})
        })
      )
    )
    return el
  }

  const postit = (el: HTMLElement, id: string): HTMLElement =>
    el.querySelector(`[data-testid="riviere-postit"][data-conversation="${id}"]`) as HTMLElement
  const gestes = (el: HTMLElement, id: string): HTMLElement | null =>
    el.querySelector(`[data-testid="riviere-verif-postit"][data-verif-conversation="${id}"]`)
  const cliquer = async (cible: Element | null): Promise<void> => {
    expect(cible).not.toBeNull()
    await act(async () => (cible as HTMLElement).click())
  }

  it('« Tout vérifier » compte la ligne, demande confirmation, puis envoie ses seuls fils', async () => {
    const verifier = vi.fn(async (ids: readonly string[]) => bilanOk(ids))
    const el = await monter(verifier)
    const bouton = el.querySelector('[data-testid="riviere-tout-verifier"]')
    expect(bouton?.textContent).toBe('Tout vérifier · 2')
    await cliquer(bouton)
    // Rien ne part avant la confirmation, qui dit le nombre de tours payés.
    expect(verifier).not.toHaveBeenCalled()
    expect(el.textContent).toContain('Lancer /check dans 2 fils ?')
    await cliquer(el.querySelector('[data-testid="riviere-tout-verifier-confirmer"]'))
    expect(verifier).toHaveBeenCalledTimes(1)
    expect([...verifier.mock.calls[0][0]].sort()).toEqual(['conv-1', 'conv-2'])
    expect(el.querySelector('[data-testid="riviere-verif-bilan"]')?.textContent).toBe(
      '/check lancé dans 2 fils'
    )
  })

  it('« Vérifier » sur un post-it n’envoie que son fil', async () => {
    const verifier = vi.fn(async (ids: readonly string[]) => bilanOk(ids))
    const el = await monter(verifier)
    await cliquer(gestes(el, 'conv-2')?.querySelector('[data-testid="riviere-verifier"]') ?? null)
    expect(verifier).toHaveBeenCalledWith(['conv-2'])
  })

  it('les gestes d’un post-it ne se montrent qu’à son survol', async () => {
    const el = await monter(vi.fn(async (ids: readonly string[]) => bilanOk(ids)))
    expect(gestes(el, 'conv-1')?.dataset.visible).toBeUndefined()
    await act(async () => {
      postit(el, 'conv-1').dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, pointerId: 1 })
      )
    })
    expect(gestes(el, 'conv-1')?.dataset.visible).toBe('true')
    expect(gestes(el, 'conv-2')?.dataset.visible).toBeUndefined()
  })

  it('un post-it hors de la ligne « À vérifier » n’a pas ces boutons', async () => {
    const el = await monter(vi.fn(async (ids: readonly string[]) => bilanOk(ids)))
    expect(gestes(el, 'conv-1')).not.toBeNull()
    expect(gestes(el, 'conv-3')).toBeNull()
  })

  it('« Vérifié à la main » fait quitter la ligne, posé à la main et jamais compté prouvé', async () => {
    const el = await monter(vi.fn(async (ids: readonly string[]) => bilanOk(ids)))
    await cliquer(
      gestes(el, 'conv-1')?.querySelector('[data-testid="riviere-verifie-a-la-main"]') ?? null
    )
    expect(postit(el, 'conv-1').dataset.etage).toBe('prouve')
    expect(postit(el, 'conv-1').dataset.manuel).toBe('1')
    expect(gestes(el, 'conv-1')).toBeNull()
    expect(el.querySelector('[data-testid="riviere-tout-verifier"]')?.textContent).toBe(
      'Tout vérifier · 1'
    )
  })

  it('la fiche d’un post-it « À vérifier » porte les deux gestes, libellés entiers', async () => {
    const verifier = vi.fn(async (ids: readonly string[]) => bilanOk(ids))
    const el = await monter(verifier)
    await cliquer(postit(el, 'conv-1'))
    const fiche = el.querySelector('[data-testid="riviere-verif-fiche"]')
    expect(fiche?.textContent).toContain('Vérifier (/check)')
    expect(fiche?.textContent).toContain('Vérifié à la main')
    await cliquer(fiche?.querySelector('[data-testid="riviere-verifier"]') ?? null)
    expect(verifier).toHaveBeenCalledWith(['conv-1'])
  })

  it('la fiche, plus haute avec ses gestes, se pose d’après sa hauteur réelle et ne déborde pas du tableau', async () => {
    // Capture du 24/10 : placée comme si elle faisait 240 px, la fiche « À vérifier » rognait
    // « Ouvrir le fil » sous le bas du tableau. happy-dom ne mesure rien : la hauteur est simulée.
    const avant = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('riviere-fiche') ? 300 : 0
      }
    })
    try {
      const el = await monter(vi.fn(async (ids: readonly string[]) => bilanOk(ids)))
      await cliquer(postit(el, 'conv-1'))
      const fiche = el.querySelector('[data-testid="riviere-fiche"]') as HTMLElement
      const hauteur = parseFloat(
        (el.querySelector('[data-testid="riviere-tableau"]') as HTMLElement).style.height
      )
      const haut = parseFloat(fiche.style.top)
      const max = parseFloat(fiche.style.maxHeight)
      expect(Number.isFinite(max)).toBe(true)
      expect(haut + Math.min(300, max)).toBeLessThanOrEqual(hauteur)
    } finally {
      if (avant) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', avant)
      else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
    }
  })

  it('sans geste de vérification fourni : pas de « Tout vérifier », ni de « Vérifier »', async () => {
    const el = await monter()
    expect(el.querySelector('[data-testid="riviere-tout-verifier"]')).toBeNull()
    expect(el.querySelector('[data-testid="riviere-verifier"]')).toBeNull()
    // « Vérifié à la main » ne dépend d'aucun envoi : il reste.
    expect(
      gestes(el, 'conv-1')?.querySelector('[data-testid="riviere-verifie-a-la-main"]') ?? null
    ).not.toBeNull()
  })
})
