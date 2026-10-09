import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * LE MESSAGE FABRIQUE PAR LE CLI N'EST PAS LE MODELE.
 *
 * Mesure conv-120, appel du tour `3e00e0a5-5602-46e9-adb3-0d9c7a162b21` (2026-10-09) : le CLI
 * emet, apres deux appels d'outil illisibles, un message assistant `model: "<synthetic>"` qui porte
 * son propre texte d'erreur. L'adaptateur l'adoptait comme modele resolu : promptCalls, activite et
 * Observatory affichaient `<synthetic>` au lieu de `claude-opus-5-5`, le modele qui avait reellement
 * produit (et facture) les 0,37 USD du tour.
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

const lancer = async (): Promise<{ model?: string }> => {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'x' }], {
    toolProfile: 'watchdog-read-only'
  })
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value as { model?: string }
}

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 }

beforeEach(() => {
  spawnCapture.stdoutEvents = []
  process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
})

describe('claude — message synthetique du CLI', () => {
  it('garde le modele reel quand le CLI ajoute un message <synthetic>', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: 'bonjour' }],
          usage
        }
      },
      {
        type: 'assistant',
        message: {
          id: 'synth',
          model: '<synthetic>',
          content: [{ type: 'text', text: 'note du CLI' }],
          usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
        }
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'bonjour',
        session_id: 's',
        is_error: false,
        total_cost_usd: 0.01,
        usage
      }
    ]
    const res = await lancer()
    expect(res.model).toBe('claude-opus-5-5')
  })
})
