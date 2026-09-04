/**
 * VEILLE DOGFOOD — est-ce que l'app et son pipeline tiennent, et où t'ont-ils déçu ?
 *
 * Lit le store réel d'Autowin (aucun capteur nouveau : tout est déjà écrit sur disque) et rend un
 * rapport court. Trois questions, dans cet ordre d'importance :
 *   1. Où l'utilisateur a-t-il exprimé une frustration ? C'est le seul juge hors-modèle du produit.
 *   2. Le pipeline fait-il son travail — les demandes sont-elles cadrées, les runs aboutissent-ils ?
 *   3. L'app se répare-t-elle en boucle sur les mêmes incidents ?
 *
 * Les marqueurs de frustration sont CALIBRÉS sur 656 messages humains réels (2026-08-23), pas
 * inventés. Deux faux positifs mesurés lors de cette calibration et corrigés ici : « nul » matchait
 * dans « annulé », et « refais » attrapait une consigne parfaitement légitime. D'où les frontières
 * de mot et l'exclusion des messages machine.
 *
 * Usage :  node scripts/dogfood-veille.mjs [--jours N] [--json]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Lit la valeur d'un drapeau en distinguant trois états, parce qu'ils n'ont pas le même sens :
 * drapeau absent (on prend le défaut), drapeau présent SANS valeur (une saisie inachevée, donc une
 * erreur), drapeau présent avec valeur (à valider). Confondre les deux derniers, c'est appliquer
 * silencieusement le défaut à quelqu'un qui voulait autre chose.
 */
const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}

// Plage maximale d'un Date JS (±8,64e15 ms depuis l'epoch) : au-delà, `new Date(...)` rend Invalid
// Date et `toISOString()` lève une RangeError. La borne est DÉDUITE de cette contrainte, pas choisie.
const JOURS_MAX = Math.floor((Date.now() + 8.64e15) / 86_400_000)

/**
 * La fenêtre d'observation est le seul réglage de cette veille, et une fenêtre mal saisie ne se
 * signale pas d'elle-même : `--jours 0` et `--jours -3` rendaient un rapport parfaitement vert —
 * 0 frustration, 0 run — qui dit « tout va bien » alors qu'il n'a rien mesuré. Un capteur qui ment
 * en silence est plus nuisible qu'un capteur en panne, puisqu'on le croit. Tout ce qui n'est pas un
 * entier strictement positif est donc refusé, plutôt que de rendre une mesure vide.
 *
 * On exige une écriture décimale au lieu de faire confiance à Number() : `Number('')` vaut 0,
 * `Number(' ')` vaut 0, `Number('0x7')` vaut 7 et `Number('1e9999')` vaut Infinity — quatre façons
 * d'obtenir une fenêtre qui n'est pas celle qu'on croit avoir tapée.
 */
const lireJours = (brut) => {
  if (typeof brut !== 'string' || !/^[0-9]+$/.test(brut.trim())) return null
  const n = Number(brut.trim())
  return Number.isSafeInteger(n) && n >= 1 && n <= JOURS_MAX ? n : null
}

const brutJours = arg('--jours', '7')
const JOURS = lireJours(brutJours)
if (JOURS === null) {
  const vu = brutJours === undefined ? 'aucune valeur' : `« ${String(brutJours).slice(0, 40)} »`
  // Deux refus differents, deux messages differents : dire « attendu un entier strictement positif »
  // a quelqu'un qui a tape 200000000 decrit une faute qu'il n'a pas commise, et cache la vraie cause.
  const horsPlage =
    /^[0-9]+$/.test(String(brutJours ?? '').trim()) && Number(String(brutJours).trim()) >= 1
  console.error(
    horsPlage
      ? `--jours : ${vu} — fenêtre trop lointaine, le maximum est ${JOURS_MAX} jours ` +
          "(au-delà, la date de début sort de la plage que JavaScript sait représenter)."
      : `--jours : ${vu} — attendu un entier strictement positif (nombre de jours observés).
` +
          'Une fenêtre nulle ou négative ne mesurerait rien et rendrait un rapport vert trompeur.'
  )
  process.exit(2)
}

