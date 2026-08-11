import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readNodeFile } from './fs-brains'

const roots: string[] = []
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('readNodeFile — course sur le chemin canonique', () => {
  it('refuse un composant canonique repointé juste avant open', () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'fs-brains-canonical-race-'))
    const outsideRoot = fs.mkdtempSync(join(tmpdir(), 'fs-brains-canonical-outside-'))
    roots.push(root, outsideRoot)
    const allowed = join(root, 'allowed')
    const outside = join(outsideRoot, 'outside')
    const relative = join('knowledge', 'domain', 'autowin-os-note.md')
    fs.mkdirSync(join(allowed, 'knowledge', 'domain'), { recursive: true })
    fs.mkdirSync(join(outside, 'knowledge', 'domain'), { recursive: true })
    fs.writeFileSync(join(allowed, relative), 'INSIDE\n', 'utf8')
    fs.writeFileSync(join(outside, relative), 'OUTSIDE\n', 'utf8')

    expect(() =>
      readNodeFile(
        join(allowed, relative),
        allowed,
        ['knowledge/domain/autowin-os-'],
        allowed,
        (canonicalPath) => {
          fs.renameSync(allowed, `${allowed}-secured`)
          fs.symlinkSync(outside, allowed, process.platform === 'win32' ? 'junction' : 'dir')
          return fs.openSync(canonicalPath, 'r')
        }
      )
    ).toThrow(/hors périmètre autorisé/)
    expect(fs.readFileSync(join(outside, relative), 'utf8')).toBe('OUTSIDE\n')
  })
})
