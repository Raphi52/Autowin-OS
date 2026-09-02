#!/usr/bin/env node
/**
 * scout-rendement — sonde DETERMINISTE et LECTURE SEULE du corpus de conversations.
 *
 * Mesure, par conversation, le chemin DEMANDE -> LIVRABLE : combien de tours,
 * combien de dollars, combien de temps, et combien de ces tours ont ete des
 * REPRISES (l'utilisateur redemande la meme chose). Rend un rapport Markdown.
 *
 * Aucune ecriture : le script n'ouvre que .autowin-data/<app>/ en lecture.
 * Usage : node scripts/scout-rendement.mjs [--data <dir>] [--top N] [--json]
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const DATA = path.resolve(argOf('--data', path.join('.autowin-data', 'autowin-os')))
const TOP = Number(argOf('--top', '15'))
const AS_JSON = args.includes('--json')

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const readJsonl = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

const convs = readJson(path.join(DATA, 'conversations.json'), [])
if (!Array.isArray(convs) || convs.length === 0) {
  console.error(`Aucune conversation lisible sous ${DATA}`)
  process.exit(2)
}

// Marqueurs de REPRISE : l'utilisateur signale que le tour precedent n'a pas livre.
const REWORK = [
  /\btoujours pas\b/i, /\bca marche (pas|toujours pas)\b/i, /\bc'?est pas (ca|bon)\b/i,
  // `non` ne compte QU'EN TETE de message (« non, … », « non ça marche pas »). L'ancien motif
  // `\bnon,? ` matchait le « non » ADJECTIF au milieu d'une phrase — « travaux non publiés »,
  // « fichier non suivi », « reste non commité » —, et le prompt automatique de /salvage porte
  // justement cette formule : 20 des 27 « reprises » du corpus etaient des faux positifs, qui
  // gonflaient aussi le score de gaspillage (pondere par le taux de reprise).
  /^\s*non\b[\s,.!:]/i, /\brefais\b/i, /\bencore\b.*\bpareil\b/i, /\bmarche pas\b/i,
  /\btu n'?as pas\b/i, /\bje t'?ai dit\b/i, /\bpourquoi tu\b/i, /\brien n'?a chang/i,
  /\bregarde mieux\b/i, /\bfaux\b/i
]
// Marqueurs de CADRAGE MANQUANT : la demande initiale est une solution ou un flou.
const VAGUE = [/\bun truc\b/i, /\bameliore\b/i, /\boptimise\b/i, /\bfais mieux\b/i, /\bcomme on avait dit\b/i, /^\s*(go|ok|vas-?y|continue|oui)\s*$/i]

/** Etiquettes ecrites par l'orchestrateur dans le journal d'activite. */
const ORCH_KINDS = new Set(['exec', 'judge', 'gate'])

