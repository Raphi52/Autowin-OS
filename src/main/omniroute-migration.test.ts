import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OmniRouteMigrationStore } from './omniroute-migration'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('OmniRoute transport state', () => {
  it('persists activation and never exposes a rollback direct', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-omniroute-migration-'))
    roots.push(root)
    const path = join(root, 'migration.json')
    const store = new OmniRouteMigrationStore(path, () => '2026-07-20T10:00:00.000Z')
    const active = store.activate('auto/coding')
    expect(active).toEqual(
      expect.objectContaining({ mode: 'omniroute', routeModel: 'auto/coding' })
    )
    expect(new OmniRouteMigrationStore(path).load().mode).toBe('omniroute')

    expect(store.activate('auto/cheap')).toEqual(
      expect.objectContaining({
        mode: 'omniroute',
        routeModel: 'auto/cheap'
      })
    )

    expect(JSON.parse(readFileSync(path, 'utf8')).mode).toBe('omniroute')
  })

  it('fails closed on invalid route models and corrupted persisted state', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-omniroute-migration-'))
    roots.push(root)
    const path = join(root, 'migration.json')
    const store = new OmniRouteMigrationStore(path)
    expect(() => store.activate('../intrus')).toThrow(/route/i)
    expect(store.load()).toEqual(
      expect.objectContaining({ mode: 'omniroute', routeModel: 'auto/coding' })
    )
  })
})
