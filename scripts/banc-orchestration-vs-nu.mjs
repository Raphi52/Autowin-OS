#!/usr/bin/env node
/**
 * banc-orchestration-vs-nu - prepare et arbitre un banc "orchestration vs appel nu".
 *
 * Pourquoi : ce qui declenche l'orchestration, c'est une PHASE nommee explicitement
 * (/scout, /build...) - src/main/agent-pilot.ts ~l.1078. La difficulte de la tache
 * n'entre PAS dans la decision : l'ancienne heuristique verbe + cible a ete retiree
 * (precision 25 % sur 251 messages). Le banc, lui, force les deux regimes a la main.
 * Mais sur une tache TRIVIALE la comparaison est vide : l'orchestration n'est plus que du
 * surcout, il n'y a rien a departager. D'ou une tache de code REELLE, multi-fichiers, avec
 * un oracle binaire que le bras ne voit pas - sinon il l'optimise au lieu de corriger.
 * fix-ok: l'en-tete attribuait le declenchement a la difficulte de la tache, absent du code
 * lu (agent-pilot.ts l.1066-1083 : seule une phase nommee court-circuite vers orchestrate).
 *
 * Le defaut n'est pas invente : il est RESEME en annulant un correctif reel du depot
 * (3106a10d, 4 fichiers de code), et l'oracle est le jeu de tests de CE correctif, retire de
 * la copie du bras puis rejoue depuis git sur sa racine. Un verdict de juge ne conclut rien
 * tout seul (6 bancs residus, gagnant inverse a configuration identique, 2026-09-06) : ici
 * c'est un code de sortie.
 *
 * BASE FIGEE (choix utilisateur, conv-770, 2026-09-28) : le bras part de 3106a10d lui-meme, jamais
 * de la tete du depot. Depuis b94b6ce6 (2026-09-18), qui a retouche les memes fichiers, annuler le
 * correctif sur la tete ne s'appliquait plus : `--preparer` aurait plante. Sur sa propre base,
 * l'annulation est exacte par construction, et le bras recoit un depot COHERENT (l'etat de 3106a10d
 * avec, pour les 4 fichiers de code, celui d'avant le correctif). Depuis cette base, package.json
 * n'a fait qu'AJOUTER deux dependances : le node_modules courant la sert.
 *
 * Usage (la racine est une COPIE : clone ou worktree propre, jamais le depot principal) :
 *   node scripts/banc-orchestration-vs-nu.mjs --preparer <racine-du-bras>
 *   node scripts/banc-orchestration-vs-nu.mjs --oracle   <racine-du-bras> [--json]
 * Exit 0 = oracle vert | 1 = oracle rouge | 2 = entrees illisibles.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Le correctif reel annule pour reseamer le defaut. */
export const COMMIT_CORRECTIF = '3106a10d'

/** Fichiers de CODE dont le correctif est annule : c'est le defaut que le bras doit retrouver. */
export const FICHIERS_CODE = [
  'src/main/behaviour-composition.ts',
  'src/main/chat-pilotage-prompt.ts',
  'src/main/constitution.ts',
  'src/main/response-style.ts'
]

/** Fichiers de TEST : ce sont l'oracle. Retires de la copie du bras, rejoues depuis git. */
export const FICHIERS_ORACLE = [
  'src/main/behaviour-composition.test.ts',
  'src/main/chat-pilotage-prompt.symptome-moindre-cout.test.ts',
  'src/main/ordre-de-priorite-des-consignes.test.ts',
  'src/main/response-style.test.ts'
]

/** L'enonce remis aux DEUX bras, mot pour mot. */
export const ENONCE = `Le prompt systeme du chat a regresse : l'escalier de localisation d'un symptome,
l'ordre de priorite des consignes et le profil de reponse ne sont plus coherents entre
src/main/constitution.ts, src/main/chat-pilotage-prompt.ts, src/main/behaviour-composition.ts et
src/main/response-style.ts. Retrouve le defaut, corrige-le a sa cause, et couvre-le par un test.
Ne modifie aucun fichier hors de src/main.`

