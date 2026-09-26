import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PREUVE DE BOUT EN BOUT DU DÉ-CUMUL, sur le chemin RÉEL de l'adaptateur.
 *
 * Les tests unitaires de `claude-session-cost.ts` prouvent l'arithmétique. Ils ne prouvent PAS que
 * l'adaptateur l'applique : vérifié à l'écran le 2026-09-20 après redémarrage, trois tours du fil
 * portaient encore 4,2560 / 4,3822 / 4,4656 — une suite croissante, donc un cumul. Ce test ferme
 * exactement ce trou : DEUX tours successifs sur la MÊME session, et c'est la différence qui doit
 * ressortir du second.
 */
const spawnCapture = vi.hoisted(() => ({ stdoutEvents: [] as Array<Record<string, unknown>> }))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => {
      for (const event of spawnCapture.stdoutEvents.splice(0)) {
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      }
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

const SESSION = 'session-de-test-decumul'

function eventsDuTour(cumulUsd: number): Array<Record<string, unknown>> {
  return [
    { type: 'assistant', message: { model: 'claude-opus-5', content: [] } },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      session_id: SESSION,
      total_cost_usd: cumulUsd,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 }
    }
  ]
}

async function jouerUnTour(cumulUsd: number): Promise<number | undefined> {
  spawnCapture.stdoutEvents = eventsDuTour(cumulUsd)
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'x' }], {
    toolProfile: 'watchdog-read-only'
  })
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value?.usage?.costUsd
}

describe('adaptateur Claude — le coût rendu est celui du TOUR, pas le cumul de la session', () => {
  beforeEach(() => {
    process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
  })

  it('rend le cumul au premier tour puis la DIFFÉRENCE aux suivants', async () => {
    // Premier tour d'une session inconnue : le cumul EST le coût du tour.
    expect(await jouerUnTour(4.25)).toBeCloseTo(4.25, 6)
    // Deuxième tour de la MÊME session : avant le correctif, l'adaptateur rendait 4,3822 —
    // et l'indicateur de la barre du haut additionnait 4,25 + 4,38 pour un tour à 13 centimes.
    expect(await jouerUnTour(4.3822)).toBeCloseTo(0.1322, 6)
    // Troisième tour : la somme des trois doit valoir le DERNIER cumul, jamais leur addition brute.
    expect(await jouerUnTour(4.4656)).toBeCloseTo(0.0834, 6)
  })
})
