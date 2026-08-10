import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { exactLineFingerprint } from '../exact-line-fingerprint'
import type { ExecutionEvidence } from './types'
import { appendPreparedCommitMutationEvidence } from './workspace-mutation-evidence'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('prepared commit mutation evidence', () => {
  it('extrait une ligne sans LF meme si Git classe le log binaire', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-mutation-commit-binary-'))
    roots.push(root)
    execFileSync('git', ['init'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@autowin.local'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Autowin Test'], { cwd: root })
    writeFileSync(
      join(root, 'app.log'),
      Buffer.concat([Buffer.from('prefix'), Buffer.from([0]), Buffer.from('\n')])
    )
    execFileSync('git', ['add', 'app.log'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'base'], { cwd: root })
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    appendFileSync(join(root, 'app.log'), 'ERROR self sans LF', 'utf8')
    execFileSync('git', ['add', 'app.log'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'agent'], { cwd: root })
    const agentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    const evidence: ExecutionEvidence[] = []

    await appendPreparedCommitMutationEvidence(
      root,
      baseSha,
      agentSha,
      [join(root, 'app.log')],
      evidence
    )

    expect(evidence[0].writtenLineFingerprintsByPath?.['app.log']).toEqual([
      exactLineFingerprint('ERROR self sans LF')
    ])
    expect(evidence[0].pathGenerationMarkers?.['app.log']).toMatch(/^present:/)
  })

  it('transporte toutes les lignes d un commit au dela de 256', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-mutation-commit-large-'))
    roots.push(root)
    execFileSync('git', ['init'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@autowin.local'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Autowin Test'], { cwd: root })
    writeFileSync(join(root, 'app.log'), '')
    execFileSync('git', ['add', 'app.log'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'base'], { cwd: root })
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    const lines = Array.from({ length: 257 }, (_, index) => `ERROR self ${index}`)
    writeFileSync(join(root, 'app.log'), `${lines.join('\n')}\n`)
    execFileSync('git', ['add', 'app.log'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'agent'], { cwd: root })
    const agentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    const evidence: ExecutionEvidence[] = []

    await appendPreparedCommitMutationEvidence(root, baseSha, agentSha, ['app.log'], evidence)

    expect(evidence[0].writtenLineFingerprintsByPath?.['app.log']).toHaveLength(257)
    expect(evidence[0].writtenLineFingerprintsByPath?.['app.log']?.at(-1)).toBe(
      exactLineFingerprint('ERROR self 256')
    )
  })
})
