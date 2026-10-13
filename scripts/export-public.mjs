#!/usr/bin/env node
/**
 * EXPORT PUBLIC — la version publique du depot est CE depot, SANS le dossier `entreprise/`.
 *
 * Pourquoi (2026-10-13, conv-913) : tout ce qui est propre a une entreprise vit dans
 * `entreprise/<nom>/`, et la garde `src/main/separation-entreprise.test.ts` interdit son nom partout
 * ailleurs. Exporter n'est donc plus remplacer des mots : c'est retirer un dossier. Le contenu de
 * chaque fichier publie est celui du depot, octet pour octet (aucune copie : l'arbre est construit
 * par git a partir des memes objets).
 *
 * Ce que fait le script :
 *   1. construit l'arbre de `--ref` (defaut HEAD) moins `entreprise/`, dans un index temporaire ;
 *   2. REFUSE de finir si un nom d'entreprise (dossiers et champ `nom` des profils) ou un terme
 *      interdit (champ `termesInterdits` : metier, serveurs, collegues, chemins personnels — conv-916)
 *      reste dans un chemin, un contenu (texte ou UTF-16), l'auteur ou le message. Un profil dont la
 *      liste de termes est mal formee fait refuser aussi : la regle ne se desarme pas en silence ;
 *   3. cree un commit LOCAL avec cet arbre. Avec `--parent <ref>` (ex. `github/main`), il se pose
 *      PAR-DESSUS l'historique public : l'envoi est alors un envoi normal, sans reecriture.
 *
 * Il n'envoie RIEN. Publier reste un geste explicite :  git push <distant> <commit>:refs/heads/main
 *
 * Usage :
 *   node scripts/export-public.mjs --auteur "Nom <adresse>" [--ref HEAD] [--parent github/main]
 *                                  [--message "Version publique"]
 * Sortie : une ligne JSON { commit, arbre, fichiers, exclus, parent }. Code 0 = pret, 1 = refuse.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  nomsDesProfils,
  RACINE_DEPOT,
  termeTrouve,
  termesDesProfils,
  texteDuFichier
} from './identite-entreprise.mjs'

const DOSSIER_EXCLU = 'entreprise'

function options(argv) {
  const lues = { ref: 'HEAD', message: 'Version publique' }
  for (let i = 0; i < argv.length; i += 2) {
    const cle = argv[i]?.replace(/^--/, '')
    if (!['ref', 'parent', 'auteur', 'message'].includes(cle) || argv[i + 1] === undefined) {
      throw new Error(`option inconnue ou sans valeur : ${argv[i]}`)
    }
    lues[cle] = argv[i + 1]
  }
  return lues
}

function git(args, env = {}, input) {
  return execFileSync('git', args, {
    cwd: RACINE_DEPOT,
    env: { ...process.env, ...env },
    input,
    maxBuffer: 1024 * 1024 * 1024
  })
}

/** Le nom en ASCII/UTF-8 (casse ignoree) ou en UTF-16LE. Decodage latin1 seulement : sur. */
function nomTrouve(octets, noms) {
  const texte = octets.toString('latin1').toLowerCase()
  return noms.find(
    (nom) => texte.includes(nom) || texte.includes(Buffer.from(nom, 'utf16le').toString('latin1'))
  )
}

/** Contenu de chaque blob de l'arbre, lu d'un seul processus `git cat-file --batch`. */
function* blobs(arbre) {
  const entrees = git(['ls-tree', '-r', '-z', arbre])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((ligne) => {
      const [meta, chemin] = ligne.split('\t')
      const [, type, sha] = meta.split(' ')
      return { type, sha, chemin }
    })
    .filter((entree) => entree.type === 'blob')
  const sortie = git(['cat-file', '--batch'], {}, entrees.map((e) => e.sha).join('\n') + '\n')
  let curseur = 0
  for (const entree of entrees) {
    const finEntete = sortie.indexOf(0x0a, curseur)
    const taille = Number(sortie.subarray(curseur, finEntete).toString('latin1').split(' ')[2])
    const debut = finEntete + 1
    yield { chemin: entree.chemin, octets: sortie.subarray(debut, debut + taille) }
    curseur = debut + taille + 1
  }
}

function exporter(argv) {
  const opts = options(argv)
  const auteur = /^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(opts.auteur ?? '')
  if (!auteur)
    throw new Error('--auteur "Nom <adresse>" est obligatoire (identite publique du commit)')
  const noms = nomsDesProfils()
  if (noms.length === 0)
    console.error('[export] aucun profil dans entreprise/ : rien a exclure ni a garder.')
  const { termes, erreurs } = termesDesProfils()
  if (erreurs.length > 0) {
    console.error('[export] REFUSE : termes interdits illisibles, la garde serait desarmee')
    for (const ligne of erreurs) console.error(`  - ${ligne}`)
    return 1
  }

  const index = join(tmpdir(), `autowin-export-${randomBytes(6).toString('hex')}.index`)
  const envIndex = { GIT_INDEX_FILE: index }
  try {
    git(['read-tree', opts.ref], envIndex)
    git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', DOSSIER_EXCLU], envIndex)
    const arbre = git(['write-tree'], envIndex).toString('utf8').trim()

    const refus = []
    let fichiers = 0
    for (const { chemin, octets } of blobs(arbre)) {
      fichiers += 1
      const dansChemin = noms.find((nom) => chemin.toLowerCase().includes(nom))
      if (dansChemin || termeTrouve(chemin, termes)) refus.push(`chemin ${chemin}`)
      else if (nomTrouve(octets, noms) || termeTrouve(texteDuFichier(octets), termes))
        refus.push(`contenu ${chemin}`)
    }
    const signature = `${opts.auteur}\n${opts.message}`
    if (nomTrouve(Buffer.from(signature, 'utf8'), noms) || termeTrouve(signature, termes))
      refus.push('auteur ou message')
    if (refus.length > 0) {
      console.error(
        `[export] REFUSE : ${refus.length} trace(s) d'un nom ou d'un terme d'entreprise hors de entreprise/`
      )
      for (const ligne of refus.slice(0, 50)) console.error(`  - ${ligne}`)
      return 1
    }

    const exclus = git(['ls-tree', '-r', '--name-only', opts.ref, '--', DOSSIER_EXCLU])
      .toString('utf8')
      .split('\n')
      .filter(Boolean).length
    const identite = {
      GIT_AUTHOR_NAME: auteur[1],
      GIT_AUTHOR_EMAIL: auteur[2],
      GIT_COMMITTER_NAME: auteur[1],
      GIT_COMMITTER_EMAIL: auteur[2]
    }
    const parent = opts.parent
      ? git(['rev-parse', '--verify', `${opts.parent}^{commit}`])
          .toString('utf8')
          .trim()
      : undefined
    const commit = git(
      ['commit-tree', arbre, ...(parent ? ['-p', parent] : []), '-m', opts.message],
      identite
    )
      .toString('utf8')
      .trim()
    console.log(JSON.stringify({ commit, arbre, fichiers, exclus, parent: parent ?? null }))
    return 0
  } finally {
    rmSync(index, { force: true })
  }
}

try {
  process.exitCode = exporter(process.argv.slice(2))
} catch (erreur) {
  console.error(`[export] ${erreur instanceof Error ? erreur.message : String(erreur)}`)
  process.exitCode = 1
}
