import { describe, expect, it, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { WorktreeManager } from './worktree-manager'
// fix-ok: le constructeur exige racineCopiesDeTaches (TS2345 mesuré au typecheck) ; racineDe la fournit à chaque gestionnaire de ce fichier.
import { racineDe } from './worktree-manager.test-helpers'
import { WorktreeRunStateStore } from './worktree-run-state'
import type { WorktreeOperationWorkerLike } from './worktree-operation-client'
import type { WorktreeOperationRequest } from './worktree-operation-protocol'

/**
 * REJEU DU REFUS « Reprise du worktree impossible pour <run> : copie durable absente ou incomplète ».
 *
 * La situation d'origine : un run arrêté par le quota (ou bloqué à l'intégration) laisse une copie
 * propre, dont le HEAD est dans l'historique, et son point de reprise vit encore. Au démarrage
 * suivant, le balayage retirait la copie (inactive depuis plus de 3 h), puis la reprise concluait
 * « copie durable absente » et abandonnait le run. Ce test rejoue exactement ce démarrage : le
 * coordinateur réconcilie à sa construction, comme en production, avec un gestionnaire réel.
 */

const roots: string[] = []
const HEURES_4 = 4 * 60 * 60 * 1_000

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function depotVide(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-reprise-depot-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'ligne1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/** Un démarrage : gestionnaire réel, copie vieille de 4 h (au-delà du seuil de 3 h du balayage). */
function gestionnaireDeDemarrage(repo: string): { wm: WorktreeManager; racine: string } {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-reprise-racine-'))
  roots.push(racine)
  const wm = new WorktreeManager({
    baseRepo: repo,
    worktreeRoot: racine,
    racineCopiesDeTaches: racineDe(racine),
    nowFn: () => Date.now() + HEURES_4
  })
  return { wm, racine }
}

afterEach(() => {
  for (const root of roots.splice(0)) supprimerArbre(root)
})

describe("démarrage : le balayage ne retire pas la copie d'un run dont le point de reprise vit", () => {
  it('REJEU : la copie propre de 4 h survit au démarrage quand son point de reprise existe encore', () => {
    const repo = depotVide()
    const { wm, racine } = gestionnaireDeDemarrage(repo)
    const copie = wm.acquire('run-arrete-quota')
    const store = new WorktreeRunStateStore(racine, 'depot-test', {
      racineCopiesDeTaches: racineDe(racine)
    })

    new RunWorktreeCoordinator({
      manager: wm,
      stateStore: store,
      nowFn: () => Date.now() + HEURES_4,
      pointsDeRepriseVivants: () => new Set(['run-arrete-quota'])
    })

    expect(existsSync(copie)).toBe(true)
    expect(wm.copiesProtegees.has('run-arrete-quota')).toBe(true)
  })

  it('JUMEAU : sans point de reprise vivant, la même copie part au démarrage (comportement inchangé)', () => {
    const repo = depotVide()
    const { wm, racine } = gestionnaireDeDemarrage(repo)
    const copie = wm.acquire('run-arrete-quota')
    const store = new WorktreeRunStateStore(racine, 'depot-test', {
      racineCopiesDeTaches: racineDe(racine)
    })

    new RunWorktreeCoordinator({
      manager: wm,
      stateStore: store,
      nowFn: () => Date.now() + HEURES_4,
      pointsDeRepriseVivants: () => new Set<string>()
    })

    expect(existsSync(copie)).toBe(false)
  })

  it('TRANSMET la garde dans la requête d’inventaire envoyée au worker, dès la construction', () => {
    const repo = depotVide()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-reprise-racine-'))
    roots.push(racine)
    const envoyees: WorktreeOperationRequest[] = []
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: racine,
      racineCopiesDeTaches: racineDe(racine),
      operationWorkerFactory: () => workerQuiEnregistre(envoyees)
    })

    new RunWorktreeCoordinator({
      manager: wm,
      stateStore: new WorktreeRunStateStore(racine, 'depot-test', {
        racineCopiesDeTaches: racineDe(racine)
      }),
      pointsDeRepriseVivants: () => new Set(['run-arrete-quota'])
    })

    const inventaire = envoyees.find((requete) => requete.operation === 'recoveryInventory')
    expect(inventaire).toMatchObject({ copiesProtegees: ['run-arrete-quota'] })
  })
})

/** Un worker qui enregistre les requêtes reçues et ne répond jamais : seule la demande nous intéresse. */
function workerQuiEnregistre(envoyees: WorktreeOperationRequest[]): WorktreeOperationWorkerLike {
  return {
    on: () => undefined,
    postMessage: (requete) => {
      envoyees.push(requete)
    },
    terminate: async () => 0
  }
}
