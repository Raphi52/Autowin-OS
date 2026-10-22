import { describe, expect, it } from 'vitest'
import { parseGitStatus, parseUnifiedDiff } from './git-read'

// Migré de scripts/arena-panel/p10-git-conflits.mts et p11-diff-lignes.mts (banc /arena,
// commit 191ab51d), retirés le 2026-10-22 (residus, conv-1062).
describe('parseGitStatus — fichiers en conflit (p10)', () => {
  const h = '0123456789abcdef0123456789abcdef01234567'
  const u = (xy: string, path: string): string =>
    `u ${xy} N... 100644 100644 100644 100644 ${h} ${h} ${h} ${path}`
  const s = parseGitStatus(
    [
      '# branch.head main',
      u('UU', 'src/a.ts'),
      u('AA', 'dossier avec espace/b.ts'),
      `1 .M N... 100644 100644 100644 ${h} ${h} src/c.ts`,
      '? neuf.txt'
    ].join('\n')
  )
  it('un conflit de fusion est visible, même avec des espaces dans le chemin', () => {
    expect(s.changes.find((c) => c.path === 'src/a.ts')).toEqual({
      path: 'src/a.ts',
      status: 'conflicted',
      staged: false
    })
    expect(s.changes.find((c) => c.path === 'dossier avec espace/b.ts')).toEqual({
      path: 'dossier avec espace/b.ts',
      status: 'conflicted',
      staged: false
    })
  })
  it('les entrées ordinaires sont inchangées', () => {
    expect(s.changes.find((c) => c.path === 'src/c.ts')).toEqual({
      path: 'src/c.ts',
      status: 'modified',
      staged: false
    })
    expect(s.changes.find((c) => c.path === 'neuf.txt')).toEqual({
      path: 'neuf.txt',
      status: 'untracked',
      staged: false
    })
    expect(s.changes).toHaveLength(4)
    expect(s.branch).toBe('main')
  })
})

describe('parseUnifiedDiff — lignes « -- » et « \\ No newline » (p11)', () => {
  const l = parseUnifiedDiff(
    [
      'diff --git a/x.sql b/x.sql',
      'index 1..2 100644',
      '--- a/x.sql',
      '+++ b/x.sql',
      '@@ -1,3 +1,3 @@',
      ' select 1;',
      '--- commentaire retiré',
      '+++ commentaire ajouté',
      ' fin',
      '\\ No newline at end of file'
    ].join('\n')
  )
  it('les vrais en-têtes de fichier restent des méta-lignes', () => {
    expect(l[2].kind).toBe('meta')
    expect(l[3].kind).toBe('meta')
    expect(l[4].kind).toBe('hunk')
  })
  it('une ligne retirée qui commence par « -- » est un retrait, pas un en-tête', () => {
    expect(l[6]).toEqual({ kind: 'del', text: '--- commentaire retiré', oldLine: 2 })
    expect(l[7]).toEqual({ kind: 'add', text: '+++ commentaire ajouté', newLine: 2 })
    expect(l[8]).toEqual({ kind: 'context', text: ' fin', oldLine: 3, newLine: 3 })
  })
  it('« \\ No newline at end of file » ne décale pas les numéros', () => {
    expect(l[9].kind).toBe('meta')
    expect(l[9].oldLine).toBeUndefined()
    expect(l[9].newLine).toBeUndefined()
    expect(l[5]).toEqual({ kind: 'context', text: ' select 1;', oldLine: 1, newLine: 1 })
  })
})
