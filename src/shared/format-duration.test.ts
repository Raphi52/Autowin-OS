import { describe, expect, it } from 'vitest'
import { formatDurationMs } from './format-duration'

describe('formatDurationMs', () => {
  it('formate les durées sous la seconde en millisecondes', () => {
    expect(formatDurationMs(500)).toBe('500 ms')
  })

  it('formate les secondes avec une décimale à virgule française', () => {
    expect(formatDurationMs(1500)).toBe('1,5 s')
  })

  it('omet la décimale quand la durée tombe sur une seconde entière', () => {
    expect(formatDurationMs(2000)).toBe('2 s')
  })

  it('formate les minutes avec le reste en secondes', () => {
    expect(formatDurationMs(150000)).toBe('2 min 30 s')
  })

  it('omet les secondes quand la durée tombe sur une minute entière', () => {
    expect(formatDurationMs(120000)).toBe('2 min')
  })

  it("bascule en minutes quand l'arrondi à une décimale atteint 60,0 s", () => {
    expect(formatDurationMs(59950)).toBe('1 min')
  })

  it('formate les heures avec les minutes sur deux chiffres', () => {
    expect(formatDurationMs(3900000)).toBe('1 h 05 min')
  })

  it('omet les minutes quand la durée tombe sur une heure entière', () => {
    expect(formatDurationMs(3600000)).toBe('1 h')
  })

  it("bascule en heures quand l'arrondi à la seconde atteint 60 min", () => {
    expect(formatDurationMs(3599940)).toBe('1 h')
  })

  it('retourne "0 ms" pour zéro', () => {
    expect(formatDurationMs(0)).toBe('0 ms')
  })

  it.each([[-5], [Number.NaN]])('retourne "0 ms" pour une entrée invalide (%s)', (input) => {
    expect(formatDurationMs(input)).toBe('0 ms')
  })

  it('arrondit les millisecondes fractionnaires avant de formater', () => {
    expect(formatDurationMs(1499.6)).toBe('1,5 s')
  })
})
