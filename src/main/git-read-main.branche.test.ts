import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as ChildProcess from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/*
 * LA BRANCHE DU BADGE SE LIT SANS CREER DE PROCESSUS (heal conv-1013, 2026-10-16).
 *
 * Mesure : `gels.jsonl` porte, du 14 au 16/10, 9 gels de 3,3 a 9,8 s du fil principal, chacun dans
 * la creation d'UN processus `spawn git status` (`ipc:git:read`, `readGitState`). `execFile` est
 * asynchrone, mais la creation du processus ne l'est pas : elle se fait sur le fil appelant (4,8 ms
 * en mediane a vide), et elle attend des que le systeme cale. Le badge de branche du chat relisait
 * `readGitState` toutes les 5 s — `git status` + `git log`, 24 processus par minute — pour un nom
 * qui tient dans `.git/HEAD`.
 *
 * `readGitBranch` lit ce fichier en asynchrone : aucun processus, et une lecture qui attend le
 * disque attend dans le pool de libuv, pas sur le fil principal. Ces tests comptent les processus
 * crees ET verifient, sur de vrais depots, que la branche rendue est celle que `git status` donne.
 */
const lancements: string[] = []
vi.mock('node:child_process', async (original) => {
  const vrai = (await original()) as typeof ChildProcess
  const compter =
    <F extends (...args: never[]) => unknown>(nom: string, fn: F) =>
    (...args: Parameters<F>): ReturnType<F> => {
      lancements.push(`${nom} ${String(args[0])} ${JSON.stringify(args[1] ?? '')}`)
      return fn(...args) as ReturnType<F>
    }
  const execFile = compter('execFile', vrai.execFile as never) as unknown as typeof vrai.execFile
  // `promisify(execFile)` passe par ce symbole : sans lui, `readGitState` perdrait `{ stdout }`.
  ;(execFile as unknown as Record<symbol, unknown>)[promisify.custom] = compter(
    'execFile',
    (vrai.execFile as unknown as Record<symbol, (...a: unknown[]) => unknown>)[
      promisify.custom
    ] as never
  )
  return {
    ...vrai,
    execFile,
    spawn: compter('spawn', vrai.spawn as never),
    exec: compter('exec', vrai.exec as never),
    execFileSync: compter('execFileSync', vrai.execFileSync as never),
    spawnSync: compter('spawnSync', vrai.spawnSync as never),
    execSync: compter('execSync', vrai.execSync as never)
  }
})

const { readGitBranch, readGitState } = await import('./git-read-main')
const { parseGitStatus } = await import('../shared/git-read')
const reel = await vi.importActual<typeof ChildProcess>('node:child_process')
const git = (cwd: string, ...args: string[]): string =>
  reel.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  })

let racine: string
const cas: Record<string, string> = {}

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), 'git-branche-'))
  const depot = join(racine, 'depot')
  mkdirSync(join(depot, 'sous', 'dossier'), { recursive: true })
  git(depot, 'init', '-q', '-b', 'feature/badge')
  writeFileSync(join(depot, 'a.txt'), 'a')
  git(depot, 'add', '.')
  git(depot, 'commit', '-q', '-m', 'un')
  cas['branche avec barre oblique'] = depot
  cas['sous-dossier du depot'] = join(depot, 'sous', 'dossier')

  const detache = join(racine, 'detache')
  mkdirSync(detache)
  git(detache, 'init', '-q', '-b', 'main')
  writeFileSync(join(detache, 'a.txt'), 'a')
  git(detache, 'add', '.')
  git(detache, 'commit', '-q', '-m', 'un')
  git(detache, 'checkout', '-q', '--detach')
  cas['HEAD detache'] = detache

  // Une copie `git worktree` : `.git` y est un FICHIER « gitdir: ... », comme les copies des runs.
  git(depot, 'worktree', 'add', '-q', '-b', 'copie-de-run', join(racine, 'copie'))
  cas['copie git worktree'] = join(racine, 'copie')

  const vide = join(racine, 'vide')
  mkdirSync(vide)
  git(vide, 'init', '-q', '-b', 'pas-encore-de-commit')
  cas['depot sans commit'] = vide

  cas['dossier absent'] = join(racine, 'absent')
})
afterAll(() => {
  rmSync(racine, { recursive: true, force: true })
})

describe('readGitBranch — la branche du badge, sans processus', () => {
  it('ne cree AUCUN processus', async () => {
    lancements.length = 0
    for (const cwd of Object.values(cas)) await readGitBranch(cwd)
    expect(lancements).toEqual([])
  })

  it.each([
    'branche avec barre oblique',
    'sous-dossier du depot',
    'HEAD detache',
    'copie git worktree',
    'depot sans commit',
    'dossier absent'
  ])('rend la meme branche que `# branch.head` de git status : %s', async (nom) => {
    const cwd = cas[nom]!
    let reference: string | undefined
    try {
      reference = parseGitStatus(git(cwd, 'status', '--porcelain=v2', '--branch')).branch
    } catch {
      reference = undefined // git ne tourne pas dans un dossier absent
    }
    const lu = await readGitBranch(cwd)
    expect(lu.available ? lu.state.branch : undefined).toBe(reference)
  })

  /*
   * SEUL ECART avec l'ancien chemin, et il est voulu : sur un depot SANS commit, `readGitState`
   * rendait « indisponible » parce que `git log` y echoue — le badge n'affichait rien alors que
   * `git status` connait la branche. Le badge affiche desormais ce nom.
   */
  it('depot sans commit : le badge montre la branche que l ancien chemin taisait', async () => {
    expect((await readGitState(cas['depot sans commit']!)).available).toBe(false)
    const lu = await readGitBranch(cas['depot sans commit']!)
    expect(lu.available && lu.state.branch).toBe('pas-encore-de-commit')
  })

  it('nomme les branches attendues', async () => {
    const branche = async (nom: string): Promise<string | undefined> => {
      const lu = await readGitBranch(cas[nom]!)
      return lu.available ? lu.state.branch : undefined
    }
    expect(await branche('branche avec barre oblique')).toBe('feature/badge')
    expect(await branche('sous-dossier du depot')).toBe('feature/badge')
    expect(await branche('HEAD detache')).toBe('(detached)')
    expect(await branche('copie git worktree')).toBe('copie-de-run')
    expect(await branche('depot sans commit')).toBe('pas-encore-de-commit')
    expect(await branche('dossier absent')).toBeUndefined()
  })
})