const rows = []
for (const c of convs) {
  const id = c.id
  const msgs = Array.isArray(c.messages) ? c.messages : []
  const users = msgs.filter((m) => m.role === 'user')
  const acts = readJsonl(path.join(DATA, 'activity', `${id}.jsonl`))
  const costUsd = acts.reduce((s, a) => s + (Number(a.costUsd) || 0), 0)
  const durationMs = acts.reduce((s, a) => s + (Number(a.durationMs) || 0), 0)
  // ETAPES D'ORCHESTRATION : les etiquettes REELLEMENT ecrites par l'app (commands.ts, type
  // OrchestrationStep). L'ancien filtre cherchait `run`/`agent`, deux mots qu'aucune ligne ne
  // porte : la colonne affichait donc 0 partout, y compris sur des conversations de 30 etapes.
  const orchestrations = acts.filter((a) => ORCH_KINDS.has(String(a.kind || ''))).length
  // --- TOURS : chaque evenement d'activite est rattache au DERNIER message utilisateur qui le precede.
  const turns = users.map((m, i) => {
    // Le MARQUEUR qui a fait compter ce tour comme reprise est conserve : un compteur dont on ne
    // peut pas verifier ce qu'il compte n'est pas auditable (13 formules FR en dur, faux positifs
    // possibles). On garde donc l'expression declenchante ET l'extrait qu'elle a touche.
    const texte = String(m.content || '')
    const declencheur = REWORK.find((r) => r.test(texte))
    return {
      index: i + 1,
      ts: Number(m.ts) || 0,
      demande: texte.replace(/\s+/g, ' ').slice(0, 90),
      reprise: Boolean(declencheur),
      marqueurReprise: declencheur ? String(declencheur) : '',
      extraitReprise: declencheur ? String(texte.match(declencheur)?.[0] || '').trim() : '',
      coutUsd: 0,
      minutes: 0
    }
  })
  // Rattachement EXACT quand le journal porte le tour (`turnId`) : un evenement peut arriver
  // APRES la demande suivante (sous-agent lent), et l'heure seule le mettrait sur le mauvais tour.
  // Sinon seulement, repli sur « dernier message utilisateur avant cet evenement ».
  const tourParId = new Map()
  {
    let dernierUser = -1
    for (const m of msgs) {
      if (m.role === 'user') dernierUser += 1
      if (m.turnId && dernierUser >= 0 && !tourParId.has(m.turnId)) tourParId.set(m.turnId, dernierUser)
    }
  }
  for (const a of acts) {
    let k = a.turnId !== undefined && tourParId.has(a.turnId) ? tourParId.get(a.turnId) : -1
    if (k < 0) {
      const t = Date.parse(a.ts)
      if (!Number.isFinite(t)) continue
      for (let i = 0; i < turns.length; i++) if (turns[i].ts <= t) k = i
    }
    if (k < 0 || k >= turns.length) continue
    turns[k].coutUsd += Number(a.costUsd) || 0
    turns[k].minutes += (Number(a.durationMs) || 0) / 60000
  }
  for (const t of turns) { t.coutUsd = Number(t.coutUsd.toFixed(4)); t.minutes = Number(t.minutes.toFixed(1)) }

  // --- BIFURCATION : premier tour ou le cout DECOLLE sans que le livrable avance.
  // Deux conditions cumulees, deterministes :
  //   (a) le tour coute >= 2x la mediane des tours payants (la pente decolle) ;
  //   (b) a partir de lui, >= 50 % du cout total de la conversation reste a depenser (le detour, pas la fin).
  // Sans tour payant, ou si aucun tour ne remplit les deux, il n'y a PAS de bifurcation : on ne devine pas.
  const payants = turns.filter((t) => t.coutUsd > 0).map((t) => t.coutUsd).sort((a, b) => a - b)
  const mediane = payants.length ? payants[Math.floor(payants.length / 2)] : 0
  const total = turns.reduce((s, t) => s + t.coutUsd, 0)
  let bifurcation = null
  if (mediane > 0 && total > 0) {
    let restant = total
    for (const t of turns) {
      if (t.coutUsd >= 2 * mediane && restant >= 0.5 * total) {
        bifurcation = { ...t, coutApresUsd: Number(restant.toFixed(4)), partApres: Number((restant / total).toFixed(3)) }
        break
      }
      restant -= t.coutUsd
    }
  }
  // Une SEULE source pour le compteur : les tours deja marques ci-dessus. Deux detections
  // paralleles finissent par diverger, et le total ne correspondrait plus a la liste affichee.
  const rework = turns.filter((t) => t.reprise).length
  const first = users[0]
  const vagueStart = first ? VAGUE.some((r) => r.test(String(first.content || ''))) : false
  const wallMs = msgs.length ? (msgs[msgs.length - 1].ts - msgs[0].ts) : 0
  rows.push({
    id,
    titre: String(c.title || '').slice(0, 60),
    tours: users.length,
    messages: msgs.length,
    reprises: rework,
    tauxReprise: users.length ? rework / users.length : 0,
    coutUsd: Number(costUsd.toFixed(4)),
    coutParTour: users.length ? Number((costUsd / users.length).toFixed(4)) : 0,
    modeleMin: Number((durationMs / 60000).toFixed(1)),
    murMin: Number((wallMs / 60000).toFixed(1)),
    orchestrations,
    demandeFloue: vagueStart,
    tours_detail: turns,
    bifurcation,
    premiereDemande: first ? String(first.content || '').replace(/\s+/g, ' ').slice(0, 120) : ''
  })
}

// Score de GASPILLAGE : ce qui a coute cher ET a du etre repris.
for (const r of rows) r.gaspillage = Number((r.coutUsd * (1 + 2 * r.tauxReprise) + (r.demandeFloue ? 1 : 0)).toFixed(3))
rows.sort((a, b) => b.gaspillage - a.gaspillage)

const tot = (k) => rows.reduce((s, r) => s + r[k], 0)
const summary = {
  conversations: rows.length,
  toursUtilisateur: tot('tours'),
  reprises: tot('reprises'),
  tauxRepriseGlobal: tot('tours') ? Number((tot('reprises') / tot('tours')).toFixed(3)) : 0,
  coutTotalUsd: Number(tot('coutUsd').toFixed(2)),
  coutMedianParConversation: (() => {
    const s = rows.map((r) => r.coutUsd).sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : 0
  })(),
  minutesModele: Number(tot('modeleMin').toFixed(1)),
  demandesFloues: rows.filter((r) => r.demandeFloue).length
}

