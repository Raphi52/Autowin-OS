#!/usr/bin/env node
// MÉMOIRES DE RELECTURE CASSÉES : pour chaque reprise de session qui a tout réécrit alors que le
// passage précédent datait de moins d'une heure, dit CE QUI a changé entre les deux appels.
// Complète la rubrique « Fils repris » de scripts/poids-du-contexte.mjs, qui ne donne que le total.
//
// Ordre du prompt chez le fournisseur : outils, puis système (consignes d'Autowin, puis la section
// « Environment » du CLI, qui recopie chaque `--add-dir`), puis l'historique. La cause retenue est
// le PREMIER élément qui diffère dans cet ordre : c'est lui qui a fait perdre tout ce qui suit.
//
// Sources : run-stdout/*.stdout.jsonl (événement `init` et usage de la 1re étape) et
// prompt-observability/<fil>.jsonl (empreinte du système `systemRef`, découpage `systemBlocks`).
//
// Usage : node scripts/memoires-cassees.mjs [--data <dossier>] [--depuis <date ISO>] [--json]
//   --depuis 2026-11-09T10:00 : seules les reprises commencées après (mesure après un correctif).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEMOIRE_RELECTURE_MIN, analyserSession } from './poids-du-contexte.mjs'

const ecart = (a = [], b = []) => ({
  plus: b.filter((x) => !a.includes(x)),
  moins: a.filter((x) => !b.includes(x))
})
const nomsServeurs = (init) => (init.mcp_servers || []).map((m) => m.name)

/**
 * La cause d'une cassure entre deux appels de la même session.
 * @param {{ init: object, prompt?: { systemRef?: string, systemBlocks?: {name:string,chars:number}[] } }} avant
 * @param {typeof avant} apres
 * @returns {{ cause: string, detail: string }}
 */
export function causeDeLaCassure(avant, apres) {
  const ia = avant.init || {}
  const ib = apres.init || {}
  const outils = ecart(ia.tools, ib.tools)
  if (outils.plus.length || outils.moins.length) {
    const mcp = ecart(nomsServeurs(ia), nomsServeurs(ib))
    if (mcp.plus.length || mcp.moins.length)
      return {
        cause: 'serveurs d’outils',
        detail: [...mcp.plus.map((n) => `+${n}`), ...mcp.moins.map((n) => `-${n}`)].join(' ')
      }
    return {
      cause: 'liste d’outils',
      detail: [...outils.plus.map((n) => `+${n}`), ...outils.moins.map((n) => `-${n}`)].join(' ')
    }
  }
  if (ia.model && ib.model && ia.model !== ib.model)
    return { cause: 'modèle', detail: `${ia.model} → ${ib.model}` }
  const pa = avant.prompt
  const pb = apres.prompt
  if (pa?.systemRef && pb?.systemRef && pa.systemRef !== pb.systemRef) {
    const blocs = (p) => new Map((p.systemBlocks || []).map((b) => [b.name, b.chars]))
    const ba = blocs(pa)
    const bb = blocs(pb)
    const changes = [...new Set([...ba.keys(), ...bb.keys()])].filter(
      (n) => ba.get(n) !== bb.get(n)
    )
    return {
      cause: changes.length
        ? `consignes : bloc ${changes.join(', ')}`
        : 'consignes : texte modifié',
      detail: changes.map((n) => `${n} ${ba.get(n) ?? 0}→${bb.get(n) ?? 0} car.`).join(' ; ')
    }
  }
  const dossiers = ecart(ia.additional_directories, ib.additional_directories)
  if (dossiers.plus.length || dossiers.moins.length)
    return {
      cause: 'dossiers ajoutés (--add-dir)',
      detail: `${dossiers.moins.length} retiré(s), ${dossiers.plus.length} ajouté(s)`
    }
  if (!pa || !pb) return { cause: 'inconnue (consignes non tracées)', detail: '' }
  return { cause: 'inconnue', detail: '' }
}

