import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'

/**
 * PRÉSERVER PUIS LIBÉRER — récupérer le disque sans jamais perdre de travail.
 *
 * Mesuré le 2026-08-14 : 49 copies pour 1 453 Mo, alors que le travail unique qu'elles portent tient
 * en 665 Ko de diff — deux mégaoctets de copie par kilooctet utile, et 16 copies sans la moindre
 * modification. Elles survivent parce qu'un run mort sans passer par `finalize` ne libère jamais sa
 * copie, et que le balayage refuse — à juste titre — de supprimer un travail qui n'existe nulle part
 * ailleurs.
 *
 * La garantie testée ici est donc double, et la seconde est la seule qui compte vraiment :
 * l'espace est rendu, ET le travail reste récupérable par une simple commande git.
 */
const racines: string[] = []
afterEach(() => {
  for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function depot(): { base: string; worktreeRoot: string; agentId: string; copie: string } {
  const racine = mkdtempSync(join(tmpdir(), 'wt-preserve-'))
  racines.push(racine)
  const base = join(racine, 'base')
  mkdirSync(base, { recursive: true })
  git(base, 'init', '-q', '-b', 'main')
  git(base, 'config', 'user.email', 't@t')
  git(base, 'config', 'user.name', 'T')
  git(base, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(base, 'a.txt'), 'base\n')
  git(base, 'add', '-A')
  git(base, 'commit', '-q', '-m', 'base')

  const worktreeRoot = join(racine, 'copies')
  mkdirSync(worktreeRoot, { recursive: true })
  const agentId = 'run-mort-1'
  const copie = join(worktreeRoot, `agent__${agentId}`)
  git(base, 'worktree', 'add', '-q', '--detach', copie, 'HEAD')
  return { base, worktreeRoot, agentId, copie }
}

const manager = (base: string, worktreeRoot: string): WorktreeManager =>
  new WorktreeManager({ baseRepo: base, worktreeRoot } as never)

describe('préserver puis libérer une copie abandonnée', () => {
  it('libère une copie SANS travail, sans créer de branche inutile', () => {
    // 16 des 49 copies mesurées étaient dans ce cas : rien d'unique, 30 Mo chacune.
    const { base, worktreeRoot, agentId, copie } = depot()
    const r = manager(base, worktreeRoot).preserverEtLiberer(agentId)
    expect(r.outcome).toBe('libere')
    expect(r.branche).toBeUndefined()
    expect(existsSync(copie)).toBe(false)
  })

  it('PRÉSERVE le travail non committé dans la branche de récupération, puis libère', () => {
    const { base, worktreeRoot, agentId, copie } = depot()
    writeFileSync(join(copie, 'a.txt'), 'travail abandonné\n')
    writeFileSync(join(copie, 'nouveau.txt'), 'fichier jamais suivi\n')

    const r = manager(base, worktreeRoot).preserverEtLiberer(agentId)
    expect(r.outcome).toBe('preserve-et-libere')
    expect(r.branche).toBe(`autowin/recovery/${agentId}`)
    expect(existsSync(copie)).toBe(false)

    // LA garantie : le travail est relisible depuis le dépôt de base, modifications ET fichier neuf.
    expect(git(base, 'show', `${r.branche}:a.txt`)).toBe('travail abandonné')
    expect(git(base, 'show', `${r.branche}:nouveau.txt`)).toBe('fichier jamais suivi')
  })

  it('rend le travail restaurable par une simple commande git', () => {
    // Une préservation qu'on ne sait pas rejouer ne vaut rien : on la rejoue ici pour de vrai.
    const { base, worktreeRoot, agentId, copie } = depot()
    writeFileSync(join(copie, 'a.txt'), 'à restaurer\n')
    const r = manager(base, worktreeRoot).preserverEtLiberer(agentId)
    expect(r.outcome).toBe('preserve-et-libere')

    const restaure = join(worktreeRoot, 'restauration')
    git(base, 'worktree', 'add', '-q', restaure, r.branche!)
    expect(existsSync(join(restaure, 'a.txt'))).toBe(true)
    expect(git(restaure, 'show', 'HEAD:a.txt')).toBe('à restaurer')
  })

  it('REFUSE de toucher une copie encore utilisée par un processus', () => {
    // Libérer sous les pieds d'un run vivant casserait ce run : le refus prime sur l'espace disque.
    const { base, worktreeRoot, agentId, copie } = depot()
    const m = manager(base, worktreeRoot)
    m.markProcess(agentId, process.pid, true)
    const r = m.preserverEtLiberer(agentId)
    expect(r.outcome).toBe('refuse')
    expect(existsSync(copie)).toBe(true)
  })

  it('dit `absente` sur une copie qui n’existe pas, sans jeter', () => {
    const { base, worktreeRoot } = depot()
    expect(manager(base, worktreeRoot).preserverEtLiberer('run-inconnu-9').outcome).toBe('absente')
  })
})
