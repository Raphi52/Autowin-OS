import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadOrchestrationStates,
  saveOrchestrationStateAsync,
  clearOrchestrationState,
  type OrchestrationRunState
} from './orchestration-state'

/*
 * MESURE DU 2026-09-04 (.autowin-data/autowin-os/gels.jsonl) : `renameSync` du checkpoint de run
 * (`run-state/<runId>.json`, appele depuis os.ts) porte 21,6 s de fil principal bloque sur les
 * 365 s de gels du jour, avec des pointes a 10 s pour UN seul rename de 173 Ko. Le cout ne vient pas
 * du volume mais de la contention disque : l'ecriture n'a donc rien a faire sur le thread qui pompe
 * les messages de la fenetre. La version asynchrone garde l'atomicite (ecrire a cote + renommer) et
 * l'ORDRE (chainage par runId), et l'etat en vol reste lisible avant que le disque ait repondu.
 */
const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

function etat(runId: string, updatedAt: number): OrchestrationRunState {
  return {
    runId,
    task: 'tache',
    phaseOutputs: [{ phase: 'build' as never, text: 'livrable build' }],
    startedAt: updatedAt - 1,
    updatedAt
  }
}

describe('checkpoint de run — ecriture hors du thread principal', () => {
  it('rend la main avant le disque, mais l etat est deja lisible', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runstate-'))
    dossiers.push(root)

    const promesse = saveOrchestrationStateAsync(root, etat('run-async', 10))
    expect(existsSync(join(root, 'run-async.json'))).toBe(false)
    expect(loadOrchestrationStates(root).map((s) => s.runId)).toContain('run-async')

    await promesse
    expect(existsSync(join(root, 'run-async.json'))).toBe(true)
    expect(loadOrchestrationStates(root)[0]).toMatchObject({ runId: 'run-async', updatedAt: 10 })
  })

  it('garde l ordre des ecritures successives du meme run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runstate-'))
    dossiers.push(root)

    void saveOrchestrationStateAsync(root, etat('run-ordre', 1))
    void saveOrchestrationStateAsync(root, etat('run-ordre', 2))
    await saveOrchestrationStateAsync(root, etat('run-ordre', 3))

    expect(loadOrchestrationStates(root)).toHaveLength(1)
    expect(loadOrchestrationStates(root)[0].updatedAt).toBe(3)
  })

  it('une cloture efface aussi l etat encore en vol', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runstate-'))
    dossiers.push(root)

    const promesse = saveOrchestrationStateAsync(root, etat('run-clos', 5))
    clearOrchestrationState(root, 'run-clos')
    expect(loadOrchestrationStates(root)).toHaveLength(0)
    await promesse
  })
})
