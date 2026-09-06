import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { preparePersistedRunForRelaunch, terminalizeInterruptedPersistedRun } from './run-reattach'
import {
  pickOrchestrationsToResume,
  saveOrchestrationState,
  type OrchestrationRunState
} from './orchestration-state'
import { compileExecutionQuote } from '../execution-quote'
import { writeSurvivableExit } from './stdout-journal'

/**
 * VERROU FANTOME — cas reel conv-43 / `run-f668f46966fd-1`, lu sur disque le 2026-09-06.
 *
 * L'agent `build` a fini AVEC SUCCES (son sidecar `.exit.json` = `{"exit_code":0}` existe encore),
 * puis le menage des journaux a supprime son `.stdout.jsonl` — le sidecar, lui, n'entre pas dans le
 * menage. Resultat : le sidecar rend `hasCertifiedRelayExit` vrai, donc `hasUnprovenEndedActiveAgent`
 * faux, donc `interruptible` faux : le compteur `activeCalls: 1` n'etait JAMAIS libere. Et comme
 * `resumeCheckpointIsStale` exempte de peremption tout checkpoint a appel actif, ce run mort depuis
 * 43 h etait reelu PREMIER a chaque demarrage, refuse par le controle de budget, et clos rouge —
 * six fois de suite.
 *
 * Le trou : « processus prouve mort + sortie certifiee + journal introuvable » n'avait aucune branche.
 */
function checkpointVerrouFantome(journalPath: string): OrchestrationRunState {
  const quote = compileExecutionQuote('frame un truc parfait pour voir et modifier le CWD')
  return {
    runId: 'run-journal-perdu',
    task: 'Frame un truc parfait pour voir et modifier le CWD',
    conversationId: 'conv-43',
    phaseOutputs: [{ phase: 'frame', text: 'cadrage produit', agentToken: 'agent-frame' }],
    executionQuote: quote,
    usage: {
      quoteId: quote.id,
      startedAgents: 2,
      startedCalls: 3,
      completedCalls: 2,
      failedCalls: 0,
      activeCalls: 1,
      activeReservationIds: ['reservation-build'],
      inputTokens: 870354,
      outputTokens: 13652,
      cacheReadTokens: 812725,
      cacheCreationTokens: 57587,
      totalTokens: 884006,
      freshTokens: 71281,
      knownCostUsd: 1.3260345,
      unpricedCalls: 0,
      unmeteredCalls: 0,
      tokenCoverage: 'complete'
    },
    agents: [
      {
        token: 'agent-frame',
        provider: 'claude',
        phase: 'frame',
        active: false,
        fanOut: false,
        journalPath: `${journalPath}.frame`,
        pid: 6960,
        identity: '639241217753164134|electron.exe'
      },
      {
        token: 'agent-build',
        reservationId: 'reservation-build',
        provider: 'claude',
        phase: 'build',
        active: true,
        fanOut: false,
        journalPath,
        pid: 32628,
        identity: '639241219730460851|electron.exe'
      }
    ],
    startedAt: 1_757_000_000_000,
    updatedAt: 1_757_000_000_000
  }
}

describe('sortie certifiee mais journal supprime', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('libere le verrou d appel et rend le run terminal', () => {
    root = mkdtempSync(join(tmpdir(), 'journal-perdu-'))
    // Le journal n'est JAMAIS ecrit : seul son sidecar de sortie survit, comme sur le disque reel.
    const journalPath = join(root, 'agent-build.stdout.jsonl')
    writeSurvivableExit(journalPath, 0)
    saveOrchestrationState(root, checkpointVerrouFantome(journalPath))

    const now = 1_757_160_000_000
    const terminal = terminalizeInterruptedPersistedRun(
      root,
      'run-journal-perdu',
      () => undefined, // les deux pid ont disparu (ESRCH), constate sur le poste reel
      now
    )

    expect(terminal?.terminal?.status).toBe('interrupted')
    expect(terminal?.terminal?.reason).toContain('journal')
    expect(terminal?.usage?.activeCalls).toBe(0)
    expect(terminal?.usage?.activeReservationIds).toEqual([])
    expect(terminal?.agents?.every((agent) => agent.active !== true)).toBe(true)
    // Le cout deja paye n'est pas efface, et l'appel perdu n'est pas compte comme consommation nulle.
    expect(terminal?.usage?.tokenCoverage).toBe('partial')
    // La trace de budget dit la MEME chose que le verdict. Elle affirmait « PID disparu sans preuve
    // de sortie » sur un run dont la sortie etait justement certifiee : deux cascades en double.
    expect(terminal?.usage?.stoppedReason).toBe(terminal?.terminal?.reason)
    expect(terminal?.usage?.stoppedReason).not.toContain('sans preuve de sortie')
  })

  it('retire le run de la file de reprise au demarrage suivant', () => {
    root = mkdtempSync(join(tmpdir(), 'journal-perdu-file-'))
    const journalPath = join(root, 'agent-build.stdout.jsonl')
    writeSurvivableExit(journalPath, 0)
    saveOrchestrationState(root, checkpointVerrouFantome(journalPath))

    const now = 1_757_160_000_000
    const terminal = terminalizeInterruptedPersistedRun(
      root,
      'run-journal-perdu',
      () => undefined,
      now
    )

    expect(pickOrchestrationsToResume([terminal!], now)).toEqual([])
  })

  it('un journal encore lisible reste hors de cette branche', () => {
    root = mkdtempSync(join(tmpdir(), 'journal-present-'))
    const journalPath = join(root, 'agent-build.stdout.jsonl')
    // Journal PRESENT : c'est le reglement normal qui doit s'en charger, pas la terminalisation.
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'build termine',
        total_cost_usd: 0.2,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 0
        }
      })}\n`,
      'utf8'
    )
    writeSurvivableExit(journalPath, 0)
    saveOrchestrationState(root, checkpointVerrouFantome(journalPath))

    const inchange = terminalizeInterruptedPersistedRun(
      root,
      'run-journal-perdu',
      () => undefined,
      1_757_160_000_000
    )
    expect(inchange?.terminal).toBeUndefined()
    expect(inchange?.usage?.activeCalls).toBe(1)

    // Et la reprise, elle, recupere le resultat au lieu de terminaliser.
    const regle = preparePersistedRunForRelaunch(
      root,
      'run-journal-perdu',
      () => undefined,
      1_757_160_000_000
    )
    expect(regle?.usage?.activeCalls).toBe(0)
    expect(regle?.phaseOutputs.map((output) => output.phase)).toEqual(['frame', 'build'])
  })

  it('la reprise ne rend pas la main sur un verrou qu elle ne peut plus solder', () => {
    root = mkdtempSync(join(tmpdir(), 'journal-perdu-relaunch-'))
    const journalPath = join(root, 'agent-build.stdout.jsonl')
    writeSurvivableExit(journalPath, 0)
    saveOrchestrationState(root, checkpointVerrouFantome(journalPath))

    const prepare = preparePersistedRunForRelaunch(
      root,
      'run-journal-perdu',
      () => undefined,
      1_757_160_000_000
    )

    expect(prepare?.terminal?.status).toBe('interrupted')
    expect(prepare?.usage?.activeCalls).toBe(0)
  })
})
