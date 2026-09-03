#!/usr/bin/env node
/**
 * arena-duel — JOURNAL DES DUELS de /arena : une ligne par BRAS mesure.
 *
 * Pourquoi : avant ce journal, un banc /arena ne laissait sur disque que les fichiers bruts
 * d'UN essai (`.autowin-data/<profil>/arena-bench/`, ecrase au banc suivant) et rien de
 * comparable d'un tournoi a l'autre. Chaque banc repartait donc de zero : impossible de dire
 * si un workflow a DEJA gagne ou perdu sur une tache voisine (mesure du 2026-09-03, conv-175).
 *
 * Une ligne = un bras : tache, workflow, duree, cout, verdict. Rien d'autre — pas de prose,
 * pas de score auto-attribue : les chiffres se LISENT dans `out-<bras>.json` / `activity/`.
 *
 * Usage :
 *   node scripts/arena-duel.mjs noter --tache "..." --workflow "..." --bras a \
 *        --duree-ms 123456 --cout-usd 0.63 --verdict gagnant [--banc <dossier>] [--note "..."]
 *   node scripts/arena-duel.mjs lire [--tache <filtre>] [--workflow <filtre>] [--limite 20] [--json]
 *
 * Exit 0 = ecrit / lu · 1 = entree refusee (champ manquant ou absurde).
 * Ecrit sous `.autowin-data/<profil>/arena-duels.jsonl` (append seul, jamais de reecriture).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const VERDICTS = ['gagnant', 'perdant', 'nul', 'abandonne', 'casse']
export const BRAS_VALIDES = ['a', 'b', 'c', 'x']

export function cheminJournal(racine = process.cwd(), profil = 'autowin-os') {
  return path.join(racine, '.autowin-data', profil, 'arena-duels.jsonl')
}

/**
 * Valide une entree de duel et rend la ligne normalisee, ou leve avec le motif exact.
 * Refuse ce qui rendrait le journal incomparable : tache vide, workflow vide, verdict inconnu,
 * duree/cout non numeriques ou negatifs. Un cout a 0 est ACCEPTE (abonnement inclus) mais
 * marque `coutUsd: 0` — il ne se devine pas.
 */
export function normaliserDuel(entree, maintenant = new Date()) {
  const texte = (v) => (typeof v === 'string' ? v.trim() : '')
  const tache = texte(entree.tache)
  const workflow = texte(entree.workflow)
  if (!tache) throw new Error('champ `tache` manquant : un duel sans tache est incomparable')
  if (!workflow) throw new Error('champ `workflow` manquant : c’est l’objet du duel')
  const verdict = texte(entree.verdict).toLowerCase()
  if (!VERDICTS.includes(verdict))
    throw new Error(`verdict \`${verdict || '(vide)'}\` inconnu — attendu : ${VERDICTS.join(', ')}`)
  const bras = texte(entree.bras).toLowerCase()
  if (bras && !BRAS_VALIDES.includes(bras))
    throw new Error(`bras \`${bras}\` inconnu — attendu : ${BRAS_VALIDES.join(', ')}`)
  const nombre = (v, nom) => {
    if (v === undefined || v === null || v === '') throw new Error(`champ \`${nom}\` manquant`)
    const n = Number(String(v).replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) throw new Error(`champ \`${nom}\` invalide : ${v}`)
    return n
  }
  return {
    schema: 'autowin.arena-duel/v1',
    ts: maintenant.toISOString(),
    tache,
    workflow,
    ...(bras ? { bras } : {}),
    dureeMs: Math.round(nombre(entree.dureeMs, 'duree-ms')),
    coutUsd: nombre(entree.coutUsd, 'cout-usd'),
    verdict,
    ...(texte(entree.banc) ? { banc: texte(entree.banc) } : {}),
    ...(texte(entree.note) ? { note: texte(entree.note) } : {})
  }
}

export function noterDuel(entree, racine = process.cwd(), profil = 'autowin-os') {
  const ligne = normaliserDuel(entree)
  const fichier = cheminJournal(racine, profil)
  mkdirSync(path.dirname(fichier), { recursive: true })
  appendFileSync(fichier, `${JSON.stringify(ligne)}\n`, 'utf8')
  return { fichier, ligne }
}

/** Les duels deja journalises, du plus recent au plus ancien. Lignes abimees IGNOREES, comptees. */
export function lireDuels(filtres = {}, racine = process.cwd(), profil = 'autowin-os') {
  const fichier = cheminJournal(racine, profil)
  if (!existsSync(fichier)) return { fichier, duels: [], abimees: 0 }
  let abimees = 0
  const duels = []
  for (const l of readFileSync(fichier, 'utf8').split('\n')) {
    if (!l.trim()) continue
    try {
      duels.push(JSON.parse(l))
    } catch {
      abimees += 1
    }
  }
  const contient = (v, f) => !f || String(v ?? '').toLowerCase().includes(String(f).toLowerCase())
  const gardes = duels
    .filter((d) => contient(d.tache, filtres.tache) && contient(d.workflow, filtres.workflow))
    .reverse()
  return {
    fichier,
    duels: filtres.limite ? gardes.slice(0, Number(filtres.limite)) : gardes,
    abimees
  }
}

function args(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const cle = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const suivant = argv[i + 1]
    if (suivant === undefined || suivant.startsWith('--')) o[cle] = true
    else {
      o[cle] = suivant
      i += 1
    }
  }
  return o
}

function main(argv) {
  const commande = argv[0]
  const o = args(argv.slice(1))
  if (commande === 'noter') {
    const { fichier, ligne } = noterDuel(o)
    console.log(`duel note dans ${fichier}`)
    console.log(JSON.stringify(ligne))
    return 0
  }
  if (commande === 'lire') {
    const { fichier, duels, abimees } = lireDuels(o)
    if (o.json) {
      console.log(JSON.stringify({ fichier, duels, abimees }, null, 2))
      return 0
    }
    if (!duels.length) {
      console.log(`aucun duel journalise (${fichier})`)
      return 0
    }
    console.log('| date | tache | workflow | bras | duree | cout $ | verdict |')
    console.log('|---|---|---|---|---|---|---|')
    for (const d of duels) {
      const min = (d.dureeMs / 60000).toFixed(1)
      console.log(
        `| ${String(d.ts).slice(0, 16)} | ${d.tache} | ${d.workflow} | ${d.bras ?? '-'} | ${min} min | ${Number(d.coutUsd).toFixed(4)} | ${d.verdict} |`
      )
    }
    if (abimees) console.log(`\n(${abimees} ligne(s) abimee(s) ignoree(s))`)
    return 0
  }
  console.error('usage : arena-duel.mjs noter|lire — voir l’en-tete du fichier')
  return 1
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (e) {
    console.error(`REFUSE : ${e.message}`)
    process.exit(1)
  }
}
