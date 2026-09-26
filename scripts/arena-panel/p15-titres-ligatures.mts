// Panel arena tour 5, tâche P15 — titreSansHomonyme (src/renderer/src/components/titre-sans-homonyme.ts) a sa PROPRE copie
// du repliage des accents, sans les ligatures : « oeuvre » à côté d'un titre « Œuvre » n'est pas reconnu comme homonyme,
// et deux conversations portent alors le même titre pour l'œil. Même famille que P14 : une seule façon de replier.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p15-titres-ligatures.mts
import assert from 'node:assert/strict'
import { titreSansHomonyme as t } from '../../src/renderer/src/components/titre-sans-homonyme'
const q = new Date(2026, 8, 21, 14, 5)
assert.equal(t('oeuvre', ['Œuvre'], q), 'oeuvre · 21/09 14:05')
assert.equal(t('strasse', ['Straße'], q), 'strasse · 21/09 14:05')
assert.equal(t('AEGIR', ['Ægir'], q), 'AEGIR · 21/09 14:05')
// Existant inchangé
assert.equal(t('Œuvre', ['Œuvre'], q), 'Œuvre · 21/09 14:05')
assert.equal(t('Cafe', ['Café'], q), 'Cafe · 21/09 14:05')
assert.equal(t('Autre sujet', ['Œuvre'], q), 'Autre sujet')
console.log('P15 OK')
