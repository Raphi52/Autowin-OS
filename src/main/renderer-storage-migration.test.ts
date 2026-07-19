import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isRendererStorageMigrationComplete,
  markRendererStorageMigrationComplete,
  rendererStorageMigrationMarker
} from './renderer-storage-migration'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('marqueur de migration LocalStorage', () => {
  it('is absent initially and idempotently marks a completed migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-renderer-migration-'))
    roots.push(root)

    expect(isRendererStorageMigrationComplete(root)).toBe(false)
    markRendererStorageMigrationComplete(root)
    markRendererStorageMigrationComplete(root)

    expect(isRendererStorageMigrationComplete(root)).toBe(true)
    expect(existsSync(rendererStorageMigrationMarker(root))).toBe(true)
  })

  it('rejects and repairs an empty or truncated marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-renderer-migration-'))
    roots.push(root)
    const marker = rendererStorageMigrationMarker(root)

    for (const invalidContent of ['', 'autowin-renderer-storage-migration:']) {
      writeFileSync(marker, invalidContent, 'utf8')
      expect(isRendererStorageMigrationComplete(root)).toBe(false)
      markRendererStorageMigrationComplete(root)
      expect(isRendererStorageMigrationComplete(root)).toBe(true)
    }
  })
})
