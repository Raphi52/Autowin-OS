/**
 * Touches du champ de frappe du panneau des Bureaux cachés. Repris du test de l'ancien bloc du fil
 * (conv-35), retiré par conv-1378 : le panneau garde ce champ et cette table.
 */
import { describe, expect, it } from 'vitest'
import { toucheTv } from './hdesk-tv-touches'

describe('toucheTv', () => {
  it('touches spéciales, Ctrl seulement champ vide, édition locale sinon', () => {
    expect(toucheTv({ key: 'Tab' })).toBe('Tab')
    expect(toucheTv({ key: 'Escape' }, false)).toBe('Echap')
    expect(toucheTv({ key: 'Backspace' })).toBe('Retour')
    expect(toucheTv({ key: 'Backspace' }, false)).toBeNull()
    expect(toucheTv({ key: 'ArrowLeft' }, false)).toBeNull()
    expect(toucheTv({ key: 'ArrowDown' }, false)).toBe('Bas')
    expect(toucheTv({ key: 'v', ctrlKey: true })).toBe('CtrlV')
    expect(toucheTv({ key: 'v', ctrlKey: true }, false)).toBeNull()
    expect(toucheTv({ key: 'q' })).toBeNull()
    expect(toucheTv({ key: 'Enter' })).toBeNull()
  })
})
