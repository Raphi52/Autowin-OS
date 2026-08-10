import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Même harnais de spawn que claude.test.ts : on rejoue une séquence stream-json arbitraire.
const spawnCapture = vi.hoisted(() => ({
  stdoutEvents: [] as Array<Record<string, unknown>>
}))
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

beforeEach(() => {
  spawnCapture.stdoutEvents = []
})

/** Draine le générateur et rend les fragments de raisonnement streamés. */
async function drainReasoning(): Promise<{ reasoning: string[]; text: string }> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
  const reasoning: string[] = []
  let step = await gen.next()
  while (!step.done) {
    if (step.value.reasoning) reasoning.push(step.value.reasoning)
    step = await gen.next()
  }
  return { reasoning, text: step.value.text }
}

describe('ClaudeCliAdapter — surcharge API (529) rendue visible', () => {
  it('streame chaque api_retry au lieu de laisser le tour muet', async () => {
    // Mesuré le 2026-08-05 dans run-stdout/ : 9 api_retry consécutifs, aucun event visible pour
    // l'UI → « réflexion » figée 2-3 min sans le moindre signal. Le retry DOIT se voir.
    spawnCapture.stdoutEvents = [
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 10,
        retry_delay_ms: 514,
        error_status: 529,
        error: 'overloaded'
      },
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 1236,
        error_status: 529,
        error: 'overloaded'
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'ok',
        session_id: 's',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
      }
    ]
    const { reasoning } = await drainReasoning()

    expect(reasoning).toHaveLength(2)
    expect(reasoning[0]).toContain('529')
    expect(reasoning[0]).toContain('1/10')
    expect(reasoning[1]).toContain('2/10')
  })

  it("échoue explicitement quand les tentatives sont épuisées sans réponse", async () => {
    // L'autre moitié du défaut : le CLI meurt après le dernier retry SANS event `result`, exit 0 →
    // le tour se terminait « réussi » et vide, donc l'UI ne sortait jamais de l'état réflexion.
    spawnCapture.stdoutEvents = [
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 10,
        max_retries: 10,
        retry_delay_ms: 33839,
        error_status: 529,
        error: 'overloaded'
      }
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
    await expect(
      (async () => {
        let step = await gen.next()
        while (!step.done) step = await gen.next()
        return step.value
      })()
    ).rejects.toThrow(/surchargé|529/)
  })
})