const git = (racine, args) =>
  execFileSync('git', ['-C', racine, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/** Le patch du correctif, restreint aux fichiers de code. */
export function patchDuCorrectif(racine) {
  return git(racine, ['show', COMMIT_CORRECTIF, '--', ...FICHIERS_CODE])
}

/** La base figee du bras : le commit du correctif, ou son annulation est exacte (voir l'en-tete). */
export const BASE = COMMIT_CORRECTIF

/** Le depot qui porte ce script : le banc ne le prepare JAMAIS, il ne travaille que sur une copie. */
const DEPOT_DU_BANC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Chemins REELS : sous Windows, le dossier temporaire arrive sous son nom court (RAPHAE~1.VIL)
// alors que git rend le nom long — compares tels quels, deux ecritures du meme dossier different.
const reel = (p) => realpathSync.native(path.resolve(p)).toLowerCase()
const memeChemin = (a, b) => reel(a) === reel(b)

/**
 * Place la copie du bras sur la base figee, y resseme le defaut et retire l'oracle de sa vue.
 * Deux refus AVANT tout geste, parce que la preparation deplace HEAD et reecrit des fichiers :
 *  - la racine doit etre la racine de SA copie git — un dossier ordinaire rangé dans le depot
 *    principal ferait agir git sur le depot principal — et jamais le depot du banc lui-meme ;
 *  - la copie doit etre propre : un travail local y serait melange au defaut, ou ecrase.
 */
export function preparer(racine) {
  const niveau = git(racine, ['rev-parse', '--show-toplevel']).trim()
  if (!memeChemin(niveau, racine) || memeChemin(niveau, DEPOT_DU_BANC))
    throw new Error(
      `refus : ${racine} n'est pas une copie du bras (racine git : ${niveau}). Le banc ne prepare ` +
        `qu'un clone ou un worktree dedie, jamais le depot principal.`
    )
  if (git(racine, ['status', '--porcelain']).trim())
    throw new Error(`refus : la copie ${racine} porte du travail local (git status non vide).`)
  git(racine, ['checkout', '--quiet', '--detach', BASE])
  const patch = path.join(racine, '.banc-correctif.patch')
  writeFileSync(patch, patchDuCorrectif(racine))
  git(racine, ['apply', '-R', patch])
  rmSync(patch)
  for (const f of FICHIERS_ORACLE) rmSync(path.join(racine, f), { force: true })
  writeFileSync(path.join(racine, 'TACHE.md'), `${ENONCE}\n`)
  return { base: BASE, defautResseme: FICHIERS_CODE, oracleRetire: FICHIERS_ORACLE }
}

/** Remet l'oracle depuis git sur la racine du bras et le rejoue. Vrai = le bras a corrige. */
export function oracle(racine) {
  git(racine, ['checkout', COMMIT_CORRECTIF, '--', ...FICHIERS_ORACLE])
  try {
    const sortie = execFileSync('npx', ['vitest', 'run', ...FICHIERS_ORACLE], {
      cwd: racine,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024
    })
    return { vert: true, sortie }
  } catch (e) {
    return { vert: false, sortie: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2)
  const mode = args[0]
  const racine = args[1] ? path.resolve(args[1]) : null
  if (!racine || !existsSync(racine) || !['--preparer', '--oracle'].includes(mode)) {
    console.error('usage: banc-orchestration-vs-nu.mjs --preparer|--oracle <racine-du-bras> [--json]')
    process.exit(2)
  }
  if (mode === '--preparer') {
    console.log(JSON.stringify(preparer(racine), null, 2))
    process.exit(0)
  }
  const r = oracle(racine)
  const derniereLignes = r.sortie.split('\n').slice(-12).join('\n')
  if (args.includes('--json')) console.log(JSON.stringify({ vert: r.vert, racine }))
  else console.log(`${derniereLignes}\nORACLE: ${r.vert ? 'VERT' : 'ROUGE'} — ${racine}`)
  process.exit(r.vert ? 0 : 1)
}
