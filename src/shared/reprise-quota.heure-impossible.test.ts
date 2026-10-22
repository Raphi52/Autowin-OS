import { describe, expect, it } from 'vitest'
import { instantDeRetourAnnonce as r } from './reprise-quota'

// Migré de scripts/arena-panel/p7-heure-de-retour.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062). Défaut d'origine : « resets 13pm » -> 13 h, « resets 3:5pm »
// -> 3 h du matin le lendemain. Une heure illisible doit rendre undefined.
const maintenant = new Date(Date.UTC(2026, 8, 21, 10, 0)) // 12 h 00 à Paris (UTC+2)
const iso = (t: string): string | undefined => {
  const v = r(t, maintenant)
  return v === undefined ? undefined : new Date(v).toISOString()
}

describe('instantDeRetourAnnonce — heures impossibles', () => {
  it.each([
    ['13 + pm', 'resets 13pm (Europe/Paris)'],
    ['0 + am', 'resets 0am (Europe/Paris)'],
    ['minutes sur un chiffre', 'resets 3:5pm (Europe/Paris)'],
    ['minute 60', 'resets 12:60pm (Europe/Paris)']
  ])('%s : illisible, donc undefined', (_cas, texte) => {
    expect(iso(texte)).toBeUndefined()
  })
  it('les formes réelles relevées dans les conversations sont inchangées', () => {
    expect(iso("You've hit your session limit · resets 4:10pm (Europe/Paris)")).toBe(
      '2026-09-21T14:10:00.000Z'
    )
    expect(iso("You've hit your session limit · resets 2am (Europe/Paris)")).toBe(
      '2026-09-22T00:00:00.000Z'
    )
    expect(iso('resets 12pm (Europe/Paris)')).toBe('2026-09-22T10:00:00.000Z')
    expect(iso('resets 14:30 (Europe/Paris)')).toBe('2026-09-21T12:30:00.000Z')
  })
})
