// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
 * LE MESSAGE ENTIER DANS LA FICHE DU BOARD (conv-1278, 2026-10-29) : « dans board je veux pouvoir
 * voir les messages en entier quand j'ouvre le détail ». La fiche montrait la première ligne du
 * message, coupée à 120 caractères puis encore par « … » sur une seule ligne.
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : une fiche qui montre le titre coupé alors que le message entier
 * est connu ; une fiche qui perd ses retours à la ligne ; une règle CSS qui recoupe le texte sur une
 * ligne ; une demande sans message entier (fichier d'un collègue écrit avant) qui n'affiche plus rien.
 */

const MAINTENANT = new Date(2026, 9, 29, 15, 0).getTime()
const HEURE = 3_600_000
const ENTIER =
  "/maj La mise à jour d'Autowin est bloquée : « La mise à jour a échoué; la tentative a été annulée et ton travail local est intact ».\n\nRelance-la et dis-moi ce qui coince."

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

describe('RiviereDuProjet — la fiche montre le message entier', () => {
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

  it('le texte entier, retours à la ligne compris ; le titre quand le texte manque', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    const demandes = [
      demande(0, { titre: `${ENTIER.slice(0, 119)}…`, texte: ENTIER }),
      demande(2, { titre: 'vérifie le commit' })
    ]
    await act(async () =>
      root.render(createElement(RiviereDuProjet, { carte: carte(demandes), ouvrir: vi.fn() }))
    )
    await act(async () =>
      (el.querySelector('[data-conversation="conv-343"]') as HTMLElement).click()
    )
    const textes = [...el.querySelectorAll('[data-testid="riviere-fiche-texte"]')].map(
      (t) => t.textContent
    )
    expect(textes).toEqual([ENTIER, 'vérifie le commit'])
  })

  it('le CSS laisse le texte passer à la ligne au lieu de le couper par « … »', () => {
    const css = readFileSync(join(__dirname, 'RiviereDuProjet.css'), 'utf8')
    const regle = /\.riviere-fiche-texte\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(regle).toMatch(/white-space:\s*pre-wrap/)
    expect(regle).not.toMatch(/nowrap|ellipsis/)
  })
})
