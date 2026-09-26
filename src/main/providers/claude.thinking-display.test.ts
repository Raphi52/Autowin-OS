import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BLOC « RAISONNEMENT » VIDE (constat utilisateur du 2026-09-12) — la pensee n'arrivait pas.
 *
 * Mesure hors-modele du 2026-09-12, CLI 2.1.269 / opus-5 : sans `--thinking-display summarized`,
 * le flux ne porte qu'un `thinking_delta` VIDE plus un `signature_delta` chiffre ; avec le drapeau,
 * 14 `thinking_delta` non vides sur la meme question. Rien n'etait donc « recuperable » cote rendu :
 * la cause est l'argument de lancement.
 *
 * ENTREE QUI FAIT ECHOUER UNE FAUSSE CORRECTION : retoucher le composant du fil laisserait ce test
 * rouge, puisqu'il porte sur ce que le CLI est SPAWNE avec.
 */
const spawnCapture = vi.hoisted(() => ({ args: [] as string[] }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (_bin: string, args: string[]) => {
    spawnCapture.args = args
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => {
      stdout.emit(
        'data',
        Buffer.from(
          `${JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 's', is_error: false, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 } })}\n`
        )
      )
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

beforeEach(() => {
  spawnCapture.args = []
})

describe('ClaudeCliAdapter — pensee en clair', () => {
  it('demande la pensee LISIBLE au CLI, sinon les thinking_delta arrivent vides', async () => {
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    const i = spawnCapture.args.indexOf('--thinking-display')
    expect(i, 'le CLI doit etre lance avec --thinking-display').toBeGreaterThanOrEqual(0)
    expect(spawnCapture.args[i + 1]).toBe('summarized')
    // Le flux partiel reste indispensable : sans lui, la pensee arriverait d'un bloc, apres coup.
    expect(spawnCapture.args).toContain('--include-partial-messages')
  })
})
