import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detachedCommit,
  git,
  manager as vraiGestionnaire,
  nettoyerRacines,
  roots,
  tempRepo
} from './worktree-manager.test-helpers'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import type { FinalizeResult } from './worktree-manager'

afterEach(nettoyerRacines)
// Suites git REELLES : meme plafond que les autres suites `worktree-manager.*` (convention maison).
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

/**
 * LA FUSION A 3 BRANCHES N'ETAIT JAMAIS DEMANDEE EN VRAI.
 *
 * Vecu le 2026-10-22 (conv-1086, run-edcf9630aaf1-1) : run vert, juge a 88, et pourtant refuse en
 * `base-dirty`. Sa copie etait partie d'`origin/main` (main local DIVERGE : `describeForLaunch`),
 * donc la fin de run apporte aussi l'avance de GitHub — 9 fichiers reecrits chez l'utilisateur,
 * dont 7 que le run n'avait pas touches, 7 sur 9 portant du travail non commite d'autres fils.
 *
 * Le barreau 2 (`preserverEditionLocale`, commit 2fb89e16, « l'echelle complete » du 2026-08-27)
 * sait faire atterrir ce travail en gardant l'edition non commitee. Mais aucun appelant de
 * production ne le demandait : il n'etait joue que par ses tests. Le refus etait donc la regle.
 *
 * Ce que ces tests ne demandent PAS : retirer de la garde les fichiers de l'avance de GitHub. Ils
 * sont reellement reecrits par la fusion (le `main` local est avance jusqu'a elle) ; les ignorer,
 * c'est ecraser le travail non commite de l'utilisateur ou faire echouer la publication plus loin.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gestionnaireSimule(over: Record<string, any> = {}): any {
  return {
    acquire: vi.fn((id: string) => `/wt/${id}`),
    listAgentIds: vi.fn(() => []),
    describe: vi.fn((id: string) => ({
      workspacePath: '/repo',
      worktreePath: `/wt/${id}`,
      baseBranch: 'main',
      baseSha: '1'.repeat(40)
    })),
    changedFiles: vi.fn(() => ['src/a.ts']),
    changedFilesAsync: vi.fn(async () => ['src/a.ts']),
    hasActiveProcesses: vi.fn(() => false),
    markProcess: vi.fn(),
    markSpawnIntent: vi.fn(),
    confirmSpawn: vi.fn(),
    remove: vi.fn(),
    validateRecoveryContext: vi.fn(() => ({ ok: true as const })),
    finalize: vi.fn((id: string): FinalizeResult => ({
      outcome: 'merged',
      agentId: id,
      committed: true
    })),
    ...over
  }
}

describe('la fin de run demande la fusion a 3 branches', () => {
  it('fin de run synchrone : `finalize` recoit preserverEditionLocale', () => {
    const gestionnaire = gestionnaireSimule()
    const co = new RunWorktreeCoordinator({ manager: gestionnaire, nowFn: () => 1 })
    co.begin('run-sync', 'Builder', true)
    co.end('run-sync')
    expect(gestionnaire.finalize).toHaveBeenCalledWith(
      'run-sync',
      expect.objectContaining({ preserverEditionLocale: true })
    )
  })

  it('fin de run de production (asynchrone) : `finalizeAsync` la recoit aussi', async () => {
    const finalizeAsync = vi.fn(async (id: string): Promise<FinalizeResult> => ({
      outcome: 'merged',
      agentId: id,
      committed: true
    }))
    const gestionnaire = gestionnaireSimule({ finalizeAsync })
    const co = new RunWorktreeCoordinator({ manager: gestionnaire, nowFn: () => 1 })
    co.begin('run-async', 'Builder', true)
    await co.endAsync('run-async')
    expect(finalizeAsync).toHaveBeenCalledWith(
      'run-async',
      expect.objectContaining({ preserverEditionLocale: true })
    )
  })

  it('publication reprise apres la fin des processus : la reprise la recoit aussi', () => {
    let actif = true
    const gestionnaire = gestionnaireSimule({ hasActiveProcesses: vi.fn(() => actif) })
    const co = new RunWorktreeCoordinator({ manager: gestionnaire, nowFn: () => 1 })
    co.begin('run-differe', 'Builder', true)
    expect(co.end('run-differe')).toMatchObject({ outcome: 'deferred' })
    actif = false
    co.retryRecovery()
    expect(gestionnaire.finalize).toHaveBeenCalledWith(
      'run-differe',
      expect.objectContaining({ preserverEditionLocale: true })
    )
  })
})

const vingtLignes = (prefixe: string): string[] =>
  Array.from({ length: 20 }, (_, i) => `${prefixe} ${i + 1}`)
const avec = (lignes: string[], index: number, texte: string): string[] =>
  lignes.map((ligne, i) => (i === index ? texte : ligne))
const ecrire = (chemin: string, lignes: string[]): void =>
  writeFileSync(chemin, lignes.join('\n') + '\n')

/**
 * Le depot du run bloque, en petit : GitHub a pris une avance (amont.txt) que le main local n'a
 * pas, et le main local a un commit a lui (long.txt ligne 10). La copie part donc de GitHub.
 */
