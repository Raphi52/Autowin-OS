import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evidenceDeLErreur } from './evidence-portee-par-erreur'

// Meme harnais de spawn que claude.api-retry.test.ts : on rejoue une sequence stream-json arbitraire.
const spawnCapture = vi.hoisted(() => ({
  stdoutEvents: [] as Array<Record<string, unknown>>,
  exitCode: 0
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
      child.emit('close', spawnCapture.exitCode)
    }, 0)
    return child
  }
}))

beforeEach(() => {
  spawnCapture.stdoutEvents = []
  spawnCapture.exitCode = 0
})

describe('ClaudeCliAdapter — les actions survivent a l echec du sous-agent', () => {
  it("porte les actions deja observees sur l'erreur levee", async () => {
    // Mesure du 2026-08-21 : un sous-agent `completed` montre ses actions 38 fois sur 39 ; un
    // sous-agent `failed` ne les montre JAMAIS (0 sur 9). La pompe accumule puis `throw errored`, donc
    // tout part avec l'exception. C'est l'inverse du besoin : on veut voir surtout quand ca casse.
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Grep', input: { command: 'grep -rn foo' } }]
        }
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu-1', is_error: false, content: 'src/a.ts:12: foo' }
          ]
        }
      }
      // ... puis le CLI meurt SANS event `result`, code de sortie non nul : le cas `failed` reel.
    ]
    spawnCapture.exitCode = 1
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])

    let leve: unknown
    try {
      let step = await gen.next()
      while (!step.done) step = await gen.next()
    } catch (error) {
      leve = error
    }

    expect(leve).toBeInstanceOf(Error)
    const actions = evidenceDeLErreur(leve)
    expect(actions?.length).toBeGreaterThan(0)
    expect(actions?.[0]?.type).toBe('Grep')
  })
})
