import { describe, expect, it } from 'vitest'
import { TITRE_CONVERSATION_MAX, titreDepuisPremierMessage } from './titre-conversation'

describe('titreDepuisPremierMessage', () => {
  it('garde intact un message court', () => {
    expect(titreDepuisPremierMessage('liste moi 100 inconvénients de autowin OS')).toBe(
      'liste moi 100 inconvénients de autowin OS'
    )
  })
  it('ne tronque plus a 42 caracteres', () => {
    const msg = 'Relance les points 2 à 7 dans D:\\AutoWinOS : allonger les titres tronqués'
    expect(msg.length).toBeGreaterThan(42)
    expect(titreDepuisPremierMessage(msg)).toBe(msg)
  })
  it('coupe un long message au mot, sous la borne, avec une ellipse', () => {
    const msg = 'mot '.repeat(60)
    const t = titreDepuisPremierMessage(msg)
    expect(t.endsWith('…')).toBe(true)
    expect(t.length).toBeLessThanOrEqual(TITRE_CONVERSATION_MAX + 1)
    expect(t).not.toMatch(/\bmo…$|\bm…$/)
  })
  it('aplatit les retours a la ligne', () => {
    expect(titreDepuisPremierMessage('a\n\n  b')).toBe('a b')
  })
})
