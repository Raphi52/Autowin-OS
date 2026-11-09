import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as WorkerThreads from 'node:worker_threads'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { WorktreeManager } from './worktree-manager'
import type { WorktreeOperationRequest } from './worktree-operation-protocol'
// fix-ok: le constructeur exige racineCopiesDeTaches (TS2345 mesuré au typecheck) ; le worker la reçoit par ses données, racineDe la fournit, et nettoyerRacines retire son dossier.
import { nettoyerRacines, racineDe } from './worktree-manager.test-helpers'

/*
 * LE WORKER DE RECENSEMENT DOIT RESPECTER LA GARDE DU POINT DE REPRISE.
 *
 * En production, l'inventaire de démarrage (`recoveryInventory`) s'exécute DANS le worker d'opérations,
 * qui a son propre gestionnaire : la garde posée sur le gestionnaire du fil principal ne l'atteint pas.
 * Ce test charge le VRAI module worker, avec un port simulé, et lui envoie la requête telle que le
 * coordinateur la poste. La copie d'un run reprenable doit survivre quand la requête la protège.
 */

const portail = vi.hoisted(() => ({
  ecouteurs: [] as Array<(requete: WorktreeOperationRequest) => void>,
  reponses: [] as unknown[],
  donnees: { baseRepo: '', worktreeRoot: '', racineCopiesDeTaches: '' }
}))

vi.mock('node:worker_threads', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerThreads>()),
  parentPort: {
    on: (_evenement: string, ecouteur: (requete: WorktreeOperationRequest) => void) => {
      portail.ecouteurs.push(ecouteur)
    },
    postMessage: (message: unknown) => {
      portail.reponses.push(message)
    }
  },
  workerData: portail.donnees
}))

const roots: string[] = []
const HEURES_4 = 4 * 60 * 60 * 1_000

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function depotVide(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-worker-depot-'))
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

/** Une copie propre vieille de 4 h : au-delà du seuil de 3 h, le balayage la prendrait. */
function vieillir(copie: string): void {
  const il = (Date.now() - HEURES_4) / 1_000
  utimesSync(copie, il, il)
}

/** Charge le vrai worker avec un nouveau gestionnaire sur ce dépôt, et rend son écouteur de requêtes. */
async function workerDeDemarrage(
  repo: string,
  racine: string
): Promise<(requete: WorktreeOperationRequest) => void> {
  vi.resetModules()
  portail.ecouteurs.length = 0
  portail.reponses.length = 0
  portail.donnees.baseRepo = repo
  portail.donnees.worktreeRoot = racine
  portail.donnees.racineCopiesDeTaches = racineDe(racine)
  await import('./worktree-operation-worker')
  const ecouteur = portail.ecouteurs[0]
  if (!ecouteur) throw new Error('le worker n’a pas branché son écouteur de requêtes')
  return ecouteur
}

afterEach(() => {
  for (const root of roots.splice(0)) supprimerArbre(root)
  nettoyerRacines()
})

describe('worker d’opérations : l’inventaire de démarrage respecte le point de reprise', () => {
  it('CONSERVE la copie propre d’un run reprenable quand la requête d’inventaire la protège', async () => {
    const repo = depotVide()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-worker-racine-'))
    roots.push(racine)
    const copie = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: racine,
      racineCopiesDeTaches: racineDe(racine)
    }).acquire('run-reprenable')
    vieillir(copie)

    const demande = await workerDeDemarrage(repo, racine)
    demande({ operation: 'recoveryInventory', copiesProtegees: ['run-reprenable'] })

    expect(portail.reponses.at(-1)).toMatchObject({ type: 'result' })
    expect(existsSync(copie)).toBe(true)
  })

  it('JUMEAU : sans protection dans la requête, la même copie part (comportement inchangé)', async () => {
    const repo = depotVide()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-worker-racine-'))
    roots.push(racine)
    const copie = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: racine,
      racineCopiesDeTaches: racineDe(racine)
    }).acquire('run-reprenable')
    vieillir(copie)

    const demande = await workerDeDemarrage(repo, racine)
    demande({ operation: 'recoveryInventory' })

    expect(existsSync(copie)).toBe(false)
  })
})
