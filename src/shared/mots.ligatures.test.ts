import { describe, expect, it } from 'vitest'
import { motsDe } from './mots'

// Migré de scripts/arena-panel/p2-ligatures.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062). Défaut d'origine : motsDe coupait sur les ligatures,
// « l'œuvre » -> ["uvre"].
describe('motsDe — ligatures', () => {
  it('déplie œ, æ et ß au lieu de couper le mot', () => {
    expect(motsDe('l’œuvre')).toContain('oeuvre')
    expect(motsDe('Ægir')).toContain('aegir')
    expect(motsDe('Straße')).toContain('strasse')
    expect(motsDe('l’œuvre')).not.toContain('uvre')
  })
  it('le découpage ordinaire est inchangé', () => {
    expect(motsDe('Écrire un fichier.ts')).toEqual(['ecrire', 'fichier.ts'])
  })
})
