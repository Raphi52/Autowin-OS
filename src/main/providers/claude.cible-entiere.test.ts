import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from './types'

// Meme harnais de spawn que claude.tool-heartbeat.test.ts : on rejoue une sequence stream-json.
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

const succes = {
  type: 'result',
  subtype: 'success',
  result: 'ok',
  session_id: 's',
  is_error: false,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
}

const appelOutil = (name: string, input: Record<string, unknown>): Record<string, unknown> => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't1', name, input }] }
})

async function drain(): Promise<StreamChunk[]> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
  const chunks: StreamChunk[] = []
  let step = await gen.next()
  while (!step.done) {
    if (step.value.status) chunks.push(step.value)
    step = await gen.next()
  }
  return chunks
}

/**
 * LA TRACE GARDE LA COMMANDE ENTIERE, L'ECRAN GARDE UNE LIGNE.
 *
 * `claude.ts` coupait la cible a 120 signes AVANT tout le monde : le libelle tenait sur une ligne
 * (contrainte reelle de l'en-tete « Reflexion », constat du 2026-09-01) mais le journal de tour, qui
 * recopie ce meme libelle via `provider-status`, ne recevait plus qu'un moignon — mesure sur conv-130,
 * ligne tronquee en plein chemin. On ne retire donc PAS la coupure : on separe l'affichage de la trace.
 */
describe('ClaudeCliAdapter — cible tronquee a l ecran, entiere dans la trace', () => {
  const longue = `grep -rn "motif" ${'src/main/tres/long/chemin/'.repeat(8)}fichier.ts`

  it('coupe le libelle a 120 signes ET emporte la cible ENTIERE a cote', async () => {
    expect(longue.length).toBeGreaterThan(120)
    spawnCapture.stdoutEvents = [appelOutil('Bash', { command: longue }), succes]
    const [chunk] = await drain()

    expect(chunk.status).toBe(`Bash · ${longue.slice(0, 120)}`)
    expect(chunk.status).not.toContain('\n')
    expect(chunk.statusTarget).toBe(longue)
  })

  it('n emporte RIEN en plus quand la cible tient deja en entier dans le libelle', async () => {
    spawnCapture.stdoutEvents = [appelOutil('Read', { file_path: 'src/main/index.ts' }), succes]
    const [chunk] = await drain()

    expect(chunk.status).toBe('Read · src/main/index.ts')
    expect(chunk.statusTarget).toBeUndefined()
  })
})

/**
 * BOUT EN BOUT — la cible entiere doit atteindre le FICHIER, pas seulement le flux. Le journal de
 * tour recopie un evenement de pilote via `pilotJournalEvents` : c'est la que `data.target` se prouve.
 */
describe('journal de tour — la cible entiere y arrive', () => {
  it('garde `data.target` de l evenement provider-status', async () => {
    const { pilotJournalEvents } = await import('../runs/turn-journal-enrich')
    const [event] = pilotJournalEvents(
      {
        kind: 'provider-status',
        iteration: 0,
        text: 'Bash · grep -rn "motif" src/main/tres/long/chemin',
        data: { target: 'grep -rn "motif" src/main/tres/long/chemin/fichier.ts' }
      },
      7
    )
    expect(event.kind).toBe('provider-status')
    expect((event.data as { target: string }).target).toBe(
      'grep -rn "motif" src/main/tres/long/chemin/fichier.ts'
    )
  })
})