function lireJsonl(fichier) {
  try {
    return fs
      .readFileSync(fichier, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

/** Toutes les traces de consignes du dossier `prompt-observability`. */
function lireTraces(dossier) {
  const traces = []
  for (const f of fs.existsSync(dossier) ? fs.readdirSync(dossier) : []) {
    if (f.endsWith('.jsonl')) traces.push(...lireJsonl(path.join(dossier, f)))
  }
  return traces
}

/**
 * La session d'une trace de consignes. Le chat écrit `sessionId` dans sa trace ; une étape de run
 * (learn, git…) ne l'écrit pas, et seul l'argument `--resume` de son appel la nomme. Une étape qui
 * ouvre une session neuve n'a ni l'un ni l'autre : elle reste sans session, rien n'est deviné.
 */
export function sessionDeLaTrace(trace) {
  if (trace.sessionId) return trace.sessionId
  const argv = trace.options?.argv
  if (!Array.isArray(argv)) return undefined
  const i = argv.lastIndexOf('--resume')
  const id = i >= 0 ? argv[i + 1] : undefined
  return typeof id === 'string' && id && !id.startsWith('-') ? id : undefined
}

/**
 * Les reprises cassées : relancées moins d'une heure après le passage précédent de la même session,
 * et pourtant réécrites en entier. `sessions` : sorties d'`analyserSession` ; `traces` : les
 * enregistrements de `prompt-observability` ; `initDe` : l'événement `init` du CLI d'une session.
 */
export function classerCassures({ sessions, traces, initDe = (s) => s.init || {}, depuisMs = 0 }) {
  const parSession = new Map()
  for (const s of sessions) {
    if (!s.sessionId || s.debutMs === undefined || s.finMs === undefined) continue
    const liste = parSession.get(s.sessionId) || []
    liste.push(s)
    parSession.set(s.sessionId, liste)
  }
  // Traces des consignes, rangées par session.
  const parTrace = new Map()
  for (const o of traces) {
    const id = sessionDeLaTrace(o)
    if (!id || !o.ts) continue
    const liste = parTrace.get(id) || []
    liste.push(o)
    parTrace.set(id, liste)
  }
  // La trace d'un appel : la plus proche de sa FIN (elle s'écrit quand l'appel rend la main).
  const traceDe = (s) => {
    const liste = parTrace.get(s.sessionId) || []
    let meilleure
    for (const o of liste) {
      const d = Math.abs(Date.parse(o.ts) - s.finMs)
      if (d < 120_000 && (!meilleure || d < meilleure.d)) meilleure = { o, d }
    }
    return meilleure?.o
  }
  const cassees = []
  for (const s of sessions) {
    const c = s.socleCout
    if (s.reprise !== true || !c?.froid || !s.sessionId || s.debutMs < depuisMs) continue
    const avant = (parSession.get(s.sessionId) || []).filter((x) => x !== s && x.finMs <= s.debutMs)
    if (!avant.length) continue
    const prec = avant.reduce((a, b) => (a.finMs > b.finMs ? a : b))
    const inactiviteMin = (s.debutMs - prec.finMs) / 60000
    if (inactiviteMin > MEMOIRE_RELECTURE_MIN) continue
    const ta = traceDe(prec)
    const tb = traceDe(s)
    const { cause, detail } = causeDeLaCassure(
      { init: initDe(prec), prompt: ta && ta !== tb ? ta : undefined },
      { init: initDe(s), prompt: tb && ta !== tb ? tb : undefined }
    )
    cassees.push({
      session: s.sessionId,
      debut: new Date(s.debutMs).toISOString(),
      inactiviteMin: Math.round(inactiviteMin * 10) / 10,
      usd: Math.round(c.ecritureUsd * 100) / 100,
      cause,
      detail
    })
  }
  return cassees
}

async function principal() {
  const args = process.argv.slice(2)
  const opt = (nom, defaut) => {
    const i = args.indexOf(nom)
    return i >= 0 && args[i + 1] ? args[i + 1] : defaut
  }
  const data = path.resolve(opt('--data', 'D:/AutoWinOS/.autowin-data/autowin-os'))
  const depuis = opt('--depuis', '')
  const depuisMs = depuis ? Date.parse(depuis) : 0
  if (depuis && !Number.isFinite(depuisMs)) {
    console.error(`--depuis attend une date ISO, reçu : ${depuis}`)
    process.exit(2)
  }
  const dossierSorties = path.join(data, 'run-stdout')
  let fichiers = []
  try {
    fichiers = fs.readdirSync(dossierSorties).filter((f) => f.endsWith('.stdout.jsonl'))
  } catch {
    console.error(`Dossier illisible : ${dossierSorties}`)
    process.exit(1)
  }
  const sessions = []
  for (const f of fichiers) {
    const lignes = fs.readFileSync(path.join(dossierSorties, f), 'utf8').split('\n')
    const s = analyserSession(lignes)
    if (!s) continue
    s.fichier = path.join(dossierSorties, f)
    sessions.push(s)
  }
  const cassees = classerCassures({
    sessions,
    traces: lireTraces(path.join(data, 'prompt-observability')),
    initDe: (session) =>
      lireJsonl(session.fichier).find((e) => e.type === 'system' && e.subtype === 'init') || {},
    depuisMs
  })
  cassees.sort((a, b) => b.usd - a.usd)
  const parCause = new Map()
  for (const c of cassees) {
    const p = parCause.get(c.cause) || { reprises: 0, usd: 0 }
    p.reprises++
    p.usd += c.usd
    parCause.set(c.cause, p)
  }
  const total = cassees.reduce((t, c) => t + c.usd, 0)
  if (args.includes('--json')) {
    console.log(JSON.stringify({ total, parCause: Object.fromEntries(parCause), cassees }, null, 2))
    return
  }
  const l = []
  l.push(`# Mémoires de relecture cassées${depuis ? ` depuis ${depuis}` : ''}`)
  l.push('')
  l.push(
    `${cassees.length} reprises à moins de ${MEMOIRE_RELECTURE_MIN} min du passage précédent ont tout réécrit : **${total.toFixed(2)} $**.`
  )
  l.push('')
  l.push('| Cause | Reprises | Réécrit |')
  l.push('|---|---|---|')
  for (const [cause, p] of [...parCause].sort((a, b) => b[1].usd - a[1].usd))
    l.push(`| ${cause} | ${p.reprises} | ${p.usd.toFixed(2)} $ |`)
  l.push('')
  l.push('| Session | Début | Inactivité | Réécrit | Cause | Détail |')
  l.push('|---|---|---|---|---|---|')
  for (const c of cassees)
    l.push(
      `| ${c.session.slice(0, 8)} | ${c.debut.slice(0, 16)} | ${c.inactiviteMin} min | ${c.usd.toFixed(2)} $ | ${c.cause} | ${c.detail.slice(0, 120)} |`
    )
  console.log(l.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal()
