// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  EVENEMENT_PREFILL,
  fermerEcouteurPrefill,
  installerRelaisPrefill,
  ouvrirEcouteurPrefill
} from './relais-prefill'

/**
 * Le message d'un bouton « lance la skill » était perdu quand le chat n'avait jamais été affiché
 * (mesuré conv-1101). Ce qui doit faire échouer ce fichier : un relais qui ne garde rien (le
 * défaut revient), qui garde AUSSI quand le chat écoute (le message serait rejoué une seconde fois
 * au prochain montage — une skill lancée deux fois), ou qui rend deux fois la même demande.
 */

let desinstaller: (() => void) | undefined

function emettre(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(EVENEMENT_PREFILL, { detail }))
}

afterEach(() => {
  desinstaller?.()
  desinstaller = undefined
  fermerEcouteurPrefill()
  ouvrirEcouteurPrefill() // vide une demande restée en attente
  fermerEcouteurPrefill()
})

describe('relais du pré-remplissage', () => {
  it('chat jamais affiché : la demande est GARDÉE, puis rendue une seule fois à son ouverture', () => {
    desinstaller = installerRelaisPrefill()
    emettre({ conversationId: 'conv-1', prompt: '/gc bilan', send: true })
    expect(ouvrirEcouteurPrefill()).toEqual({
      conversationId: 'conv-1',
      prompt: '/gc bilan',
      send: true
    })
    fermerEcouteurPrefill()
    expect(ouvrirEcouteurPrefill()).toBeNull()
  })

  it('chat qui écoute : rien n’est gardé (pas de second envoi au prochain montage)', () => {
    desinstaller = installerRelaisPrefill()
    ouvrirEcouteurPrefill()
    emettre({ conversationId: 'conv-2', prompt: '/curate', send: true })
    fermerEcouteurPrefill()
    expect(ouvrirEcouteurPrefill()).toBeNull()
  })

  it('chat démonté puis remonté : la demande émise entre-temps est gardée', () => {
    desinstaller = installerRelaisPrefill()
    ouvrirEcouteurPrefill()
    fermerEcouteurPrefill()
    emettre({ conversationId: 'conv-3', prompt: '/maj', send: true })
    expect(ouvrirEcouteurPrefill()?.prompt).toBe('/maj')
  })

  it('un événement vide (ni conversation ni texte) n’est pas gardé', () => {
    desinstaller = installerRelaisPrefill()
    emettre({})
    expect(ouvrirEcouteurPrefill()).toBeNull()
  })
})
