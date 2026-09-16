import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UN CRASH DU CLI N'EST PAS UNE DECISION TERMINALE.
 *
 * Mesure conv-599, tour `fa92ae4e-2126-40bf-9a21-e7133ebdd962` : apres 4 iterations payees
 * (≈1,06 USD, 917 k tokens), l'iteration 4 meurt en `error_during_execution` en 1,9 s pour
 * 0 token et 0 USD. Marque `retryable: false`, le tour entier est jete ; l'utilisateur a du
 * retaper « /kaizen cette erreur et reprend » (saisie ts 1789562253947).
 *
 * Regle : `error_during_execution` SANS consommation = plantage transitoire, rejouable une fois
 * (la borne des 2 tentatives d'AgentPilot interdit la boucle). Des qu'un token a ete facture,
 * ou pour tout autre code (budget, max_turns), la decision reste terminale.
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
      for (const event of spawnCapture.stdoutEvents.splice(0))
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

const lancer = async (): Promise<unknown> => {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'x' }], {
    toolProfile: 'watchdog-read-only'
  })
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value
}

beforeEach(() => {
  spawnCapture.stdoutEvents = []
  process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
})

describe('claude — plantage transitoire du CLI', () => {
  it('rend REJOUABLE un error_during_execution qui n a rien consomme', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'result',
        subtype: 'error_during_execution',
        result: '',
        session_id: 's',
        is_error: true,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
      }
    ]
    await expect(lancer()).rejects.toMatchObject({
      code: 'error_during_execution',
      retryable: true
    })
  })

  it('garde TERMINAL un error_during_execution deja facture', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'result',
        subtype: 'error_during_execution',
        result: '',
        session_id: 's',
        is_error: true,
        total_cost_usd: 0.42,
        usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 0 }
      }
    ]
    await expect(lancer()).rejects.toMatchObject({
      code: 'error_during_execution',
      retryable: false
    })
  })

  it('garde TERMINAL un autre code, meme sans consommation', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'result',
        subtype: 'error_max_budget_usd',
        result: '',
        session_id: 's',
        is_error: true,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
      }
    ]
    await expect(lancer()).rejects.toMatchObject({
      code: 'error_max_budget_usd',
      retryable: false
    })
  })
})
