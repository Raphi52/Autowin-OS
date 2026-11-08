#!/usr/bin/env node
/**
 * Relevé des RATÉS d'une journée ou d'une période, matière première du kaizen.
 *
 * Pourquoi : `/kaizen` sait auditer un fil, mais rien ne dit LESQUELS ont mal tourné, ni quelle cause
 * revient de l'un à l'autre. Ce relevé croise cinq traces que l'app écrit déjà, sans appel de modèle,
 * classe les fils par gravité et compte les causes d'arrêt qui reviennent : la maintenance du matin
 * (skills/maintenance/SKILL.md) et `/kaizen hier` ne dépensent ainsi leur budget que sur la cause
 * qui coûte le plus, au lieu de traiter dix ratés isolés.
 *
 *   node scripts/kaizen-veille.mjs                         # hier (heure de Paris)
 *   node scripts/kaizen-veille.mjs --jour 2026-11-07 --json
 *   node scripts/kaizen-veille.mjs --depuis 2026-11-03 [--jusqu-a 2026-11-07]
 *   node scripts/kaizen-veille.mjs --donnees <dossier autowin-os>
 *
 * Signaux (poids entre crochets) :
 *   recadrage  [3] l'utilisateur a corrigé ou relancé (« marche pas », « toujours », « pk », « non »…)
 *   refus      [3] une demande refusée (demandes/index.jsonl, etat « refuse ») ; sa raison est lue
 *                  dans la fiche RUN.md (« Résultat (…) : refusé — <raison> ») pour compter les causes
 *   rouge      [2] un verdict rouge du juge (trust.jsonl)
 *   sansPreuve [1] une demande close sans preuve (etat « sans-preuve »)
 *   cout       [1] coût du fil au-dessus de 3× la médiane de la période (cost.jsonl)
 * Les gels de l'app (gels.jsonl, ≥ 2 s) n'ont pas de fil : ils sont comptés à part.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ZONE = 'Europe/Paris'
export const POIDS = { recadrage: 3, refus: 3, rouge: 2, sansPreuve: 1, cout: 1 }

/**
 * Formules par lesquelles l'utilisateur dit qu'un tour a raté. Volontairement étroites : un faux
 * positif envoie le kaizen sur un fil sain, ce qui coûte plus cher qu'un raté manqué un jour.
 */
