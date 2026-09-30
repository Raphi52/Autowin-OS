/**
 * MESURE — que valent les 2e et 3e conversations du rappel automatique ? (conv-889, 2026-09-30)
 *
 * Usage : npx tsx scripts/mesure-rappel-selectif.mts [chemin/conversations.json]
 *
 * Rejoue le rappel de `rappel-conversations.ts` sur chaque message HUMAIN du corpus reel, avec le
 * VRAI `ConversationStore.search`, puis le confronte a deux verites etablies SANS le score :
 *
 *   A. CITATION — le message nomme lui-meme une conversation (`conv-N`). La cible est celle-la ; la
 *      requete est le message PRIVE de ce nom (sinon on mesurerait la recherche d'un identifiant).
 *   B. REDITE — le message repose une demande deja faite dans un AUTRE fil, plus ancien : memes
 *      mots a 80 % (Jaccard sur les mots de 3 lettres et plus, 4 mots minimum). Les fils FOURCHES
 *      l'un de l'autre sont exclus : ils partagent leur historique par construction.
 *
 * Conditions de production reproduites : 3 conversations demandees, conversation courante exclue
 * APRES la recherche, meme fournisseur, meme dossier. Le corpus est celui du jour : seules les
 * conversations creees AVANT le message sont admises (on demande 50 resultats puis on filtre ; le
 * re-classement porte sur 400 candidats dans les deux cas, donc l'ordre des 3 premiers est celui de
 * la production). BIAIS ASSUMES : l'index de rarete voit tout le corpus, y compris le futur, et une
 * conversation ancienne porte aussi ses messages posterieurs. Pas de budget de temps : la mesure est
 * deterministe, la production peut couper plus tot sous charge.
 */
import { readFileSync } from 'node:fs'
import { ConversationStore } from '../src/main/store/conversations'
import { canonicalProjectPath } from '../src/shared/project-path'
import { motsDe } from '../src/shared/mots'

type Msg = { role: string; content: unknown; ts?: number | string }
type Conv = {
  id: string
  provider: string
  projectPath?: string
  createdAt: number | string
  forkedFrom?: string
  messages: Msg[]
}

const chemin = process.argv[2] ?? '.autowin-data/autowin-os/conversations.json'
const corpus = JSON.parse(readFileSync(chemin, 'utf8')) as Conv[]
const store = new ConversationStore()
store.hydrate(corpus as never)

const temps = (v: number | string | undefined): number =>
  typeof v === 'number' ? v : v ? Date.parse(v) : Number.NaN

