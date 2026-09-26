// Panel arena tour 3, tâche P9 — extrairePari compte comme VRAI pari un exemple cité dans un bloc ~~~,
// ou dans un bloc ```` contenant ``` : le score de calibration mesure alors un exemple pédagogique.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p9-pari-dans-un-bloc.mts
import assert from 'node:assert/strict'
import { extrairePari as p } from '../../src/shared/pari-parse'
const L = (c: number, r: string) => `AUTOWIN_PARI_V1: {"confiance":${c},"refutateur":"${r}"}`
assert.equal(p(`~~~\n${L(0.99, 'ex')}\n~~~`), null)                         // bloc ~~~
assert.equal(p(`~~~~\n~~~\n${L(0.99, 'ex')}\n~~~~`), null)                  // ~~~ dans un ~~~~ ne ferme pas
assert.equal(p(`\`\`\`\`md\n\`\`\`\n${L(0.99, 'ex')}\n\`\`\`\``), null)      // ``` dans un ```` ne ferme pas
assert.deepEqual(p(`~~~\n${L(0.99, 'ex')}\n~~~\n${L(0.6, 'vrai')}`), { confiance: 0.6, refutateur: 'vrai' })
// Existant inchangé
assert.deepEqual(p(L(0.7, 'x')), { confiance: 0.7, refutateur: 'x' })
assert.equal(p(`\`\`\`\n${L(0.9, 'ex')}\n\`\`\``), null)
console.log('P9 OK')
