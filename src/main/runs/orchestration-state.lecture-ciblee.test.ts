import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/*
 * LECTURE CIBLEE D'UN CHECKPOINT DE RUN (heal conv-1013, 2026-10-16).
 *
 * Mesure : a chaque demarrage, `gels.jsonl` porte « corps du module termine » a ~2,9 s, dont
 * ~1,15 s de `readFileSync` (≈ 540 appels) partis de `terminalizeInterruptedPersistedRun`. Le
 * balayage `os.terminalizeAbandonedOrchestrations` charge TOUS les checkpoints, puis, pour CHACUN,
 * rechargeait TOUS les checkpoints pour en retrouver un seul : N + N² lectures. Rejoue sur une copie
 * des 36 vrais checkpoints (7,6 Mo) : 1 332 lectures, ~1,0 s de fil principal.
 *
 * Un checkpoint n'est reconnu que dans `<runId>.json` (`loadOrchestrationStates` ecarte tout fichier
 * dont le nom ne porte pas son `runId`) : retrouver UN run n'a donc besoin que de ce fichier-la.
 * Ces tests comptent les lectures ET verifient que la lecture ciblee rend exactement ce que rendait
 * `loadOrchestrationStates(root).find(...)`.
 */
const lectures: string[] = []
vi.mock('node:fs', async (original) => {
  const vrai = (await original()) as typeof fs
  return {
    ...vrai,
    readFileSync: (...args: Parameters<typeof vrai.readFileSync>) => {
      lectures.push(String(args[0]))
      return vrai.readFileSync(...args)
    }
  }
})

const {
  loadOrchestrationState,
  loadOrchestrationStates,
  saveOrchestrationState,
  saveOrchestrationStateAsync
} = await import('./orchestration-state')
const { terminalizeInterruptedPersistedRun } = await import('./run-reattach')
type Etat = Parameters<typeof saveOrchestrationState>[1]

let root: string
const etat = (runId: string, updatedAt = 1000): Etat => ({
  runId,
  task: 'tache',
  phaseOutputs: [{ phase: 'build' as never, text: 'livrable build' }],
  startedAt: updatedAt - 1,
  updatedAt
})
const lecturesDansRoot = (): number => lectures.filter((p) => p.startsWith(root)).length

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lecture-ciblee-'))
  for (let i = 0; i < 10; i++) saveOrchestrationState(root, etat(`run-n${i}-1`, 1000 + i))
  lectures.length = 0
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkpoint de run — lecture ciblee', () => {
  it('retrouver UN run ne lit que SON fichier, pas les dix', () => {
    const relu = terminalizeInterruptedPersistedRun(root, 'run-n3-1', () => null)
    expect(relu?.runId).toBe('run-n3-1')
    expect(lecturesDansRoot()).toBe(1)
  })

  it('le balayage du demarrage lit 2N fichiers, plus N + N²', () => {
    loadOrchestrationStates(root).map(
      (s) => terminalizeInterruptedPersistedRun(root, s.runId, () => null) ?? s
    )
    // 10 pour l'inventaire, puis 1 par run : 20, contre 110 avant.
    expect(lecturesDansRoot()).toBe(20)
  })

  it('rend exactement ce que rendait le chargement complet', async () => {
    const complet = (id: string): Etat | undefined =>
      loadOrchestrationStates(root).find((c) => c.runId === id)

    // present, absent
    expect(loadOrchestrationState(root, 'run-n5-1')).toEqual(complet('run-n5-1'))
    expect(loadOrchestrationState(root, 'run-absent-1')).toBeUndefined()
    expect(complet('run-absent-1')).toBeUndefined()

    // JSON tronque par un crash : ignore des deux cotes
    writeFileSync(join(root, 'run-casse-1.json'), '{"runId":"run-cas')
    expect(loadOrchestrationState(root, 'run-casse-1')).toBeUndefined()
    expect(complet('run-casse-1')).toBeUndefined()

    // fichier qui ne porte pas son runId : ignore des deux cotes
    writeFileSync(join(root, 'run-nom-1.json'), JSON.stringify(etat('run-autre-1')))
    expect(loadOrchestrationState(root, 'run-nom-1')).toBeUndefined()
    expect(loadOrchestrationState(root, 'run-autre-1')).toBeUndefined()
    expect(complet('run-autre-1')).toBeUndefined()

    // etat en vol (ecriture asynchrone pas encore sur le disque) : il prime, des deux cotes
    const enVol = saveOrchestrationStateAsync(root, etat('run-n2-1', 9999))
    expect(loadOrchestrationState(root, 'run-n2-1')?.updatedAt).toBe(9999)
    expect(complet('run-n2-1')?.updatedAt).toBe(9999)
    const neuf = saveOrchestrationStateAsync(root, etat('run-neuf-1', 7))
    expect(loadOrchestrationState(root, 'run-neuf-1')?.updatedAt).toBe(7)
    expect(complet('run-neuf-1')?.updatedAt).toBe(7)
    await Promise.all([enVol, neuf])

    // dossier absent : rien, sans lever
    expect(loadOrchestrationState(join(root, 'absent'), 'run-n1-1')).toBeUndefined()
  })
})
