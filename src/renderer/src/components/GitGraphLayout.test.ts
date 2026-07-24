import { describe, expect, it } from 'vitest'
import type { GitGraphCommit } from '../../../shared/git-graph'
import { layoutGitGraph } from './GitGraphLayout'

function commit(hash: string, parents: string[] = []): GitGraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    refs: [],
    author: 'Test',
    date: '2026-07-23T00:00:00Z',
    subject: hash
  }
}

describe('layoutGitGraph', () => {
  it('place les branches d’un merge sur des lanes distinctes et relie tous les parents visibles', () => {
    const layout = layoutGitGraph([
      commit('merge', ['left', 'right']),
      commit('left', ['base']),
      commit('right', ['base']),
      commit('base')
    ])

    expect(layout.nodes.find((node) => node.commit.hash === 'left')?.lane).not.toBe(
      layout.nodes.find((node) => node.commit.hash === 'right')?.lane
    )
    expect(layout.edges).toHaveLength(4)
    expect(layout.width).toBeGreaterThanOrEqual(720)
  })

  it('ignore proprement un parent hors de la fenêtre d’historique', () => {
    const layout = layoutGitGraph([commit('tip', ['outside'])])

    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
  })
})
