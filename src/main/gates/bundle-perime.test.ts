import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mesureBundlePerime } from './bundle-perime'

function depotFactice(bundleSec: number, sourceSec: number): string {
  const racine = mkdtempSync(join(tmpdir(), 'aw-bundle-'))
  mkdirSync(join(racine, 'out/main'), { recursive: true })
  mkdirSync(join(racine, 'src/main/gates'), { recursive: true })
  writeFileSync(join(racine, 'out/main/index.js'), '// bundle')
  writeFileSync(join(racine, 'src/main/gates/stopgate.ts'), '// source')
  utimesSync(join(racine, 'out/main/index.js'), bundleSec, bundleSec)
  utimesSync(join(racine, 'src/main/gates/stopgate.ts'), sourceSec, sourceSec)
  return racine
}

describe('mesureBundlePerime', () => {
  it('voit la source plus recente que le bundle (cas conv-539 : bundle 11:06, correctifs 11:31)', () => {
    const m = mesureBundlePerime(depotFactice(1_000_000, 2_000_000))
    expect(m).toBeDefined()
    expect(m!.sourceMs).toBeGreaterThan(m!.bundleMs)
  })

  it('voit le bundle a jour', () => {
    const m = mesureBundlePerime(depotFactice(2_000_000, 1_000_000))
    expect(m!.sourceMs).toBeLessThan(m!.bundleMs)
  })

  it('rend undefined sans bundle plutot que d inventer un blocage', () => {
    expect(mesureBundlePerime(mkdtempSync(join(tmpdir(), 'aw-vide-')))).toBeUndefined()
  })
})
