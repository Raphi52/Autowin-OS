#!/usr/bin/env node
/**
 * cout-du-fil — d'où vient la dépense d'UN fil, lue sur les données de l'app (lecture seule).
 *
 * Usage : node scripts/cout-du-fil.mjs conv-NNN [--data <dossier de données>] [--json]
 *
 * Deux sources, parce qu'aucune ne suffit seule :
 * - `cost.jsonl` (le registre des coûts) donne le TOTAL fiable et sa répartition par rôle ;
 * - `activity/<conv>.jsonl` donne la STRUCTURE des exécutions : étapes, durées, et les refus du
 *   contrôle final qui ont relancé une construction.
 * Le registre compte plus que le journal d'activité (25 429 $ contre 17 617 $ sur ce poste au
 * 2026-11-19) : les deux totaux sont rendus côte à côte, jamais l'un pris pour l'autre.
 *
 * Pourquoi ce script : décomposer un fil coûteux se refaisait à la main, en une ligne `node -e`
 * différente à chaque fois (271 $ sur un seul fil : 14 refus du contrôle, suivis chacun d'une
 * nouvelle construction).
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Rôles du registre qui relèvent d'une exécution lancée par `orchestrate`, pas du tour de chat. */
export const ROLES_EXECUTION = new Set(['subagent', 'judge', 'orchestrator'])

export function lireJsonl(fichier) {
  if (!fs.existsSync(fichier)) return []
  const lignes = []
  for (const brute of fs.readFileSync(fichier, 'utf8').split('\n')) {
    const t = brute.trim()
    if (!t) continue
    try {
      lignes.push(JSON.parse(t))
    } catch {
      /* ligne tronquée par une écriture en cours : ignorée, jamais devinée */
    }
  }
  return lignes
}

const cout = (e) => (typeof e?.costUsd === 'number' && Number.isFinite(e.costUsd) ? e.costUsd : 0)
const ms = (ts) => {
  const n = Date.parse(ts ?? '')
  return Number.isFinite(n) ? n : undefined
}

/** Un refus du contrôle final : la ligne `gate` qui a renvoyé l'exécution en construction. */
function estUnRefus(e) {
  return e.kind === 'gate' && /^(BLOQUÉ|Arrêté au contrôle final)/.test(String(e.phase ?? ''))
}

/**
 * D'où vient un refus : le juge, le garde des modifications répétées sans cause (fix-gate), la grille
 * du nettoyage. Un refus peut porter plusieurs motifs : il compte pour chacun.
 */
export function famillesDuRefus(motif) {
  const familles = []
  if (/Objection du juge/.test(motif)) familles.push('juge')
  if (/fix-gate/.test(motif)) familles.push('fix-gate')
  if (/grille qualité de clean/.test(motif)) familles.push('nettoyage')
  return familles.length ? familles : ['autre']
}

/**
 * @param {{ conversationId: string, couts: object[], activite: object[] }} entree
 *   `couts` = lignes de cost.jsonl (toutes : le filtre par fil se fait ici), `activite` = lignes de
 *   activity/<conv>.jsonl.
 */
export function analyserFil({ conversationId, couts, activite }) {
  const duFil = couts.filter((c) => c.conversationId === conversationId)
  const parRole = {}
  const toursDeChat = new Set()
  for (const c of duFil) {
    const role = ROLES_EXECUTION.has(c.role)
      ? 'executions'
      : c.role === 'supervisor'
        ? 'chat'
        : (c.role ?? 'inconnu')
    parRole[role] = (parRole[role] ?? 0) + cout(c)
    if (c.role === 'supervisor' && c.turnId) toursDeChat.add(c.turnId)
  }
  const registreUsd = duFil.reduce((s, c) => s + cout(c), 0)

  const runs = new Map()
  for (const e of activite) {
    if (!e.runId) continue
    const r = runs.get(e.runId) ?? {
      runId: e.runId,
      coutUsd: 0,
      debut: undefined,
      fin: undefined,
      passesDeBuild: 0,
      controles: 0,
      parPhase: {},
      refus: []
    }
    const t = ms(e.ts)
    if (t !== undefined) {
      r.debut = r.debut === undefined ? t : Math.min(r.debut, t)
      r.fin = r.fin === undefined ? t : Math.max(r.fin, t)
    }
    if ((e.kind === 'exec' || e.kind === 'judge') && e.costUsd !== undefined) {
      const phase = e.kind === 'judge' ? 'judge' : String(e.phase ?? '?')
      const p = (r.parPhase[phase] ??= { usd: 0, n: 0, minutes: 0 })
      p.usd += cout(e)
      p.n += 1
      p.minutes += (Number(e.durationMs) || 0) / 60_000
      r.coutUsd += cout(e)
      if (phase === 'build') r.passesDeBuild += 1
      if (phase === 'judge') r.controles += 1
    }
    if (estUnRefus(e)) r.refus.push(String(e.phase).replace(/\s+/g, ' ').slice(0, 160))
    runs.set(e.runId, r)
  }

  const executions = [...runs.values()]
    .map((r) => ({
      runId: r.runId,
      coutUsd: r.coutUsd,
      dureeMin: r.debut !== undefined && r.fin !== undefined ? (r.fin - r.debut) / 60_000 : 0,
      passesDeBuild: r.passesDeBuild,
      controles: r.controles,
      parPhase: r.parPhase,
      refus: r.refus
    }))
    .sort((a, b) => b.coutUsd - a.coutUsd)

  const tours = activite
    .filter((e) => e.kind === 'chat-usage')
    .map((e) => ({ ts: e.ts, coutUsd: cout(e), demande: String(e.label ?? '').slice(0, 80) }))

  return {
    conversationId,
    registreUsd,
    activiteUsd:
      executions.reduce((s, r) => s + r.coutUsd, 0) + tours.reduce((s, t) => s + t.coutUsd, 0),
    parRole,
    toursDeChat: toursDeChat.size,
    executions,
    tours
  }
}

