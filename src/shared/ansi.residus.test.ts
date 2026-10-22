import { describe, expect, it } from 'vitest'
import { sansSequencesAnsi as s } from './ansi'

// Migré de scripts/arena-panel/p3-ansi-residus.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062). Défaut d'origine : des restes de séquences échappaient au
// nettoyage — CSI 8 bits (U+009B) et choix de jeu de caractères (ESC ( B).
describe('sansSequencesAnsi — séquences rares', () => {
  it('retire le CSI 8 bits', () => {
    expect(s('\u009b31mX\u009b0m')).toBe('X')
  })
  it('retire la désignation de jeu G0/G1', () => {
    expect(s('\u001b(Btexte\u001b)0')).toBe('texte')
  })
  it('le cas ordinaire et le texte sans séquence sont intacts', () => {
    expect(s('\u001b[31mrouge\u001b[0m')).toBe('rouge')
    expect(s('[crochet] (paren) B')).toBe('[crochet] (paren) B')
  })
})
