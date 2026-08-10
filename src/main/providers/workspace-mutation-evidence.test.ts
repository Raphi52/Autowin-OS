import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendWorkspaceMutationEvidence,
  captureWorkspaceMutationSnapshot
} from './workspace-mutation-evidence'
import type { ExecutionEvidence } from './types'
import { exactLineFingerprint } from '../exact-line-fingerprint'

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
    writeFileSync(join(root, 'created.ts'), 'créé par le tour\ncréé par le tour\n', 'utf8')
    const evidence: ExecutionEvidence[] = []
    await appendWorkspaceMutationEvidence(before, root, evidence)

    expect(evidence).toMatchObject([
      {
        type: 'workspace_delta',
        kind: 'mutation',
        ok: true,
        paths: ['created.ts', 'edited.ts'],
        writtenLineFingerprintsByPath: {
          'created.ts': [
            exactLineFingerprint('créé par le tour'),
            exactLineFingerprint('créé par le tour')
          ],
          'edited.ts': [exactLineFingerprint('modifié par le tour')]
        }
      }
    ])
  })

  it('conserve toutes les lignes réellement ajoutées quand Edit et shell touchent le même fichier', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-mutation-mixed-'))
    roots.push(root)
    execFileSync('git', ['init'], { cwd: root })
    writeFileSync(join(root, 'app.log'), 'initial\n', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'initial'], {
      cwd: root
    })

    const before = await captureWorkspaceMutationSnapshot(root, ['app.log'])
    appendFileSync(join(root, 'app.log'), 'ERROR via Edit\nERROR via shell\n', 'utf8')
    const evidence: ExecutionEvidence[] = [
      {
        type: 'file_change',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: 'Edit',
        paths: ['app.log'],
        writtenLineFingerprints: [exactLineFingerprint('ERROR via Edit')]
      },
      {
        type: 'file_change',
        kind: 'mutation',
        status: 'failed',
        ok: false,
        summary: 'échec sans écriture',
        paths: ['app.log'],
        writtenLineFingerprints: [exactLineFingerprint('ERROR fantôme')]
      }
    ]

    await appendWorkspaceMutationEvidence(before, root, evidence)

    expect(evidence.at(-1)?.writtenLineFingerprintsByPath?.['app.log']).toEqual([
      exactLineFingerprint('ERROR via Edit'),
      exactLineFingerprint('ERROR via shell')
    ])
  })

  it('observe les lignes ajoutées à un log ignoré explicitement surveillé', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-mutation-ignored-'))
    roots.push(root)
    execFileSync('git', ['init'], { cwd: root })
    writeFileSync(join(root, '.gitignore'), '*.log\n', 'utf8')
    writeFileSync(join(root, 'app.log'), 'initial\n', 'utf8')
    execFileSync('git', ['add', '.gitignore'], { cwd: root })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'initial'], {
      cwd: root
    })

    const before = await captureWorkspaceMutationSnapshot(root, ['app.log'])
    appendFileSync(join(root, 'app.log'), '++ERROR auto\n', 'utf8')
    const evidence: ExecutionEvidence[] = []
    await appendWorkspaceMutationEvidence(before, root, evidence)

    expect(evidence).toMatchObject([
      {
        type: 'workspace_delta',
        paths: ['app.log'],
        writtenLineFingerprintsByPath: {
          'app.log': [exactLineFingerprint('++ERROR auto')]
        }
      }
    ])
  })
})