const usd = (n) => `${n >= 10 ? n.toFixed(0) : n.toFixed(2)} $`

export function rapport(a) {
  const l = []
  l.push(
    `${a.conversationId} — ${usd(a.registreUsd)} au registre des coûts (journal d'activité : ${usd(a.activiteUsd)})`
  )
  const roles = Object.entries(a.parRole).sort((x, y) => y[1] - x[1])
  if (roles.length) {
    l.push(
      `  par rôle : ${roles.map(([r, v]) => `${r} ${usd(v)}`).join(' · ')} — ${a.toursDeChat} tour(s) de chat`
    )
  }
  for (const r of a.executions) {
    l.push('')
    l.push(
      `exécution ${r.runId} : ${usd(r.coutUsd)} en ${Math.round(r.dureeMin)} min — ${r.passesDeBuild} construction(s), ${r.controles} contrôle(s), ${r.refus.length} refus du contrôle final`
    )
    const phases = Object.entries(r.parPhase).sort((x, y) => y[1].usd - x[1].usd)
    l.push(
      `  ${phases.map(([p, v]) => `${p} ${usd(v.usd)} (${v.n}×, ${Math.round(v.minutes)} min)`).join(' · ')}`
    )
    const parFamille = {}
    for (const m of r.refus)
      for (const f of famillesDuRefus(m)) parFamille[f] = (parFamille[f] ?? 0) + 1
    if (r.refus.length) {
      l.push(
        `  refus par origine : ${Object.entries(parFamille)
          .map(([f, n]) => `${f} ${n}`)
          .join(' · ')}`
      )
    }
    // Un refus qui revient mot pour mot dit que la boucle tourne sur le même point : on le compte.
    const parMotif = new Map()
    for (const m of r.refus) parMotif.set(m.slice(0, 90), (parMotif.get(m.slice(0, 90)) ?? 0) + 1)
    for (const [motif, n] of [...parMotif].slice(0, 6)) {
      l.push(`  refus${n > 1 ? ` ×${n}` : ''} : ${motif}…`)
    }
    if (parMotif.size > 6) l.push(`  … ${parMotif.size - 6} autre(s) motif(s) de refus`)
  }
  const chers = [...a.tours].sort((x, y) => y.coutUsd - x.coutUsd).slice(0, 5)
  if (chers.length) {
    l.push('')
    l.push('tours de chat les plus chers (journal d’activité) :')
    for (const t of chers) l.push(`  ${String(t.ts).slice(0, 16)}  ${usd(t.coutUsd)}  ${t.demande}`)
  }
  return l.join('\n')
}

async function principal() {
  const args = process.argv.slice(2)
  const opt = (nom, defaut) => {
    const i = args.indexOf(nom)
    return i >= 0 && args[i + 1] ? args[i + 1] : defaut
  }
  const conversationId = args.find((a) => /^conv-\d+$/.test(a))
  if (!conversationId) {
    console.error('Usage : node scripts/cout-du-fil.mjs conv-NNN [--data <dossier>] [--json]')
    process.exit(2)
  }
  const data = path.resolve(opt('--data', path.join('.autowin-data', 'autowin-os')))
  const couts = lireJsonl(path.join(data, 'cost.jsonl'))
  const activite = lireJsonl(path.join(data, 'activity', `${conversationId}.jsonl`))
  if (!couts.some((c) => c.conversationId === conversationId) && activite.length === 0) {
    console.error(`Aucune dépense connue pour ${conversationId} dans ${data}.`)
    process.exit(1)
  }
  const a = analyserFil({ conversationId, couts, activite })
  console.log(args.includes('--json') ? JSON.stringify(a, null, 2) : rapport(a))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal()
