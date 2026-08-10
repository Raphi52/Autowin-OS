import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fsFault = vi.hoisted(() => ({ renameTarget: '', remaining: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: (oldPath: string, newPath: string) => {
      if (newPath === fsFault.renameTarget && fsFault.remaining > 0) {
        fsFault.remaining -= 1
        throw new Error('rename injecté en échec')
      }
      return actual.renameSync(oldPath, newPath)
    }
  }
})

import { enablementPath, setNativeEnablement } from './native-registry'

describe('migration durable du registre natif legacy', () => {
  let base = ''

  afterEach(() => {
    fsFault.renameTarget = ''
    fsFault.remaining = 0
    if (base) rmSync(base, { recursive: true, force: true })
  })

  it('restaure le legacy si la première publication échoue puis le migre à la relance', () => {
    base = mkdtempSync(join(tmpdir(), 'natreg-migration-'))
    const primary = enablementPath(base)
    const legacy = { tools: { legacyOff: false } }
    writeFileSync(primary, JSON.stringify(legacy), 'utf8')
    fsFault.renameTarget = primary
    fsFault.remaining = 1

    expect(() => setNativeEnablement('tools', 'newTool', true, base)).toThrow(/écrire/i)
    expect(JSON.parse(readFileSync(primary, 'utf8'))).toEqual(legacy)

    setNativeEnablement('tools', 'newTool', true, base)

    const migrated = JSON.parse(readFileSync(primary, 'utf8'))
    const backup = JSON.parse(readFileSync(`${primary}.bak`, 'utf8'))
    expect(migrated).toMatchObject({
      schemaVersion: 1,
      skills: {},
      tools: { legacyOff: false, newTool: true },
      plugins: {},
      hooks: {}
    })
    expect(backup.schemaVersion).toBe(1)
  })
})