const JSON_OUT = process.argv.includes('--json')
const RACINE = join(process.cwd(), '.autowin-data', 'autowin-os')
if (!existsSync(RACINE)) {
  // Le store vit dans le dépôt CANONIQUE, jamais dans un worktree : dire « la racine du dépôt »
  // enverrait chercher pendant dix minutes dans une copie qui n'en aura jamais.
  console.error(
    `Store introuvable : ${RACINE}\n` +
      "Cette veille lit les données réelles de l'app : lance-la depuis le dépôt canonique\n" +
      "(C:\\Amitel\\Autowin OS), pas depuis un worktree ni une copie."
  )
  process.exit(2)
}

const depuis = new Date(Date.now() - JOURS * 86_400_000).toISOString()

/** Un message écrit par la MACHINE, pas par l'humain — il ne dit rien de sa satisfaction. */
const estMachine = (t) =>
  t.startsWith('/') ||
  t.includes('Auto-Kaizen') ||
  t.includes('automatiquement') ||
  t.startsWith('Un run vient d')

/**
 * Marqueurs de frustration. Frontières de mot obligatoires : sans elles « nul » matche « annulé »
 * (faux positif mesuré). Volontairement conservateur — mieux vaut rater une plainte tiède que noyer
 * le rapport, qui ne serait alors plus lu.
 */
