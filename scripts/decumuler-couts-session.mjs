#!/usr/bin/env node
/**
 * RÉPARE LES JOURNAUX DE COÛT DÉJÀ ÉCRITS — une seule fois.
 *
 * Défaut corrigé à la source le 2026-09-20 (`src/main/providers/claude-session-cost.ts`) : le CLI
 * Claude rend `total_cost_usd`, qui est le CUMUL de la session reprise, et Autowin l'écrivait tel
 * quel comme coût du tour. L'indicateur de la barre du haut additionne ces lignes : il additionnait
 * des cumuls. Mesure sur le poste : 9 320 $ affichés pour 4 428 $ réellement dépensés.
 *
 * Le correctif à la source ne répare pas le passé. Ce script le fait, sur les DEUX journaux que lit
 * l'indicateur (`prompt-observability/*.jsonl` et `activity/*.jsonl`).
 *
 * DÉCISION PAR LA PREUVE, PAS PAR UNE HEURISTIQUE DE FORME : pour chaque session, on compare la
 * suite BRUTE et la suite DÉ-CUMULÉE au coût recalculé depuis les tokens du tour au tarif public.
 * On ne réécrit que si la version dé-cumulée colle nettement mieux. Une session dont les coûts
 * étaient déjà justes n'est donc pas touchée.
 *
 * RÉVERSIBLE : chaque fichier modifié est copié en `<fichier>.avant-decumul.bak` avant réécriture.
 * IDEMPOTENT : un fichier déjà réparé ne colle plus mieux en dé-cumulé, donc il est laissé tel quel.
 *
 * Usage :  node scripts/decumuler-couts-session.mjs [--ecrire]   (sans `--ecrire` : simulation)
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ECRIRE = process.argv.includes('--ecrire')
const RACINE = process.argv.find((a) => a.startsWith('--racine='))?.slice(9)
  ?? join(process.cwd(), '.autowin-data', 'autowin-os')

/** Tarifs publics Anthropic, alignés sur `src/shared/cost-estimate.ts`. */
function tarif(model = '') {
  const m = model.toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return { in: 10, out: 50 }
  if (m.includes('opus')) return { in: 5, out: 25 }
  if (m.includes('sonnet')) return { in: 3, out: 15 }
  if (m.includes('haiku')) return { in: 1, out: 5 }
  return undefined
}

/** Coût recalculé depuis les tokens — la MESURE INDÉPENDANTE qui arbitre. */
function estimation(usage, model) {
  const t = tarif(model)
  if (!t) return undefined
  const inp = Math.max(0, usage.inputTokens ?? 0)
  const write = Math.min(inp, Math.max(0, usage.cacheCreationTokens ?? 0))
  const read = Math.min(inp - write, Math.max(0, usage.cacheReadTokens ?? 0))
  const fresh = inp - write - read
  const out = Math.max(0, usage.outputTokens ?? 0)
  return (fresh * t.in + read * t.in * 0.1 + write * t.in * 1.25 + out * t.out) / 1e6
}

function lireLignes(chemin) {
  return readFileSync(chemin, 'utf-8').split('\n').filter((l) => l.trim())
}

/** Dé-cumule une suite de cumuls ; le premier terme reste tel quel. */
function deltas(valeurs) {
  let dernier = 0
  return valeurs.map((v) => {
    const d = v >= dernier ? v - dernier : v
    dernier = v
    return d
  })
}

/** Somme des écarts à l'estimation — plus c'est petit, plus la suite est crédible. */
function ecart(valeurs, estimations) {
  return valeurs.reduce((total, v, i) => total + Math.abs(v - (estimations[i] ?? v)), 0)
}

let avant = 0
let apres = 0
let fichiersModifies = 0
/** Correspondance cumul → coût du tour, par conversation : sert à réparer aussi l'activité. */
const correction = new Map()

