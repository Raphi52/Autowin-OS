import { describe, expect, it } from 'vitest'
import { guardAttachments, guardBoolean } from './ipc-guards'

describe('IPC runtime guards', () => {
  it('preserves real booleans', () => {
    expect(guardBoolean(false, 'enabled')).toBe(false)
    expect(guardBoolean(true, 'enabled')).toBe(true)
  })

  it('rejects coercive boolean lookalikes', () => {
    expect(() => guardBoolean('false', 'enabled')).toThrow('boolean attendu')
    expect(() => guardBoolean(0, 'enabled')).toThrow('boolean attendu')
  })

  it('accepts bounded chat attachments and rejects oversized payloads', () => {
    const attachment = {
      name: 'notes.md',
      mimeType: 'text/markdown',
      size: 7,
      kind: 'text' as const,
      content: '# Notes'
    }
    expect(guardAttachments([attachment])).toEqual([attachment])
    expect(() => guardAttachments([{ ...attachment, size: 11 * 1024 * 1024 }])).toThrow(
      'trop volumineux'
    )
    expect(() => guardAttachments(Array.from({ length: 9 }, () => attachment))).toThrow(
      'trop de fichiers'
    )
  })
})
