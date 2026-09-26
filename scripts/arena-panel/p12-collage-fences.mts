// Panel arena tour 4, tâche P12 — separationEntreBlocsTexte compte les délimiteurs ``` et ~~~ ensemble, par parité :
// un ~~~ cité DANS un bloc ``` (ou un ``` dans un bloc ````) est pris pour une fermeture, et deux blocs de texte
// streamés sont alors séparés par « \n\n » au milieu d'un bloc de code — ce qui casse le code affiché.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p12-collage-fences.mts
import assert from 'node:assert/strict'
import { separationEntreBlocsTexte as s } from '../../src/shared/collage-blocs-texte'
assert.equal(s('```md\n~~~\nligne.', 'Suite'), '')                 // ~~~ dans ``` : le bloc est ENCORE ouvert
assert.equal(s('````\n```\nligne.', 'Suite'), '')                  // ``` dans ```` : encore ouvert
assert.equal(s('~~~\n```\nligne.', 'Suite'), '')                   // ``` dans ~~~ : encore ouvert
// Existant inchangé
assert.equal(s('```\ncode\n```\nFin.', 'Suite'), '\n\n')            // bloc fermé puis phrases soudées : séparées
assert.equal(s('```\ncode.', 'Suite'), '')                         // bloc ouvert simple
assert.equal(s('Fin.', 'Suite'), '\n\n')
assert.equal(s('Fin.', '```js\nx'), '\n\n')                        // un bloc qui s'ouvre se détache
console.log('P12 OK')
