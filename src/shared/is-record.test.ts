import { describe, expect, it } from 'vitest'
import { isRecord } from './is-record'

/*
 * Une seule version du test « est-ce un objet à clés ? ». Six copies identiques d'`isRecord` et trois
 * d'`isPlainObject` (même réponse pour toute valeur) vivaient dans le code : ce test fixe la réponse
 * que toutes donnaient, pour qu'elles puissent n'en faire qu'une.
 */
describe('isRecord', () => {
  it('accepte un objet à clés, même vide ou sans prototype', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(Object.create(null))).toBe(true)
  })

  it('refuse null, les tableaux et les valeurs simples', () => {
    for (const valeur of [null, undefined, [], [1], 0, 1, '', 'x', true, false]) {
      expect(isRecord(valeur)).toBe(false)
    }
  })

  it('donne la même réponse que l’ancienne forme `isPlainObject`', () => {
    const isPlainObject = (v: unknown): boolean =>
      Boolean(v) && typeof v === 'object' && !Array.isArray(v)
    for (const valeur of [null, undefined, [], {}, { a: 1 }, 0, '', 'x', true, new Date()]) {
      expect(isRecord(valeur)).toBe(isPlainObject(valeur))
    }
  })
})
