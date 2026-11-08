#!/usr/bin/env node
/**
 * Relevé des RATÉS d'une journée, matière première du kaizen du matin.
 *
 * Pourquoi : `/kaizen` sait auditer UN fil, mais rien ne dit chaque matin LESQUELS ont mal tourné la
 * veille. Ce relevé croise cinq traces que l'app écrit déjà, sans appel de modèle, et classe les fils
 * par gravité pour que le kaizen ne dépense son budget que sur les deux ou trois pires.
 *
 *   node scripts/kaizen-veille.mjs                 # hier (heure de Paris), sortie lisible
 *   node scripts/kaizen-veille.mjs --jour 2026-11-07 --json
 *   node scripts/kaizen-veille.mjs --donnees <dossier autowin-os>
 *
 * Signaux (poids entre crochets) :
 *   recadrage  [3] l'utilisateur a corrigé ou relancé (« marche pas », « toujours », « pk », « non »…)
 *   refus      [3] une demande arrêtée au contrôle final (demandes/index.jsonl, etat « refuse »)
 *   rouge      [2] un verdict rouge du juge (trust.jsonl)
 *   sansPreuve [1] une demande close sans preuve (etat « sans-preuve »)
 *   cout       [1] coût du fil au-dessus de 3× la médiane du jour (cost.jsonl)
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
 * Calcule le relevé d'un jour à partir des lignes déjà lues. Pur, pour être testé sans disque.
 * @param {{saisies:any[], demandes:any[], verdicts:any[], couts:any[], gels:any[]}} traces
 */
export function releverLaJournee(jour, traces) {
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
    if (
      jourParis(s.ts) !== jour ||
      !s.conversationId ||
      s.conversationId === 'nouvelle-conversation'
    )
      continue
    const f = fil(s.conversationId)
    f.saisies++
    if (estRecadrage(s.texte)) f.recadrage.push(String(s.texte).replace(/\s+/g, ' ').slice(0, 140))
  }

  // Une demande a plusieurs lignes au fil de sa vie : seul son DERNIER état compte.
  const dernierEtat = new Map()
  for (const d of traces.demandes) {
    if (!d.messageId || jourParis(d.demandeLe ?? d.ts) !== jour) continue
    const avant = dernierEtat.get(d.messageId)
    if (!avant || (d.ts ?? 0) >= (avant.ts ?? 0)) dernierEtat.set(d.messageId, d)
  }
  for (const d of dernierEtat.values()) {
    if (d.etat === 'refuse') fil(d.conversationId).refus.push(String(d.constat ?? '').slice(0, 140))
    else if (d.etat === 'sans-preuve') fil(d.conversationId).sansPreuve++
  }

  for (const v of traces.verdicts) {
    if (v.verdict === 'red' && v.conversationId && jourParis(v.ts) === jour)
      fil(v.conversationId).rouge++
  }

  const coutParFil = new Map()
  for (const c of traces.couts) {
    if (!c.conversationId || jourParis(c.ts) !== jour) continue
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

  const gels = traces.gels.filter((g) => jourParis(g.ts) === jour && (g.blocageMs ?? 0) >= 2000)
  const classes = [...fils.values()]
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || b.coutUsd - a.coutUsd)
  return {
    jour,
    filsActifs: [...fils.values()].filter((f) => f.saisies > 0).length,
    totaux: {
      recadrages: classes.reduce((n, f) => n + f.recadrage.length, 0),
      refus: classes.reduce((n, f) => n + f.refus.length, 0),
      rouges: classes.reduce((n, f) => n + f.rouge, 0),
      sansPreuve: classes.reduce((n, f) => n + f.sansPreuve, 0),
      gels: gels.length,
      gelMaxMs: gels.reduce((m, g) => Math.max(m, g.blocageMs ?? 0), 0)
    },
    fils: classes
  }
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

function lisible(r, top) {
  const t = r.totaux
  const l = [
    `Ratés du ${r.jour} — ${r.filsActifs} fils actifs`,
    `recadrages ${t.recadrages} · refus ${t.refus} · juge rouge ${t.rouges} · sans preuve ${t.sansPreuve} · gels ≥2 s ${t.gels}${t.gels ? ` (max ${(t.gelMaxMs / 1000).toFixed(1)} s)` : ''}`,
    ''
  ]
  for (const f of r.fils.slice(0, top)) {
    const parts = []
    if (f.recadrage.length) parts.push(`${f.recadrage.length} recadrage(s)`)
    if (f.refus.length) parts.push(`${f.refus.length} refus`)
    if (f.rouge) parts.push(`${f.rouge} rouge(s)`)
    if (f.sansPreuve) parts.push(`${f.sansPreuve} sans preuve`)
    if (f.cout) parts.push(`coût ${f.coutUsd.toFixed(2)} $`)
    l.push(`[${String(f.score).padStart(2)}] ${f.conversationId} — ${parts.join(' · ')}`)
    for (const q of f.recadrage.slice(0, 2)) l.push(`      « ${q} »`)
    for (const q of f.refus.slice(0, 1)) l.push(`      refus : ${q}`)
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
  const jour = arg('--jour') ?? hier()
  const top = Number(arg('--top') ?? 10)
  const r = releverLaJournee(jour, lireTraces(dossier))
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
