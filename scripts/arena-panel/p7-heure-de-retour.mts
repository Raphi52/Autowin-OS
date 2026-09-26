// Panel arena tour 3, tâche P7 — instantDeRetourAnnonce accepte des heures impossibles :
// « resets 13pm » -> 13h, « resets 3:5pm » -> 3h du matin le lendemain. Une heure illisible doit rendre undefined.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p7-heure-de-retour.mts
import assert from 'node:assert/strict'
import { instantDeRetourAnnonce as r } from '../../src/shared/reprise-quota'
const maintenant = new Date(Date.UTC(2026, 8, 21, 10, 0)) // 12h00 à Paris (UTC+2)
const iso = (t: string) => { const v = r(t, maintenant); return v === undefined ? undefined : new Date(v).toISOString() }
assert.equal(iso('resets 13pm (Europe/Paris)'), undefined)          // 13 + pm : impossible
assert.equal(iso('resets 0am (Europe/Paris)'), undefined)           // 0 + am : impossible
assert.equal(iso('resets 3:5pm (Europe/Paris)'), undefined)         // minutes sur 1 chiffre : illisible, pas « 3h du matin »
assert.equal(iso('resets 12:60pm (Europe/Paris)'), undefined)
// Formes RÉELLES relevées dans conversations.json (« You've hit your session limit · resets … ») : inchangées
assert.equal(iso("You've hit your session limit · resets 4:10pm (Europe/Paris)"), '2026-09-21T14:10:00.000Z')
assert.equal(iso("You've hit your session limit · resets 2am (Europe/Paris)"), '2026-09-22T00:00:00.000Z')
assert.equal(iso('resets 12pm (Europe/Paris)'), '2026-09-22T10:00:00.000Z') // midi déjà passé -> demain midi
assert.equal(iso('resets 14:30 (Europe/Paris)'), '2026-09-21T12:30:00.000Z') // 24 h sans am/pm : valide
console.log('P7 OK')
