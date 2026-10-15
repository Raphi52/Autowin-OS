import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadOrchestrationStates,
  marquerCheckpointCoupeParQuota,
  pickOrchestrationsToResume,
  pickResumeForTask,
  repriseAutoRetenueParQuota,
  saveOrchestrationState,
  type OrchestrationRunState
} from './orchestration-state'

/**
 * RUN SUSPENDU PAR LE MUR DE QUOTA (conv-914 / conv-916, 2026-10-13) : l'acquis payé reste
 * reprenable, l'heure de retour annoncée est notée, et seule la reprise AUTOMATIQUE l'attend.
 */
let root: string
/** Instantané de consommation complet, tel que le superviseur le rend. */
const conso = (activeReservationIds: string[]): NonNullable<OrchestrationRunState['usage']> => ({
  quoteId: 'quote-1',
  startedCalls: 3,
  completedCalls: 2,
  failedCalls: activeReservationIds.length ? 0 : 1,
  activeCalls: activeReservationIds.length,
  activeReservationIds,
  inputTokens: 10,
  outputTokens: 10,
  cacheReadTokens: 0,
  totalTokens: 20,
  freshTokens: 20,
  unpricedCalls: 0,
  unmeteredCalls: 0,
  knownCostUsd: 1.5,
  tokenCoverage: 'complete'
})
const HEURE_DU_MUR = Date.parse('2026-10-13T09:17:00.000Z')
const RETOUR = Date.parse('2026-10-13T11:00:00.000Z') // « resets 1pm (Europe/Paris) »

const runPaye = (): OrchestrationRunState => ({
  runId: 'run-219bfae8dec4-1',
  task: 'si cette conv est en train de bosser encore faut que j ai un spinner sur la conv',
  conversationId: 'conv-914',
  phaseOutputs: [
    { phase: 'frame' as never, text: 'cadrage' },
    { phase: 'build' as never, text: 'build payé' }
  ],
  // Dernier checkpoint d'agents, pris quand l'appel de la phase clean était encore EN VOL.
  agents: [{ token: 'tok-clean', phase: 'clean' as never, active: true, reservationId: 'resa-1' }],
  usage: conso(['resa-1']),
  startedAt: HEURE_DU_MUR - 60_000,
  updatedAt: HEURE_DU_MUR - 1_000
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orch-mur-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkpoint suspendu par le mur de quota', () => {
  it('note le refus et l’heure, réaligne agents et consommation réglés, garde les phases payées', async () => {
    saveOrchestrationState(root, runPaye())
    await marquerCheckpointCoupeParQuota(
      root,
      'run-219bfae8dec4-1',
      { reason: "You've hit your session limit · resets 1pm (Europe/Paris)", resumeAfter: RETOUR },
      {
        agents: [{ token: 'tok-clean', phase: 'clean' as never, active: false }],
        usage: conso([])
      },
      HEURE_DU_MUR
    )

    const [relu] = loadOrchestrationStates(root)
    expect(relu.phaseOutputs.map((output) => output.text)).toEqual(['cadrage', 'build payé'])
    expect(relu.quotaWall).toEqual({
      reason: "You've hit your session limit · resets 1pm (Europe/Paris)",
      resumeAfter: RETOUR,
      decidedAt: HEURE_DU_MUR
    })
    // Plus de verrou fantôme : l'appel refusé est réglé, sur le disque aussi.
    expect(relu.usage?.activeCalls).toBe(0)
    expect(relu.agents?.[0]?.active).toBe(false)
    // Persisté réellement, pas seulement en mémoire.
    const disque = JSON.parse(readFileSync(join(root, 'run-219bfae8dec4-1.json'), 'utf8'))
    expect(disque.quotaWall.resumeAfter).toBe(RETOUR)
  })

  it('la reprise automatique attend l’heure annoncée ; sans heure, le redémarrage suffit', () => {
    const suspendu: OrchestrationRunState = {
      ...runPaye(),
      quotaWall: { reason: 'session limit', resumeAfter: RETOUR, decidedAt: HEURE_DU_MUR }
    }
    expect(repriseAutoRetenueParQuota(suspendu, RETOUR - 1)).toBe(true)
    expect(repriseAutoRetenueParQuota(suspendu, RETOUR)).toBe(false)
    const sansHeure: OrchestrationRunState = {
      ...runPaye(),
      quotaWall: { reason: 'session limit', decidedAt: HEURE_DU_MUR }
    }
    expect(repriseAutoRetenueParQuota(sansHeure, HEURE_DU_MUR + 1)).toBe(false)
    expect(repriseAutoRetenueParQuota(runPaye(), HEURE_DU_MUR + 1)).toBe(false)
  })

  it('reste trouvable par la relance de la même tâche et reste dans la liste protégée', () => {
    saveOrchestrationState(root, {
      ...runPaye(),
      agents: [],
      usage: conso([]),
      quotaWall: { reason: 'session limit', resumeAfter: RETOUR, decidedAt: HEURE_DU_MUR }
    })
    const etats = loadOrchestrationStates(root)
    const avantLeRetour = HEURE_DU_MUR + 60_000
    expect(
      pickResumeForTask(etats, {
        task: runPaye().task,
        conversationId: 'conv-914',
        nowMs: avantLeRetour
      })?.runId
    ).toBe('run-219bfae8dec4-1')
    // Toujours « reprenable » : c'est ce qui le protège du ménage des copies (`workspace-gc`).
    expect(pickOrchestrationsToResume(etats, avantLeRetour).map((s) => s.runId)).toContain(
      'run-219bfae8dec4-1'
    )
  })

  it('refuse une marque illisible au lieu d’écrire un checkpoint que la relecture jetterait', async () => {
    saveOrchestrationState(root, { ...runPaye(), agents: [], usage: undefined })
    await expect(
      marquerCheckpointCoupeParQuota(
        root,
        'run-219bfae8dec4-1',
        { reason: '   ' },
        {},
        HEURE_DU_MUR
      )
    ).rejects.toThrow(/quotaWall invalide/)
    expect(loadOrchestrationStates(root)[0].quotaWall).toBeUndefined()
  })
})
