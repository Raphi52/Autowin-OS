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
 * LA FIN DE RUN NE TOUCHE JAMAIS L'ARBRE DE L'UTILISATEUR POUR PUBLIER.
 *
 * Sa copie est partie d'`origin/main` alors que le main local a divergé : la fin de run apporte donc
 * aussi l'avance de GitHub, qui réécrit des fichiers que l'utilisateur peut éditer sans commiter. Quand
 * ces éditions touchent les fichiers publiés, la publication est refusée (`base-dirty`), et rien n'est
 * écrit chez lui. Ce que ces tests ne demandent PAS : retirer de la garde les fichiers de l'avance de
 * GitHub. Ils sont réellement réécrits par la fusion ; les ignorer, c'est écraser le travail non commité
 * de l'utilisateur ou faire échouer la publication plus loin.
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

/**
 * Le site d'appel ne transmet plus de drapeau d'écriture dans l'arbre : si un appelant le
 * réintroduit, ces tests passent au rouge au lieu de laisser la fin de run écrire chez l'utilisateur.
 */
describe('la fin de run ne demande plus d’écriture dans l’arbre partagé', () => {
  it('fin de run synchrone : `finalize` ne reçoit aucun drapeau d’écriture', () => {
    const gestionnaire = gestionnaireSimule()
    const co = new RunWorktreeCoordinator({ manager: gestionnaire, nowFn: () => 1 })
    co.begin('run-sync', 'Builder', true)
    co.end('run-sync')
    expect(gestionnaire.finalize).toHaveBeenCalledWith('run-sync', expect.anything())
    expect(gestionnaire.finalize.mock.calls.at(-1)?.[1]).not.toHaveProperty(
      'preserverEditionLocale'
    )
  })

  it('fin de run de production (asynchrone) : `finalizeAsync` ne reçoit aucun drapeau d’écriture', async () => {
    const finalizeAsync = vi.fn(async (id: string): Promise<FinalizeResult> => ({
      outcome: 'merged',
      agentId: id,
      committed: true
    }))
    const gestionnaire = gestionnaireSimule({ finalizeAsync })
    const co = new RunWorktreeCoordinator({ manager: gestionnaire, nowFn: () => 1 })
    co.begin('run-async', 'Builder', true)
    await co.endAsync('run-async')
    expect(finalizeAsync).toHaveBeenCalledWith('run-async', expect.anything())
    const options = (finalizeAsync.mock.calls.at(-1) as unknown[] | undefined)?.[1]
    expect(options).not.toHaveProperty('preserverEditionLocale')
  })

  it('publication reprise après la fin des processus : la reprise non plus', () => {
    let actif = true
    const gestionnaire = gestionnaireSimule({ hasActiveProcesses: vi.fn(() => actif) })
    const co = new RunWorktreeCoordinator({ manager: gestionnaire, nowFn: () => 1 })
    co.begin('run-differe', 'Builder', true)
    expect(co.end('run-differe')).toMatchObject({ outcome: 'deferred' })
    actif = false
    co.retryRecovery()
    expect(gestionnaire.finalize).toHaveBeenCalledWith('run-differe', expect.anything())
    expect(gestionnaire.finalize.mock.calls.at(-1)?.[1]).not.toHaveProperty(
      'preserverEditionLocale'
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
      dernierConnu: (id: string) => etat.get(id),
      getAsync: async (id: string) => etat.get(id),
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

describe('e2e isolé — le cas de run-edcf9630aaf1-1 : copie partie de GitHub, main divergé', () => {
  it('éditions non commitées sur les fichiers de l’avance GitHub : refusé, rien n’est écrit chez lui', () => {
    const { repo, co, copie, avanceGithub, longLocal, amont } = scenarioDiverge()
    // La copie est bien partie de l'avance de GitHub, sans le commit local (`describeForLaunch`).
    expect(git(copie, 'rev-parse', 'HEAD~1')).toBe(avanceGithub)

    // Un autre fil a du travail NON COMMITE sur les deux fichiers que la fin de run reecrit :
    // amont.txt, que seule l'avance de GitHub touche, et long.txt, juste a cote du commit local.
    ecrire(join(repo, 'amont.txt'), avec(amont, 1, 'EDITION NON COMMITEE AMONT'))
    ecrire(join(repo, 'long.txt'), avec(longLocal, 10, 'EDITION NON COMMITEE LONG'))
    const octetsAmont = readFileSync(join(repo, 'amont.txt'))
    const octetsLong = readFileSync(join(repo, 'long.txt'))
    const headAvant = git(repo, 'rev-parse', 'HEAD')

    const res = co.end('run-diverge')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
    expect((res as { files: string[] }).files).toEqual(
      expect.arrayContaining(['amont.txt', 'long.txt'])
    )
    // Rien n'est publié, rien n'est écrit chez lui : ses éditions sont intactes, octet pour octet.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headAvant)
    expect(readFileSync(join(repo, 'amont.txt')).equals(octetsAmont)).toBe(true)
    expect(readFileSync(join(repo, 'long.txt')).equals(octetsLong)).toBe(true)
    expect(git(repo, 'stash', 'list')).toBe('')
    // Le travail du run reste atteignable par l'adresse d'attente.
    expect((res as { stagedRef?: string }).stagedRef).toBe('refs/autowin/integration/run-diverge')
  })

  it('un VRAI conflit (meme ligne que le run) reste refuse, et son fichier ne bouge pas d un octet', () => {
    const { repo, co, longLocal } = scenarioDiverge()
    const headAvant = git(repo, 'rev-parse', 'HEAD')
    const sienne = avec(longLocal, 17, 'EDITION NON COMMITEE SUR LA LIGNE DU RUN')
    ecrire(join(repo, 'long.txt'), sienne)
    const octetsAvant = readFileSync(join(repo, 'long.txt'))

    const res = co.end('run-diverge')

    // Refus, avec l'adresse d'attente : rien n'est perdu, rien n'est écrit chez lui.
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty', files: ['long.txt'] })
    expect((res as { stagedRef?: string }).stagedRef).toBe('refs/autowin/integration/run-diverge')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headAvant)
    expect(readFileSync(join(repo, 'long.txt')).equals(octetsAvant)).toBe(true)
  })
})
