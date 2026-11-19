import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { depotDeLaCopie, inedits } from './gc-copie-sans-git.mjs'

/*
 * Le cas réel du 19/11 : 41 copies de deux autres dépôts mises en corbeille après que leur
 * inscription git a été retirée. `git status` n'y lit plus rien ; seul le contenu des fichiers,
 * comparé aux objets du dépôt, dit s'il reste du travail que le dépôt n'a pas.
 */
const SCRIPT = fileURLToPath(new URL('./gc-copie-sans-git.mjs', import.meta.url))

let racine
let depot
let copie

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr}`)
  return r.stdout
}

function ecrire(chemin, contenu) {
  mkdirSync(dirname(chemin), { recursive: true })
  writeFileSync(chemin, contenu)
}

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'gc-copie-sans-git-'))
  depot = join(racine, 'depot')
  copie = join(racine, 'corbeille', 'copie-lot5')
  mkdirSync(depot)
  git(depot, 'init', '-q')
  git(depot, 'config', 'user.email', 'test@example.invalid')
  git(depot, 'config', 'user.name', 'test')
  // Cas réel : le dépôt range ses textes en LF, la copie Windows les a en CRLF.
  git(depot, 'config', 'core.autocrlf', 'true')
  ecrire(join(depot, '.gitignore'), 'dist/\n')
  ecrire(join(depot, 'src', 'jeu.luau'), 'local a = 1\nreturn a\n')
  git(depot, 'add', '.')
  git(depot, 'commit', '-q', '-m', 'base')

  // La copie : son `.git` vise une inscription que le dépôt n'a plus.
  ecrire(
    join(copie, '.git'),
    `gitdir: ${join(depot, '.git', 'worktrees', 'copie-lot5').replaceAll('\\', '/')}\n`
  )
  ecrire(join(copie, '.gitignore'), 'dist/\n')
  ecrire(join(copie, 'src', 'jeu.luau'), 'local a = 1\r\nreturn a\r\n')
  ecrire(join(copie, 'src', 'nouveau.luau'), 'return "travail jamais commité"\n')
  ecrire(join(copie, 'dist', 'paquet.js'), 'construit, ignoré par git')
  ecrire(join(copie, 'vide.txt'), '')
  // Une jonction vers un dossier plein d'inédits : jamais suivie, comme le node_modules des copies.
  const cible = join(racine, 'ailleurs')
  ecrire(join(cible, 'etranger.txt'), 'contenu hors de la copie')
  symlinkSync(cible, join(copie, 'node_modules'), 'junction')
})

afterEach(() => {
  rmSync(racine, { recursive: true, force: true })
})

describe('depotDeLaCopie', () => {
  it('déduit le dépôt du fichier .git, même quand son inscription a disparu', () => {
    expect(depotDeLaCopie(copie)).toBe(join(depot, '.git'))
  })

  it('rend null pour un dossier sans .git', () => {
    rmSync(join(copie, '.git'))
    expect(depotDeLaCopie(copie)).toBeNull()
  })
})

describe('inedits', () => {
  it('ne garde que le contenu absent du dépôt : ni le connu (même en CRLF), ni l’ignoré, ni le vide, ni le lié', () => {
    const r = inedits({ copie })
    expect(r.depot).toBe(join(depot, '.git'))
    expect(r.inedits.map((f) => f.chemin)).toEqual(['src/nouveau.luau'])
    expect(r.connus).toBe(2) // .gitignore et src/jeu.luau ; ni .git, ni le vide, ni l'ignoré
    expect(r.ignores).toBe(1)
    expect(r.liens).toBe(1)
    expect(r.tailleInedite).toBeGreaterThan(0)
  })

  it('rend une copie sans inédit quand tout son contenu est dans le dépôt', () => {
    rmSync(join(copie, 'src', 'nouveau.luau'))
    expect(inedits({ copie }).inedits).toEqual([])
  })

  it('accepte le dépôt donné à la main pour une copie sans .git', () => {
    rmSync(join(copie, '.git'))
    expect(inedits({ copie }).erreur).toMatch(/dépôt/)
    expect(inedits({ copie, depot }).inedits.map((f) => f.chemin)).toEqual(['src/nouveau.luau'])
  })
})

describe('ligne de commande', () => {
  it('rend du JSON, code 0, et 1 quand une copie ne peut pas être jugée', () => {
    const ok = spawnSync(process.execPath, [SCRIPT, copie], { encoding: 'utf8' })
    expect(ok.status).toBe(0)
    expect(JSON.parse(ok.stdout).copies[0].inedits).toHaveLength(1)

    const orpheline = join(racine, 'sans-depot')
    ecrire(join(orpheline, 'a.txt'), 'a')
    const ko = spawnSync(process.execPath, [SCRIPT, orpheline], { encoding: 'utf8' })
    expect(ko.status).toBe(1)
    expect(JSON.parse(ko.stdout).copies[0].erreur).toMatch(/dépôt/)
  })

  it('refuse un appel sans copie, code 2', () => {
    expect(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status).toBe(2)
  })
})
