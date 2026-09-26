import { describe, expect, it } from 'vitest'
import { formaterHeureMessage } from './heure-message'

const now = new Date(2026, 8, 24, 15, 0).getTime()

describe('formaterHeureMessage', () => {
  it("aujourd'hui : heure seule", () => {
    expect(formaterHeureMessage(new Date(2026, 8, 24, 14, 32).getTime(), now)).toBe('14:32')
  })
  it('hier : préfixe « hier »', () => {
    expect(formaterHeureMessage(new Date(2026, 8, 23, 9, 5).getTime(), now)).toBe('hier 09:05')
  })
  it('plus ancien : jour et mois, sans année si même année', () => {
    const r = formaterHeureMessage(new Date(2026, 8, 12, 16, 40).getTime(), now)
    expect(r).toMatch(/^12 sept\.? 16:40$/)
  })
  it("autre année : l'année apparaît", () => {
    expect(formaterHeureMessage(new Date(2025, 0, 3, 8, 0).getTime(), now)).toContain('2025')
  })
})
