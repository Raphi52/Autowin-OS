import { describe, expect, it } from 'vitest'
import {
  searchConversations,
  segmentsSurlignes as seg,
  type ConversationSearchSource
} from './conversation-search'

// Migré de scripts/arena-panel/p14-recherche-ligatures.mts (banc /arena, commit 191ab51d), retiré
// le 2026-10-22 (residus, conv-1062). Défaut d'origine : la recherche repliait les accents avec sa
// PROPRE copie, sans les ligatures — « oeuvre » ne trouvait pas « l'œuvre ». Le surlignage doit
// rester exact sur le texte d'ORIGINE, même quand le repliage change la longueur (œ -> oe).
const conv = (id: string, title: string): ConversationSearchSource => ({
  id,
  title,
  provider: 'claude',
  updatedAt: 0,
  messages: []
})
const convs = [conv('c1', "Relire l'œuvre"), conv('c2', 'Straße 12'), conv('c3', 'Ægir')]
const ids = (q: string): string[] => searchConversations(convs, q).map((h) => h.conversation.id)

describe('recherche de conversations — ligatures', () => {
  it('trouve un titre à ligature depuis sa forme dépliée, et inversement', () => {
    expect(ids('oeuvre')).toEqual(['c1'])
    expect(ids('strasse')).toEqual(['c2'])
    expect(ids('aegir')).toEqual(['c3'])
    expect(ids('œuvre')).toEqual(['c1'])
  })
  it('surligne exactement le texte d’origine', () => {
    expect(seg("Relire l'œuvre", 'oeuvre')).toEqual([
      { texte: "Relire l'", marque: false },
      { texte: 'œuvre', marque: true }
    ])
    expect(seg('Straße 12', 'strasse')).toEqual([
      { texte: 'Straße', marque: true },
      { texte: ' 12', marque: false }
    ])
    expect(seg('Café noir', 'noir')).toEqual([
      { texte: 'Café ', marque: false },
      { texte: 'noir', marque: true }
    ])
  })
  it('les cas ordinaires sont inchangés', () => {
    expect(seg('À jour', 'a jour')).toEqual([{ texte: 'À jour', marque: true }])
    expect(seg('rien ici', 'zzz')).toEqual([{ texte: 'rien ici', marque: false }])
  })
})
