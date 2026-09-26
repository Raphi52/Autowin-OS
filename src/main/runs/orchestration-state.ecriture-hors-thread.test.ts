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

/*
 * DEFAUT MESURE LE 2026-09-12 : le refus de reprise annonce « definitivement impossible —
 * checkpoint retire, ce run ne sera plus rejoue » (relaunch-resumable-run.ts) laissait le fichier
 * `run-state/<runId>.json` sur le disque, parce qu'une ecriture encore EN VOL renommait son `.tmp`
 * APRES le `rmSync`. Consequence reelle : `run-1ede1d229c1e-1` et `run-91389273e2a2-1` revenaient a
 * chaque demarrage et empilaient 92 evenements `failed` dans UN SEUL journal de tour.
 */
describe('checkpoint oublie — la promesse « ne sera plus rejoue » tient', () => {
  it('une ecriture en vol ne ressuscite pas un checkpoint efface', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runstate-oubli-'))
    dossiers.push(root)
    const enVol = saveOrchestrationStateAsync(root, etat('run-aaaaaaaaaaaa-1', 1_000))
    clearOrchestrationState(root, 'run-aaaaaaaaaaaa-1')
    await enVol
    expect(existsSync(join(root, 'run-aaaaaaaaaaaa-1.json'))).toBe(false)
    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('une sauvegarde tardive du meme run est refusee apres l’oubli', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runstate-oubli2-'))
    dossiers.push(root)
    await saveOrchestrationStateAsync(root, etat('run-bbbbbbbbbbbb-1', 1_000))
    clearOrchestrationState(root, 'run-bbbbbbbbbbbb-1')
    await saveOrchestrationStateAsync(root, etat('run-bbbbbbbbbbbb-1', 2_000))
    expect(existsSync(join(root, 'run-bbbbbbbbbbbb-1.json'))).toBe(false)
    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('un run NEUF portant le meme identifiant reste ecrivable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runstate-oubli3-'))
    dossiers.push(root)
    clearOrchestrationState(root, 'run-cccccccccccc-1')
    const neuf = etat('run-cccccccccccc-1', Date.now() + 10_000)
    await saveOrchestrationStateAsync(root, neuf)
    expect(loadOrchestrationStates(root).map((s) => s.runId)).toEqual(['run-cccccccccccc-1'])
  })
})
