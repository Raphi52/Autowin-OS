// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardDUnCollegue } from '../../../shared/board-collegues'
import type { CarteDesBesoins, ProjetDeLaCarte } from '../../../shared/carte-des-besoins'
import { carteAvecCollegues } from './board-collegues'
import { RiviereDuProjet } from './RiviereDuProjet'
import { CLE_ETATS_MANUELS_CARTE } from './etats-manuels-carte'

/**
 * LES POST-IT DES COLLÈGUES À L'ÉCRAN (conv-1210, 2026-10-28 : « avec leur nom sur chaque post-it
 * et en lecture seule »). ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un post-it de collègue sans son nom,
 * qui se glisse vers un autre étage, qui montre « vérifier », ou dont la fiche ouvre un fil d'ici.
 */

const MAINTENANT = new Date(2026, 9, 28, 15, 0).getTime()
const HEURE = 3_600_000

function carte(): CarteDesBesoins {
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: 1,
    demandes: [
      {
        conversationId: 'conv-1',
        conversationTitre: 'Mon fil',
        rang: 0,
        titre: 'ma demande',
        statut: 'en-cours',
        constat: 'tour en cours',
        debut: MAINTENANT - 2 * HEURE,
        demandeur: { cle: 'raph@x', nom: 'Raph', origine: 'journal' }
      }
    ],
    runsBloques: [],
    comptes: { prouve: 0, refuse: 0, 'en-cours': 1, 'sans-preuve': 0 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: 1,
    runsBloques: 0,
    conversationsLues: 1,
    demandeurs: [{ cle: 'raph@x', nom: 'Raph', demandes: 1 }],
    demandesJournalisees: 1,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

const JEAN: BoardDUnCollegue = {
  poste: 'jdupont',
  nom: 'Jean Dupont',
  postIts: [
    {
      conversationId: 'conv-1',
      titre: 'Le fil de Jean',
      projet: { cle: 'P', libelle: 'AutoWinOS' },
      etage: 'sans-preuve',
      etatPreuve: 'sans-preuve',
      derniereDemande: new Date(MAINTENANT - HEURE).toISOString(),
      demandes: [
        {
          rang: 0,
          titre: 'sa demande',
          statut: 'sans-preuve',
          constat: 'aucune vérification',
          date: new Date(MAINTENANT - HEURE).toISOString(),
          workItems: [{ sourceId: 'azdo', id: '4321' }]
        }
      ]
    }
  ]
}

describe('RiviereDuProjet — un post-it de collègue se lit, il ne se touche pas', () => {
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

  async function monter(): Promise<{ el: HTMLDivElement; ouvrir: ReturnType<typeof vi.fn> }> {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    const ouvrir = vi.fn()
    const verifier = vi.fn()
    await act(async () =>
      root.render(
        createElement(RiviereDuProjet, {
          carte: carteAvecCollegues(carte(), [JEAN]),
          ouvrir,
          verifier: verifier as never
        })
      )
    )
    return { el, ouvrir }
  }
  const postit = (el: HTMLElement, id: string): HTMLElement =>
    el.querySelector(`[data-conversation="${id}"]`) as HTMLElement
  const pointeur = (cible: Element, type: string, x: number, y = 60): void => {
    cible.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 })
    )
  }

  it('porte le nom du collègue, et le nôtre n’en porte pas', async () => {
    const { el } = await monter()
    const deJean = postit(el, 'jdupont/conv-1')
    expect(deJean.dataset.collegue).toBe('jdupont')
    expect(deJean.querySelector('[data-testid="riviere-postit-collegue"]')?.textContent).toContain(
      'Jean Dupont'
    )
    expect(postit(el, 'conv-1').querySelector('[data-testid="riviere-postit-collegue"]')).toBeNull()
    // Le collègue a son bouton dans le filtre des personnes.
    const noms = [...el.querySelectorAll('[data-testid="riviere-personne"]')].map(
      (b) => b.textContent
    )
    expect(noms).toContain('Jean Dupont')
  })

  it('ne se glisse pas vers un autre étage', async () => {
    const { el } = await monter()
    const etageFait = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-etage"]')].find(
      (e) => e.dataset.etage === 'prouve'
    )!
    const yFait = parseFloat(etageFait.style.top) + parseFloat(etageFait.style.height) / 2
    const p = postit(el, 'jdupont/conv-1')
    await act(async () => {
      pointeur(p, 'pointerdown', 800, 100)
      pointeur(p, 'pointermove', 805, 140)
      pointeur(p, 'pointermove', 805, yFait)
      pointeur(p, 'pointerup', 805, yFait)
    })
    expect(postit(el, 'jdupont/conv-1').dataset.etage).toBe('sans-preuve')
    expect(window.localStorage.getItem(CLE_ETATS_MANUELS_CARTE)).toBeNull()
  })

  it('sa fiche dit où vit le fil, sans « Ouvrir le fil » ni geste « vérifier »', async () => {
    const { el, ouvrir } = await monter()
    await act(async () => postit(el, 'jdupont/conv-1').click())
    const fiche = el.querySelector('[data-testid="riviere-fiche"]') as HTMLElement
    expect(fiche.textContent).toContain('Le fil de Jean')
    expect(fiche.querySelector('[data-testid="riviere-fiche-collegue"]')?.textContent).toContain(
      'conv-1'
    )
    expect(fiche.querySelector('[data-testid="riviere-fiche-taches"]')?.textContent).toBe('#4321')
    expect(fiche.querySelector('[data-testid="riviere-fiche-ouvrir"]')).toBeNull()
    expect(fiche.querySelector('[data-testid="tache-lier"]')).toBeNull()
    // Le post-it de Jean est « À vérifier » : sans exclusion, ses gestes seraient là.
    expect(el.querySelector('[data-testid="riviere-verif-postit"]')).toBeNull()
    expect(el.querySelector('[data-testid="riviere-verif-fiche"]')).toBeNull()
    expect(ouvrir).not.toHaveBeenCalled()
  })
})
