#!/usr/bin/env node
/**
 * Lit un fichier d'un dépôt GitHub PUBLIC tel qu'il est à un commit précis, et rend des liens
 * ancrés à la ligne (`/blob/<sha>/<chemin>#L<n>`) pour les lignes qui portent un motif.
 *
 * Pourquoi : `steal` exige qu'un mécanisme cité soit prouvé par du code lu « à un permalien »
 * (preuve 🟢). Sur ce poste `gh` n'est pas installé, et un lien vers une branche (`main`) change
 * sous le lecteur : la citation doit tenir dans trois mois. Le script ne passe que par l'API
 * publique (sans jeton) et le CDN `raw.githubusercontent.com`.
 *
 * Usage : node scripts/github-permalien.mjs <propriétaire/dépôt> <chemin> [--ref <branche|tag|sha>]
 *           [--motif <regex>] [--json]
 * Sortie : le commit, sa date, puis une ligne « permalien  texte » par correspondance.
 * Codes : 0 = lu (et au moins une ligne trouvée si --motif) · 1 = motif absent · 2 = arguments ·
 *         3 = réseau ou fichier introuvable.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function permalien(depot, sha, chemin, ligne) {
  return `https://github.com/${depot}/blob/${sha}/${chemin}#L${ligne}`
}

export function lignesCorrespondantes(texte, motif) {
  const re = new RegExp(motif, 'i')
  return texte
    .split(/\r?\n/)
    .map((t, i) => ({ ligne: i + 1, texte: t }))
    .filter((l) => re.test(l.texte))
}

export function lireArguments(argv) {
  const libres = []
  const opts = { ref: undefined, motif: undefined, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ref') opts.ref = argv[++i]
    else if (a === '--motif') opts.motif = argv[++i]
    else if (a === '--json') opts.json = true
    else libres.push(a)
  }
  const [depot, chemin] = libres
  if (!depot || !/^[\w.-]+\/[\w.-]+$/.test(depot)) {
    throw new Error('premier argument attendu : propriétaire/dépôt (ex. anthropics/skills)')
  }
  if (!chemin) throw new Error('deuxième argument attendu : chemin du fichier dans le dépôt')
  return { depot, chemin, ...opts }
}

async function json(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'autowin-github-permalien' } })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} sur ${url}`)
  return r.json()
}

/** Le dernier commit qui a touché CE fichier : sa date dit quand la citation a changé pour la dernière fois. */
async function dernierCommit(depot, chemin, ref) {
  const q = new URLSearchParams({ path: chemin, per_page: '1' })
  if (ref) q.set('sha', ref)
  const liste = await json(`https://api.github.com/repos/${depot}/commits?${q}`)
  if (!Array.isArray(liste) || liste.length === 0) {
    throw new Error(`aucun commit ne touche ${chemin} dans ${depot}${ref ? ` (${ref})` : ''}`)
  }
  return { sha: liste[0].sha, date: liste[0].commit.committer.date }
}

async function principal() {
  let args
  try {
    args = lireArguments(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    return 2
  }
  let commit, texte
  try {
    commit = await dernierCommit(args.depot, args.chemin, args.ref)
    const r = await fetch(
      `https://raw.githubusercontent.com/${args.depot}/${commit.sha}/${args.chemin}`
    )
    if (!r.ok) throw new Error(`${r.status} sur le fichier brut`)
    texte = await r.text()
  } catch (e) {
    console.error(e.message)
    return 3
  }
  const court = commit.sha.slice(0, 10)
  const lignes = args.motif ? lignesCorrespondantes(texte, args.motif) : []
  const resultat = {
    depot: args.depot,
    chemin: args.chemin,
    commit: court,
    date: commit.date,
    fichier: `https://github.com/${args.depot}/blob/${court}/${args.chemin}`,
    lignes: lignes.map((l) => ({ ...l, lien: permalien(args.depot, court, args.chemin, l.ligne) }))
  }
  if (args.json) console.log(JSON.stringify(resultat, null, 2))
  else {
    console.log(`${resultat.depot} @ ${court} (${commit.date}) — ${resultat.fichier}`)
    for (const l of resultat.lignes) console.log(`${l.lien}  ${l.texte.trim().slice(0, 220)}`)
  }
  return args.motif && lignes.length === 0 ? 1 : 0
}

// `exitCode` et non `process.exit()` : sous Windows, sortir pendant que `fetch` ferme encore ses
// connexions déclenche une assertion de libuv (code 127 au lieu du 3 annoncé, vu sur un dépôt 404).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  principal().then((code) => {
    process.exitCode = code
  })
}
