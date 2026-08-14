import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pruneLegacyContextValues } from './context-value-gc'

describe('pruneLegacyContextValues', () => {
  it('supprime seulement les anciens fichiers du cache legacy', () => {
    const base = mkdtempSync(join(tmpdir(), 'aos-context-gc-'))
    const root = join(base, 'context-values')
    mkdirSync(root)
    const oldFile = join(root, 'old.txt')
    const recentFile = join(root, 'recent.txt')
    writeFileSync(oldFile, 'ancien')
    writeFileSync(recentFile, 'récent')
    const nowMs = 1_800_000_000_000
    const oldDate = new Date(nowMs - 31 * 24 * 60 * 60 * 1000)
    utimesSync(oldFile, oldDate, oldDate)
    const recentDate = new Date(nowMs - 24 * 60 * 60 * 1000)
    utimesSync(recentFile, recentDate, recentDate)

    expect(pruneLegacyContextValues(base, 30, nowMs)).toBe(1)
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(recentFile)).toBe(true)
  })
})
