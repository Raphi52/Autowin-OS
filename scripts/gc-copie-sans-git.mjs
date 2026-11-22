#!/usr/bin/env node
/**
 * UNE COPIE QUI A PERDU SON LIEN GIT PORTE-T-ELLE DU TRAVAIL QUE LE DÉPÔT N'A PAS ?
 *
 * Le `/gc` ne retire une copie git que si `git status` la dit propre. Mais une copie déplacée, ou
 * dont l'inscription a été retirée du dépôt (`git worktree prune`), ne répond plus : `git status`
 * échoue (« not a git repository »), et un `2>/dev/null` fait passer cet échec pour « 0 modification ».
 * C'est arrivé le 19/11 sur 41 copies de deux autres dépôts du poste, mises en corbeille la veille.
 *
 * LA PREUVE ici ne dépend plus de l'inscription : chaque fichier de la copie est haché comme git le
 * rangerait (mêmes filtres de fin de ligne, `hash-object --stdin-paths` avec la config du dépôt), puis
 * cherché dans les objets du dépôt (`cat-file --batch-check`). Un contenu ABSENT n'est sauvegardé
 * nulle part : c'est du travail inédit. Un contenu présent est dans le dépôt, au moins comme objet.
 *
 * Ne comptent pas : ce que le `.gitignore` de la copie ignore, les fichiers vides, `.git`, et tout lien
 * ou jonction (jamais suivi : le `node_modules` des copies vise celui du dépôt).
 * Une copie qui a perdu son `.gitignore` racine (reste d'un retrait coupé) se juge AUSSI avec les règles
 * d'ignorance du dossier de travail du dépôt (`reglesDuDepot: true`) : sans elles, ses sorties de
 * construction passaient pour du travail inédit (21/11 : 33 restes de copies NéoRIG, 166 716 « inédits »,
 * tous sous `bin`, `obj`, `web/node_modules` ou `wwwroot/app`, que le `.gitignore` du dépôt ignore).
 * Limites : un fichier seulement indexé (`git add` sans commit) a son objet dans le dépôt ; il passe
 * pour connu alors qu'aucun commit ne le porte. Ce sont les règles ACTUELLES du dépôt qui jugent la copie.
 *
 * Usage, lecture seule :
 *   node --no-warnings scripts/gc-copie-sans-git.mjs [--depot <dépôt ou son .git>] <copie>...
 * Sans `--depot`, le dépôt se lit dans le fichier `.git` de la copie (`gitdir: <dépôt>/.git/worktrees/…`).
 * Sortie : JSON `{ copies: [{ copie, depot, connus, ignores, reglesDuDepot, liens, inedits,
 * tailleInedite, erreur }] }`.
 * Code 0 = toutes jugées, 1 = au moins une copie sans dépôt lisible (dit dans `erreur`), 2 = refusé.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAMPON = 512 * 1024 * 1024

/** Le dossier `.git` du dépôt d'une copie, lu dans son fichier `.git` ; `null` s'il ne se lit pas. */
export function depotDeLaCopie(copie) {
  const lien = join(copie, '.git')
  if (!existsSync(lien) || !lstatSync(lien).isFile()) return null
  const ligne = readFileSync(lien, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m)
  if (!ligne) return null
  // `<dépôt>/.git/worktrees/<nom>` : l'inscription peut avoir disparu, le dépôt, lui, reste.
  const gitdir = resolve(copie, ligne[1]).replace(/[\\/]worktrees[\\/][^\\/]+$/, '')
  return existsSync(join(gitdir, 'objects')) ? gitdir : null
}

/** `<dépôt>` ou `<dépôt>/.git` → le dossier `.git` ; `null` si aucun n'a d'objets. */
function dossierGit(depot) {
  for (const candidat of [join(depot, '.git'), depot])
    if (existsSync(join(candidat, 'objects'))) return resolve(candidat)
  return null
}

/** Fichiers de la copie, chemins relatifs en `/`, sans `.git` ni liens. */
function lister(copie) {
  const fichiers = []
  let liens = 0
  const pile = ['']
  while (pile.length) {
    const rel = pile.pop()
    for (const nom of readdirSync(join(copie, rel))) {
      if (rel === '' && nom === '.git') continue
      const chemin = rel ? `${rel}/${nom}` : nom
      const infos = lstatSync(join(copie, chemin))
      if (infos.isSymbolicLink()) liens++
      else if (infos.isDirectory()) pile.push(chemin)
      else if (infos.isFile() && infos.size > 0) fichiers.push({ chemin, taille: infos.size })
    }
  }
  return { fichiers, liens }
}

