import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { saveOrchestrationState } from '../runs/orchestration-state'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { WorktreeManager } from './worktree-manager'
// fix-ok: le constructeur exige racineCopiesDeTaches (TS2345 mesuré au typecheck) ; racineDe la fournit au gestionnaire de ce fichier.
import { racineDe } from './worktree-manager.test-helpers'

/**
 * LE POINT DE REPRISE LU SUR DISQUE, PAR LE CHEMIN PAR DÉFAUT (sans injecter la garde).
 *
 * Le coordinateur lit `run-state` à chaque balayage. Un run dont le point de reprise existe garde sa
 * copie propre, âgée de 4 h ; le même run sans point de reprise la perd. Seule la racine des points
 * change entre les deux cas.
 *
 * ENTRÉE QUI FERAIT ÉCHOUER LE PREMIER TEST SI LA CORRECTION ÉTAIT FAUSSE : un câblage par défaut qui
 * ne lirait pas le disque (ensemble vide) → la copie part, le test passe au rouge ; le témoin reste vert.
 */

const roots: string[] = []
const HEURE_MS = 60 * 60 * 1_000

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function depotTemporaire(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-points-disque-repo-'))
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

function dossierTemporaire(prefixe: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefixe))
  roots.push(dir)
  return dir
}

/** Un gestionnaire dont l'horloge est décalée de 4 h, et un coordinateur qui lit `racinePoints`. */
function montage(repo: string, racinePoints: string) {
  const racineCopies = dossierTemporaire('autowin-points-disque-copies-')
  const manager = new WorktreeManager({
    baseRepo: repo,
    worktreeRoot: racineCopies,
    racineCopiesDeTaches: racineDe(racineCopies),
    nowFn: () => Date.now() + 4 * HEURE_MS
  })
  const co = new RunWorktreeCoordinator({
    manager,
    racinePointsDeReprise: racinePoints,
    deferRecoveryUntil: new Promise(() => {})
  } as never)
  return { manager, co }
}

afterEach(() => {
  for (const root of roots.splice(0)) supprimerArbre(root)
})

describe('point de reprise sur disque, chemin de production', () => {
  it('garde la copie propre d’un run dont le point de reprise existe sur disque', async () => {
    const repo = depotTemporaire()
    const racinePoints = dossierTemporaire('autowin-points-disque-run-state-')
    saveOrchestrationState(racinePoints, {
      runId: 'run-reprenable',
      task: 'ajoute un bouton',
      phaseOutputs: [{ phase: 'build' as never, text: 'livrable build' }],
      startedAt: Date.now() - 1000,
      updatedAt: Date.now()
    })
    const { manager, co } = montage(repo, racinePoints)
    const copie = manager.acquire('run-reprenable')
    expect(existsSync(copie)).toBe(true)

    const balayees = await co.balayerLesCopiesAbandonnees()

    expect(balayees).not.toContain('run-reprenable')
    expect(existsSync(copie)).toBe(true)
  })

  it('TÉMOIN : sans point de reprise sur disque, la même copie propre de 4 h part', async () => {
    const repo = depotTemporaire()
    const racinePoints = dossierTemporaire('autowin-points-disque-vide-')
    const { manager, co } = montage(repo, racinePoints)
    const copie = manager.acquire('run-reprenable')
    expect(existsSync(copie)).toBe(true)

    const balayees = await co.balayerLesCopiesAbandonnees()

    expect(balayees).toContain('run-reprenable')
    expect(existsSync(copie)).toBe(false)
  })
})
