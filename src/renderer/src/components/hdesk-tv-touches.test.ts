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
    expect(toucheTv({ key: 'c', ctrlKey: true })).toBe('CtrlC')
    expect(toucheTv({ key: 'c', ctrlKey: true }, false)).toBeNull()
    expect(toucheTv({ key: 'q' })).toBeNull()
    expect(toucheTv({ key: 'Enter' })).toBeNull()
  })

  // conv-1528 : envoyé au bureau caché, Ctrl+V arrivait en caractère ^V brut (mesuré dans une console :
  // « echo [^V », rien de collé). Le collage reste donc TOUJOURS dans le champ, puis Entrée le tape.
  it('Ctrl+V colle dans le champ, même vide : il ne part jamais au bureau caché', () => {
    expect(toucheTv({ key: 'v', ctrlKey: true })).toBeNull()
    expect(toucheTv({ key: 'V', ctrlKey: true })).toBeNull()
    expect(toucheTv({ key: 'v', ctrlKey: true }, false)).toBeNull()
    expect(toucheTv({ key: 'q' })).toBeNull()
    expect(toucheTv({ key: 'Enter' })).toBeNull()
  })
})
