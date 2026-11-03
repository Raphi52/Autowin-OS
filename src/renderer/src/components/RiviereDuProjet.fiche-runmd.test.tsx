// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte
} from '../../../shared/carte-des-besoins'
import { RiviereDuProjet } from './RiviereDuProjet'
import { CLE_ETATS_MANUELS_CARTE } from './etats-manuels-carte'

/**
 * LE LIEN « RUN.md » D'UNE DEMANDE (conv-1441, 2026-11-02) : l'app écrit une fiche par demande depuis
 * conv-1418, mais le Board ne la montrait nulle part. ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un lien sur
 * une demande sans fiche ; un lien qui ouvre la fiche d'une autre demande ; un lien sur la demande
 * d'un collègue, dont le fil vit dans SON Autowin.
 */

const MAINTENANT = new Date(2026, 9, 29, 15, 0).getTime()
const HEURE = 3_600_000

const demande = (rang: number, extra: Partial<DemandeDeLaCarte>): DemandeDeLaCarte => ({
  conversationId: 'conv-343',
  conversationTitre: 'Réparer la mise à jour',
  rang,
  titre: `demande ${rang}`,
  statut: 'sans-preuve',
  constat: 'fini sans vérification',
  debut: MAINTENANT - (3 - rang) * HEURE,
  demandeur: { cle: 'raph@x', nom: 'Raph', origine: 'journal' },
  ...extra
})

function carte(demandes: DemandeDeLaCarte[]): CarteDesBesoins {
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: 1,
    demandes,
    runsBloques: [],
    comptes: { prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': demandes.length }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 1,
    demandeurs: [{ cle: 'raph@x', nom: 'Raph', demandes: demandes.length }],
    demandesJournalisees: demandes.length,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

describe('RiviereDuProjet — le lien vers la fiche RUN.md de chaque demande', () => {
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

  it('seule une demande qui a sa fiche porte le lien, et il ouvre CETTE fiche dans son fil', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    const ouvrirFiche = vi.fn()
    const demandes = [
      demande(0, { messageId: 'm0', titre: 'avec fiche' }),
      demande(2, { messageId: 'm2', titre: 'sans fiche' })
    ]
    const fiches = { 'conv-343': { m0: 'D:/d/demandes/conv-343/avec-fiche/RUN.md' } }
    await act(async () =>
      root.render(
        createElement(RiviereDuProjet, {
          carte: carte(demandes),
          ouvrir: vi.fn(),
          fiches,
          ouvrirFiche
        })
      )
    )
    await act(async () =>
      (el.querySelector('[data-conversation="conv-343"]') as HTMLElement).click()
    )
    const liens = el.querySelectorAll<HTMLButtonElement>('[data-testid="riviere-fiche-runmd"]')
    expect(liens).toHaveLength(1)
    expect(liens[0]?.closest('li')?.textContent).toContain('avec fiche')
    await act(async () => liens[0]?.click())
    expect(ouvrirFiche).toHaveBeenCalledWith('conv-343', 'D:/d/demandes/conv-343/avec-fiche/RUN.md')
  })

  it('sans fiches transmises, aucun lien', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(
        createElement(RiviereDuProjet, {
          carte: carte([demande(0, { messageId: 'm0' })]),
          ouvrir: vi.fn()
        })
      )
    )
    await act(async () =>
      (el.querySelector('[data-conversation="conv-343"]') as HTMLElement).click()
    )
    expect(el.querySelector('[data-testid="riviere-fiche-runmd"]')).toBeNull()
  })
})
