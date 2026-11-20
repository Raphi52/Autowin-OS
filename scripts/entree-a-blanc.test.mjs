import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { entreeABlanc } from './entree-a-blanc.mjs'

/**
 * L'entrée à blanc doit annoncer ce que la porte fera (src/main/copies/copie-de-tache.ts) sans rien écrire.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : partir du HEAD de la copie au lieu de la base du fil
 * (refs/autowin/base-de-fil/<fil>) — le cas « base en avance » annonce alors un conflit que la porte ne voit pas
 * (conv-2032, 20/11/2026 : 3 conflits annoncés à tort sur app.css, demo1.mjs, README.md).
 */

const dossiers = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...ENV } }).trim()
const ecrire = (dossier, fichier, texte) => writeFileSync(join(dossier, fichier), texte)

/** Un dépôt avec main, une copie de fil `conv-9001` (worktree) et sa base posée sur le commit de départ. */
function depotAvecCopie() {
  const racine = mkdtempSync(join(tmpdir(), 'entree-a-blanc-test-'))
  dossiers.push(racine)
  const depot = join(racine, 'depot')
  const copie = join(racine, 'conv-9001')
  execFileSync('git', ['init', '-q', '-b', 'main', depot])
  git(depot, 'config', 'core.autocrlf', 'false')
  ecrire(depot, 'a.txt', 'un\ndeux\ntrois\n')
  ecrire(depot, 'b.txt', 'b\n')
  git(depot, 'add', '-A')
  git(depot, 'commit', '-q', '-m', 'départ')
  git(depot, 'worktree', 'add', '-q', '--detach', copie, 'main')
  git(depot, 'update-ref', 'refs/autowin/base-de-fil/conv-9001', 'HEAD')
  return { depot, copie }
}

const commiter = (depot, fichier, texte) => {
  ecrire(depot, fichier, texte)
  git(depot, 'commit', '-q', '-am', `main : ${fichier}`)
}

describe('entrée à blanc d’une copie de fil', () => {
  it('annonce une entrée sans conflit quand main a changé un autre fichier', () => {
    const { depot, copie } = depotAvecCopie()
    ecrire(copie, 'a.txt', 'UN\ndeux\ntrois\n')
    commiter(depot, 'b.txt', 'b modifié\n')
    const avant = git(depot, 'rev-parse', 'HEAD')
    const r = entreeABlanc({ copie, depot })
    expect(r).toMatchObject({ etat: 'entrera', fichiers: ['a.txt'] })
    // Rien n'est écrit : ni main, ni le dossier partagé, ni la copie.
    expect(git(depot, 'rev-parse', 'HEAD')).toBe(avant)
    expect(git(depot, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(copie, 'a.txt'), 'utf8')).toBe('UN\ndeux\ntrois\n')
    expect(git(copie, 'status', '--porcelain')).toBe('M a.txt')
  })

  it('nomme le fichier en conflit quand main et la copie changent la même ligne', () => {
    const { depot, copie } = depotAvecCopie()
    ecrire(copie, 'a.txt', 'COPIE\ndeux\ntrois\n')
    commiter(depot, 'a.txt', 'MAIN\ndeux\ntrois\n')
    expect(entreeABlanc({ copie, depot })).toMatchObject({ etat: 'conflit', enConflit: ['a.txt'] })
  })

  it('part de la base du fil, pas du HEAD de la copie (travail déjà entré puis retouché)', () => {
    const { depot, copie } = depotAvecCopie()
    // Tour 1 : la copie ajoute une ligne, la porte la fait entrer dans main et avance la base du fil.
    ecrire(copie, 'a.txt', 'un\ndeux\ntrois\nquatre\n')
    commiter(depot, 'a.txt', 'un\ndeux\ntrois\nquatre\n')
    const arbre = git(depot, 'rev-parse', 'HEAD^{tree}')
    const passage = git(depot, 'commit-tree', arbre, '-p', 'HEAD~1', '-m', 'passage')
    git(depot, 'update-ref', 'refs/autowin/base-de-fil/conv-9001', passage)
    // Tour 2 : la copie (HEAD toujours au départ) retouche la ligne ajoutée ; main avance ailleurs.
    ecrire(copie, 'a.txt', 'un\ndeux\ntrois\nQUATRE\n')
    commiter(depot, 'b.txt', 'b du lot voisin\n')
    expect(entreeABlanc({ copie, depot })).toMatchObject({ etat: 'entrera', fichiers: ['a.txt'] })
  })

  it('bloque sur un fichier visé modifié autrement dans le dossier partagé, pas s’il porte déjà le résultat', () => {
    const { depot, copie } = depotAvecCopie()
    ecrire(copie, 'a.txt', 'UN\ndeux\ntrois\n')
    ecrire(depot, 'a.txt', 'autre chose\n')
    expect(entreeABlanc({ copie, depot })).toMatchObject({ etat: 'bloque', bloquants: ['a.txt'] })
    ecrire(depot, 'a.txt', 'UN\ndeux\ntrois\n')
    expect(entreeABlanc({ copie, depot })).toMatchObject({ etat: 'entrera' })
  })

  it('bloque sans base posée, et ne voit rien à entrer dans une copie identique à sa base', () => {
    const { depot, copie } = depotAvecCopie()
    expect(entreeABlanc({ copie, depot })).toMatchObject({ etat: 'rien-a-entrer' })
    expect(entreeABlanc({ copie, depot, fil: 'conv-0000' })).toMatchObject({ etat: 'bloque' })
  })
})
