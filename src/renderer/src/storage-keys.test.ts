import { describe, expect, it } from 'vitest'
import { legacyStorageKey } from '../../shared/app-identity'
import {
  MIGRATED_STORAGE_SUFFIXES,
  autowinStorageKey,
  importMigratedStorage,
  migrateAutowinStorage,
  readMigratedStorageValue
} from './storage-keys'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('cles LocalStorage Autowin OS', () => {
  it('excludes retired Loop Builder drafts from startup migration', () => {
    expect(MIGRATED_STORAGE_SUFFIXES).toEqual([
      'agent-workflow.v1',
      'graph.visibility-settings.v1',
      'graph.node-spacing.v1'
    ])
  })

  it('copies a legacy value into the canonical key without deleting the source', () => {
    const storage = new MemoryStorage()
    const suffix = 'agent-workflow.v1'
    storage.setItem(legacyStorageKey(suffix), '{"legacy":true}')

    expect(readMigratedStorageValue(storage, suffix)).toBe('{"legacy":true}')
    expect(storage.getItem(autowinStorageKey(suffix))).toBe('{"legacy":true}')
    expect(storage.getItem(legacyStorageKey(suffix))).toBe('{"legacy":true}')
  })

  it('keeps a divergent canonical value and stays idempotent', () => {
    const storage = new MemoryStorage()
    const suffix = 'agent-workflow.v1'
    storage.setItem(legacyStorageKey(suffix), 'legacy')
    storage.setItem(autowinStorageKey(suffix), 'current')

    expect(readMigratedStorageValue(storage, suffix)).toBe('current')
    expect(readMigratedStorageValue(storage, suffix)).toBe('current')
    expect(storage.getItem(legacyStorageKey(suffix))).toBe('legacy')
  })

  it('migrates the complete allowlist at application startup', () => {
    const storage = new MemoryStorage()
    for (const suffix of MIGRATED_STORAGE_SUFFIXES) {
      storage.setItem(legacyStorageKey(suffix), `legacy:${suffix}`)
    }

    expect(migrateAutowinStorage(storage)).toBe(MIGRATED_STORAGE_SUFFIXES.length)
    expect(migrateAutowinStorage(storage)).toBe(0)
    for (const suffix of MIGRATED_STORAGE_SUFFIXES) {
      expect(storage.getItem(autowinStorageKey(suffix))).toBe(`legacy:${suffix}`)
      expect(storage.getItem(legacyStorageKey(suffix))).toBe(`legacy:${suffix}`)
    }
  })

  it('imports a distinct legacy profile without replacing current values', () => {
    const storage = new MemoryStorage()
    storage.setItem(autowinStorageKey('agent-workflow.v1'), 'current')
    const legacyValues: Record<string, string> = {
      'agent-workflow.v1': 'legacy-workflow',
      'skill-loop.v1': 'legacy-loop',
      'skill-loop.library.v1': 'legacy-library'
    }

    expect(importMigratedStorage(storage, legacyValues)).toBe(0)
    expect(storage.getItem(autowinStorageKey('agent-workflow.v1'))).toBe('current')
    expect(storage.getItem(autowinStorageKey('skill-loop.v1'))).toBeNull()
    expect(storage.getItem(autowinStorageKey('skill-loop.library.v1'))).toBeNull()
  })
})
