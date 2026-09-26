// Panel arena, tâche P2 — motsDe coupe les mots sur les ligatures : « l'œuvre » -> ["uvre"].
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p2-ligatures.mts
import assert from 'node:assert/strict'
import { motsDe } from '../../src/shared/mots'
assert.ok(motsDe('l’œuvre').includes('oeuvre'), JSON.stringify(motsDe('l’œuvre')))
assert.ok(motsDe('Ægir').includes('aegir'), JSON.stringify(motsDe('Ægir')))
assert.ok(motsDe('Straße').includes('strasse'), JSON.stringify(motsDe('Straße')))
assert.deepEqual(motsDe('Écrire un fichier.ts'), ['ecrire', 'fichier.ts'])  // existant inchangé
assert.ok(!motsDe('l’œuvre').includes('uvre'))
console.log('P2 OK')
