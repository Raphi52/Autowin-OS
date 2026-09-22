// Panel arena tour 2, tâche P5 — parseFileRef accepte « a.ts:0 » comme ligne 0 ; les lignes commencent à 1.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p5-ligne-zero.mts
import assert from 'node:assert/strict'
import { parseFileRef as p } from '../../src/shared/file-ref'
assert.deepEqual(p('a.ts:0'), { path: 'a.ts', line: undefined })     // ligne 0 : le fichier, sans ligne
assert.deepEqual(p('a.ts:00'), { path: 'a.ts', line: undefined })
assert.deepEqual(p('a.ts:0:5'), { path: 'a.ts', line: undefined })
assert.deepEqual(p('a.ts:1'), { path: 'a.ts', line: 1 })             // existant inchangé
assert.deepEqual(p('src/a.ts:12:5'), { path: 'src/a.ts', line: 12 })
assert.equal(p('a.ts:-1'), null)
console.log('P5 OK')
