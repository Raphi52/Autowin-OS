// Panel arena tour 4, tâche P10 — parseGitStatus ignore les entrées « u » (fichiers en CONFLIT) de
// `git status --porcelain=v2` : un conflit de fusion est invisible dans l'interface.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p10-git-conflits.mts
import assert from 'node:assert/strict'
import { parseGitStatus } from '../../src/shared/git-read'
const h = '0123456789abcdef0123456789abcdef01234567'
const u = (xy: string, path: string) => `u ${xy} N... 100644 100644 100644 100644 ${h} ${h} ${h} ${path}`
const s = parseGitStatus(['# branch.head main', u('UU', 'src/a.ts'), u('AA', 'dossier avec espace/b.ts'), '1 .M N... 100644 100644 100644 ' + h + ' ' + h + ' src/c.ts', '? neuf.txt'].join('\n'))
assert.deepEqual(s.changes.find((c) => c.path === 'src/a.ts'), { path: 'src/a.ts', status: 'conflicted', staged: false })
assert.deepEqual(s.changes.find((c) => c.path === 'dossier avec espace/b.ts'), { path: 'dossier avec espace/b.ts', status: 'conflicted', staged: false })
// Existant inchangé
assert.deepEqual(s.changes.find((c) => c.path === 'src/c.ts'), { path: 'src/c.ts', status: 'modified', staged: false })
assert.deepEqual(s.changes.find((c) => c.path === 'neuf.txt'), { path: 'neuf.txt', status: 'untracked', staged: false })
assert.equal(s.changes.length, 4)
assert.equal(s.branch, 'main')
console.log('P10 OK')
