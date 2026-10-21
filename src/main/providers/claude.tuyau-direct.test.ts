/**
 * LE TUYAU DIRECT VERS LE CLI CLAUDE — deux défauts trouvés par l'audit du branchement (conv-1040).
 *
 * Ce chemin sert de repli quand le journal survivable est indisponible (ou `AUTOWIN_DETACHED_RUNS=0`).
 *
 * 1. L'ENTRÉE du CLI n'avait aucune écoute d'erreur. Quand le CLI meurt avant d'avoir lu le message,
 *    Node émet `write EOF` / `EPIPE` sur ce flux : sans écoute, l'erreur sort du processus principal,
 *    et son gestionnaire de plantage arrête TOUTES les orchestrations (`index.ts`,
 *    `abortAllOrchestrations`). Mesuré en réel : 20 exceptions non rattrapées sur 20 lancements.
 * 2. La SORTIE était décodée morceau par morceau : un « é » coupé entre deux morceaux devenait « �� ».
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Double = EventEmitter & Record<string, unknown>

const cap = vi.hoisted(() => ({
  fils: undefined as (EventEmitter & Record<string, unknown>) | undefined,
  entree: undefined as EventEmitter | undefined,
  messageRecu: undefined as string | undefined,
  /** Morceaux BRUTS écrits sur la sortie du CLI, puis fermeture avec ce code ; absent = rien d'auto. */
  scenario: undefined as { morceaux: Buffer[]; code: number } | undefined
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const fils = new EventEmitter() as Double
    const stdout = new EventEmitter()
    fils.stdout = stdout
    fils.stderr = new EventEmitter()
    // Flux d'entrée réaliste : un émetteur, comme le `Writable` d'un vrai processus.
    const entree = new EventEmitter() as EventEmitter & { end: (texte: string) => void }
    entree.end = (texte: string): void => {
      cap.messageRecu = texte
    }
    fils.stdin = entree
    fils.exitCode = null
    fils.kill = (): boolean => true
    fils.unref = (): void => {}
    cap.fils = fils
    cap.entree = entree
    const scenario = cap.scenario
    if (scenario) {
      setTimeout(() => {
        for (const morceau of scenario.morceaux) stdout.emit('data', morceau)
        fils.emit('close', scenario.code)
      }, 0)
    }
    return fils
  }
}))

let journalAvant: string | undefined
beforeEach(() => {
  journalAvant = process.env.AUTOWIN_RUN_JOURNAL_ROOT
  delete process.env.AUTOWIN_RUN_JOURNAL_ROOT // tuyau direct
  cap.fils = undefined
  cap.entree = undefined
  cap.messageRecu = undefined
  cap.scenario = undefined
})
afterEach(() => {
  if (journalAvant === undefined) delete process.env.AUTOWIN_RUN_JOURNAL_ROOT
  else process.env.AUTOWIN_RUN_JOURNAL_ROOT = journalAvant
})

async function envoyer(): Promise<AsyncGenerator<{ delta?: string }, unknown, void>> {
  const { ClaudeCliAdapter } = await import('./claude')
  return new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'travaille' }])
}

async function attendreQue(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5))
  if (!condition()) throw new Error('condition jamais remplie')
}

describe('entrée du CLI : un CLI mort avant de lire ne fait pas planter l’app', () => {
  it('l’erreur d’écriture est rattrapée et nommée dans l’échec du tour', async () => {
    const gen = await envoyer()
    const issue = gen.next().then(
      async (pas) => {
        while (!pas.done) pas = await gen.next()
        return 'rendu sans erreur'
      },
      (e: Error) => e.message
    )
    await attendreQue(() => cap.messageRecu !== undefined)
    expect(cap.messageRecu).toContain('travaille')
    const panne = Object.assign(new Error('write EOF'), { code: 'EOF' })
    // Sans écoute, `emit('error')` JETTE : c'est l'exception qui sortait du processus principal.
    expect(() => cap.entree!.emit('error', panne)).not.toThrow()
    cap.fils!.emit('close', 1)
    const message = await issue
    expect(message).toContain('claude CLI exit 1')
    expect(message).toContain('write EOF')
  })
})

describe('sortie du CLI : un caractère coupé entre deux morceaux reste entier', () => {
  it('« é » coupé en deux arrive « é », jamais « �� »', async () => {
    const ligne = Buffer.from(
      `${JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-test', content: [{ type: 'text', text: 'réponse' }] }
      })}\n${JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'réponse',
        session_id: 's',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
      })}\n`,
      'utf8'
    )
    const coupure = ligne.indexOf(Buffer.from('é', 'utf8')) + 1 // entre les deux octets du « é »
    cap.scenario = { morceaux: [ligne.subarray(0, coupure), ligne.subarray(coupure)], code: 0 }
    const gen = await envoyer()
    let texte = ''
    let pas = await gen.next()
    while (!pas.done) {
      texte += pas.value.delta ?? ''
      pas = await gen.next()
    }
    expect(texte).toBe('réponse')
  })
})
