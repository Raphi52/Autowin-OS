import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedUtf8FileWithin, readUtf8Prefix } from './bounded-file-read'

const sandboxes: string[] = []

afterEach(() => {
  for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('bounded file reads', () => {
  it('never reads more than the requested prefix for skill metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'bounded-prefix-'))
    sandboxes.push(root)
    const path = join(root, 'SKILL.md')
    writeFileSync(path, 'a'.repeat(1_000_000), 'utf8')

    expect(Buffer.byteLength(readUtf8Prefix(path, 2048), 'utf8')).toBe(2048)
  })

  it('rejects an oversized file and a target outside the allowed canonical root', () => {
    const root = mkdtempSync(join(tmpdir(), 'bounded-read-'))
    sandboxes.push(root)
    const allowed = join(root, 'allowed')
    const outside = join(root, 'outside')
    mkdirSync(allowed, { recursive: true })
    mkdirSync(outside, { recursive: true })
    const large = join(allowed, 'large.md')
    const secret = join(outside, 'secret.md')
    writeFileSync(large, 'x'.repeat(101), 'utf8')
    writeFileSync(secret, 'secret', 'utf8')

    expect(() => readBoundedUtf8FileWithin(large, [allowed], 100)).toThrow(/volumineux|limite/i)
    expect(() => readBoundedUtf8FileWithin(secret, [allowed], 100)).toThrow(/racine|autoris/i)
  })
})
