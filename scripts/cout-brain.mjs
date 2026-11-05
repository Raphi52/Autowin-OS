#!/usr/bin/env node
/**
 * COÛT BRAIN DU MODÈLE PRINCIPAL — ce que le Brain lui a servi, par voie, depuis une date.
 *
 * Pourquoi (conv-1571, 2026-11-05) : pour savoir si le filtre de la liste de `brain_query` par le
 * modèle des petites tâches fait vraiment baisser ce que reçoit le modèle principal, il fallait
 * refaire à la main le compte des traces Brain (`injectedChars`) par voie. Ce script le rejoue.
 *
 * Lit les quatre fichiers du spool (`brain-trace-spool/`, `src/main/activity/brain-trace-spool.ts`).
 * Une voie = `kind` + `point` de la trace : `pousse:chat-titres-du-tour` (notes proches de chaque
 * tour), `query` (brain_query), `lecture:command-brain-read` (brain_read), `automatic` (chargement
 * en tête d'un run orchestré).
 *
 * Usage : node scripts/cout-brain.mjs [--depuis 2026-11-05T07:00] [--jusqu-a <date>] [--dossier <spool>] [--json]
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FICHIERS = [
  'events.archive.1.jsonl',
  'events.archive.jsonl',
  'events.previous.jsonl',
  'events.jsonl'
]

function argument(nom) {
  const i = process.argv.indexOf(nom)
  return i > 0 ? process.argv[i + 1] : undefined
}

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
const dossier =
  argument('--dossier') ?? join(racine, '.autowin-data', 'autowin-os', 'brain-trace-spool')
const depuis = argument('--depuis') ? Date.parse(argument('--depuis')) : -Infinity
const jusqua = argument('--jusqu-a') ? Date.parse(argument('--jusqu-a')) : Infinity
if (Number.isNaN(depuis) || Number.isNaN(jusqua)) {
  console.error('date illisible : --depuis / --jusqu-a attendent une date ISO (2026-11-05T07:00)')
  process.exit(2)
}
if (!existsSync(dossier)) {
  console.error(`spool Brain introuvable : ${dossier}`)
  process.exit(1)
}

const traces = []
const vues = new Set()
for (const fichier of FICHIERS) {
  const chemin = join(dossier, fichier)
  if (!existsSync(chemin)) continue
  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    if (!ligne.trim()) continue
    let t
    try {
      t = JSON.parse(ligne)
    } catch {
      continue
    }
    // Une rotation peut laisser la même trace dans deux fichiers : on la compte une fois.
    const cle = t.id ?? `${t.timestamp}|${t.kind}|${t.point}|${t.query}`
    if (vues.has(cle)) continue
    vues.add(cle)
    const quand = Date.parse(t.timestamp)
    if (quand >= depuis && quand < jusqua) traces.push(t)
  }
}

const mediane = (valeurs) => {
  if (valeurs.length === 0) return 0
  const tri = [...valeurs].sort((a, b) => a - b)
  return tri[Math.floor(tri.length / 2)]
}

const voies = new Map()
for (const t of traces) {
  const voie = t.point ? `${t.kind}:${t.point}` : String(t.kind)
  const liste = voies.get(voie) ?? []
  liste.push(t)
  voies.set(voie, liste)
}

const lignes = [...voies.entries()]
  .map(([voie, liste]) => {
    const servis = liste.map((t) => t.injectedChars ?? 0).filter((n) => n > 0)
    return {
      voie,
      appels: liste.length,
      servis: servis.length,
      mediane: mediane(servis),
      max: servis.length ? Math.max(...servis) : 0,
      total: servis.reduce((s, n) => s + n, 0),
      du: liste[0].timestamp.slice(0, 16),
      au: liste[liste.length - 1].timestamp.slice(0, 16)
    }
  })
  .sort((a, b) => b.total - a.total)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ dossier, traces: traces.length, voies: lignes }, null, 2))
} else {
  console.log(`${traces.length} traces Brain lues (${dossier})`)
  console.log('voie | appels | servis | médiane car. | max car. | total car. | du → au')
  for (const l of lignes) {
    console.log(
      `${l.voie} | ${l.appels} | ${l.servis} | ${l.mediane} | ${l.max} | ${l.total} | ${l.du} → ${l.au}`
    )
  }
}
