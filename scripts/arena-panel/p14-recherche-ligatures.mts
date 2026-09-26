// Panel arena tour 5, tâche P14 — la recherche de conversations (src/renderer/src/components/conversation-search.ts) replie
// les accents avec sa PROPRE copie, sans les ligatures corrigées au tour 1 dans shared/mots.ts : « oeuvre » ne trouve pas
// « l'œuvre ». Le surlignage doit rester exact sur le texte d'ORIGINE, y compris quand le repliage change la longueur
// (œ -> oe) et quand l'accent est stocké séparément de sa lettre (« e » + U+0301).
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p14-recherche-ligatures.mts
import assert from 'node:assert/strict'
import { searchConversations as s, segmentsSurlignes as seg } from '../../src/renderer/src/components/conversation-search'
const convs = [{ id: 'c1', title: "Relire l'œuvre", messages: [] }, { id: 'c2', title: 'Straße 12', messages: [] }, { id: 'c3', title: 'Ægir', messages: [] }] as never
const ids = (q: string) => (s(convs, q) as Array<{ conversation?: { id: string }; id?: string }>).map((h) => h.conversation?.id ?? h.id)
assert.deepEqual(ids('oeuvre'), ['c1'])
assert.deepEqual(ids('strasse'), ['c2'])
assert.deepEqual(ids('aegir'), ['c3'])
assert.deepEqual(seg("Relire l'œuvre", 'oeuvre'), [{ texte: "Relire l'", marque: false }, { texte: 'œuvre', marque: true }])
assert.deepEqual(seg('Straße 12', 'strasse'), [{ texte: 'Straße', marque: true }, { texte: ' 12', marque: false }])
assert.deepEqual(seg('Café noir', 'noir'), [{ texte: 'Café ', marque: false }, { texte: 'noir', marque: true }])
// Existant inchangé
assert.deepEqual(ids('œuvre'), ['c1'])
assert.deepEqual(seg('À jour', 'a jour'), [{ texte: 'À jour', marque: true }])
assert.deepEqual(seg('rien ici', 'zzz'), [{ texte: 'rien ici', marque: false }])
console.log('P14 OK')
