import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DOSSIER_ENTREPRISE } from './identite-entreprise'

/**
 * `.githooks/pre-push` — REFUS de tout push vers GitHub dont un commit contient `entreprise/`.
 *
 * Pourquoi (2026-10-13, conv-932) : ce qui est propre à l'entreprise vit dans `entreprise/` et ne
 * doit jamais atteindre le dépôt public. La version publique se construit sans ce dossier
 * (`scripts/export-public.mjs`), mais rien n'empêchait un `git push github main` direct de publier
 * tout l'arbre : le hook ne gardait que la branche par défaut, et seulement contre les agents.
 *
 * Ces tests poussent VRAIMENT, à travers git et le hook du dépôt (`core.hooksPath`), vers des dépôts
 * nus locaux. Le distant « GitHub » garde son adresse github.com dans la configuration et n'est
 * redirigé vers le disque que par `url.<chemin>.insteadOf` — exactement ce que git transmet au hook
 * dans ce cas (mesuré : `$2` reçoit l'adresse RÉÉCRITE, le nom du distant reste dans `$1`).
 * On pousse sur une branche de travail : la garde de la branche par défaut n'entre pas en jeu.
 */

const HOOKS = resolve(__dirname, '..', '..', '.githooks')
const ADRESSE_PUBLIQUE = 'https://github.com/exemple/public.git'

const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Environnement neutre : ni signal d'agent, ni exception, ni dépôt git hérité du lanceur. */
function envPropre(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of [
    'AUTOWIN_OS_WORKSPACE',
    'ALLOW_MAIN_PUSH',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE'
  ]) {
    delete env[k]
  }
  return env
}

function git(
  cwd: string,
  args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: envPropre(), windowsHide: true })
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

function gitOk(cwd: string, args: string[]): string {
  const r = git(cwd, args)
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} → ${r.status}\n${r.stderr}`)
  return r.stdout
}

/** Un dépôt local, un distant public (GitHub redirigé sur le disque) et un distant interne. */
function depots(): { local: string; publicNu: string; interneNu: string } {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-prepush-'))
  dossiers.push(racine)
  const publicNu = join(racine, 'public.git')
  const interneNu = join(racine, 'interne.git')
  const local = join(racine, 'local')
  gitOk(racine, ['init', '-q', '--bare', publicNu])
  gitOk(racine, ['init', '-q', '--bare', interneNu])
  gitOk(racine, ['init', '-q', '-b', 'main', local])
  gitOk(local, ['config', 'user.email', 'test@example.com'])
  gitOk(local, ['config', 'user.name', 'Test'])
  gitOk(local, ['config', 'core.autocrlf', 'false'])
  gitOk(local, ['config', 'core.hooksPath', HOOKS])
  gitOk(local, ['remote', 'add', 'github', ADRESSE_PUBLIQUE])
  gitOk(local, ['config', `url.${publicNu.replace(/\\/g, '/')}.insteadOf`, ADRESSE_PUBLIQUE])
  gitOk(local, ['remote', 'add', 'origin', interneNu])
  return { local, publicNu, interneNu }
}

function commit(local: string, fichiers: Record<string, string | null>, message: string): string {
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const absolu = join(local, chemin)
    if (contenu === null) {
      gitOk(local, ['rm', '-q', '-r', chemin])
      continue
    }
    mkdirSync(resolve(absolu, '..'), { recursive: true })
    writeFileSync(absolu, contenu)
    gitOk(local, ['add', chemin])
  }
  gitOk(local, ['commit', '-q', '-m', message])
  return gitOk(local, ['rev-parse', 'HEAD'])
}

function refDistante(nu: string, branche: string): string | null {
  const r = git(nu, ['rev-parse', '--verify', '-q', `refs/heads/${branche}`])
  return r.status === 0 ? r.stdout : null
}

const PRIVE = `${DOSSIER_ENTREPRISE}/exemple/note.md`

describe('.githooks/pre-push — rien de entreprise/ vers GitHub', () => {
  it('refuse un push vers GitHub dont le commit contient entreprise/', () => {
    const { local, publicNu } = depots()
    commit(local, { 'a.txt': 'a\n', [PRIVE]: 'interne\n' }, 'avec le dossier prive')

    const r = git(local, ['push', 'github', 'HEAD:refs/heads/travail'])

    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain(`${DOSSIER_ENTREPRISE}/`)
    expect(refDistante(publicNu, 'travail')).toBeNull()
  })

  it('refuse aussi quand le dossier a été ajouté puis retiré dans les commits poussés', () => {
    const { local, publicNu } = depots()
    commit(local, { 'a.txt': 'a\n' }, 'base')
    gitOk(local, ['push', '-q', 'github', 'HEAD:refs/heads/travail'])
    commit(local, { [PRIVE]: 'interne\n' }, 'ajout du dossier prive')
    commit(local, { [DOSSIER_ENTREPRISE]: null }, 'retrait du dossier prive')
    const publie = refDistante(publicNu, 'travail')

    const r = git(local, ['push', 'github', 'HEAD:refs/heads/travail'])

    expect(r.status).not.toBe(0)
    expect(refDistante(publicNu, 'travail')).toBe(publie)
  })

  it('laisse passer vers GitHub des commits qui ne contiennent pas entreprise/', () => {
    const { local, publicNu } = depots()
    const sha = commit(local, { 'a.txt': 'a\n', 'docs/b.md': 'b\n' }, 'public seulement')

    const r = git(local, ['push', 'github', 'HEAD:refs/heads/travail'])

    expect(r.status, r.stderr).toBe(0)
    expect(refDistante(publicNu, 'travail')).toBe(sha)
  })

  it('laisse passer entreprise/ vers le dépôt interne', () => {
    const { local, interneNu } = depots()
    const sha = commit(local, { 'a.txt': 'a\n', [PRIVE]: 'interne\n' }, 'avec le dossier prive')

    const r = git(local, ['push', 'origin', 'HEAD:refs/heads/travail'])

    expect(r.status, r.stderr).toBe(0)
    expect(refDistante(interneNu, 'travail')).toBe(sha)
  })

  it("ne s'arrête pas à un dossier voisin au nom proche", () => {
    const { local, publicNu } = depots()
    const sha = commit(
      local,
      { [`docs/${DOSSIER_ENTREPRISE}/x.md`]: 'x\n', [`${DOSSIER_ENTREPRISE}s.md`]: 'y\n' },
      'voisins'
    )

    const r = git(local, ['push', 'github', 'HEAD:refs/heads/travail'])

    expect(r.status, r.stderr).toBe(0)
    expect(refDistante(publicNu, 'travail')).toBe(sha)
  })
})
