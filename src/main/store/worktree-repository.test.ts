import { describe, expect, it } from 'vitest'
import { repositoryWorktreeIdentity } from './worktree-repository'

describe('repositoryWorktreeIdentity', () => {
  it('isole deux dépôts qui partagent la même AppData', () => {
    const first = repositoryWorktreeIdentity(
      'C:/appdata/worktrees',
      'C:/repos/a',
      () => 'C:/repos/a/.git'
    )
    const second = repositoryWorktreeIdentity(
      'C:/appdata/worktrees',
      'C:/repos/b',
      () => 'C:/repos/b/.git'
    )

    expect(first.repoId).not.toBe(second.repoId)
    expect(first.root).not.toBe(second.root)
  })

  it('refuse la mutation si l’identité Git ne peut pas être prouvée', () => {
    expect(() =>
      repositoryWorktreeIdentity('C:/appdata/worktrees', 'C:/repos/a', () => undefined)
    ).toThrow(/identité Git/)
  })
})
