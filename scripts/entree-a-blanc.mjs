#!/usr/bin/env node
/**
 * ENTRÉE À BLANC d'une copie de fil dans main : dit AVANT la fin du tour si la porte refusera l'envoi
 * (« ⛔ Envoi refusé »), sans rien écrire dans le dossier partagé ni dans la copie.
 *
 * Rejoue le calcul de la porte (src/main/copies/copie-de-tache.ts, entrerSansFile) :
 *  - le point de départ est la BASE DU FIL (refs/autowin/base-de-fil/<fil>), pas le HEAD de la copie : après une
 *    entrée, la base avance alors que le HEAD de la copie reste en arrière (constaté sur conv-2032 le 20/11/2026 :
 *    un essai fait depuis HEAD annonçait 3 conflits, la porte n'en voyait aucun) ;
 *  - l'arbre de la copie = son index + tous ses fichiers (`add -A` sur une copie de l'index) ;
 *  - fusion à trois voies (`merge-tree --merge-base=<base>`) avec la tête du dossier partagé ;
 *  - un fichier visé modifié et non commité dans le dossier partagé bloque, sauf s'il porte déjà le résultat.
 * Les seuls objets écrits sont l'arbre et le commit de passage, hors de toute branche (ramassés par git gc).
 *
 * Usage : node scripts/entree-a-blanc.mjs <copie du fil> [--fil conv-NNNN] [--depot <dossier partagé>]
 *   --fil   : par défaut le nom du dossier de la copie (copies-de-taches/conv-2032 → conv-2032)
 *   --depot : par défaut le dossier principal du dépôt (premier de `git worktree list`)
 * Codes : 0 = entrera (ou rien à entrer) · 1 = conflit · 2 = bloqué (base absente, fichier non commité) · 3 = usage.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const git = (cwd, args, env) =>
  execFileSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 << 20 })
const essai = (cwd, args) => {
  try {
    return git(cwd, args).trim() || null
  } catch {
    return null
  }
}

/** Le dossier principal d'un dépôt : la première entrée de `git worktree list`. */
export function dossierPrincipal(copie) {
  const premiere = git(copie, ['worktree', 'list', '--porcelain']).split(/\r?\n/u)[0] ?? ''
  return premiere.replace(/^worktree /u, '').trim()
}

/** L'arbre que la porte lira : l'index de la copie, complété de tous ses fichiers, sans toucher son vrai index. */
function arbreDeLaCopie(copie) {
  const temporaire = mkdtempSync(join(tmpdir(), 'entree-a-blanc-'))
  try {
    const index = join(temporaire, 'index')
    const vrai = resolve(copie, git(copie, ['rev-parse', '--git-path', 'index']).trim())
    if (existsSync(vrai)) copyFileSync(vrai, index)
    git(copie, ['add', '-A', '--', '.'], { GIT_INDEX_FILE: index })
    return git(copie, ['write-tree'], { GIT_INDEX_FILE: index }).trim()
  } finally {
    rmSync(temporaire, { recursive: true, force: true })
  }
}

const cheminsDuStatut = (sortie) => {
  const chemins = new Set()
  const champs = sortie.split('\0')
  for (let i = 0; i < champs.length; i++) {
    const champ = champs[i]
    if (champ.length < 4) continue
    chemins.add(champ.slice(3))
    if (champ[0] === 'R' || champ[0] === 'C') chemins.add(champs[++i]) // renommage : l'ancien nom suit
  }
  return chemins
}

/**
 * @returns {{ etat: 'entrera'|'deja-dans-la-branche'|'rien-a-entrer'|'conflit'|'bloque', fichiers: string[],
 *   enConflit?: string[], bloquants?: string[], base?: string, raison?: string }}
 */
