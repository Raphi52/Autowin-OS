import { describe, expect, it, vi } from 'vitest'
import { motifArreterUnFil, interruptionSansDefaut } from '../../shared/arret-par-stop'
import { classifyProviderFailure } from './provider-failure-diagnosis'

// Aucun CLI réel ne doit partir : l'appel est coupé avant tout lancement.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    throw new Error('spawn interdit dans ce test')
  }
}))

/**
 * UN APPEL PARTI SUR UN SIGNAL DÉJÀ COUPÉ GARDE LA SIGNATURE DE L'ARRÊT.
 *
 * `AbortSignal.throwIfAborted()` jette la raison telle quelle — une chaîne pour `arreter_un_fil` et
 * pour le bouton Stop. Sans le marqueur `[abort]` d'`abortFailure`, le diagnostic lisait une panne
 * (relevé le 2026-11-06 : « arret demande par conv-1667 (arreter_un_fil) : … » classé `other`).
 */
describe('adaptateurs — un appel coupé avant son lancement', () => {
  const motif = motifArreterUnFil('conv-1667', 'Lot 2 parti sans le code du lot 1')
  const coupe = (): AbortSignal => {
    const controleur = new AbortController()
    controleur.abort(motif)
    return controleur.signal
  }
  const verifier = (erreur: unknown, action: string): void => {
    expect(erreur).toBeInstanceOf(Error)
    const message = (erreur as Error).message
    expect(message.startsWith(`[abort] ${action} interrompu : ${motif}`)).toBe(true)
    expect(classifyProviderFailure(message)).toBe('cancelled')
    expect(interruptionSansDefaut(message)).toBe('arret-voulu')
  }

  it('claude', async () => {
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'C:/outils/claude.exe' }).send(
      [{ role: 'user', content: 'travaille' }],
      { signal: coupe() }
    )
    verifier(
      await gen.next().then(
        () => undefined,
        (e: unknown) => e
      ),
      'claude CLI'
    )
  })

  it('codex', async () => {
    const { CodexAdapter } = await import('./codex')
    const gen = new CodexAdapter().send([{ role: 'user', content: 'travaille' }], {
      signal: coupe(),
      execution: { cwd: process.cwd(), sandbox: 'read-only' }
    } as never)
    verifier(
      await gen.next().then(
        () => undefined,
        (e: unknown) => e
      ),
      'codex exec'
    )
  })
})
