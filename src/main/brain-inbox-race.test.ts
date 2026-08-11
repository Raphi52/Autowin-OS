import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const race = vi.hoisted(() => ({
  armed: false,
  kind: '' as 'collision' | 'junction' | 'post-junction' | 'fsync' | '',
  target: '',
  destination: '',
  outside: ''
}))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const trigger = (path: unknown): void => {
    if (!race.armed || String(path) !== race.target) return
    race.armed = false
    if (race.kind === 'collision') {
      fs.writeFileSync(race.target, '# concurrent\n', 'utf8')
      return
    }
    fs.renameSync(race.destination, `${race.destination}-secured`)
    fs.symlinkSync(
      race.outside,
      race.destination,
      process.platform === 'win32' ? 'junction' : 'dir'
    )
  }
  return {
    ...fs,
    existsSync(path: Parameters<typeof fs.existsSync>[0]) {
      const exists = fs.existsSync(path)
      if (!exists) trigger(path)
      return exists
    },
    openSync(path: Parameters<typeof fs.openSync>[0], flags: Parameters<typeof fs.openSync>[1]) {
      if (flags === 'wx' && (race.kind === 'collision' || race.kind === 'junction')) trigger(path)
      return fs.openSync(path, flags)
    },
    fsyncSync(descriptor: Parameters<typeof fs.fsyncSync>[0]) {
      fs.fsyncSync(descriptor)
      if (race.kind === 'post-junction' && race.armed) trigger(race.target)
      if (race.kind === 'fsync' && race.armed) {
        race.armed = false
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      }
    },
    renameSync(
      oldPath: Parameters<typeof fs.renameSync>[0],
      newPath: Parameters<typeof fs.renameSync>[1]
    ) {
      trigger(newPath)
      return fs.renameSync(oldPath, newPath)
    }
  }
})

import { promoteInboxCandidate } from './brain-inbox'

const roots: string[] = []
afterEach(() => {
  race.armed = false
  race.kind = ''
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function brainRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'brain-inbox-race-'))
  roots.push(root)
  mkdirSync(join(root, 'inbox'), { recursive: true })
  mkdirSync(join(root, 'knowledge'), { recursive: true })
  writeFileSync(join(root, 'inbox', 'a.md'), '# candidat\n', 'utf8')
  return root
}

describe('promotion Brain — réservation sans écrasement', () => {
  it('conserve une création concurrente et réserve le suffixe suivant', () => {
    const root = brainRoot()
    race.kind = 'collision'
    race.target = join(root, 'knowledge', 'a.md')
    race.armed = true

    const moved = promoteInboxCandidate(root, 'inbox/a')

    expect(moved.to).toBe('knowledge/a-2')
    expect(readFileSync(join(root, 'knowledge', 'a.md'), 'utf8')).toBe('# concurrent\n')
    expect(readFileSync(join(root, 'knowledge', 'a-2.md'), 'utf8')).toBe('# candidat\n')
  })

  it('ne copie aucun octet candidat si la destination est repointée avant sa réservation', () => {
    const root = brainRoot()
    const outside = mkdtempSync(join(tmpdir(), 'brain-inbox-race-outside-'))
    roots.push(outside)
    race.kind = 'junction'
    race.destination = join(root, 'knowledge')
    race.target = join(race.destination, 'a.md')
    race.outside = outside
    race.armed = true

    expect(() => promoteInboxCandidate(root, 'inbox/a')).toThrow(/hors périmètre/)
    expect(readFileSync(join(root, 'inbox', 'a.md'), 'utf8')).toBe('# candidat\n')
    for (const entry of readdirSync(outside)) {
      expect(readFileSync(join(outside, entry), 'utf8')).not.toContain('# candidat')
    }
  })

  it('conserve la source si la destination est repointée après écriture', () => {
    const root = brainRoot()
    const outside = mkdtempSync(join(tmpdir(), 'brain-inbox-post-race-outside-'))
    roots.push(outside)
    race.kind = 'post-junction'
    race.destination = join(root, 'knowledge')
    race.target = join(race.destination, 'a.md')
    race.outside = outside
    race.armed = true

    expect(() => promoteInboxCandidate(root, 'inbox/a')).toThrow(/hors périmètre|EPERM|EBUSY/)
    expect(readFileSync(join(root, 'inbox', 'a.md'), 'utf8')).toBe('# candidat\n')
    expect(readdirSync(outside)).toEqual([])
    if (existsSync(`${race.destination}-secured/a.md`)) {
      expect(readFileSync(`${race.destination}-secured/a.md`, 'utf8')).toBe('')
    } else {
      expect(readFileSync(join(race.destination, 'a.md'), 'utf8')).toBe('')
    }
  })

  it('met une cible partielle en quarantaine si fsync échoue', () => {
    const root = brainRoot()
    race.kind = 'fsync'
    race.target = join(root, 'knowledge', 'a.md')
    race.armed = true

    expect(() => promoteInboxCandidate(root, 'inbox/a')).toThrow(/disk full/)
    expect(readFileSync(join(root, 'inbox', 'a.md'), 'utf8')).toBe('# candidat\n')
    expect(readFileSync(join(root, 'knowledge', 'a.md'), 'utf8')).toBe('')
  })
})