export function entreeABlanc({ copie, fil = basename(resolve(copie)), depot = dossierPrincipal(copie) }) {
  const base = essai(depot, ['rev-parse', '--verify', '-q', `refs/autowin/base-de-fil/${fil}^{commit}`])
  if (!base)
    return { etat: 'bloque', fichiers: [], raison: `aucune base posée pour ${fil} (refs/autowin/base-de-fil/${fil})` }
  const arbre = arbreDeLaCopie(copie)
  const arbreBase = git(depot, ['rev-parse', `${base}^{tree}`]).trim()
  const fichiers =
    arbre === arbreBase
      ? []
      : git(depot, ['diff-tree', '-r', '--name-only', '--no-renames', '-z', arbreBase, arbre]).split('\0').filter(Boolean)
  if (fichiers.length === 0) return { etat: 'rien-a-entrer', fichiers, base }

  const tete = git(depot, ['rev-parse', 'HEAD']).trim()
  const passage = git(depot, ['-c', 'commit.gpgsign=false', 'commit-tree', arbre, '-p', base, '-m', `Entrée à blanc de ${fil}`], {
    GIT_AUTHOR_NAME: 'entree-a-blanc', GIT_AUTHOR_EMAIL: 'autowin@localhost',
    GIT_COMMITTER_NAME: 'entree-a-blanc', GIT_COMMITTER_EMAIL: 'autowin@localhost'
  }).trim()
  let fusion
  try {
    fusion = git(depot, ['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, tete, passage])
  } catch (erreur) {
    if (erreur.status !== 1 || typeof erreur.stdout !== 'string') throw erreur
    // Sortie de merge-tree en conflit : l'arbre, puis les fichiers en conflit, puis une ligne vide et les messages.
    const lignes = erreur.stdout.split(/\r?\n/u)
    const fin = lignes.indexOf('', 1)
    const enConflit = [...new Set(lignes.slice(1, fin === -1 ? undefined : fin).filter(Boolean))]
    return { etat: 'conflit', fichiers, enConflit, base }
  }
  const arbreFusionne = fusion.split(/\r?\n/u)[0].trim()
  if (arbreFusionne === git(depot, ['rev-parse', `${tete}^{tree}`]).trim())
    return { etat: 'deja-dans-la-branche', fichiers, base }

  const sales = cheminsDuStatut(git(depot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
  const bloquants = fichiers.filter((chemin) => {
    if (!sales.has(chemin)) return false
    const cible = essai(depot, ['rev-parse', '--verify', '-q', `${arbreFusionne}:${chemin}`])
    const surDisque = existsSync(join(depot, chemin)) ? essai(depot, ['hash-object', '--', chemin]) : null
    return !cible || cible !== surDisque
  })
  if (bloquants.length > 0)
    return { etat: 'bloque', fichiers, bloquants, base, raison: 'modifié et non commité dans le dossier partagé' }
  return { etat: 'entrera', fichiers, base }
}

const CODES = { entrera: 0, 'deja-dans-la-branche': 0, 'rien-a-entrer': 0, conflit: 1, bloque: 2 }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const option = (nom) => {
    const i = args.indexOf(nom)
    return i === -1 ? undefined : args.splice(i, 2)[1]
  }
  const fil = option('--fil')
  const depot = option('--depot')
  const copie = args[0]
  if (!copie || !existsSync(copie)) {
    console.error('Usage : node scripts/entree-a-blanc.mjs <copie du fil> [--fil conv-NNNN] [--depot <dossier partagé>]')
    process.exit(3)
  }
  const r = entreeABlanc({ copie, ...(fil ? { fil } : {}), ...(depot ? { depot } : {}) })
  const libelle = {
    entrera: 'ENTRERA sans conflit',
    'deja-dans-la-branche': 'déjà dans la branche : rien ne sera ajouté',
    'rien-a-entrer': 'rien à entrer',
    conflit: `CONFLIT sur ${r.enConflit?.join(', ')}`,
    bloque: `BLOQUÉ : ${r.raison}${r.bloquants ? ` (${r.bloquants.join(', ')})` : ''}`
  }[r.etat]
  console.log(`${libelle}${r.base ? ` — base du fil ${r.base.slice(0, 9)}` : ''}`)
  if (r.fichiers.length) console.log(`fichiers apportés : ${r.fichiers.join(', ')}`)
  process.exit(CODES[r.etat])
}
