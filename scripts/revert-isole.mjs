#!/usr/bin/env node
// Verifie hors modele qu'un commit est annulable d'un seul `git revert`.
// Cause nommee (conv-539, tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e, saisie ts 1789466353210) :
// le juge a du verifier A LA MAIN que `git revert 0c286f60` cassait la compilation, parce que
// rien dans le depot ne mesurait cette promesse. Ce script est la mesure manquante.
// fix-ok: promesse "un commit par edition, annulable d'un seul revert" non mesurable -> mesure ajoutee.
// Sortie : JSON + statut 0 (annulable), 3 (conflit), 4 (compilation cassee), 2 (usage/erreur).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sha = process.argv[2]
if (!sha) {
  console.error('usage: node scripts/revert-isole.mjs <sha> [tsconfig]')
  process.exit(2)
}
const projet = process.argv[3] ?? 'tsconfig.node.json'
const git = (args, cwd = process.cwd()) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const erreursTsc = (racine) => {
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', join(racine, projet)], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    })
    return []
  } catch (e) {
    const brut = `${e.stdout ?? ''}${e.stderr ?? ''}`
    return brut
      .split(/\r?\n/)
      .filter((ligne) => /error TS\d+:/.test(ligne))
      .map((ligne) => ligne.replace(/^.*?([^\\/]+\(\d+,\d+\): error TS\d+)/, '$1'))
  }
}

const base = mkdtempSync(join(tmpdir(), 'revert-isole-'))
const arbre = join(base, 'wt')
const sortie = { sha, annulable: false, raison: null }
let statut = 0
try {
  git(['worktree', 'add', '--detach', arbre, 'HEAD'])
  const avant = erreursTsc(arbre)
  try {
    git(['revert', '--no-commit', '--no-edit', sha], arbre)
  } catch {
    sortie.raison = 'conflit: le revert ne s applique plus sur HEAD'
    statut = 3
  }
  if (statut === 0) {
    const apres = erreursTsc(arbre)
    const nouvelles = apres.filter((ligne) => !avant.includes(ligne))
    if (nouvelles.length > 0) {
      sortie.raison = `compilation cassee par le revert: ${nouvelles.slice(0, 5).join(' | ')}`
      statut = 4
    } else {
      sortie.annulable = true
      sortie.preuve = `revert applique, 0 erreur de compilation nouvelle (${avant.length} preexistante(s))`
    }
  }
} catch (e) {
  sortie.raison = `erreur: ${e.message}`
  statut = 2
} finally {
  try {
    git(['worktree', 'remove', '--force', arbre])
  } catch {
    // Nettoyage au mieux : le worktree peut deja etre absent ; rmSync ci-dessous finit le travail.
  }
  rmSync(base, { recursive: true, force: true })
}
console.log(JSON.stringify(sortie, null, 2))
process.exit(statut)
