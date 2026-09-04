import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Meme harnais de spawn que claude.evidence-sur-echec.test.ts, avec en plus la sortie d'ERREUR
// du CLI : c'est la seule chose qui dit POURQUOI `claude` sort en 1, et elle etait jetee.
const spawnCapture = vi.hoisted(() => ({
  stdoutEvents: [] as Array<Record<string, unknown>>,
  stderrChunks: [] as string[],
  exitCode: 0
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    child.stdout = stdout
    child.stderr = stderr
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => {
      for (const event of spawnCapture.stdoutEvents.splice(0))
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      for (const chunk of spawnCapture.stderrChunks.splice(0)) stderr.emit('data', Buffer.from(chunk))
      child.emit('close', spawnCapture.exitCode)
    }, 0)
    return child
  }
}))

beforeEach(() => {
  spawnCapture.stdoutEvents = []
  spawnCapture.stderrChunks = []
  spawnCapture.exitCode = 0
})

async function messageDEchec(): Promise<string> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
  try {
    let step = await gen.next()
    while (!step.done) step = await gen.next()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('aucune erreur levee')
}

describe('ClaudeCliAdapter — « exit 1 » nomme la sortie d erreur du CLI', () => {
  it("joint la sortie d'erreur du CLI au message d'echec", async () => {
    spawnCapture.stderrChunks = ['Invalid API key · Please run /login\n']
    spawnCapture.exitCode = 1
    const message = await messageDEchec()
    expect(message).toContain('claude CLI exit 1')
    expect(message).toContain('Invalid API key')
  })

  it('borne la sortie d erreur : on garde la FIN, pas un pave', async () => {
    spawnCapture.stderrChunks = [`${'x'.repeat(5000)}\ncause finale\n`]
    spawnCapture.exitCode = 1
    const message = await messageDEchec()
    expect(message).toContain('cause finale')
    expect(message.length).toBeLessThan(1500)
  })

  it("sans sortie d'erreur, le message d'echec reste celui d'avant", async () => {
    spawnCapture.exitCode = 1
    const message = await messageDEchec()
    expect(message).toContain('claude CLI exit 1')
    expect(message).not.toContain('sortie du CLI')
  })
})
