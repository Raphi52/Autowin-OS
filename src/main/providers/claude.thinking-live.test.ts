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

describe('ClaudeCliAdapter — raisonnement EN TEMPS REEL', () => {
  it('streame les thinking_delta partiels et ne redouble pas le bloc complet', async () => {
    // Constat utilisateur (2026-08-31) : le bloc « Reflexion » n'ecrivait rien pendant que le modele
    // reflechissait, puis crachait le pave d'un coup. Cause : le CLI etait spawne sans
    // `--include-partial-messages`, donc SEUL le bloc `assistant` complet arrivait.
    spawnCapture.stdoutEvents = [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'je compare ' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'A et B' } } },
      { type: 'assistant', message: { model: 'm', content: [{ type: 'thinking', thinking: 'je compare A et B' }, { type: 'text', text: 'B.' }] } },
      {
        type: 'result',
        subtype: 'success',
        result: 'B.',
        session_id: 's',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
      }
    ]
    const { reasoning, text } = await drainReasoning()

    expect(reasoning, 'chaque delta doit sortir au fil de leau').toEqual(['je compare ', 'A et B'])
    expect(text).toBe('B.')
  })
})