const RECADRAGES = [
  /\b(?:ça|ca|ce|sa)\s+(?:ne\s+)?marche\s+(?:pas|toujours|plus)\b/i,
  /\bmarche\s+pas\b/i,
  /\btoujours\s+pas\b/i,
  /\bc['’]?est\s+(?:pas|faux|nul|cass[ée])\b/i,
  /\bpas\s+(?:ça|ca)\b/i,
  /\bj['’]?(?:ai|avais)\s+(?:dit|demand[ée])\b/i,
  /\btu\s+(?:as|a)\s+(?:oubli[ée]|cass[ée]|pas)\b/i,
  /\bpourquoi\b|\bpk\b|\bpq\b/i,
  /\b(?:trop\s+long|arr[êe]te)\b/i,
  /\b(?:encore|re)\s*(?:rat[ée]|cass[ée]|bloqu[ée])\b/i,
  /^\s*non\b/i,
  /\bbug(?:ue|gé|ge)?\b/i
]

export function estRecadrage(texte) {
  const t = String(texte ?? '').slice(0, 600)
  if (t.trim().length < 2) return false
  return RECADRAGES.some((r) => r.test(t))
}

/** Jour civil à Paris (AAAA-MM-JJ) d'un instant en millisecondes ou ISO. */
export function jourParis(instant) {
  const d = new Date(typeof instant === 'number' ? instant : Date.parse(instant))
  if (Number.isNaN(d.getTime())) return undefined
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d)
}

export function hier(maintenant = Date.now()) {
  return jourParis(maintenant - 24 * 3600 * 1000)
}

/**
 * Raison d'un refus sans ce qui la rend unique (coût, espaces) : deux refus pour la même cause
 * doivent tomber dans la même case, sinon rien ne « revient ».
 */
export function normaliserCause(raison) {
  return String(raison ?? '')
    .replace(/\s*·\s*[\d\s.,]+\s*\$.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

const LIGNE_DE_REFUS = /^Résultat \((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC\) : refusé — (.+)$/gm

/** Raisons de refus écrites dans une fiche RUN.md, avec le jour de Paris de chacune. */
export function refusDeLaFiche(texte) {
  const sortie = []
  for (const m of String(texte ?? '').matchAll(LIGNE_DE_REFUS)) {
    sortie.push({ jour: jourParis(`${m[1]}T${m[2]}:00Z`), cause: normaliserCause(m[3]) })
  }
  return sortie
}

function lignesJson(chemin) {
  if (!existsSync(chemin)) return []
  const sortie = []
  for (const l of readFileSync(chemin, 'utf8').split('\n')) {
    if (!l.trim()) continue
    try {
      sortie.push(JSON.parse(l))
    } catch {
      // une ligne coupée par une écriture en cours : les autres restent lisibles
    }
  }
  return sortie
}

function mediane(valeurs) {
  if (!valeurs.length) return 0
  const v = [...valeurs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/**
 * Calcule le relevé d'une période (bornes incluses, AAAA-MM-JJ de Paris) à partir des lignes déjà
 * lues. Pur, pour être testé sans disque : `lireFiche(chemin relatif)` rend le texte d'un RUN.md.
 * @param {{du:string, au:string}} periode
 * @param {{saisies:any[], demandes:any[], verdicts:any[], couts:any[], gels:any[]}} traces
 * @param {(fiche:string) => string | undefined} [lireFiche]
 */
export function releverLaPeriode(periode, traces, lireFiche = () => undefined) {
  const { du, au } = periode
  const dans = (instant) => {
    const j = jourParis(instant)
    return Boolean(j) && j >= du && j <= au
  }
  const fils = new Map()
  const fil = (id) => {
    if (!fils.has(id))
      fils.set(id, {
        conversationId: id,
        score: 0,
        recadrage: [],
        refus: [],
        rouge: 0,
        sansPreuve: 0,
        coutUsd: 0,
        cout: false,
        saisies: 0
      })
    return fils.get(id)
  }

  for (const s of traces.saisies) {
    if (!dans(s.ts) || !s.conversationId || s.conversationId === 'nouvelle-conversation') continue
    const f = fil(s.conversationId)
    f.saisies++
    if (estRecadrage(s.texte)) f.recadrage.push(String(s.texte).replace(/\s+/g, ' ').slice(0, 140))
  }

  // Une demande a plusieurs lignes au fil de sa vie : seul son DERNIER état compte.
  const dernierEtat = new Map()
  for (const d of traces.demandes) {
    if (!d.messageId || !dans(d.demandeLe ?? d.ts)) continue
    const avant = dernierEtat.get(d.messageId)
    if (!avant || (d.ts ?? 0) >= (avant.ts ?? 0)) dernierEtat.set(d.messageId, d)
  }
  const fichesRefusees = new Map()
  for (const d of dernierEtat.values()) {
    if (d.etat === 'refuse') {
      fil(d.conversationId).refus.push(String(d.constat ?? '').slice(0, 140))
      if (d.fiche) fichesRefusees.set(d.fiche, d.conversationId)
    } else if (d.etat === 'sans-preuve') fil(d.conversationId).sansPreuve++
  }

  // Une fiche porte TOUTE la vie d'une demande : on n'y compte que les refus datés de la période.
  const causes = new Map()
  const compter = (cause, conversationId) => {
    const c = causes.get(cause) ?? { cause, fois: 0, fils: new Set() }
    c.fois++
    c.fils.add(conversationId)
    causes.set(cause, c)
  }
  for (const [fiche, conversationId] of fichesRefusees) {
    const lus = refusDeLaFiche(lireFiche(fiche)).filter((r) => r.jour >= du && r.jour <= au)
    if (!lus.length) compter('raison non écrite dans la fiche', conversationId)
    for (const r of lus) compter(r.cause, conversationId)
  }

  for (const v of traces.verdicts) {
    if (v.verdict === 'red' && v.conversationId && dans(v.ts)) fil(v.conversationId).rouge++
  }

  const coutParFil = new Map()
  for (const c of traces.couts) {
    if (!c.conversationId || !dans(c.ts)) continue
    coutParFil.set(
      c.conversationId,
      (coutParFil.get(c.conversationId) ?? 0) + (Number(c.costUsd) || 0)
    )
  }
  const seuilCout = 3 * mediane([...coutParFil.values()].filter((x) => x > 0))
  for (const [id, usd] of coutParFil) {
    const f = fils.get(id)
    if (f) f.coutUsd = usd
    if (seuilCout > 0 && usd > seuilCout) {
      fil(id).coutUsd = usd
      fil(id).cout = true
    }
  }

  for (const f of fils.values()) {
    f.score =
      POIDS.recadrage * f.recadrage.length +
      POIDS.refus * f.refus.length +
      POIDS.rouge * f.rouge +
      POIDS.sansPreuve * f.sansPreuve +
      (f.cout ? POIDS.cout : 0)
  }

  const gels = traces.gels.filter((g) => dans(g.ts) && (g.blocageMs ?? 0) >= 2000)
  const classes = [...fils.values()]
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || b.coutUsd - a.coutUsd)
  return {
    du,
    au,
    filsActifs: [...fils.values()].filter((f) => f.saisies > 0).length,
    totaux: {
      recadrages: classes.reduce((n, f) => n + f.recadrage.length, 0),
      refus: classes.reduce((n, f) => n + f.refus.length, 0),
      rouges: classes.reduce((n, f) => n + f.rouge, 0),
      sansPreuve: classes.reduce((n, f) => n + f.sansPreuve, 0),
      gels: gels.length,
      gelMaxMs: gels.reduce((m, g) => Math.max(m, g.blocageMs ?? 0), 0)
    },
    // Une cause vue dans plusieurs fils passe devant une cause répétée dans un seul.
    causes: [...causes.values()]
      .map((c) => ({ cause: c.cause, fois: c.fois, fils: [...c.fils] }))
      .sort((a, b) => b.fils.length - a.fils.length || b.fois - a.fois),
    fils: classes
  }
}

export function releverLaJournee(jour, traces, lireFiche) {
  return releverLaPeriode({ du: jour, au: jour }, traces, lireFiche)
}

export function lireTraces(dossier) {
  return {
    saisies: lignesJson(join(dossier, 'saisies-utilisateur.jsonl')),
    demandes: lignesJson(join(dossier, 'demandes', 'index.jsonl')),
    verdicts: lignesJson(join(dossier, 'trust.jsonl')),
    couts: lignesJson(join(dossier, 'cost.jsonl')),
    gels: lignesJson(join(dossier, 'gels.jsonl'))
  }
}

export function lecteurDeFiches(dossier) {
  return (fiche) => {
    const chemin = join(dossier, 'demandes', fiche)
    return existsSync(chemin) ? readFileSync(chemin, 'utf8') : undefined
  }
}

function lisible(r, top) {
  const t = r.totaux
  const l = [
    `Ratés ${r.du === r.au ? `du ${r.du}` : `du ${r.du} au ${r.au}`} — ${r.filsActifs} fils actifs`,
    `recadrages ${t.recadrages} · refus ${t.refus} · juge rouge ${t.rouges} · sans preuve ${t.sansPreuve} · gels ≥2 s ${t.gels}${t.gels ? ` (max ${(t.gelMaxMs / 1000).toFixed(1)} s)` : ''}`,
    ''
  ]
  if (r.causes.length) {
    l.push('Causes de refus qui reviennent :')
    for (const c of r.causes.slice(0, 5))
      l.push(
        `  ${c.fois}× dans ${c.fils.length} fil(s) — ${c.cause}  (${c.fils.slice(0, 4).join(', ')})`
      )
    l.push('')
  }
  for (const f of r.fils.slice(0, top)) {
    const parts = []
    if (f.recadrage.length) parts.push(`${f.recadrage.length} recadrage(s)`)
    if (f.refus.length) parts.push(`${f.refus.length} refus`)
    if (f.rouge) parts.push(`${f.rouge} rouge(s)`)
    if (f.sansPreuve) parts.push(`${f.sansPreuve} sans preuve`)
    if (f.cout) parts.push(`coût ${f.coutUsd.toFixed(2)} $`)
    l.push(`[${String(f.score).padStart(2)}] ${f.conversationId} — ${parts.join(' · ')}`)
    for (const q of f.recadrage.slice(0, 2)) l.push(`      « ${q} »`)
  }
  if (!r.fils.length) l.push('Aucun raté relevé.')
  return l.join('\n')
}

function principal(argv) {
  const arg = (nom) => {
    const i = argv.indexOf(nom)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const ici = dirname(fileURLToPath(import.meta.url))
  const dossier = resolve(
    arg('--donnees') ??
      process.env.AUTOWIN_DONNEES ??
      join(ici, '..', '.autowin-data', 'autowin-os')
  )
  if (!existsSync(join(dossier, 'saisies-utilisateur.jsonl'))) {
    console.error(`Dossier de données introuvable ou vide : ${dossier} (option --donnees)`)
    return 2
  }
  const jour = arg('--jour')
  const au = jour ?? arg('--jusqu-a') ?? hier()
  const du = jour ?? arg('--depuis') ?? au
  if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || !/^\d{4}-\d{2}-\d{2}$/.test(au) || du > au) {
    console.error(`Période invalide : du ${du} au ${au} (format AAAA-MM-JJ)`)
    return 2
  }
  const top = Number(arg('--top') ?? 10)
  const r = releverLaPeriode({ du, au }, lireTraces(dossier), lecteurDeFiches(dossier))
  console.log(
    argv.includes('--json')
      ? JSON.stringify({ ...r, fils: r.fils.slice(0, top) }, null, 2)
      : lisible(r, top)
  )
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.argv.slice(2))
}
