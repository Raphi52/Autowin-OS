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
import { phraseDuRefus } from '../../../shared/echec-publication'
import { RiviereDuProjet } from './RiviereDuProjet'
import { CLE_ETATS_MANUELS_CARTE } from './etats-manuels-carte'

/**
 * UN ENVOI REFUSÉ SE VOIT SUR LA DEMANDE CONCERNÉE. Le refus est écrit par `echec-publication.ts` (la même
 * phrase que dans le fil) ; la fiche de la demande la montre, les autres demandes non.
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : une demande dont le tour a refusé sans sa phrase ; une demande sans
 * refus qui affiche la phrase d'une autre ; une règle CSS qui coupe la phrase.
 */
const MAINTENANT = new Date(2026, 10, 8, 15, 0).getTime()
const HEURE = 3_600_000
const REFUS = phraseDuRefus({
  titre: 'Envoi refusé',
  raison:
    "un élément réservé à l'entreprise était dans un commit à créer : ce commit n'a pas été fait, rien n'est parti",
  action: 'Retire-le du travail, puis relance /git.'
})

const demande = (rang: number, extra: Partial<DemandeDeLaCarte>): DemandeDeLaCarte => ({
  conversationId: 'conv-1752',
  conversationTitre: 'Board des correctifs',
  rang,
  titre: `demande ${rang}`,
  statut: 'sans-preuve',
  constat: 'fini sans vérification',
  debut: MAINTENANT - (3 - rang) * HEURE,
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

describe('RiviereDuProjet — un envoi refusé se voit sur sa demande', () => {
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

  it('la fiche de la demande dont le tour a refusé l’envoi montre la phrase, les autres non', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    const demandes = [
      demande(0, { titre: 'publie le correctif', envoiRefuse: REFUS }),
      demande(2, { titre: 'vérifie la suite' })
    ]
    await act(async () =>
      root.render(createElement(RiviereDuProjet, { carte: carte(demandes), ouvrir: vi.fn() }))
    )
    await act(async () =>
      (el.querySelector('[data-conversation="conv-1752"]') as HTMLElement).click()
    )
    const refus = [...el.querySelectorAll('[data-testid="riviere-fiche-refus"]')].map(
      (r) => r.textContent
    )
    expect(refus).toEqual([REFUS])
  })

  it('le CSS montre la phrase en couleur d’erreur, sans la couper', () => {
    const css = readFileSync(join(__dirname, 'RiviereDuProjet.css'), 'utf8')
    const regle = /\.riviere-fiche-refus\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(regle).toMatch(/color:\s*var\(--err\)/)
    expect(regle).not.toMatch(/nowrap|ellipsis/)
  })
})
