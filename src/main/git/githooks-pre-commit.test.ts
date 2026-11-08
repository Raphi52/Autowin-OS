import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * `.githooks/pre-commit` — REFUS d'un commit qui supprime un module encore importé par le commit.
 *
 * Rejeu de l'incident du 2026-10-17 (commit 06c5ede1) : l'index de l'arbre partagé portait
 * la suppression stagée de `conversation-router.ts`, l'importeur n'était
 * modifié que dans l'arbre de travail, et un `git add <autres fichiers> && git commit` a emporté la
 * suppression seule. Ces tests commitent VRAIMENT, à travers git et le hook du dépôt
 * (`core.hooksPath`), dans des dépôts jetables.
 */

const HOOKS = resolve(__dirname, '../../../.githooks')

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

  /*
   * L'ancien rangement des copies de fil (2026-11-05) : `retours-de-tour/essai__<fil>-<instant>-<rang>`,
   * avec son propre index, comme une copie d'agent. Le hook ne les reconnaissait pas.
   */
  it("ne s'applique pas dans une ancienne copie de fil essai__… (son index n'est pas partagé)", () => {
    const { git } = depot('retours-de-tour/essai__conv-1471-1793778602628-1')
    git('rm', '-q', 'src/main/routeur.ts')
    const r = git('commit', '-q', '-m', 'ancienne copie')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne s'applique pas dans la copie de travail d'un fil (`copies-de-fil/<fil>`)", () => {
    const { git } = depot('copies-de-fil/conv-1710')
    git('rm', '-q', 'src/main/routeur.ts')
    const r = git('commit', '-q', '-m', 'travail du fil')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it('reste actif dans un dépôt dont le nom contient « essai__ » sans commencer par lui', () => {
    const { git } = depot('mon-essai__depot')
    git('rm', '-q', 'src/main/routeur.ts')
    const r = git('commit', '-m', 'retrait')
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toMatch(/src\/main\/routeur\.ts supprimé/)
  })
})

/**
 * Règle du 2026-10-31 : une interface nouvelle suit les thèmes. Le chemin choisi ici n'est
 * dans aucun plancher : c'est un fichier nouveau, qui n'a droit à aucune couleur en dur.
 */
describe('.githooks/pre-commit : interface qui ne suivrait pas les thèmes', () => {
  const NOUVEAU = 'src/renderer/src/components/ZoneNeuveDuTest.css'

  it('REFUSE une feuille nouvelle qui écrit une couleur en dur', () => {
    const { git, ecrire } = depot()
    ecrire(NOUVEAU, '.zone { color: #fff; }\n')
    git('add', NOUVEAU)
    const r = git('commit', '-m', 'zone neuve')
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toContain(`${NOUVEAU} : 1 couleur(s) en dur, 0 au plus`)
    expect(String(git('rev-list', '--count', 'HEAD').stdout).trim()).toBe('1')
  })

  it('laisse passer la même feuille écrite avec les jetons du thème', () => {
    const { git, ecrire } = depot()
    ecrire(NOUVEAU, '.zone { color: var(--text); }\n')
    git('add', NOUVEAU)
    const r = git('commit', '-q', '-m', 'zone neuve')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne regarde que ce que le commit emporte, pas le travail d'à côté", () => {
    const { git, ecrire } = depot()
    // Une autre session a une feuille fautive dans l'arbre, non stagée ; ce commit ne la porte pas.
    ecrire(NOUVEAU, '.zone { color: #fff; }\n')
    ecrire('src/main/autre.ts', 'export const autre = 3\n')
    git('add', 'src/main/autre.ts')
    const r = git('commit', '-q', '-m', 'autre sujet')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne s'applique pas dans une copie de travail d'agent", () => {
    const { git, ecrire } = depot('agent__run-x-1')
    ecrire(NOUVEAU, '.zone { color: #fff; }\n')
    git('add', NOUVEAU)
    const r = git('commit', '-q', '-m', 'agent')
    expect(r.status, String(r.stderr)).toBe(0)
  })
})
