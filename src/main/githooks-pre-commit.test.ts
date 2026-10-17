import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * `.githooks/pre-commit` — REFUS d'un commit qui supprime un module encore importé par le commit.
 *
 * Rejeu de l'incident du 2026-10-17 (conv-318, commit 06c5ede1) : l'index de l'arbre partagé portait
 * la suppression stagée de `conversation-router.ts` (travail de conv-305), l'importeur n'était
 * modifié que dans l'arbre de travail, et un `git add <autres fichiers> && git commit` a emporté la
 * suppression seule. Ces tests commitent VRAIMENT, à travers git et le hook du dépôt
 * (`core.hooksPath`), dans des dépôts jetables.
 */

const HOOKS = resolve(__dirname, '..', '..', '.githooks')

const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

function envPropre(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k]
  return env
}

function depot(sousDossier?: string): {
  git: (...args: string[]) => ReturnType<typeof spawnSync>
  ecrire: (f: string, t: string) => void
} {
  const parent = mkdtempSync(join(tmpdir(), 'garde-commit-'))
  dossiers.push(parent)
  const racine = sousDossier ? join(parent, sousDossier) : parent
  mkdirSync(racine, { recursive: true })
  const git = (...args: string[]): ReturnType<typeof spawnSync> =>
    spawnSync('git', args, { cwd: racine, encoding: 'utf8', env: envPropre() })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@exemple.invalid')
  git('config', 'user.name', 'test')
  git('config', 'core.hooksPath', HOOKS)
  git('config', 'core.autocrlf', 'false')
  const ecrire = (f: string, t: string): void => {
    mkdirSync(join(racine, f, '..'), { recursive: true })
    writeFileSync(join(racine, f), t)
  }
  ecrire('src/main/routeur.ts', 'export const routeur = 1\n')
  ecrire('src/main/index.ts', "import { routeur } from './routeur'\nexport const x = routeur\n")
  ecrire('src/main/autre.ts', 'export const autre = 2\n')
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', 'base')
  return { git, ecrire }
}

describe('.githooks/pre-commit : module supprimé encore importé', () => {
  it('REFUSE le commit qui emporte une suppression stagée sans son importeur (rejeu de 06c5ede1)', () => {
    const { git, ecrire } = depot()
    // Une autre session : suppression stagée, importeur modifié dans l'arbre de travail seulement.
    git('rm', '-q', 'src/main/routeur.ts')
    ecrire('src/main/index.ts', 'export const x = 0\n')
    // L'agent : ajoute SON fichier puis commite tout l'index.
    ecrire('src/main/autre.ts', 'export const autre = 3\n')
    git('add', 'src/main/autre.ts')
    const r = git('commit', '-m', 'kaizen')
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toMatch(/src\/main\/routeur\.ts supprimé, mais src\/main\/index\.ts:1/)
    expect(String(git('rev-list', '--count', 'HEAD').stdout).trim()).toBe('1')
  })

  it('laisse passer le même travail commité par chemins nommés', () => {
    const { git, ecrire } = depot()
    git('rm', '-q', 'src/main/routeur.ts')
    ecrire('src/main/index.ts', 'export const x = 0\n')
    ecrire('src/main/autre.ts', 'export const autre = 3\n')
    const r = git('commit', '-q', '-m', 'kaizen', '--', 'src/main/autre.ts')
    expect(r.status, String(r.stderr)).toBe(0)
    expect(String(git('diff', '--cached', '--name-status').stdout)).toMatch(
      /^D\tsrc\/main\/routeur\.ts/m
    )
  })

  it('laisse passer la suppression commitée AVEC son importeur', () => {
    const { git, ecrire } = depot()
    git('rm', '-q', 'src/main/routeur.ts')
    ecrire('src/main/index.ts', 'export const x = 0\n')
    git('add', 'src/main/index.ts')
    const r = git('commit', '-q', '-m', 'retrait du routeur')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne confond pas un simple homonyme : un autre module du même nom ailleurs n'est pas visé", () => {
    const { git, ecrire } = depot()
    ecrire('src/autre-dossier/routeur.ts', 'export const r = 1\n')
    ecrire('src/autre-dossier/usage.ts', "import { r } from './routeur'\nexport const u = r\n")
    git('add', '-A')
    git('commit', '-q', '--no-verify', '-m', 'homonyme')
    git('rm', '-q', 'src/main/routeur.ts')
    ecrire('src/main/index.ts', 'export const x = 0\n')
    git('add', 'src/main/index.ts')
    const r = git('commit', '-q', '-m', 'retrait')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne s'applique pas dans une copie de travail d'agent (son index n'est pas partagé)", () => {
    const { git } = depot('agent__run-x-1')
    git('rm', '-q', 'src/main/routeur.ts')
    const r = git('commit', '-q', '-m', 'agent')
    expect(r.status, String(r.stderr)).toBe(0)
  })
})
