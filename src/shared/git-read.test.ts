import { describe, expect, it } from 'vitest'
import { parseGitStatus, parseGitLog } from './git-read'

describe('parseGitStatus (porcelain v2 --branch)', () => {
  const sample = [
    '# branch.oid abc123',
    '# branch.head feat/source-control',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/renderer/ChatView.tsx',
    '1 M. N... 100644 100644 100644 ccc ddd src/main/index.ts',
    '1 A. N... 000000 100644 100644 000 eee src/shared/git-read.ts',
    '? src/untracked-file.ts'
  ].join('\n')

  it('extrait la branche et ahead/behind', () => {
    const s = parseGitStatus(sample)
    expect(s.branch).toBe('feat/source-control')
    expect(s.ahead).toBe(2)
    expect(s.behind).toBe(1)
  })

  it('classe les changements (modified/added/untracked) + staged', () => {
    const s = parseGitStatus(sample)
    expect(s.changes).toHaveLength(4)
    const chatview = s.changes.find((c) => c.path.endsWith('ChatView.tsx'))!
    expect(chatview).toMatchObject({ status: 'modified', staged: false }) // XY = ".M" → unstaged
    const index = s.changes.find((c) => c.path.endsWith('index.ts'))!
    expect(index).toMatchObject({ status: 'modified', staged: true }) // "M." → staged
    const untracked = s.changes.find((c) => c.path.endsWith('untracked-file.ts'))!
    expect(untracked.status).toBe('untracked')
  })

  it('repo propre → aucun changement', () => {
    const s = parseGitStatus('# branch.head main\n# branch.ab +0 -0')
    expect(s.branch).toBe('main')
    expect(s.changes).toHaveLength(0)
  })
})

describe('parseGitLog', () => {
  it('parse hash + sujet séparés par une tab', () => {
    const log = 'a1b2c3d\tfeat: source control\ne4f5g6h\tfix: parser'
    const c = parseGitLog(log)
    expect(c).toHaveLength(2)
    expect(c[0]).toEqual({ hash: 'a1b2c3d', subject: 'feat: source control' })
  })
  it('vide → []', () => {
    expect(parseGitLog('')).toEqual([])
  })
})
