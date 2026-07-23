import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { catalogPath, enablementPath } from './native-registry'

// On teste la couche capability-controls contre un registre natif LOCAL (aucun sous-processus).

describe('capability-controls (source locale générique, sans Native)', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'capctl-'))
    // catalogue tools déclaratif + état d'activation initial
    writeFileSync(
      catalogPath(base),
      JSON.stringify({
        tools: [
          { id: 'alpha', label: 'alpha', description: '', mutable: true },
          { id: 'beta', label: 'beta', description: '', mutable: true },
          { id: 'gamma', label: 'gamma', description: '', mutable: true }
        ]
      })
    )
    writeFileSync(
      enablementPath(base),
      JSON.stringify({ tools: { alpha: true, beta: false, gamma: false } })
    )
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('le registre natif applique une sélection cible par diff', async () => {
    const { setNativeEnablement, listNativeRegistry } = await import('./native-registry')
    const target = new Set(['beta', 'gamma'])
    for (const item of listNativeRegistry('tools', base)) {
      if (item.enabled !== target.has(item.id)) setNativeEnablement('tools', item.id, target.has(item.id), base)
    }
    const after = listNativeRegistry('tools', base)
    expect(after.find((i) => i.id === 'alpha')?.enabled).toBe(false)
    expect(after.find((i) => i.id === 'beta')?.enabled).toBe(true)
    expect(after.find((i) => i.id === 'gamma')?.enabled).toBe(true)
  })

  it('listCapabilities délègue au registre natif (skills scannés du disque)', async () => {
    const { listCapabilities } = await import('./capability-controls')
    const skills = await listCapabilities('skills')
    expect(Array.isArray(skills)).toBe(true) // pas de throw, source locale
  })
})
