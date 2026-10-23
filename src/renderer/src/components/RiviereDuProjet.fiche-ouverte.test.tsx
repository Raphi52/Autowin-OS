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

/**
 * LE CLIC SUR UNE COLONNE QUAND UNE FICHE EST OUVERTE (conv-1130, 2026-10-23 : « fais que le clic
 * sur une colonne n'agisse pas quand une fiche est ouverte : le premier clic ferme juste la
 * fiche »). Fichier à part : `RiviereDuProjet.test.tsx` était en cours d'édition par un autre fil.
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un premier clic qui ferme la fiche ET déplace la loupe, sur
 * le fond du tableau comme dans la bande des jours ; un second clic, fiche fermée, qui ne la
 * déplace plus.
 */

const MAINTENANT = new Date(2026, 9, 23, 15, 0).getTime()
const HEURE = 3_600_000
const JOUR = 24 * HEURE

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
  constat: 'npm test → exit 0',
  debut,
  demandeur: { cle: 'raph@x', nom: 'Raph', origine: 'journal' }
})

function carte(): CarteDesBesoins {
  const demandes = [
    demande('conv-1', 'sans-preuve', MAINTENANT - 2 * HEURE),
    // Au jour 4 de la frise : sa fiche s'ouvre loin de la loupe d'aujourd'hui.
    demande('conv-3', 'refuse', MAINTENANT - 9 * JOUR)
  ]
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: 2,
    demandes,
    runsBloques: [],
    comptes: { prouve: 0, refuse: 1, 'en-cours': 0, 'sans-preuve': 1 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 2,
    demandeurs: [{ cle: 'raph@x', nom: 'Raph', demandes: 2 }],
    demandesJournalisees: 2,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

describe('RiviereDuProjet — clic sur une colonne, fiche ouverte', () => {
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

  async function monter(): Promise<HTMLDivElement> {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(createElement(RiviereDuProjet, { carte: carte(), ouvrir: vi.fn() }))
    )
    return el
  }

  const plusLarge = (el: HTMLElement): number => {
    const l = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-jour"]')].map((j) =>
      parseFloat(j.style.width)
    )
    return l.indexOf(Math.max(...l))
  }
  /** Le milieu de la colonne du jour `j` TELLE QU'AFFICHÉE. */
  const milieu = (el: HTMLElement, j: number): number => {
    const col = el.querySelectorAll<HTMLElement>('[data-testid="riviere-jour"]')[j]
    return parseFloat(col.style.left) + parseFloat(col.style.width) / 2
  }
  const fiche = (el: HTMLElement): Element | null =>
    el.querySelector('[data-testid="riviere-fiche"]')
  const ouvrirLaFiche = async (el: HTMLElement): Promise<void> => {
    await act(async () => (el.querySelector('[data-conversation="conv-3"]') as HTMLElement).click())
    expect(fiche(el)).not.toBeNull()
  }
  /** Un vrai clic de souris : l'appui, puis le clic, au même point. */
  const cliquer = (cible: Element, x: number): void => {
    const init = { bubbles: true, clientX: x, clientY: 60, button: 0, pointerId: 1 }
    cible.dispatchEvent(new PointerEvent('pointerdown', init))
    cible.dispatchEvent(new MouseEvent('click', init))
  }

  it('sur le tableau : le premier clic ferme seulement la fiche, le suivant déplace la loupe', async () => {
    const el = await monter()
    expect(plusLarge(el)).toBe(13)
    await ouvrirLaFiche(el)
    const etage = el.querySelector('[data-testid="riviere-etage"]') as HTMLElement
    await act(async () => cliquer(etage, milieu(el, 11)))
    expect(fiche(el)).toBeNull()
    expect(plusLarge(el)).toBe(13)
    await act(async () => cliquer(etage, milieu(el, 11)))
    expect(plusLarge(el)).toBe(11)
  })

  it('dans la bande des jours : même règle, le premier clic ferme seulement la fiche', async () => {
    const el = await monter()
    await ouvrirLaFiche(el)
    const tete = () => el.querySelectorAll<HTMLElement>('[data-testid="riviere-tete-jour"]')[2]
    await act(async () => cliquer(tete(), 0))
    expect(fiche(el)).toBeNull()
    expect(plusLarge(el)).toBe(13)
    await act(async () => cliquer(tete(), 0))
    expect(plusLarge(el)).toBe(2)
  })

  it('un appui qui ferme la fiche sans finir en clic ne mange pas le clic d’après', async () => {
    const el = await monter()
    await ouvrirLaFiche(el)
    const etage = el.querySelector('[data-testid="riviere-etage"]') as HTMLElement
    // L'appui ferme la fiche, puis la souris part ailleurs : aucun clic n'arrive.
    await act(async () =>
      etage.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: milieu(el, 5), button: 0 })
      )
    )
    expect(fiche(el)).toBeNull()
    await act(async () => cliquer(etage, milieu(el, 6)))
    expect(plusLarge(el)).toBe(6)
  })
})