const FRUSTRATION = [
  [/\b(ça|ca|c')?\s*(marche|fonctionne)\s+(pas|plus)\b/i, 'ça ne marche pas'],
  [/\btoujours\s+pas\b|\btjr?\s+pas\b/i, 'toujours pas — la 2e tentative a échoué'],
  [/\brien\s+compris\b|\bj'?ai\s+pas\s+compris\b/i, "la réponse n'était pas comprise"],
  [/\b(j'?en\s+ai\s+)?marre\b/i, 'lassitude exprimée'],
  [/\bsert\s+[àa]\s+rien\b|\binutile\b/i, 'jugé inutile'],
  [/\bpourquoi\s+tu\b|\bpk\s+(tu|il|elle)\b|\bt'?as\s+fait\s+quoi\b/i, 'comportement incompris'],
  [/\bnon\s+mais\b|\bs[ée]rieux\s*\?/i, 'exaspération'],
  [/\brecommence\b|\breprends\s+tout\b/i, 'travail à refaire'],
  [/\bencore\s+la\s+m[êe]me\b|\b2e\s+fois\b|\bdeuxi[èe]me\s+fois\b/i, 'répétition du même défaut']
]

function lireJsonl(chemin) {
  const out = []
  try {
    for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
      const t = ligne.trim()
      if (!t) continue
      try {
        out.push(JSON.parse(t))
      } catch {
        /* ligne tronquée par un crash : on la saute, elle ne vaut pas un arrêt */
      }
    }
  } catch {
    /* fichier illisible : idem */
  }
  return out
}

// ---- 1. Frustrations -------------------------------------------------------
const frustrations = []
let messagesHumains = 0
const dossierActivite = join(RACINE, 'activity')
for (const f of existsSync(dossierActivite) ? readdirSync(dossierActivite) : []) {
  if (!f.endsWith('.jsonl')) continue
  let precedent = null
  for (const e of lireJsonl(join(dossierActivite, f))) {
    if (e.kind !== 'chat-usage') continue
    const texte = String(e.label ?? '').trim()
    if (!texte || texte === precedent) continue
    precedent = texte
    if (estMachine(texte) || (e.ts ?? '') < depuis) continue
    messagesHumains += 1
    for (const [motif, quoi] of FRUSTRATION) {
      if (motif.test(texte)) {
        frustrations.push({ conv: f.replace('.jsonl', ''), ts: e.ts, quoi, texte: texte.slice(0, 120) })
        break
      }
    }
  }
}

// ---- 2. Le pipeline cadre-t-il ? -------------------------------------------
const dossierRuns = join(RACINE, 'runs')
let libres = 0
let avecCadrage = 0
const phasesVues = new Map()
for (const conv of existsSync(dossierRuns) ? readdirSync(dossierRuns) : []) {
  if (!conv.startsWith('conv-')) continue
  const dossierConv = join(dossierRuns, conv)
  let sujets = []
  try {
    sujets = readdirSync(dossierConv)
  } catch {
    continue
  }
  for (const sujet of sujets) {
    const trace = join(dossierConv, sujet, 'trace.json')
    if (!existsSync(trace)) continue
    // Un sujet préfixé d'une phase vient d'une commande explicite (`/build`…), pas d'une demande
    // libre : le compter fausserait le taux de cadrage — c'est l'erreur que j'ai faite le 2026-08-23,
    // 627 runs automatiques comptés comme des demandes, un « 3 % » annoncé pour un vrai 4 %.
    if (/^(build|scout|frame|clean|judge|terrain)-/.test(sujet)) continue
    let brut = ''
    try {
      // FENÊTRÉ comme le reste, et c'est le point qui décide de l'utilité de cet indicateur : en
      // cumul il resterait figé à 4 % pour toujours, donc incapable de montrer qu'un correctif
      // améliore quoi que ce soit. Un indicateur qui ne peut pas bouger ne se surveille pas.
      if (statSync(trace).mtimeMs < Date.now() - JOURS * 86_400_000) continue
      brut = readFileSync(trace, 'utf8')
    } catch {
      continue
    }
    const phases = new Set([...brut.matchAll(/"phase"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))
    if (!phases.size || (phases.size === 1 && phases.has('kaizen'))) continue
    libres += 1
    if (phases.has('frame')) avecCadrage += 1
    const cle = [...phases].sort().join('+')
    phasesVues.set(cle, (phasesVues.get(cle) ?? 0) + 1)
  }
}

// ---- 3. L'app se répare-t-elle en boucle ? ---------------------------------
// FENÊTRÉ, et ça n'a rien d'un détail : en cumul ce compteur affiche 595, dont 592 pour la seule
// journée du 2026-08-04 — une boucle d'emballement depuis longtemps éteinte. Un indicateur de santé
// qui rappelle éternellement une vieille crise affole pour rien, puis on cesse de le lire.
const limiteMs = Date.now() - JOURS * 86_400_000
let incidentsAuto = 0
let incidentsAutoTotal = 0
for (const conv of existsSync(dossierRuns) ? readdirSync(dossierRuns) : []) {
  try {
    for (const sujet of readdirSync(join(dossierRuns, conv))) {
      if (!sujet.includes('corrige-automatiquement-l-incident')) continue
      incidentsAutoTotal += 1
      if (statSync(join(dossierRuns, conv, sujet)).mtimeMs >= limiteMs) incidentsAuto += 1
    }
  } catch {
    /* dossier disparu sous nous : une autre session écrit en même temps */
  }
}

const rapport = {
  fenetre: `${JOURS} jour(s)`,
  messagesHumains,
  frustrations,
  cadrage: { libres, avecCadrage, taux: libres ? Math.round((100 * avecCadrage) / libres) : null },
  phases: Object.fromEntries([...phasesVues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)),
  incidentsAutoReparation: incidentsAuto,
  incidentsAutoDepuisToujours: incidentsAutoTotal
}

if (JSON_OUT) {
  console.log(JSON.stringify(rapport, null, 2))
  process.exit(0)
}

console.log(`\n=== VEILLE DOGFOOD — ${JOURS} derniers jours ===\n`)
console.log(`Messages humains : ${messagesHumains}`)
console.log(
  `Frustrations     : ${frustrations.length}` +
    (messagesHumains ? ` (${Math.round((100 * frustrations.length) / messagesHumains)} %)` : '')
)
for (const f of frustrations.slice(-12)) {
  console.log(`  · ${String(f.ts).slice(0, 16)} [${f.quoi}]`)
  console.log(`    ${f.texte}`)
}
if (!frustrations.length) console.log('  (aucune — ou les marqueurs sont trop étroits, voir en tête de fichier)')

console.log(`\nCadrage des demandes libres : ${avecCadrage}/${libres}` + (rapport.cadrage.taux !== null ? ` (${rapport.cadrage.taux} %)` : ''))
console.log('  Référence du 2026-08-23, AVANT correctif : 9/205 (4 %).')
console.log('  Phases les plus jouées :')
for (const [k, v] of Object.entries(rapport.phases)) console.log(`    ${String(v).padStart(4)}  ${k}`)

console.log(
  `\nRéparations automatiques d'incidents : ${incidentsAuto} sur la fenêtre (${incidentsAutoTotal} depuis toujours)`
)
console.log("  Sur la fenêtre, un nombre qui grimpe = l'app se soigne en boucle au lieu d'être soignée.")
console.log("  Le cumul garde la trace du 2026-08-04 : 592 en une journée, emballement depuis éteint.\n")
