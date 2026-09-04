import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureWorkflowBenchCheckpoint } from './workflow-bench-checkpoint'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('checkpoint reel du banc contrefactuel', () => {
  it('capture HEAD et distingue un workspace sale avant le premier bras', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-counterfactual-'))
    roots.push(root)
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
    git('init')
    git('config', 'user.email', 'autowin@test.local')
    git('config', 'user.name', 'Autowin Test')
    writeFileSync(join(root, 'tracked.txt'), 'base\n')
    git('add', 'tracked.txt')
    git('commit', '-m', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()

    const clean = await captureWorkflowBenchCheckpoint(root, 'objectif')
    writeFileSync(join(root, 'untracked.txt'), 'delta\n')
    const dirty = await captureWorkflowBenchCheckpoint(root, 'objectif')

    expect(clean.sourceSnapshot.baseSha).toBe(baseSha)
    expect(clean.state.dirty).toBe(false)
    expect(dirty.state.dirty).toBe(true)
    expect(dirty.sourceSnapshot.baseSha).not.toBe(baseSha)
    expect(git('show', `${dirty.sourceSnapshot.baseSha}:untracked.txt`)).toBe('delta\n')
    expect(dirty.sourceSnapshot.contentHash).not.toBe(clean.sourceSnapshot.contentHash)

    writeFileSync(join(root, 'untracked.txt'), 'autre contenu, meme statut\n')
    const sameStatusDifferentContent = await captureWorkflowBenchCheckpoint(root, 'objectif')
    expect(sameStatusDifferentContent.sourceSnapshot.contentHash).not.toBe(
      dirty.sourceSnapshot.contentHash
    )
  })
})