function scenarioDiverge(): {
  repo: string
  co: RunWorktreeCoordinator
  copie: string
  avanceGithub: string
  long: string[]
  longLocal: string[]
  amont: string[]
} {
  const repo = tempRepo()
  const long = vingtLignes('long')
  const amont = vingtLignes('amont')
  ecrire(join(repo, 'long.txt'), long)
  ecrire(join(repo, 'amont.txt'), amont)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'depart')

  const distant = mkdtempSync(join(tmpdir(), 'autowin-origin-'))
  roots.push(distant)
  git(distant, 'init', '-q', '--bare', '-b', 'main')
  git(repo, 'remote', 'add', 'origin', distant)
  git(repo, 'push', '-q', 'origin', 'main')
  const avanceGithub = detachedCommit(
    repo,
    git(repo, 'rev-parse', 'HEAD'),
    'amont.txt',
    avec(amont, 17, 'AVANCE GITHUB').join('\n') + '\n'
  )
  git(repo, 'push', '-q', 'origin', `${avanceGithub}:refs/heads/main`)

  const longLocal = avec(long, 9, 'COMMIT LOCAL')
  ecrire(join(repo, 'long.txt'), longLocal)
  git(repo, 'commit', '-q', '-am', 'commit local')

  const etat = new Map<string, unknown>()
  const co = new RunWorktreeCoordinator({
    manager: vraiGestionnaire(repo) as never,
    stateStore: {
      list: () => [...etat.values()],
      get: (id: string) => etat.get(id),
      save: (e: { runId: string }) => etat.set(e.runId, e),
      remove: (id: string) => etat.delete(id)
    } as never
  } as never)

  const copie = co.begin('run-diverge', 'Builder', true, { task: 'modifier long.txt' })!
  // Le run committe son travail ligne 18 de long.txt, comme l'agent de run-edcf9630aaf1-1.
  ecrire(join(copie, 'long.txt'), avec(long, 17, 'TRAVAIL DU RUN'))
  git(copie, 'commit', '-q', '-am', 'travail du run')
  return { repo, co, copie, avanceGithub, long, longLocal, amont }
}

describe('e2e isole — le cas de run-edcf9630aaf1-1 : copie partie de GitHub, main divergé', () => {
  it('le run atterrit, et les editions non commitees survivent, meme sur un fichier de l avance GitHub', () => {
    const { repo, co, copie, avanceGithub, longLocal, amont } = scenarioDiverge()
    // La copie est bien partie de l'avance de GitHub, sans le commit local (`describeForLaunch`).
    expect(git(copie, 'rev-parse', 'HEAD~1')).toBe(avanceGithub)

    // Un autre fil a du travail NON COMMITE sur les deux fichiers que la fin de run reecrit :
    // amont.txt, que seule l'avance de GitHub touche, et long.txt, juste a cote du commit local.
    ecrire(join(repo, 'amont.txt'), avec(amont, 1, 'EDITION NON COMMITEE AMONT'))
    ecrire(join(repo, 'long.txt'), avec(longLocal, 10, 'EDITION NON COMMITEE LONG'))

    const res = co.end('run-diverge')

    expect(res).toMatchObject({ outcome: 'merged' })
    const longFinal = readFileSync(join(repo, 'long.txt'), 'utf8')
    const amontFinal = readFileSync(join(repo, 'amont.txt'), 'utf8')
    // Le travail du run, le commit local et l'avance de GitHub sont dans l'historique...
    expect(git(repo, 'show', 'HEAD:long.txt')).toContain('TRAVAIL DU RUN')
    expect(git(repo, 'show', 'HEAD:long.txt')).toContain('COMMIT LOCAL')
    expect(git(repo, 'show', 'HEAD:amont.txt')).toContain('AVANCE GITHUB')
    expect(longFinal).toContain('TRAVAIL DU RUN')
    expect(amontFinal).toContain('AVANCE GITHUB')
    // ...et les editions de l'autre fil sont intactes, et toujours NON commitees.
    expect(longFinal).toContain('EDITION NON COMMITEE LONG')
    expect(amontFinal).toContain('EDITION NON COMMITEE AMONT')
    expect(git(repo, 'show', 'HEAD:long.txt')).not.toContain('EDITION NON COMMITEE')
    expect(git(repo, 'show', 'HEAD:amont.txt')).not.toContain('EDITION NON COMMITEE')
    const sale = git(repo, 'status', '--porcelain=v1')
    expect(sale).toContain('long.txt')
    expect(sale).toContain('amont.txt')
  })

  it('un VRAI conflit (meme ligne que le run) reste refuse, et son fichier ne bouge pas d un octet', () => {
    const { repo, co, longLocal } = scenarioDiverge()
    const headAvant = git(repo, 'rev-parse', 'HEAD')
    const sienne = avec(longLocal, 17, 'EDITION NON COMMITEE SUR LA LIGNE DU RUN')
    ecrire(join(repo, 'long.txt'), sienne)
    const octetsAvant = readFileSync(join(repo, 'long.txt'))

    const res = co.end('run-diverge')

    // Refus, avec l'adresse d'attente du barreau 1 : rien n'est perdu, rien n'est ecrit chez lui.
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty', files: ['long.txt'] })
    expect((res as { stagedRef?: string }).stagedRef).toBe('refs/autowin/integration/run-diverge')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headAvant)
    expect(readFileSync(join(repo, 'long.txt')).equals(octetsAvant)).toBe(true)
  })
})
