import { describe, expect, it } from 'vitest'
import { guardBoolean } from './ipc-guards'

describe('IPC runtime guards', () => {
  it('preserves real booleans', () => {
    expect(guardBoolean(false, 'enabled')).toBe(false)
    expect(guardBoolean(true, 'enabled')).toBe(true)
  })

  it('rejects coercive boolean lookalikes', () => {
    expect(() => guardBoolean('false', 'enabled')).toThrow('boolean attendu')
    expect(() => guardBoolean(0, 'enabled')).toThrow('boolean attendu')
  })
})
