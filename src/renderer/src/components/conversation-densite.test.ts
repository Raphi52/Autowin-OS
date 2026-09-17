import { describe, expect, it } from 'vitest'
import {
  DENSITES_CONVERSATION,
  DENSITE_CONVERSATION_DEFAUT,
  densiteSuivante,
  libelleDensite,
  lireDensiteConversations,
  traitsDensite
} from './chat-view-model'

/**
 * Les trois crans d'affichage de la liste des conversations (demande du 2026-09-17). La rotation et
 * la relecture du choix memorise sont des fonctions PURES : elles se prouvent sans monter la vue.
 */
describe('densite de la liste des conversations', () => {
  it('retombe sur le cran detaille — celui d’avant le reglage — pour toute valeur inconnue', () => {
    expect(DENSITE_CONVERSATION_DEFAUT).toBe('detail')
    expect(lireDensiteConversations(null)).toBe('detail')
    expect(lireDensiteConversations('')).toBe('detail')
    expect(lireDensiteConversations('enorme')).toBe('detail')
  })

  it('relit un cran memorise', () => {
    for (const cran of DENSITES_CONVERSATION) expect(lireDensiteConversations(cran)).toBe(cran)
  })

  it('tourne sur les trois crans et revient a son point de depart', () => {
    expect(densiteSuivante('compact')).toBe('normal')
    expect(densiteSuivante('normal')).toBe('detail')
    expect(densiteSuivante('detail')).toBe('compact')
    let cran = DENSITE_CONVERSATION_DEFAUT
    for (let tour = 0; tour < DENSITES_CONVERSATION.length; tour += 1) cran = densiteSuivante(cran)
    expect(cran).toBe(DENSITE_CONVERSATION_DEFAUT)
  })

  it('nomme chaque cran en clair, sans mot de mecanique', () => {
    expect(libelleDensite('compact')).toBe('compacte')
    expect(libelleDensite('normal')).toBe('normale')
    expect(libelleDensite('detail')).toBe('détaillée')
  })

  it('dessine d’autant plus de lignes que le cran est serre', () => {
    expect(traitsDensite('compact').length).toBeGreaterThan(traitsDensite('normal').length)
    expect(traitsDensite('normal').length).toBeGreaterThan(traitsDensite('detail').length)
    for (const cran of DENSITES_CONVERSATION) {
      for (const y of traitsDensite(cran)) {
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(16)
      }
    }
  })
})
