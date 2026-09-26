// Panel arena, tâche P3 — sansSequencesAnsi laisse des restes : CSI 8 bits (U+009B) et choix de jeu de caractères (ESC ( B).
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p3-ansi-residus.mts
import assert from 'node:assert/strict'
import { sansSequencesAnsi as s } from '../../src/shared/ansi'
assert.equal(s('\u009b31mX\u009b0m'), 'X')                 // CSI 8 bits
assert.equal(s('\u001b(Btexte\u001b)0'), 'texte')          // désignation de jeu G0/G1
assert.equal(s('\u001b[31mrouge\u001b[0m'), 'rouge')       // existant inchangé
assert.equal(s('[crochet] (paren) B'), '[crochet] (paren) B') // texte ordinaire intact
console.log('P3 OK')
