// Panel arena, tâche P1 — formatUsd donne 3 décimales à TOUT montant négatif (-1.5 -> "-1,500 $").
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p1-cout-negatif.mts
import assert from 'node:assert/strict'
import { formatUsd } from '../../src/shared/cost-estimate'
assert.equal(formatUsd(-1.5), '-1,50 $')        // négatif ordinaire : 2 décimales
assert.equal(formatUsd(-0.004), '-0,004 $')     // négatif sous le centime : 3 décimales
assert.equal(formatUsd(0.004), '0,004 $')       // positif sous le centime inchangé
assert.equal(formatUsd(1234.5), '1234,50 $')    // positif ordinaire inchangé
assert.equal(formatUsd(0), '0 $')
console.log('P1 OK')
