// Panel arena tour 4, tâche P11 — parseUnifiedDiff : (1) une ligne RETIRÉE qui commence par « -- » (commentaire SQL/Lua)
// devient « --- … » et est prise pour un en-tête ; (2) « \ No newline at end of file » est comptée comme une ligne de contexte,
// ce qui décale tous les numéros suivants.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p11-diff-lignes.mts
import assert from 'node:assert/strict'
import { parseUnifiedDiff } from '../../src/shared/git-read'
const diff = [
  'diff --git a/x.sql b/x.sql', 'index 1..2 100644', '--- a/x.sql', '+++ b/x.sql',
  '@@ -1,3 +1,3 @@', ' select 1;', '--- commentaire retiré', '+++ commentaire ajouté', ' fin', '\\ No newline at end of file',
].join('\n')
const l = parseUnifiedDiff(diff)
assert.equal(l[2].kind, 'meta'); assert.equal(l[3].kind, 'meta')              // vrais en-têtes de fichier : meta
assert.deepEqual(l[6], { kind: 'del', text: '--- commentaire retiré', oldLine: 2 })
assert.deepEqual(l[7], { kind: 'add', text: '+++ commentaire ajouté', newLine: 2 })
assert.deepEqual(l[8], { kind: 'context', text: ' fin', oldLine: 3, newLine: 3 })
assert.equal(l[9].kind, 'meta')                                               // « \ No newline » : ni ajout ni contexte
assert.equal(l[9].oldLine, undefined); assert.equal(l[9].newLine, undefined)
// Existant inchangé
assert.deepEqual(l[5], { kind: 'context', text: ' select 1;', oldLine: 1, newLine: 1 })
assert.equal(l[4].kind, 'hunk')
console.log('P11 OK')
