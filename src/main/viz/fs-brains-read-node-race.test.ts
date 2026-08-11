import * as actualFs from 'node:fs'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const race = vi.hoisted(() => ({
  alias: '',
  target: '',
  outside: '',
  armed: false
}))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const realpathSync = ((path: Parameters<typeof fs.realpathSync>[0]) =>
    fs.realpathSync(path)) as typeof fs.realpathSync
  realpathSync.native = ((path: Parameters<typeof fs.realpathSync.native>[0]) => {
    const result = fs.realpathSync.native(path)
    if (race.armed && String(path) === race.target) {
      race.armed = false
      fs.rmSync(race.alias, { force: true })
      fs.symlinkSync(race.outside, race.alias, process.platform === 'win32' ? 'junction' : 'dir')
    }
    return result
  }) as unknown as typeof fs.realpathSync.native
  return { ...fs, realpathSync }
})

import { readNodeFile } from './fs-brains'

const roots: string[] = []
afterEach(() => {
  race.armed = false
  race.alias = ''
  race.target = ''
  race.outside = ''
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('readNodeFile — identité autorisée stable', () => {
  it('lit le fichier canonique autorisé si son alias est repointé après realpath', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-brains-read-race-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'fs-brains-read-outside-'))
    roots.push(root, outsideRoot)
    const allowed = join(root, 'allowed')
    const outside = join(outsideRoot, 'outside')
    const alias = join(root, 'alias')
    const relative = join('knowledge', 'domain', 'autowin-os-note.md')
    mkdirSync(join(allowed, 'knowledge', 'domain'), { recursive: true })
    mkdirSync(join(outside, 'knowledge', 'domain'), { recursive: true })
    writeFileSync(join(allowed, relative), 'INSIDE\n', 'utf8')
    writeFileSync(join(outside, relative), 'OUTSIDE\n', 'utf8')
    symlinkSync(allowed, alias, process.platform === 'win32' ? 'junction' : 'dir')

    race.alias = alias
    race.target = join(alias, relative)
    race.outside = outside
    race.armed = true

    const result = readNodeFile(
      join(alias, relative),
      allowed,
      ['knowledge/domain/autowin-os-'],
      allowed
    )

    expect(result.content).toBe('INSIDE\n')
    expect(actualFs.readFileSync(join(outside, relative), 'utf8')).toBe('OUTSIDE\n')
  })
})