const dossierPrompts = join(RACINE, 'prompt-observability')
for (const nom of existsSync(dossierPrompts) ? readdirSync(dossierPrompts) : []) {
  if (!nom.endsWith('.jsonl')) continue
  const chemin = join(dossierPrompts, nom)
  let lignes
  try {
    lignes = lireLignes(chemin)
  } catch {
    continue
  }
  const enregistrements = lignes.map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return null
    }
  })
  // Une SESSION = une suite de cumuls. Les appels sans session ne cumulent rien.
  const sessions = new Map()
  enregistrements.forEach((rec, index) => {
    const cout = rec?.usage?.costUsd
    if (typeof cout !== 'number' || !rec?.sessionId) return
    const liste = sessions.get(rec.sessionId) ?? []
    liste.push(index)
    sessions.set(rec.sessionId, liste)
  })
  const remplacements = new Map()
  for (const indices of sessions.values()) {
    if (indices.length < 2) continue
    const bruts = indices.map((i) => enregistrements[i].usage.costUsd)
    const ests = indices.map((i) => estimation(enregistrements[i].usage ?? {}, enregistrements[i].model))
    if (ests.some((e) => e === undefined)) continue
    const croissante = bruts.every((v, i) => i === 0 || v >= bruts[i - 1])
    if (!croissante) {
      /*
       * CUMULS ISOLÉS dans une session déjà juste. Mesuré le 2026-09-21 sur conv-733 : deux tours
       * écrits au moment même du redémarrage (61,55 $ et 64,71 $) au milieu de tours à 2-5 $ —
       * le magasin ne connaissait pas encore la session, donc le premier tour vu a gardé le cumul.
       * Signature : la valeur vaut la SOMME des tours précédents de la session plus son propre
       * coût. On ne la corrige que si cette lecture colle nettement mieux aux tokens du tour.
       */
      let somme = 0
      indices.forEach((i, rang) => {
        const brut = bruts[rang]
        const corrige = brut - somme
        if (
          rang > 0 &&
          corrige >= 0 &&
          // La valeur brute doit être MANIFESTEMENT fausse (au moins le double du coût mesuré par
          // les tokens). Sans ce seuil, 55 tours déjà justes se voyaient retirer quelques centimes
          // par coïncidence — un écart de 5 % n'est pas un cumul.
          brut > 2 * ests[rang] &&
          Math.abs(corrige - ests[rang]) * 2 < Math.abs(brut - ests[rang])
        ) {
          remplacements.set(i, corrige)
          somme += corrige
        } else {
          somme += brut
        }
      })
      continue
    }
    const decumules = deltas(bruts)
    // L'arbitrage : la version dé-cumulée doit coller NETTEMENT mieux aux tokens.
    if (!(ecart(decumules, ests) * 2 < ecart(bruts, ests))) continue
    indices.forEach((i, rang) => remplacements.set(i, decumules[rang]))
  }
  if (remplacements.size === 0) continue
  const conversation = nom.replace(/\.jsonl$/, '')
  const table = correction.get(conversation) ?? new Map()
  const sortie = enregistrements.map((rec, index) => {
    if (!remplacements.has(index)) return JSON.stringify(rec)
    const ancien = rec.usage.costUsd
    const nouveau = remplacements.get(index)
    avant += ancien
    apres += nouveau
    table.set(ancien.toFixed(9), nouveau)
    if (process.argv.includes("--detail")) console.log(`  ${nom} ${rec.ts} ${ancien.toFixed(3)} → ${nouveau.toFixed(3)} (tokens: ${estimation(rec.usage ?? {}, rec.model)?.toFixed(3)})`)
    return JSON.stringify({ ...rec, usage: { ...rec.usage, costUsd: nouveau } })
  })
  correction.set(conversation, table)
  fichiersModifies += 1
  if (ECRIRE) {
    const sauvegarde = `${chemin}.avant-decumul.bak`
    if (!existsSync(sauvegarde)) copyFileSync(chemin, sauvegarde)
    writeFileSync(chemin, `${sortie.join('\n')}\n`, 'utf-8')
  }
}

// ACTIVITÉ : mêmes montants, mais sans `sessionId` pour les regrouper. On applique la table
// établie ci-dessus, par valeur exacte — un cumul est unique au neuf-millionième près.
let activiteModifiee = 0
const dossierActivite = join(RACINE, 'activity')
for (const nom of existsSync(dossierActivite) ? readdirSync(dossierActivite) : []) {
  if (!nom.endsWith('.jsonl')) continue
  const table = correction.get(nom.replace(/\.jsonl$/, ''))
  if (!table || table.size === 0) continue
  const chemin = join(dossierActivite, nom)
  let lignes
  try {
    lignes = lireLignes(chemin)
  } catch {
    continue
  }
  let touche = false
  const sortie = lignes.map((ligne) => {
    let rec
    try {
      rec = JSON.parse(ligne)
    } catch {
      return ligne
    }
    if (typeof rec?.costUsd !== 'number') return ligne
    const nouveau = table.get(rec.costUsd.toFixed(9))
    if (nouveau === undefined) return ligne
    touche = true
    return JSON.stringify({ ...rec, costUsd: nouveau })
  })
  if (!touche) continue
  activiteModifiee += 1
  if (ECRIRE) {
    const sauvegarde = `${chemin}.avant-decumul.bak`
    if (!existsSync(sauvegarde)) copyFileSync(chemin, sauvegarde)
    writeFileSync(chemin, `${sortie.join('\n')}\n`, 'utf-8')
  }
}

console.log(
  `${ECRIRE ? 'RÉÉCRIT' : 'SIMULATION'} — journaux d'appels : ${fichiersModifies} fichiers · ` +
    `journaux d'activité : ${activiteModifiee} fichiers`
)
console.log(
  `Total affiché avant : ${avant.toFixed(2)} $ → après : ${apres.toFixed(2)} $ ` +
    `(${(avant - apres).toFixed(2)} $ de cumuls comptés deux fois)`
)