/** Messages ecrits par l'app a la place de l'utilisateur : gabarits reperes dans le corpus. */
const GABARITS_APP = [
  /^\[\[autowin-fixture/,
  /^Lance \/salvage/,
  /^\/salvage\b/,
  /^La chaîne de ce fil/,
  /^Reprise après/,
  /^Un mail vient d'arriver/,
  /^\/(maintenance|curate|gc|rendement|residus) passe quotidienne/,
  /^Tu analyses Autowin OS/,
  /^Traite ENSEMBLE ces/,
  /^Corrige ce defaut d'Au/,
  /^La mise à jour d'Autow/,
  /^Dans D:\\RigV3WPF, (port|alig)/
]
const estHumain = (texte: string): boolean => !GABARITS_APP.some((g) => g.test(texte.trim()))

const parId = new Map(corpus.map((c) => [c.id, c]))
const creeLe = new Map(corpus.map((c) => [c.id, temps(c.createdAt)]))
const fourches = (a: Conv, b: Conv): boolean => a.forkedFrom === b.id || b.forkedFrom === a.id

interface Requete {
  conv: Conv
  texte: string
  ts: number
}
const requetes: Requete[] = []
for (const conv of corpus) {
  for (const m of conv.messages) {
    if (m.role !== 'user' || typeof m.content !== 'string') continue
    if (!m.content.trim() || !estHumain(m.content)) continue
    requetes.push({ conv, texte: m.content, ts: temps(m.ts) })
  }
}

/* ---------- Verite B : redites ---------- */
const motsSet = (t: string): Set<string> => new Set(motsDe(t))
const jaccard = (a: Set<string>, b: Set<string>): number => {
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter || 1)
}
const signatures = requetes.map((r) => ({ r, mots: motsSet(r.texte) }))
function ciblesRedite(r: Requete, mots: Set<string>): Set<string> {
  const cibles = new Set<string>()
  if (mots.size < 4) return cibles
  for (const autre of signatures) {
    if (autre.r.conv.id === r.conv.id) continue
    if (!(autre.r.ts < r.ts)) continue
    if (fourches(autre.r.conv, r.conv)) continue
    if (autre.mots.size < 4) continue
    if (jaccard(mots, autre.mots) >= 0.8) cibles.add(autre.r.conv.id)
  }
  return cibles
}

/* ---------- Le rappel tel qu'en production ---------- */
interface Montre {
  id: string
  score: number
}
function rappel(r: Requete, terme: string): Montre[] {
  const projet = canonicalProjectPath(r.conv.projectPath)
  return store
    .search(terme, { limite: 50, extraitsParConversation: 2 })
    .filter((c) => (creeLe.get(c.id) ?? Infinity) <= r.ts || c.id === r.conv.id)
    .slice(0, 3)
    .filter((c) => c.id !== r.conv.id)
    .filter((c) => c.provider === r.conv.provider)
    .filter((c) => canonicalProjectPath(c.projectPath) === projet)
    .map((c) => ({ id: c.id, score: c.score }))
}

/* ---------- Collecte ---------- */
interface Ligne {
  verite: 'citation' | 'redite' | 'aucune'
  cibles: Set<string>
  montres: Montre[]
}
const lignes: Ligne[] = []
const debut = Date.now()
for (const [i, { r, mots }] of signatures.entries()) {
  const cites = [...r.texte.matchAll(/conv-\d+/g)]
    .map((m) => m[0])
    .filter((id) => id !== r.conv.id && parId.has(id) && (creeLe.get(id) ?? Infinity) <= r.ts)
  if (cites.length) {
    const terme = r.texte.replace(/conv-\d+/g, ' ').trim()
    if (terme) lignes.push({ verite: 'citation', cibles: new Set(cites), montres: rappel(r, terme) })
    continue
  }
  const redites = ciblesRedite(r, mots)
  lignes.push({
    verite: redites.size ? 'redite' : 'aucune',
    cibles: redites,
    montres: rappel(r, r.texte)
  })
  if (i % 500 === 0) process.stderr.write(`  ${i}/${signatures.length} (${Date.now() - debut} ms)\n`)
}

/* ---------- Rapport ---------- */
const pct = (n: number, d: number): string => (d ? `${((100 * n) / d).toFixed(1)} %` : '—')
const avecVerite = lignes.filter((l) => l.verite !== 'aucune')
console.log(`corpus : ${corpus.length} conversations, ${requetes.length} messages humains`)
console.log(
  `verites : ${lignes.filter((l) => l.verite === 'citation').length} citations, ` +
    `${lignes.filter((l) => l.verite === 'redite').length} redites`
)

console.log('\n1. QUALITE PAR RANG (messages a verite connue)')
for (const rang of [0, 1, 2]) {
  const presents = avecVerite.filter((l) => l.montres[rang])
  const justes = presents.filter((l) => l.cibles.has(l.montres[rang].id))
  console.log(
    `  rang ${rang + 1} : ${presents.length} montres, ${justes.length} justes (${pct(justes.length, presents.length)})`
  )
}
const trouvees = avecVerite.filter((l) => l.montres.some((m) => l.cibles.has(m.id)))
console.log(`  cible parmi les montres : ${trouvees.length}/${avecVerite.length}`)

/** Ratio d'un resultat au MEILLEUR montre (le rang 1 apres re-classement). */
const ratio = (l: Ligne, k: number): number =>
  l.montres[0].score > 0 ? l.montres[k].score / l.montres[0].score : 0

console.log('\n2. RATIO AU MEILLEUR, rangs 2-3 : justes contre inutiles')
const justes23: number[] = []
const inutiles23: number[] = []
for (const l of avecVerite)
  for (const k of [1, 2])
    if (l.montres[k]) (l.cibles.has(l.montres[k].id) ? justes23 : inutiles23).push(ratio(l, k))
const quantiles = (xs: number[]): string => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN)
  return `n=${s.length} q10=${q(0.1).toFixed(2)} q25=${q(0.25).toFixed(2)} mediane=${q(0.5).toFixed(2)} q75=${q(0.75).toFixed(2)} q90=${q(0.9).toFixed(2)}`
}
console.log(`  justes   : ${quantiles(justes23)}`)
console.log(`  inutiles : ${quantiles(inutiles23)}`)

console.log('\n3. FILTRE RELATIF : garder le rang k>=2 si score_k >= alpha * score_1')
console.log('  alpha | justes 2-3 gardes | inutiles 2-3 retires | cible trouvee | convs montrees / tour (tous tours)')
for (const alpha of [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
  const garde = (l: Ligne) => l.montres.filter((_, k) => k === 0 || ratio(l, k) >= alpha)
  const gJ = justes23.filter((x) => x >= alpha).length
  const rI = inutiles23.filter((x) => x < alpha).length
  const cible = avecVerite.filter((l) => garde(l).some((m) => l.cibles.has(m.id))).length
  const volume = lignes.reduce((s, l) => s + garde(l).length, 0) / lignes.length
  console.log(
    `  ${alpha.toFixed(1).padStart(5)} | ${`${gJ}/${justes23.length}`.padStart(17)} | ${`${rI}/${inutiles23.length}`.padStart(20)} | ${`${cible}/${avecVerite.length}`.padStart(13)} | ${volume.toFixed(2)}`
  )
}
console.log(`\nduree : ${Date.now() - debut} ms`)
