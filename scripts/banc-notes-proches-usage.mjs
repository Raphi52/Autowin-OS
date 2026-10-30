/**
 * BANC D'USAGE des notes Brain proches (src/main/brain-titres-du-tour.ts), sur les VRAIS tours.
 *
 * Pourquoi (conv-1303, 2026-10-30) : `scripts/sonde-titres-brain.mts` mesure le tri sur 27 questions
 * d'évaluation. Ce banc-ci le mesure sur l'usage réel : pour chaque tour servi, il rejoue plusieurs
 * règles de tri sur les candidats que le Brain avait renvoyés (gardés par la trace), et compte les
 * notes que l'agent a RÉELLEMENT ouvertes avec `brain_read` dans ce tour (turn-journals). Gratuit,
 * lecture seule, aucun appel au Brain ni au modèle.
 *
 * Résultat du 30/10 (821 tours, 22-30/10) : la règle actuelle (rang ≤ 3, score ≥ 0,40) couvre 78
 * ouvertures sur 153 pour 1,55 ligne par tour ; le rang 1 seul 51 pour 0,75 ; sans seuil 80 pour
 * 2,97 ; un tri mêlant score et mots du titre fait moins bien (56-57 pour ~2,1). Sur les 75 notes
 * ouvertes hors du bloc, 57 n'étaient pas parmi les ~21 candidats : aucun tri ne les aurait servies.
 * Bornes gardées. Changer la REQUÊTE se mesure, sur le Brain vivant, par
 * `scripts/banc-notes-proches-requete.mts` : les mots-clés font moins bien que le message entier.
 *
 * Usage : node scripts/banc-notes-proches-usage.mjs [dossier-de-donnees] [depuis-ISO]
 *   défaut : .autowin-data/autowin-os, depuis 2026-10-22T08 (avant, les turn-journals ne notaient
 *   pas les outils natifs : les ouvertures y sont invisibles).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const donnees = process.argv[2] ?? join('.autowin-data', 'autowin-os')
const depuis = process.argv[3] ?? '2026-10-22T08'
const spool = join(donnees, 'brain-trace-spool')
const journaux = join(donnees, 'turn-journals')
const POINT = 'chat-titres-du-tour'

const norm = (p) =>
  String(p ?? '')
    .split(String.fromCharCode(92))
    .join('/')
const sansAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const VIDES = new Set(
  'dans pour avec sans plus mais donc alors cette celui celle sont etre avoir fait faire tout tous toutes quoi quand comment pourquoi elle elles nous vous leur leurs ceux encore deja aussi bien tres puis apres avant entre sous chez comme parce autre autres meme quel quelle quels quelles votre notre the and that this with from have pas une des les est qui que sur aux ont par'.split(
    ' '
  )
)
const mots = (s) =>
  new Set(
    sansAccent(s)
      .split(/[^a-z0-9]+/)
      .filter((m) => m.length >= 4 && !VIDES.has(m))
  )

function traces() {
  const vues = new Set()
  const out = []
  for (const f of [
    'events.archive.1.jsonl',
    'events.archive.jsonl',
    'events.previous.jsonl',
    'events.jsonl'
  ]) {
    const chemin = join(spool, f)
    if (!existsSync(chemin)) continue
    for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
      if (!ligne.includes(POINT)) continue
      try {
        const t = JSON.parse(ligne)
        const cle = t.id ?? `${t.timestamp}${t.conversationId}`
        if (vues.has(cle)) continue
        vues.add(cle)
        out.push(t)
      } catch {
        // ligne partielle
      }
    }
  }
  return out
}

function ouvertes(conversationId, turnId) {
  const chemin = join(journaux, conversationId, `${turnId}.jsonl`)
  if (!existsSync(chemin)) return new Set()
  const notes = new Set()
  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    if (!ligne.includes('"name":"brain_read"') || !ligne.includes('"kind":"command"')) continue
    try {
      notes.add(norm(JSON.parse(ligne).args?.path))
    } catch {
      // ligne partielle
    }
  }
  return notes
}

const lexical = (requete, c) => {
  const q = mots(requete)
  if (q.size === 0) return 0
  const t = mots(`${c.title ?? ''} ${c.path.replace(/[-_/]/g, ' ')}`)
  let n = 0
  for (const m of q) if (t.has(m)) n++
  return n / Math.min(q.size, 8)
}
const retenus = (t, rangMax) =>
  t.navigation.candidates.filter((c) => c.retained && c.rank <= rangMax)
const actuel = (t) =>
  retenus(t, 3)
    .filter((c) => c.denseCos >= 0.4)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((c) => norm(c.path))

const REGLES = {
  'actuelle (rang<=3, score>=0,40)': actuel,
  'rang 1 seul': (t) => actuel(t).slice(0, 1),
  'rang<=3 sans seuil': (t) =>
    retenus(t, 3)
      .sort((a, b) => a.rank - b.rank)
      .map((c) => norm(c.path)),
  'score + mots du titre (top 10)': (t) =>
    retenus(t, 10)
      .map((c) => ({ c, s: c.denseCos + 0.25 * lexical(t.query, c) }))
      .filter((x) => x.s >= 0.45)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => norm(x.c.path))
}

const tours = traces()
  .filter((t) => t.timestamp >= depuis && t.turnId && t.navigation?.candidates?.length)
  .map((t) => ({ t, lues: ouvertes(t.conversationId, t.turnId) }))

console.log(`tours rejoués : ${tours.length} (depuis ${depuis})`)
for (const [nom, regle] of Object.entries(REGLES)) {
  let lignes = 0
  let couvertes = 0
  let lues = 0
  let jamaisLues = 0
  for (const { t, lues: l } of tours) {
    const servies = regle(t)
    lignes += servies.length
    for (const o of l) {
      lues++
      if (servies.includes(o)) couvertes++
    }
    if (!servies.some((s) => l.has(s))) jamaisLues += servies.length
  }
  console.log(
    `${nom.padEnd(34)} lignes/tour ${(lignes / Math.max(1, tours.length)).toFixed(2)} | ouvertures couvertes ${couvertes}/${lues} | lignes jamais lues ${jamaisLues}`
  )
}
let absentes = 0
let horsBloc = 0
for (const { t, lues } of tours) {
  const servies = new Set(actuel(t))
  for (const o of lues) {
    if (servies.has(o)) continue
    horsBloc++
    if (!t.navigation.candidates.some((c) => norm(c.path) === o)) absentes++
  }
}
console.log(`ouvertes hors du bloc : ${horsBloc}, dont absentes des candidats : ${absentes}`)
