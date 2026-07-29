import { describe, expect, it } from 'vitest'

import { toUpperCase } from './to-upper-case'

describe('toUpperCase', () => {
  it('converts a lowercase string to uppercase', () => {
    expect(toUpperCase('hello')).toBe('HELLO')
  })

  it('converts a mixed-case string to uppercase', () => {
    expect(toUpperCase('HeLLo')).toBe('HELLO')
  })

  it('keeps an empty string empty', () => {
    expect(toUpperCase('')).toBe('')
  })
})
