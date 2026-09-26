import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// REPRODUIT le 2026-09-25 (clone neuf) : au 1er demarrage l'app lance `claude update` (16:59:26) ;
// npm SUPPRIME puis recree tout le paquet `@anthropic-ai/claude-code` (17:00:00 → exe copie a
// 17:00:03). L'adaptateur, construit pendant cette fenetre, ne trouvait pas `claude.exe`, figeait le
// repli nu `claude` dans son constructeur, et CHAQUE tour suivant echouait (« Le fichier specifie est
// introuvable », 17:01:10) alors que le binaire etait revenu — jusqu'au redemarrage de l'app.

const spawnCapture = vi.hoisted(() => ({ bins: [] as string[] }))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (bin: string) => {
    spawnCapture.bins.push(bin)
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    queueMicrotask(() => {
      const event = {
        type: 'result',
        subtype: 'success',
        result: 'ok',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
      }
      stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.emit('close', 0)
    })
    return child
  }
}))

import { ClaudeCliAdapter, signalerMiseAJourClaudeCli } from './claude'

async function drain(stream: AsyncGenerator<unknown, unknown, void>): Promise<void> {
  let step = await stream.next()
  while (!step.done) step = await stream.next()
}

const binAvant = process.env.CLAUDE_BIN

beforeEach(() => {
  spawnCapture.bins = []
})

afterEach(() => {
  if (binAvant === undefined) delete process.env.CLAUDE_BIN
  else process.env.CLAUDE_BIN = binAvant
})

describe('ClaudeCliAdapter — binaire resolu a CHAQUE tour, pas fige a la construction', () => {
  it('un binaire devenu disponible APRES la construction est celui qui est lance', async () => {
    process.env.CLAUDE_BIN = 'claude-pendant-la-mise-a-jour'
    const adapter = new ClaudeCliAdapter()
    process.env.CLAUDE_BIN = 'claude-apres-la-mise-a-jour'

    await drain(adapter.send([{ role: 'user', content: 'Test' }]))

    expect(spawnCapture.bins).toEqual(['claude-apres-la-mise-a-jour'])
  })

  it('un `claude update` en cours RETIENT le lancement jusqu a sa fin', async () => {
    let terminer!: () => void
    signalerMiseAJourClaudeCli(new Promise<void>((resolve) => (terminer = resolve)))
    const adapter = new ClaudeCliAdapter({ bin: 'claude-test' })

    const tour = drain(adapter.send([{ role: 'user', content: 'Test' }]))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(spawnCapture.bins).toEqual([])

    terminer()
    await tour
    expect(spawnCapture.bins).toEqual(['claude-test'])
  })
})
