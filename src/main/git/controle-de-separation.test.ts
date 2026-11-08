import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GitRunner } from '../runs/run-autoclose'
import { controleDeSeparation, type ResultatDeSeparation } from './controle-de-separation'

/**
 * Le contrôle des commits posés par l'app : il lit le message, les chemins et le contenu que le
 * commit emporte. Les cas tournent dans de vrais dépôts jetables : un git simulé ne prouverait ni la
 * lecture de l'index ni le profil trouvé depuis une copie liée.
 */

const racines: string[] = []
afterEach(() => {
  for (const racine of racines.splice(0)) rmSync(racine, { recursive: true, force: true })
})

const IDENTITE = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}
const PROFIL_VALIDE = JSON.stringify({ termesInterdits: [{ motif: 'zorglub' }] })

function gitBrut(args: string[], cwd: string, env: Record<string, string> = {}, entree?: string) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: entree,
    windowsHide: true
  })
}

function git(args: string[], cwd: string, env?: Record<string, string>, entree?: string): string {
  return gitBrut(args, cwd, env, entree).trim()
}

/** Un arbre qui ne contient QUE ces fichiers, bâti dans un index jetable (l'index du dépôt reste intact). */
function arbreDe(repo: string, fichiers: Record<string, string>): string {
  const env = { GIT_INDEX_FILE: join(repo, '.git', 'index-controle') }
  git(['read-tree', '--empty'], repo, env)
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const oid = git(['hash-object', '-w', '--stdin'], repo, {}, contenu)
    git(['update-index', '--add', '--cacheinfo', `100644,${oid},${chemin}`], repo, env)
  }
  return git(['write-tree'], repo, env)
}

type Preparation = { racine: string; repo: string; base: string; arbreBase: string }

/** Un dépôt avec un commit de base, et, si `profil` est donné, un profil d'entreprise sur le poste. */
function preparer(profil?: string): Preparation {
  const racine = mkdtempSync(join(tmpdir(), 'controle-separation-'))
  racines.push(racine)
  const repo = join(racine, 'depot')
  mkdirSync(repo)
  git(['init', '-q'], repo)
  if (profil !== undefined) {
    mkdirSync(join(repo, 'entreprise', 'acme'), { recursive: true })
    writeFileSync(join(repo, 'entreprise', 'acme', 'identite.json'), profil)
  }
  const arbreBase = arbreDe(repo, { 'a.txt': 'base\n' })
  const base = git(['commit-tree', arbreBase, '-m', 'base'], repo, IDENTITE)
  return { racine, repo, base, arbreBase }
}

const lanceur: GitRunner = async (args, cwd, options) => gitBrut(args, cwd, options?.env)

function controle(
  copie: string,
  base: string,
  arbre: string,
  message: string
): Promise<ResultatDeSeparation> {
  return controleDeSeparation({ copie, base, arbre, message, git: lanceur })
}

function refus(resultat: ResultatDeSeparation): string {
  if (resultat.ok) throw new Error('le commit aurait dû être refusé')
  return resultat.raison
}

describe('controleDeSeparation', () => {
  it('refuse un message de commit qui porte un terme du profil', async () => {
    const p = preparer(PROFIL_VALIDE)
    const r = await controle(p.repo, p.base, p.arbreBase, 'feat : la ligne zorglub')
    expect(refus(r)).toContain('message du commit')
  })

  it('son jumeau, un message propre, passe', async () => {
    const p = preparer(PROFIL_VALIDE)
    expect(await controle(p.repo, p.base, p.arbreBase, 'feat : la ligne propre')).toEqual({
      ok: true
    })
  })

  it('refuse un fichier dont le chemin porte le nom d’un profil', async () => {
    const p = preparer(PROFIL_VALIDE)
    const arbre = arbreDe(p.repo, { 'a.txt': 'base\n', 'notes-acme.txt': 'rien\n' })
    const r = await controle(p.repo, p.base, arbre, 'feat : ajout')
    expect(refus(r)).toContain('notes-acme.txt (chemin)')
  })

  it('refuse un contenu qui porte un terme du profil', async () => {
    const p = preparer(PROFIL_VALIDE)
    const arbre = arbreDe(p.repo, { 'a.txt': 'le serveur zorglub\n' })
    const r = await controle(p.repo, p.base, arbre, 'feat : contenu')
    expect(refus(r)).toContain('a.txt (contenu)')
  })

  it('refuse un contenu qui porte le nom d’un profil, casse ignorée', async () => {
    const p = preparer(PROFIL_VALIDE)
    const arbre = arbreDe(p.repo, { 'a.txt': 'Contrat ACME\n' })
    const r = await controle(p.repo, p.base, arbre, 'feat : contenu')
    expect(refus(r)).toContain('a.txt (contenu)')
  })

  it('son jumeau, un contenu propre, passe', async () => {
    const p = preparer(PROFIL_VALIDE)
    const arbre = arbreDe(p.repo, { 'a.txt': 'texte propre\n' })
    expect(await controle(p.repo, p.base, arbre, 'feat : contenu')).toEqual({ ok: true })
  })

  it('dans une copie liée, le profil du dépôt principal est trouvé', async () => {
    const p = preparer(PROFIL_VALIDE)
    const copie = join(p.racine, 'copie')
    git(['worktree', 'add', '-q', '--detach', copie, p.base], p.repo)
    const r = await controle(copie, p.base, p.arbreBase, 'feat : la ligne zorglub')
    expect(refus(r)).toContain('message du commit')
    expect(await controle(copie, p.base, p.arbreBase, 'feat : la ligne propre')).toEqual({
      ok: true
    })
  })

  it('un profil mal formé ne refuse pas le commit : le contrôle ne peut pas tourner, il le signale', async () => {
    const p = preparer('{ pas du json')
    const r = await controle(p.repo, p.base, p.arbreBase, 'feat : ligne propre')
    expect(r).toMatchObject({ ok: true, avertissement: expect.stringContaining('mal formé') })
  })

  it('sans profil d’entreprise sur le poste, rien à garder : le commit passe', async () => {
    const p = preparer()
    expect(await controle(p.repo, p.base, p.arbreBase, 'feat : la ligne zorglub')).toEqual({
      ok: true
    })
  })
})
