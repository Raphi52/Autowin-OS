import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supprimerArbre } from './fs-supprimer'

/**
 * Gel mesure le 2026-10-10 (`gels.jsonl`, 06:55) : `discover` lisait le workspace en
 * `readdirSync` -- 240 dossiers, 2 860 ms de thread principal tenu pendant
 * `os:behaviourComposition`. L'inventaire doit parcourir les dossiers sans aucune lecture
 * synchrone de repertoire.
 */
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, readdirSync: vi.fn(original.readdirSync) }
})

vi.mock('./capability-controls', () => ({
  listCapabilities: vi.fn(async () => [])
}))

const sandboxes: string[] = []
afterEach(async () => {
  for (const dir of sandboxes.splice(0)) await supprimerArbre(dir)
})

describe('listBehaviourFiles — parcours sans gel', () => {
  it('trouve les fichiers imbriques sans un seul readdirSync', async () => {
    const root = mkdtempSync(join(tmpdir(), 'behaviour-sans-gel-'))
    sandboxes.push(root)
    const workspace = join(root, 'workspace')
    for (let i = 0; i < 12; i += 1) mkdirSync(join(workspace, `p${i}`, 'a', 'b'), { recursive: true })
    writeFileSync(join(workspace, 'p3', 'a', 'b', 'CLAUDE.md'), 'profond', 'utf8')
    writeFileSync(join(workspace, 'p7', 'AGENTS.md'), 'agents', 'utf8')
    mkdirSync(join(root, 'home'), { recursive: true })

    const { listBehaviourFiles } = await import('./behaviour-files')
    vi.mocked(fs.readdirSync).mockClear()
    const files = await listBehaviourFiles({
      workspaceRoot: workspace,
      contextRoot: workspace,
      homeRoot: join(root, 'home')
    })

    expect(vi.mocked(fs.readdirSync)).not.toHaveBeenCalled()
    const chemins = files.map((f) => f.path.replace(/\\/g, '/'))
    expect(chemins.some((p) => p.endsWith('p3/a/b/CLAUDE.md'))).toBe(true)
    expect(chemins.some((p) => p.endsWith('p7/AGENTS.md'))).toBe(true)
  })
})
