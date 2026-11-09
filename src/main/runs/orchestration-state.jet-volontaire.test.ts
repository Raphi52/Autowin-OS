import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clorePointDeRepriseJete,
  loadOrchestrationStates,
  pointsDeRepriseVivantsSur,
  saveOrchestrationState,
  type OrchestrationRunState
} from './orchestration-state'

/**
 * Un jet volontaire (copie jetée sur demande de l'utilisateur) doit clore le point de reprise de son
 * run. Sinon la reprise suivante retente le run, ne trouve plus sa copie et refuse « copie durable
 * absente » : la même panne que les refus du 05-06/11, par une autre porte.
 */

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function racineDeTest(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-jet-point-'))
  roots.push(dir)
  return dir
}

const etatOuvert = (runId: string): OrchestrationRunState => ({
  runId,
  task: 'ajoute un bouton',
  phaseOutputs: [{ phase: 'build' as never, text: 'livrable build' }],
  startedAt: 1_000,
  updatedAt: 2_000
})

describe('un jet volontaire clôt le point de reprise de son run', () => {
  it('clorePointDeRepriseJete retire le run de la liste protégée et le marque « discarded »', () => {
    const root = racineDeTest()
    saveOrchestrationState(root, etatOuvert('run-jete'))
    expect(pointsDeRepriseVivantsSur(root, 3_000).has('run-jete')).toBe(true)

    expect(clorePointDeRepriseJete(root, 'run-jete', 3_000)).toBe(true)

    expect(pointsDeRepriseVivantsSur(root, 3_000).has('run-jete')).toBe(false)
    expect(
      loadOrchestrationStates(root).find((etat) => etat.runId === 'run-jete')?.terminal
    ).toMatchObject({ status: 'discarded' })
  })

  it('JUMEAU : sans point ouvert pour ce run, clorePointDeRepriseJete ne crée rien et rend false', () => {
    const root = racineDeTest()

    expect(clorePointDeRepriseJete(root, 'run-absent', 3_000)).toBe(false)
    expect(loadOrchestrationStates(root)).toEqual([])
  })
})
