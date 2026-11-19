#!/usr/bin/env node
/**
 * sql-resultat-vers-fichier — écrit dans un fichier JSON le résultat EXACT de requêtes `sql_query`
 * déjà passées dans la session, sans que l'agent recopie une seule valeur.
 *
 * Pourquoi : `sql_query` rend ses lignes dans le contexte de l'agent, et rien d'autre. Pour livrer
 * un fichier (liste de référence, jeu de validation), l'agent devait RECOPIER des centaines de
 * lignes de production : lent, et chaque valeur recopiée peut être altérée sans que rien ne le voie.
 * Constaté le 2026-11-17 : 6 listes d'une base de production à livrer en JSON, jusqu'à
 * 1 275 lignes par liste.
 *
 * Ce script ne se connecte à AUCUNE base : il relit le journal de la session
 * (`.autowin-data/autowin-os/run-stdout/*.stdout.jsonl`), où chaque résultat d'outil est consigné
 * tel que l'agent l'a reçu. Toutes les gardes de `sql_query` (catalogue, SELECT seul, ROLLBACK,
 * plafond de lignes) restent donc la seule porte vers la base ; une liste plus longue que le
 * plafond se lit en PAGES (OFFSET … FETCH), chacune visible et bornée.
 *
 * Contrat côté requête : chaque ligne porte deux colonnes de marquage —
 *   'nom-du-lot' AS aw_lot, <n> AS aw_page   (pages numérotées à partir de 1)
 * Le script rassemble les pages du lot, vérifie qu'aucune n'est tronquée et qu'aucune ne manque,
 * retire les colonnes aw_*, puis écrit le tableau.
 *
 * Usage :
 *   node scripts/sql-resultat-vers-fichier.mjs --lot avocats --sortie C:/…/avocats.json [--attendu 1275]
 *        [--journal <fichier.stdout.jsonl>]
 * Codes de sortie : 0 écrit · 2 arguments · 3 lot introuvable · 4 page tronquée · 5 page manquante
 *                   · 6 nombre de lignes différent de --attendu
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOSSIER_JOURNAUX = join(RACINE, '.autowin-data', 'autowin-os', 'run-stdout')

/** Textes des résultats d'outil d'une ligne de journal (forme stream-json de Claude Code). */
function textesDeResultats(ligne) {
  const contenu = ligne?.message?.content
  if (ligne?.type !== 'user' || !Array.isArray(contenu)) return []
  const textes = []
  for (const bloc of contenu) {
    if (bloc?.type !== 'tool_result') continue
    const c = bloc.content
    if (typeof c === 'string') textes.push({ id: bloc.tool_use_id, texte: c })
    else if (Array.isArray(c)) {
      for (const p of c)
        if (p?.type === 'text') textes.push({ id: bloc.tool_use_id, texte: p.text })
    }
  }
  return textes
}

/**
 * Pages d'un lot trouvées dans le texte d'un journal. Une page rejouée plus tard remplace la
 * précédente (la dernière lecture fait foi).
 * @returns {Map<number, {lignes: object[], tronquee: boolean}>}
 */
export function pagesDuLot(texteJournal, lot) {
  const pages = new Map()
  for (const brut of texteJournal.split('\n')) {
    if (!brut.includes('aw_lot')) continue
    let ligne
    try {
      ligne = JSON.parse(brut)
    } catch {
      continue
    }
    for (const { texte } of textesDeResultats(ligne)) {
      let resultat
      try {
        resultat = JSON.parse(texte)
      } catch {
        continue
      }
      const lignes = resultat?.ok === true && Array.isArray(resultat.rows) ? resultat.rows : null
      if (!lignes || lignes.length === 0 || lignes[0].aw_lot !== lot) continue
      const page = Number(lignes[0].aw_page ?? 1)
      pages.set(page, { lignes, tronquee: resultat.truncated === true })
    }
  }
  return pages
}

/** Assemble les pages 1..N en un seul tableau, colonnes aw_* retirées. Lève une erreur codée. */
export function assembler(pages) {
  const numeros = [...pages.keys()].sort((a, b) => a - b)
  for (let i = 0; i < numeros.length; i++) {
    if (numeros[i] !== i + 1) {
      throw Object.assign(
        new Error(`page ${i + 1} manquante (pages vues : ${numeros.join(', ')})`),
        { code: 5 }
      )
    }
  }
  const tout = []
  for (const n of numeros) {
    const { lignes, tronquee } = pages.get(n)
    if (tronquee) {
      throw Object.assign(
        new Error(`page ${n} tronquée par le plafond de sql_query : réduis la page`),
        { code: 4 }
      )
    }
    for (const l of lignes) {
      const propre = {}
      for (const [k, v] of Object.entries(l)) if (!k.startsWith('aw_')) propre[k] = v
      tout.push(propre)
    }
  }
  return tout
}

function journalContenant(lot) {
  const fichiers = readdirSync(DOSSIER_JOURNAUX)
    .filter((f) => f.endsWith('.stdout.jsonl'))
    .map((f) => join(DOSSIER_JOURNAUX, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, 20)
  const marque = `\\"aw_lot\\":\\"${lot}\\"`
  return fichiers.find((f) => readFileSync(f, 'utf8').includes(marque))
}

function lireArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]
  }
  return a
}

function principal() {
  const args = lireArgs(process.argv.slice(2))
  if (!args.lot || !args.sortie) {
    console.error(
      'usage : --lot <nom> --sortie <fichier.json> [--attendu <n>] [--journal <fichier>]'
    )
    return 2
  }
  const journal = args.journal ?? journalContenant(args.lot)
  if (!journal) {
    console.error(
      `lot « ${args.lot} » introuvable dans les 20 derniers journaux de ${DOSSIER_JOURNAUX}`
    )
    return 3
  }
  const pages = pagesDuLot(readFileSync(journal, 'utf8'), args.lot)
  if (pages.size === 0) {
    console.error(`lot « ${args.lot} » introuvable dans ${journal}`)
    return 3
  }
  let lignes
  try {
    lignes = assembler(pages)
  } catch (e) {
    console.error(e.message)
    return e.code ?? 1
  }
  if (args.attendu !== undefined && lignes.length !== Number(args.attendu)) {
    console.error(`${lignes.length} ligne(s) assemblée(s), ${args.attendu} attendue(s)`)
    return 6
  }
  mkdirSync(dirname(resolve(args.sortie)), { recursive: true })
  writeFileSync(args.sortie, JSON.stringify(lignes, null, 2) + '\n', 'utf8')
  console.log(
    JSON.stringify({
      lot: args.lot,
      pages: pages.size,
      lignes: lignes.length,
      sortie: args.sortie,
      journal
    })
  )
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal()
}
