import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeRunStateStore, type WorktreeRunRecord } from './worktree-run-state'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-worktree-state-'))
  roots.push(root)
  return root
}

function record(root: string, overrides: Partial<WorktreeRunRecord> = {}): WorktreeRunRecord {
  return {
    version: 1,
    repoId: 'repo-a',
    runId: 'run-red',
    agentName: 'Builder',
    role: 'build',
    task: 'corrige le cycle',
    worktreePath: join(root, 'agent__run-red'),
    baseBranch: 'main',
    baseSha: '1'.repeat(40),
    verdict: 'red',
    publication: 'not-requested',
    files: [{ path: 'src/main/os.ts', kind: 'mod' }],
    createdAtMs: 10,
    updatedAtMs: 20,
    ...overrides
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('WorktreeRunStateStore', () => {
  it('conserve un verdict rouge à travers deux redémarrages', () => {
    const root = tempRoot()
    new WorktreeRunStateStore(root, 'repo-a').save(record(root))

    const firstRestart = new WorktreeRunStateStore(root, 'repo-a')
    expect(firstRestart.get('run-red')).toMatchObject({
      verdict: 'red',
      publication: 'not-requested'
    })

    const secondRestart = new WorktreeRunStateStore(root, 'repo-a')
    expect(secondRestart.get('run-red')).toMatchObject({
      verdict: 'red',
      publication: 'not-requested'
    })
  })

  it('refuse fail-closed un manifeste corrompu ou attribué à un autre dépôt', () => {
    const root = tempRoot()
    const store = new WorktreeRunStateStore(root, 'repo-a')
    mkdirSync(join(root, '.runs'), { recursive: true })
    writeFileSync(
      store.pathFor('foreign'),
      JSON.stringify(
        record(root, {
          runId: 'foreign',
          repoId: 'repo-b',
          worktreePath: join(root, 'agent__foreign')
        })
      )
    )
    writeFileSync(store.pathFor('broken'), '{')
    writeFileSync(
      store.pathFor('invalid-verdict'),
      JSON.stringify(
        record(root, {
          runId: 'invalid-verdict',
          verdict: 'red',
          worktreePath: join(root, 'agent__invalid-verdict')
        }) as unknown
      ).replace('"verdict":"red"', '"verdict":"magically-green"')
    )

    expect(store.get('foreign')).toMatchObject({
      runId: 'foreign',
      verdict: 'unknown',
      publication: 'blocked'
    })
    expect(store.get('broken')).toMatchObject({
      runId: 'broken',
      verdict: 'unknown',
      publication: 'blocked'
    })
    expect(store.get('invalid-verdict')).toMatchObject({
      runId: 'invalid-verdict',
      verdict: 'unknown',
      publication: 'blocked'
    })
  })

  it('refuse fail-closed un manifeste vert forge sans contexte Git publiable', () => {
    const root = tempRoot()
    const store = new WorktreeRunStateStore(root, 'repo-a')
    mkdirSync(join(root, '.runs'), { recursive: true })
    writeFileSync(
      store.pathFor('forged-green'),
      JSON.stringify(
        record(root, {
          runId: 'forged-green',
          worktreePath: '',
          baseBranch: '',
          baseSha: '',
          verdict: 'green',
          publication: 'pending'
        })
      )
    )

    expect(store.get('forged-green')).toMatchObject({
      runId: 'forged-green',
      verdict: 'unknown',
      publication: 'blocked'
    })
  })
})