if (AS_JSON) { console.log(JSON.stringify({ summary, rows }, null, 2)); process.exit(0) }

const fmt = (n) => String(n)
console.log(`# Rendement du corpus — ${DATA}\n`)
console.log(`Conversations: **${summary.conversations}** · tours utilisateur: **${summary.toursUtilisateur}** · reprises: **${summary.reprises}** (taux ${(summary.tauxRepriseGlobal * 100).toFixed(1)} %)`)
console.log(`Coût total mesuré: **$${summary.coutTotalUsd}** · médiane/conversation: $${summary.coutMedianParConversation} · temps modèle: ${summary.minutesModele} min · demandes initiales floues: ${summary.demandesFloues}\n`)
console.log(`## Top ${Math.min(TOP, rows.length)} par gaspillage (coût pondéré par le taux de reprise)\n`)
console.log('| conv | tours | reprises | $ | $/tour | min modèle | orch. | flou | titre |')
console.log('|---|---|---|---|---|---|---|---|---|')
for (const r of rows.slice(0, TOP)) {
  console.log(`| ${r.id} | ${r.tours} | ${r.reprises} | ${fmt(r.coutUsd)} | ${fmt(r.coutParTour)} | ${fmt(r.modeleMin)} | ${r.orchestrations} | ${r.demandeFloue ? 'oui' : ''} | ${r.titre} |`)
}
console.log(`\n## Tour de bifurcation (premier tour dont le cout decolle : >= 2x la mediane, alors qu'il reste >= 50 % du cout a depenser)
`)
const bifs = rows.filter((r) => r.bifurcation)
if (bifs.length === 0) {
  console.log('_Aucune bifurcation detectee : le cout est reparti, aucun tour de decrochage._')
} else {
  console.log('| conv | tour | $ du tour | $ a partir de lui | part du total | reprise | demande du tour |')
  console.log('|---|---|---|---|---|---|---|')
  for (const r of bifs.slice(0, TOP)) {
    const b = r.bifurcation
    console.log(`| ${r.id} | #${b.index} | ${b.coutUsd} | ${b.coutApresUsd} | ${(b.partApres * 100).toFixed(0)} % | ${b.reprise ? 'oui' : ''} | ${b.demande} |`)
  }
  console.log('\n_Candidat, pas verdict : lire ce tour (conversation_read / retrospective) pour nommer la cause — cadrage · routage · preuve · redite · surdimensionnement · boucle._')
}

// LISTE des tours comptes comme reprise. Le total seul n'est pas auditable : sans le tour et
// l'expression qui l'a declenche, impossible de dire si 27 reprises sont 27 vraies reprises.
const REPRISES_AFFICHEES = 25
const reprises = rows
  .flatMap((r) => r.tours_detail.filter((t) => t.reprise).map((t) => ({ conv: r.id, ...t })))
  .sort((a, b) => b.coutUsd - a.coutUsd)
console.log(
  `\n## Tours comptes comme REPRISE — ${reprises.length} tour(s), $${reprises
    .reduce((s, t) => s + t.coutUsd, 0)
    .toFixed(2)} depenses dessus\n`
)
if (reprises.length === 0) {
  console.log('_Aucun tour de reprise detecte sur ce corpus._')
} else {
  console.log('| conv | tour | $ du tour | expression detectee | demande |')
  console.log('|---|---|---|---|---|')
  for (const t of reprises.slice(0, REPRISES_AFFICHEES)) {
    console.log(`| ${t.conv} | #${t.index} | ${fmt(t.coutUsd)} | \`${t.extraitReprise}\` | ${t.demande} |`)
  }
  if (reprises.length > REPRISES_AFFICHEES) {
    console.log(`\n_${reprises.length - REPRISES_AFFICHEES} autre(s) non affiche(s) — \`--json\` les porte toutes._`)
  }
  console.log(
    "\n_Detection par 13 expressions francaises en dur : verifier chaque ligne avant d'en tirer un taux. Une ligne fausse ici gonfle le score de gaspillage de sa conversation._"
  )
}

console.log(`\n## Premières demandes des conversations les plus coûteuses\n`)
for (const r of rows.slice(0, Math.min(8, rows.length))) console.log(`- **${r.id}** ($${r.coutUsd}, ${r.reprises} reprise(s)) — « ${r.premiereDemande} »`)
console.log(`\n_Lecture seule. Chaque ligne est un CANDIDAT : la cause se lit dans la conversation (conversation_read / retrospective), pas dans ce tableau._`)