function git(gitdir, copie, args, entree, codesAdmis = [0]) {
  const r = spawnSync('git', [`--git-dir=${gitdir}`, `--work-tree=${copie}`, ...args], {
    cwd: copie,
    input: entree,
    encoding: 'utf8',
    maxBuffer: TAMPON
  })
  if (r.error) throw r.error
  if (!codesAdmis.includes(r.status)) throw new Error(`git ${args[0]} : ${r.stderr.trim()}`)
  return r.stdout
}

/**
 * Les chemins (relatifs, en `/`) que les `.gitignore` de `dossier` ignorent. `--no-index` : la règle
 * seule, sans l'index du dépôt (qui ne connaît pas la copie) ; les chemins n'ont pas à exister dans
 * `dossier`, ce qui permet de juger ceux d'une copie avec les règles du dossier de travail du dépôt.
 */
function ignoresParLesRegles(gitdir, dossier, fichiers) {
  if (!fichiers.length) return new Set()
  return new Set(
    git(
      gitdir,
      dossier,
      ['check-ignore', '--no-index', '--stdin', '-z'],
      fichiers.map((f) => f.chemin).join('\0'),
      [0, 1]
    )
      .split('\0')
      .filter(Boolean)
  )
}

/** Juge une copie : ce qu'elle porte que le dépôt n'a pas. */
export function inedits({ copie, depot }) {
  copie = resolve(copie)
  const gitdir = depot ? dossierGit(depot) : depotDeLaCopie(copie)
  const bilan = {
    copie,
    depot: gitdir,
    connus: 0,
    ignores: 0,
    reglesDuDepot: false,
    liens: 0,
    inedits: [],
    tailleInedite: 0
  }
  if (!gitdir) return { ...bilan, erreur: 'dépôt introuvable : donner --depot' }
  if (!existsSync(copie) || !statSync(copie).isDirectory())
    return { ...bilan, erreur: 'copie introuvable' }

  const { fichiers, liens } = lister(copie)
  bilan.liens = liens
  if (!fichiers.length) return bilan

  const ignores = ignoresParLesRegles(gitdir, copie, fichiers)
  // Sans `.gitignore` racine, la copie a perdu ses règles : le dossier de travail du dépôt les donne.
  // Un dépôt nu (`<nom>.git`) n'a pas de dossier de travail : son parent n'a rien à dire.
  const travailDuDepot = basename(gitdir) === '.git' ? dirname(gitdir) : null
  if (
    travailDuDepot &&
    !existsSync(join(copie, '.gitignore')) &&
    existsSync(join(travailDuDepot, '.gitignore'))
  ) {
    bilan.reglesDuDepot = true
    const restants = fichiers.filter((f) => !ignores.has(f.chemin))
    for (const chemin of ignoresParLesRegles(gitdir, travailDuDepot, restants)) ignores.add(chemin)
  }
  const suivis = fichiers.filter((f) => !ignores.has(f.chemin))
  bilan.ignores = fichiers.length - suivis.length
  if (!suivis.length) return bilan

  const empreintes = git(
    gitdir,
    copie,
    ['hash-object', '--stdin-paths'],
    suivis.map((f) => f.chemin).join('\n') + '\n'
  )
    .split('\n')
    .filter(Boolean)
  const presences = git(gitdir, copie, ['cat-file', '--batch-check'], empreintes.join('\n') + '\n')
    .split('\n')
    .filter(Boolean)
  suivis.forEach((f, i) => {
    if (presences[i]?.endsWith(' missing')) bilan.inedits.push(f)
    else bilan.connus++
  })
  bilan.inedits.sort((a, b) => b.taille - a.taille)
  bilan.tailleInedite = bilan.inedits.reduce((s, f) => s + f.taille, 0)
  return bilan
}

function principal(argv) {
  const copies = []
  let depot
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--depot') depot = argv[++i]
    else copies.push(argv[i])
  }
  if (!copies.length || (argv.includes('--depot') && !depot)) {
    process.stderr.write('usage : gc-copie-sans-git.mjs [--depot <dépôt>] <copie>...\n')
    return 2
  }
  const resultats = copies.map((copie) => {
    try {
      return inedits({ copie, depot })
    } catch (e) {
      return { copie: resolve(copie), erreur: String(e.message ?? e) }
    }
  })
  process.stdout.write(JSON.stringify({ copies: resultats }, null, 1) + '\n')
  return resultats.some((r) => r.erreur) ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = principal(process.argv.slice(2))
