import { describe, expect, it } from 'vitest'
import { parseGitGraphCommits, parseGitGraphRefs, parseGitWorktrees } from './git-graph'

describe('parseGitGraphRefs', () => {
  it('conserve toutes les références et distingue local, remote et tag', () => {
    const input = [
      'aaaaaaaa\x1f\x1frefs/heads/main\x1f*\x1e',
      'bbbbbbbb\x1f\x1frefs/remotes/origin/main\x1f \x1e',
      'tagobject\x1fcccccccc\x1frefs/tags/v1.0.0\x1f \x1e'
    ].join('')

    expect(parseGitGraphRefs(input)).toEqual([
      {
        name: 'main',
        fullName: 'refs/heads/main',
        kind: 'local',
        hash: 'aaaaaaaa',
        isHead: true
      },
      {
        name: 'origin/main',
        fullName: 'refs/remotes/origin/main',
        kind: 'remote',
        hash: 'bbbbbbbb',
        isHead: false
      },
      {
        name: 'v1.0.0',
        fullName: 'refs/tags/v1.0.0',
        kind: 'tag',
        hash: 'cccccccc',
        isHead: false
      }
    ])
  })
})

describe('parseGitGraphCommits', () => {
  it('préserve parents, décorations, auteur, date et sujet', () => {
    const input =
      'aaaaaaaa\x1faaaaaaa\x1fbbbbbbbb cccccccc\x1fHEAD -> main, origin/main\x1fRaphaël\x1f2026-07-23T19:00:00+02:00\x1fmerge: exemple\x1e'

    expect(parseGitGraphCommits(input)).toEqual([
      {
        hash: 'aaaaaaaa',
        shortHash: 'aaaaaaa',
        parents: ['bbbbbbbb', 'cccccccc'],
        refs: ['HEAD -> main', 'origin/main'],
        author: 'Raphaël',
        date: '2026-07-23T19:00:00+02:00',
        subject: 'merge: exemple'
      }
    ])
  })
})

describe('parseGitWorktrees', () => {
  it('parse les worktrees branchés, detached et verrouillés', () => {
    const input = [
      'worktree C:/repo',
      'HEAD aaaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree C:/repo-proof',
      'HEAD bbbbbbbb',
      'detached',
      'locked preuve',
      ''
    ].join('\n')

    expect(parseGitWorktrees(input)).toEqual([
      {
        path: 'C:/repo',
        head: 'aaaaaaaa',
        branch: 'main',
        detached: false,
        locked: false
      },
      {
        path: 'C:/repo-proof',
        head: 'bbbbbbbb',
        detached: true,
        locked: true
      }
    ])
  })
})
