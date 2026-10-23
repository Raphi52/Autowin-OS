// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte
} from '../../../shared/carte-des-besoins'
import { RiviereDuProjet } from './RiviereDuProjet'

/**
 * LES NOMS DU BOARD AU CRAYON (conv-1132, 2026-10-23 : « met les noms en mode doodle / sketch, ça
 * les barre quand ils sont désélectionnés »). Fichier à part : `RiviereDuProjet.test.tsx` était en
 * cours d'édition par un autre fil. ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un nom barré alors que
 * personne n'est choisi (tout le monde est affiché), le nom choisi lui-même barré, un nom qui reste
 * barré après qu'on a re-cliqué pour tout réafficher.
 */

const MAINTENANT = Date.now()

const demande = (conversationId: string, cle: string, nom: string): DemandeDeLaCarte => ({
  conversationId,
  conversationTitre: `Fil ${conversationId}`,
  rang: 1,
  titre: `demande ${conversationId}`,
  statut: 'en-cours',
  constat: '',
  debut: MAINTENANT - 3_600_000,
  demandeur: { cle, nom, origine: 'journal' }
})

function carte(): CarteDesBesoins {
  const demandes = [demande('conv-1', 'raph@x', 'Raph'), demande('conv-2', 'lea@x', 'Léa')]
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: 2,
    demandes,
    runsBloques: [],
    comptes: { prouve: 0, refuse: 0, 'en-cours': 2, 'sans-preuve': 0 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 2,
    demandeurs: [
      { cle: 'raph@x', nom: 'Raph', demandes: 1 },
      { cle: 'lea@x', nom: 'Léa', demandes: 1 }
    ],
    demandesJournalisees: 2,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

describe('RiviereDuProjet — noms au crayon', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
  })

  it('barre les noms désélectionnés, jamais celui choisi ; sans choix, personne n’est barré', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(createElement(RiviereDuProjet, { carte: carte(), ouvrir: vi.fn() }))
    )
    const nom = (texte: string): HTMLElement =>
      [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-personne"]')].find(
        (b) => b.textContent === texte
      )!

    expect(nom('Raph').dataset.barre).toBeUndefined()
    expect(nom('Léa').dataset.barre).toBeUndefined()

    await act(async () => nom('Léa').click())
    expect(nom('Raph').dataset.barre).toBe('true')
    expect(nom('Léa').dataset.barre).toBeUndefined()

    await act(async () => nom('Léa').click())
    expect(nom('Raph').dataset.barre).toBeUndefined()
  })
})
