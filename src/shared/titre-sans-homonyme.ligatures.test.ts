import { describe, expect, it } from 'vitest'
import { titreSansHomonyme as t } from './titre-sans-homonyme'

// Migré de scripts/arena-panel/p15-titres-ligatures.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062). Ce script était devenu ROUGE sans que personne le voie : il
// importait encore `src/renderer/src/components/titre-sans-homonyme`, déplacé dans `src/shared/`
// le 2026-10-19 (b49ce52a). Défaut d'origine : « oeuvre » à côté d'un titre « Œuvre » n'était
// pas reconnu comme homonyme, et deux conversations portaient le même titre pour l'œil.
const q = new Date(2026, 8, 21, 14, 5)

describe('titreSansHomonyme — ligatures', () => {
  it('reconnaît un homonyme qui ne diffère que par une ligature', () => {
    expect(t('oeuvre', ['Œuvre'], q)).toBe('oeuvre · 21/09 14:05')
    expect(t('strasse', ['Straße'], q)).toBe('strasse · 21/09 14:05')
    expect(t('AEGIR', ['Ægir'], q)).toBe('AEGIR · 21/09 14:05')
  })
  it('les cas ordinaires sont inchangés', () => {
    expect(t('Œuvre', ['Œuvre'], q)).toBe('Œuvre · 21/09 14:05')
    expect(t('Cafe', ['Café'], q)).toBe('Cafe · 21/09 14:05')
    expect(t('Autre sujet', ['Œuvre'], q)).toBe('Autre sujet')
  })
})
