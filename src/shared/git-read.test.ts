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

  it('extrait seulement le nouveau chemin d’un renommage porcelain v2', () => {
    const s = parseGitStatus(
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/new name.ts\tsrc/old name.ts'
    )

    expect(s.changes).toEqual([{ path: 'src/new name.ts', status: 'renamed', staged: true }])
  })

  /*
   * NOM CITE PAR GIT — heal conv-204, 2026-10-10. Avec `core.quotePath` (defaut), git ecrit entre
   * guillemets, a la maniere du C, tout chemin portant un octet non ASCII ou un caractere special :
   * `"accentu\303\251.ts"`. Garde tel quel, ce texte n'est le nom d'AUCUN fichier : la photo git
   * le passait a `git diff`, qui ne trouvait rien, et les modifications du fichier etaient invisibles.
   */
  it('decode un chemin cite par git (octets UTF-8 en octal) dans chaque type de ligne', () => {
    const s = parseGitStatus(
      [
        '1 .M N... 100644 100644 100644 aaa bbb "src/accentu\\303\\251.ts"',
        '? "nouveau \\303\\251t\\303\\251.ts"',
        '2 R. N... 100644 100644 100644 aaa bbb R100 "src/\\303\\251.ts"\t"src/old \\342\\202\\254.ts"',
        'u UU N... 100644 100644 100644 100644 aaa bbb ccc "conflit \\303\\240.ts"'
      ].join('\n')
    )
    expect(s.changes.map((c) => c.path)).toEqual([
      'src/accentué.ts',
      'nouveau été.ts',
      'src/é.ts',
      'conflit à.ts'
    ])
  })

  it('decode les echappements C de git (guillemet, barre oblique inverse, tabulation)', () => {
    const s = parseGitStatus('? "a\\"b\\\\c\\td.ts"')
    expect(s.changes.map((c) => c.path)).toEqual(['a"b\\c\td.ts'])
  })

  it('laisse intact un chemin non cite, meme s il contient un guillemet au milieu', () => {
    const s = parseGitStatus('? src/sans-guillemets.ts\n? src/mi"lieu.ts')
    expect(s.changes.map((c) => c.path)).toEqual(['src/sans-guillemets.ts', 'src/mi"lieu.ts'])
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

describe('parseUnifiedDiff — numéros de ligne', () => {
  it('numérote chaque ligne (avant/après) depuis les en-têtes de hunk', () => {
    const lines = parseUnifiedDiff(
      [
        'diff --git a/x.ts b/x.ts',
        '@@ -10,3 +10,4 @@',
        ' contexte',
        '-supprimee',
        '+ajoutee',
        '+ajoutee2',
        ' fin'
      ].join('\n')
    )
    const at = (k: string): (typeof lines)[number][] => lines.filter((l) => l.kind === k)

    expect(at('meta')[0]).not.toHaveProperty('oldLine')
    expect(at('meta')[0]).not.toHaveProperty('newLine')
    // Le contexte avance les DEUX compteurs, à partir du hunk (10 / 10).
    expect(at('context')[0]).toMatchObject({ oldLine: 10, newLine: 10 })
    // Une suppression n'existe que dans l'ancien fichier, un ajout que dans le nouveau.
    expect(at('del')[0]).toMatchObject({ oldLine: 11 })
    expect(at('del')[0]).not.toHaveProperty('newLine')
    expect(at('add').map((l) => l.newLine)).toEqual([11, 12])
    // Après 1 suppression et 2 ajouts, les compteurs sont désynchronisés — c'est le comportement réel.
    expect(at('context')[1]).toMatchObject({ oldLine: 12, newLine: 13 })
  })

  it('repart des bons numéros à chaque nouveau hunk', () => {
    const lines = parseUnifiedDiff(['@@ -1,1 +1,1 @@', '+a', '@@ -50,1 +60,1 @@', '+b'].join('\n'))
    const adds = lines.filter((l) => l.kind === 'add')
    expect(adds[0].newLine).toBe(1)
    expect(adds[1].newLine).toBe(60)
  })
})
