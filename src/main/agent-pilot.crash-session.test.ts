import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import { ProviderCallError } from './providers/types'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * CE QUE MONTRE LA CAPTURE DE conv-625 (demande utilisateur du 2026-09-16, tour
 * `2fbc8f95-6a5d-4fd4-821c-7af5a197303a`) : un tour meurt sur « You've hit your session limit ·
 * resets 10:30pm », le MEME prompt renvoye juste apres meurt en
 * « Claude a interrompu l'appel : error_during_execution · 0.0000 USD » — alors que la barre de
 * quotas affiche 94 % de restant sur le compte actif. Rien n'est consomme, donc rien n'a ete
 * refuse pour cause de quota : c'est la session CLI reprise (`--resume`) qui n'est plus ouvrable
 * (session jamais close par le mur, ou rangee ailleurs). Le rejeu repartait avec EXACTEMENT le
 * meme `resumeSessionId` et remourait a l'identique — refaire la meme chose en attendant un autre
 * resultat. La session heritee d'un tour PRECEDENT doit donc etre lachee avant le rejeu, comme
 * elle l'est deja pour « Prompt is too long ».
 */
const CRASH = () =>
  new ProviderCallError("Claude a interrompu l'appel : error_during_execution · 0.0000 USD", {
    code: 'error_during_execution',
    retryable: true
  })

function pilotAvecCrash(captured: SendOptions[], crashes: number) {
  let restants = crashes
  const registry = {
    send: vi.fn(async (_p: string, _m: Message[], o: SendOptions): Promise<SendResult> => {
      captured.push({ ...o })
      if (restants > 0) {
        restants -= 1
        throw CRASH()
      }
      return { text: 'ok', sessionId: 'sess-1' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = { catalog: vi.fn(() => []), snapshotForPrompt: vi.fn(async () => ({})), exec: vi.fn() }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AgentPilot(registry as any, roles as any, bus as any)
}

const history = (...turns: string[]): Message[] =>
  turns.map(
    (content, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content }) as Message
  )

/** Horloge REELLE, prise avant `useFakeTimers` : les lectures git du tour avancent en vrai. */
const vraiSetTimeout = globalThis.setTimeout
async function jusquAuBout<T>(tour: Promise<T>): Promise<T> {
  let fini = false
  void tour.finally(() => (fini = true)).catch(() => undefined)
  for (let i = 0; i < 400 && !fini; i++) {
    await vi.advanceTimersByTimeAsync(10_000)
    await new Promise((r) => vraiSetTimeout(r, 5))
  }
  return tour
}

describe('chat() — crash d execution a 0 token sur une session reprise', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-crashsess-')))
  })
  afterEach(() => {
    vi.useRealTimers()
    configureAutowinAppDataBase(undefined)
  })

  it('LACHE la session heritee avant le rejeu (le 2e essai ne refait pas le premier)', async () => {
    const captured: SendOptions[] = []
    const p = pilotAvecCrash(captured, 0)
    await jusquAuBout(p.chat(history('tour 1'), () => {}, undefined, 1, 'conv-A'))
    expect(captured[0].resumeSessionId).toBeUndefined()

    const p2 = pilotAvecCrash(captured, 1)
    const encours = p2.chat(
      history('tour 1', 'ok', 'tour 2'),
      () => {},
      undefined,
      1,
      'conv-A'
    )
    // Le tour fait de VRAIES lectures git (capture avant/apres du dossier, 2026-09-23) : l'attente
    // de rejeu peut s'armer APRES un premier saut d'horloge. On avance donc jusqu'a la fin du tour.
    await jusquAuBout(encours)

    // 2e appel du tour 2 = le rejeu : il ne doit PLUS reclamer la session qui vient de casser.
    expect(captured).toHaveLength(3)
    expect(captured[1].resumeSessionId).toBe('sess-1')
    expect(captured[2].resumeSessionId).toBeUndefined()
  })
})
