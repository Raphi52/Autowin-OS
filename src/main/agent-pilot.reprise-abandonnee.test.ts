import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import { ProviderCallError } from './providers/types'
import type { Message, SendOptions, SendResult } from './providers/types'
import { loadChatSessions } from './runs/chat-session-store'

/**
 * SESSION ABANDONNÉE = FIL ENTIER RENVOYÉ (audit du branchement Claude, conv-1040, 2026-10-21).
 *
 * Un tour qui REPREND une session n'envoie que la dernière demande : l'historique est censé vivre
 * dans la session du CLI (`buildTurnMessageBlocks`, branche reprise). Quand cette session est
 * abandonnée en cours de tour — « Prompt is too long », ou plantage du CLI à 0 jeton —, le nouvel
 * essai partait dans une session NEUVE avec ce même message amputé : aucun historique, et la phrase
 * « Ta session en porte normalement l'historique », fausse. Seule la branche « refus du filtre de
 * sécurité » reconstruisait le message.
 *
 * Et « Prompt is too long » n'oubliait la session qu'en mémoire : si le nouvel essai échouait aussi,
 * la session empoisonnée revenait au premier tour après un redémarrage de l'app.
 */
const PHRASE_REPRISE = 'Suite de NOTRE conversation'

type Appel = { options: SendOptions; contenu: string }
type Comportement = (rang: number) => SendResult | Error

function pilote(appels: Appel[], comportement: Comportement): AgentPilot {
  let rang = 0
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], options: SendOptions) => {
      appels.push({ options: { ...options }, contenu: messages[0]?.content ?? '' })
      const issue = comportement(rang++)
      if (issue instanceof Error) throw issue
      return issue
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', description: 'etat', args: {} }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AgentPilot(registry as any, roles as any, bus as any)
}

const fil = (...tours: string[]): Message[] =>
  tours.map(
    (content, rang) => ({ role: rang % 2 === 0 ? 'user' : 'assistant', content }) as Message
  )

const OK = (sessionId?: string): SendResult =>
  ({ text: 'voila la reponse', ...(sessionId ? { sessionId } : {}) }) as SendResult
const TROP_LONG = (): Error => new Error("Claude a interrompu l'appel : Prompt is too long")
const CRASH_0_JETON = (): Error =>
  new ProviderCallError("Claude a interrompu l'appel : error_during_execution · 0.0000 USD", {
    code: 'error_during_execution',
    retryable: true
  })

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

/** Premier tour : ouvre `sess-1` et la range (mémoire + disque) pour la conversation. */
async function premierTour(conv: string): Promise<void> {
  await jusquAuBout(
    pilote([], () => OK('sess-1')).chat(fil('bonjour'), () => {}, undefined, 1, conv)
  )
  expect(loadChatSessions()[conv]?.sessionId).toBe('sess-1')
}

describe('chat() — session abandonnée en cours de tour : le nouvel essai porte le fil entier', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-reprise-abandonnee-')))
  })
  afterEach(() => {
    vi.useRealTimers()
    configureAutowinAppDataBase(undefined)
  })

  for (const [cas, panne] of [
    ['« Prompt is too long »', TROP_LONG],
    ['plantage du CLI à 0 jeton', CRASH_0_JETON]
  ] as const) {
    it(`${cas} : l'essai sans reprise renvoie l'historique, pas le message amputé`, async () => {
      await premierTour('conv-R')
      const appels: Appel[] = []
      const p = pilote(appels, (rang) => (rang === 0 ? panne() : OK('sess-2')))
      await jusquAuBout(
        p.chat(fil('bonjour', 'ma reponse', 'et maintenant ?'), () => {}, undefined, 1, 'conv-R')
      )

      expect(appels).toHaveLength(2)
      // Le 1er appel reprend la session : message amputé, c'est voulu.
      expect(appels[0]!.options.resumeSessionId).toBe('sess-1')
      expect(appels[0]!.contenu).toContain(PHRASE_REPRISE)
      expect(appels[0]!.contenu).not.toContain('TOI: ma reponse')
      // Le nouvel essai part dans une session NEUVE : il doit porter tout le fil.
      expect(appels[1]!.options.resumeSessionId).toBeUndefined()
      expect(appels[1]!.contenu).toContain('TOI: ma reponse')
      expect(appels[1]!.contenu).toContain('et maintenant ?')
      expect(appels[1]!.contenu).not.toContain(PHRASE_REPRISE)
    })
  }

  it('« Prompt is too long » puis un second échec : la session est oubliée AUSSI sur le disque', async () => {
    await premierTour('conv-D')
    const p = pilote([], (rang) =>
      rang === 0
        ? TROP_LONG()
        : new ProviderCallError('panne definitive', { code: 'x', retryable: false })
    )
    await jusquAuBout(p.chat(fil('bonjour', 'r', 'suite'), () => {}, undefined, 1, 'conv-D')).catch(
      () => undefined
    )

    expect(loadChatSessions()['conv-D']).toBeUndefined()
    // Redémarrage de l'app : un pilote neuf relit le disque et ne doit pas reprendre la session morte.
    const apres: Appel[] = []
    await jusquAuBout(
      pilote(apres, () => OK('sess-3')).chat(
        fil('bonjour', 'r', 'suite', 'r2', 'encore'),
        () => {},
        undefined,
        1,
        'conv-D'
      )
    )
    expect(apres[0]!.options.resumeSessionId).toBeUndefined()
  })
})
