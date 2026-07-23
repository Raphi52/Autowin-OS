import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import type { FinalizeResult } from './worktree-manager'

function fakeManager(over: Partial<{
  acquire: (id: string) => string
  finalize: (id: string) => FinalizeResult
  changedFiles: (id: string) => string[]
  remove: (id: string) => void
}> = {}) {
  return {
    acquire: over.acquire ?? ((id: string) => `/wt/${id}`),
    finalize: over.finalize ?? ((id: string) => ({ outcome: 'merged', agentId: id, committed: true } as FinalizeResult)),
    changedFiles: over.changedFiles ?? (() => ['os.ts']),
    remove: over.remove ?? (() => {})
  }
}

describe('RunWorktreeCoordinator (flip live)', () => {
  it('run MUTATION → acquiert une copie et renvoie son cwd', () => {
    const acquire = vi.fn((id: string) => `/wt/${id}`)
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ acquire }), nowFn: () => 1 })
    const cwd = co.begin('run-1', 'Builder', true)
    expect(cwd).toBe('/wt/run-1')
    expect(acquire).toHaveBeenCalledWith('run-1')
    expect(co.activity()[0]).toMatchObject({ agentId: 'run-1', state: 'working' })
  })

  it('run NON-mutation → pas de copie, cwd undefined (retombe sur la base)', () => {
    const acquire = vi.fn()
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ acquire }), nowFn: () => 1 })
    expect(co.begin('run-2', 'Scout', false)).toBeUndefined()
    expect(acquire).not.toHaveBeenCalled()
  })

  it('end fusionne en full-auto et marque merged', () => {
    const co = new RunWorktreeCoordinator({ manager: fakeManager(), nowFn: () => 5 })
    co.begin('run-1', 'Builder', true)
    const res = co.end('run-1')
    expect(res?.outcome).toBe('merged')
    expect(co.activity()[0]).toMatchObject({ state: 'merged', endedAtMs: 5 })
  })

  it('end en CONFLIT → state conflict + fichier remonté (pas d’écrasement)', () => {
    const finalize = (id: string): FinalizeResult => ({ outcome: 'conflict', agentId: id, files: ['os.ts'] })
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ finalize }), nowFn: () => 9 })
    co.begin('run-1', 'Judge', true)
    const res = co.end('run-1')
    expect(res?.outcome).toBe('conflict')
    const a = co.activity()[0]
    expect(a.state).toBe('conflict')
    expect(a.conflictFile).toBe('os.ts')
  })

  it('notifie onActivity à chaque changement (pour l’IPC → renderer)', () => {
    const onActivity = vi.fn()
    const co = new RunWorktreeCoordinator({ manager: fakeManager(), nowFn: () => 1, onActivity })
    co.begin('run-1', 'Builder', true)
    co.end('run-1')
    expect(onActivity).toHaveBeenCalled()
    // dernier appel = état final merged
    const last = onActivity.mock.calls.at(-1)![0]
    expect(last[0].state).toBe('merged')
  })

  it('end sur run inconnu → undefined, ne jette pas', () => {
    const co = new RunWorktreeCoordinator({ manager: fakeManager() })
    expect(co.end('nope')).toBeUndefined()
  })
})
