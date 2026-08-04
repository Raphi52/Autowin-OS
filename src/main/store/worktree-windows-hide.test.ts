import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(
  () => [] as Array<{ bin: string; args: string[]; options: Record<string, unknown> }>
)

vi.mock('node:child_process', () => ({
  execFileSync: (bin: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ bin, args, options })
    if (args.includes('--git-common-dir')) return '.git\n'
    return ''
  }
}))

import { WorktreeManager } from './worktree-manager'
import { repositoryWorktreeIdentity } from './worktree-repository'

beforeEach(() => calls.splice(0))

describe('frontière Git worktree — aucune console Windows', () => {
  it('masque la sonde dépôt et les deux runners Git du manager', () => {
    repositoryWorktreeIdentity('C:\\worktrees', 'C:\\repo')
    const manager = new WorktreeManager({ baseRepo: 'C:\\repo', worktreeRoot: 'C:\\worktrees' })
    const git = Reflect.get(manager, 'git') as (repo: string, args: string[]) => string
    const tryGit = Reflect.get(manager, 'tryGitFn') as (
      repo: string,
      args: string[]
    ) => { code: number }

    git('C:\\repo', ['status', '--porcelain'])
    tryGit('C:\\repo', ['merge', '--no-edit', 'agent'])

    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.bin === 'git')).toBe(true)
    expect(calls.every((call) => call.options.windowsHide === true)).toBe(true)
  })
})
