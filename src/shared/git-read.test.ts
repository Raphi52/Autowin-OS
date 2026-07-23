import { describe, expect, it } from 'vitest'
import { parseGitStatus, parseGitLog, parseUnifiedDiff } from './git-read'

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

describe('parseUnifiedDiff', () => {
  const diff = [
    'diff --git a/f.ts b/f.ts',
    'index 111..222 100644',
    '--- a/f.ts',
    '+++ b/f.ts',
    '@@ -1,3 +1,3 @@',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    ' const c = 4'
  ].join('\n')

  it('type chaque ligne (meta/hunk/add/del/context)', () => {
    const d = parseUnifiedDiff(diff)
    expect(d.find((l) => l.text.startsWith('diff '))!.kind).toBe('meta')
    expect(d.find((l) => l.text.startsWith('@@'))!.kind).toBe('hunk')
    expect(d.filter((l) => l.kind === 'add')).toHaveLength(1)
    expect(d.filter((l) => l.kind === 'del')).toHaveLength(1)
    expect(d.find((l) => l.text === ' const a = 1')!.kind).toBe('context')
  })

  it('vide → []', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})
