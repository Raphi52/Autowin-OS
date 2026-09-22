// Panel arena tour 5, tâche P13 — src/main/agent-pilot.ts RECOPIE l'ancienne règle de parité des fences (corrigée au tour 4
// dans shared/collage-blocs-texte.ts) : DeltaCollageTracker coupe au milieu d'un bloc ``` qui contient ~~~, et
// detacherFenceCollee INSÈRE « \n\n » à l'intérieur d'un bloc ```` qui contient ``` — le code affiché est altéré.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p13-pilote-fences.mts
import assert from 'node:assert/strict'
import { DeltaCollageTracker, detacherFenceCollee } from '../../src/main/agent-pilot'
const coupe = (avant: string, apres: string) => { const t = new DeltaCollageTracker(); t.separation('a', avant); return t.separation('b', apres) }
assert.equal(coupe('```md\n~~~\nligne.', 'Suite'), '')                         // ~~~ dans ``` : bloc encore ouvert
assert.equal(coupe('````\n```\nligne.', 'Suite'), '')                          // ``` dans ```` : encore ouvert
const imbrique = '````md\n```\nvoici.```ts\n````'
assert.equal(detacherFenceCollee(imbrique), imbrique)                          // dans un bloc : contenu intact
const tilde = '```\n~~~\nvoici.```ts\n```'
assert.equal(detacherFenceCollee(tilde), tilde)
// Existant inchangé
assert.equal(detacherFenceCollee('voici.```ts\nx\n```'), 'voici.\n\n```ts\nx\n```') // vraie soudure hors bloc : détachée
assert.equal(coupe('```\ncode\n```\nFin.', 'Suite'), '\n\n')                  // bloc fermé, phrases soudées : séparées
assert.equal(coupe('```\ncode.', 'Suite'), '')                                 // bloc ouvert simple
console.log('P13 OK')
