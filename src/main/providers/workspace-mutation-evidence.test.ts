import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendWorkspaceMutationEvidence,
  captureWorkspaceMutationSnapshot
} from './workspace-mutation-evidence'
import type { ExecutionEvidence } from './types'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('workspace mutation evidence', () => {
  it('attribue le delta réel et ignore un fichier sale mais inchangé pendant le tour', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-mutation-delta-'))
    roots.push(root)
    execFileSync('git', ['init'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@autowin.local'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Autowin Test'], { cwd: root })
    writeFileSync(join(root, 'edited.ts'), 'initial\n', 'utf8')
    writeFileSync(join(root, 'foreign.ts'), 'initial\n', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })
    writeFileSync(join(root, 'foreign.ts'), 'sale avant le tour\n', 'utf8')

    const before = await captureWorkspaceMutationSnapshot(root)
    writeFileSync(join(root, 'edited.ts'), 'modifié par le tour\n', 'utf8')
    writeFileSync(join(root, 'created.ts'), 'créé par le tour\n', 'utf8')
    const evidence: ExecutionEvidence[] = []
    await appendWorkspaceMutationEvidence(before, root, evidence)

    expect(evidence).toMatchObject([
      {
        type: 'workspace_delta',
        kind: 'mutation',
        ok: true,
        paths: ['created.ts', 'edited.ts']
      }
    ])
  })
})
