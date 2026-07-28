import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  autoCloseBranch,
  autoCloseRun,
  detectSecret,
  parsePorcelainPaths,
  type GitRunner
} from './run-autoclose'

const run = promisify(execFile)
/** Vrai git (pas un mock) : c'est le comportement de git qu'on veut prouver, pas notre idée de git. */
const realGit: GitRunner = async (args, cwd) => (await run('git', args, { cwd })).stdout

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Dépôt de travail + un « distant » local (bare) pour observer un vrai push. */
async function repoWithRemote(): Promise<{ repo: string; remote: string }> {
  const root = mkdtempSync(join(tmpdir(), 'autowin-autoclose-'))
  dirs.push(root)
  const repo = join(root, 'work')
  const remote = join(root, 'remote.git')
  mkdirSync(repo)
  await run('git', ['init', '--bare', remote])
  await run('git', ['init', '-b', 'travail'], { cwd: repo })
  await run('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  await run('git', ['config', 'user.name', 'T'], { cwd: repo })
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  await run('git', ['add', '-A'], { cwd: repo })
  await run('git', ['commit', '-m', 'base'], { cwd: repo })
  await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
  return { repo, remote }
}

describe('autoCloseRun — publication d’un run vert', () => {
  it('commite et publie sur la branche dédiée SANS déplacer le HEAD local', async () => {
    const { repo, remote } = await repoWithRemote()
    writeFileSync(join(repo, 'nouveau.ts'), 'export const x = 1\n')

    const res = await autoCloseRun({
      repo,
      branch: autoCloseBranch('run-42'),
      message: 'clôture auto',
      runGit: realGit
    })

    expect(res).toMatchObject({ status: 'pushed', branch: 'auto/run-42' })
    // La branche locale n'a PAS changé : l'utilisateur reste où il travaillait.
    expect((await run('git', ['branch', '--show-current'], { cwd: repo })).stdout.trim()).toBe('travail')
    // Le distant a bien reçu la branche dédiée…
    const remoteBranches = (await run('git', ['branch'], { cwd: remote })).stdout
    expect(remoteBranches).toContain('auto/run-42')
    // …et RIEN sur main/master.
    expect(remoteBranches).not.toContain('main')
    expect(remoteBranches).not.toContain('master')
  })

  it('REFUSE de publier sur main (garde d’équipe, non contournable par l’appelant)', async () => {
    const { repo } = await repoWithRemote()
    writeFileSync(join(repo, 'x.ts'), 'x\n')
    const git = vi.fn(realGit)

    const res = await autoCloseRun({ repo, branch: 'main', message: 'm', runGit: git })

    expect(res).toMatchObject({ status: 'skipped', reason: 'protected-branch' })
    expect(git).not.toHaveBeenCalled() // refus AVANT toute commande git
  })

  it('ne commite QUE les chemins demandés (dépôt partagé : le reste n’est pas emporté)', async () => {
    const { repo } = await repoWithRemote()
    writeFileSync(join(repo, 'du-run.md'), '# produit par le run\n')
    writeFileSync(join(repo, 'autrui.md'), '# travail de quelqu_un d_autre\n')

    const res = await autoCloseRun({
      repo,
      branch: 'auto/run-7',
      message: 'notes du run',
      paths: ['du-run.md'],
      push: false,
      runGit: realGit
    })

    expect(res).toMatchObject({ status: 'committed', files: 1 })
    const committed = (await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo })).stdout
    expect(committed).toContain('du-run.md')
    expect(committed).not.toContain('autrui.md')
    // Le fichier d'autrui reste non suivi, intact.
    expect((await run('git', ['status', '--porcelain'], { cwd: repo })).stdout).toContain('autrui.md')
  })

  it('ne crée pas de commit vide quand le run n’a rien changé', async () => {
    const { repo } = await repoWithRemote()
    const res = await autoCloseRun({ repo, branch: 'auto/run-1', message: 'm', runGit: realGit })
    expect(res).toMatchObject({ status: 'skipped', reason: 'no-changes' })
  })

  it('BLOQUE la publication si un secret apparaît dans ce qui serait publié', async () => {
    const { repo } = await repoWithRemote()
    writeFileSync(join(repo, 'base.txt'), 'base\nAKIAIOSFODNN7EXAMPLE\n')

    const res = await autoCloseRun({ repo, branch: 'auto/run-9', message: 'm', runGit: realGit })

    expect(res).toMatchObject({ status: 'skipped', reason: 'secret-detected' })
    // Rien n'a été commité.
    expect((await run('git', ['log', '--oneline'], { cwd: repo })).stdout.trim().split('\n')).toHaveLength(1)
  })

  it('une défaillance git devient un échec rapporté, jamais une exception', async () => {
    const res = await autoCloseRun({
      repo: join(tmpdir(), 'depot-inexistant-autowin'),
      branch: 'auto/run-3',
      message: 'm',
      runGit: realGit
    })
    expect(res.status).toBe('failed')
  })
})

describe('helpers', () => {
  it('detectSecret repère les motifs sensibles usuels', () => {
    expect(detectSecret('rien de spécial')).toBeUndefined()
    expect(detectSecret('AKIAIOSFODNN7EXAMPLE')).toBe('clé AWS')
    expect(detectSecret('-----BEGIN RSA PRIVATE KEY-----')).toBe('clé privée')
  })

  it('parsePorcelainPaths gère modifications, ajouts et renommages', () => {
    expect(parsePorcelainPaths(' M src/a.ts\n?? b.md\nR  vieux.md -> neuf.md\n')).toEqual([
      'src/a.ts',
      'b.md',
      'neuf.md'
    ])
  })

  it('autoCloseBranch produit un nom sûr, jamais protégé', () => {
    expect(autoCloseBranch('run-ns-12')).toBe('auto/run-ns-12')
    expect(autoCloseBranch('run/étrange espace')).toMatch(/^auto\/run-/)
  })
})
