import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import {
  claudeCompteDuFil,
  configureClaudeActiveAccountId,
  configureClaudeCompteDuFil
} from './claude-accounts'
import { ProviderRegistry } from './providers/registry'
import {
  ProviderCallError,
  type Message,
  type ProviderAdapter,
  type SendOptions,
  type SendResult,
  type StreamChunk
} from './providers/types'

/**
 * UN FIL AU COMPTE CHOISI GARDE CE COMPTE D'UN BOUT À L'AUTRE DU TOUR (conv-1416, 2026-11-01).
 *
 * Câblé sur le VRAI `ProviderRegistry` : c'est la jonction registre → tour qui compte. Le compte
 * actif de l'application bouge sous le fil (un autre fil tourne, ou un compte tombe) : le fil choisi
 * ne doit ni perdre sa session, ni changer de compte, ni repartir tout seul.
 */
type Appel = { options: SendOptions; contenu: string }

const COMPTES = { 'conv-Q': { id: 'pro', nom: 'Compte pro', env: {} } }

function monter(
  reponse: (rang: number) => SendResult | Error,
  etat: { actif: string; rotations: number }
): { pilote: AgentPilot; appels: Appel[] } {
  const appels: Appel[] = []
  const claude: ProviderAdapter = {
    id: 'claude',
    honoursSessionResume: true,
    async auth() {
      return true
    },
    async *send(messages: Message[], options: SendOptions = {}) {
      appels.push({ options: { ...options }, contenu: messages[0]?.content ?? '' })
      const issue = reponse(appels.length - 1)
      if (issue instanceof Error) {
        yield { delta: 'Je commence le travail…' } as StreamChunk
        throw issue
      }
      return issue
    }
  }
  const registry = new ProviderRegistry(
    undefined,
    undefined,
    () => etat.actif,
    (_provider, mure) => {
      etat.rotations += 1
      etat.actif = mure === 'gmail' ? 'autre' : 'gmail'
      return etat.actif
    },
    (_provider, fil) => claudeCompteDuFil(fil)
  ).register(claude)
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', description: 'etat', args: {} }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilote: new AgentPilot(registry, roles as any, bus as any), appels }
}

const fil = (...tours: string[]): Message[] =>
  tours.map(
    (content, rang) => ({ role: rang % 2 === 0 ? 'user' : 'assistant', content }) as Message
  )

const OK = (sessionId: string): SendResult =>
  ({ text: 'voila la reponse', provider: 'claude', systemInjected: false, sessionId }) as SendResult

describe('chat() — fil au compte choisi', () => {
  let etat: { actif: string; rotations: number }

  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-compte-du-fil-')))
    etat = { actif: 'gmail', rotations: 0 }
    configureClaudeActiveAccountId(() => etat.actif)
    configureClaudeCompteDuFil((id) => COMPTES[id as keyof typeof COMPTES])
  })
  afterEach(() => {
    configureClaudeActiveAccountId(() => undefined)
    configureClaudeCompteDuFil(() => undefined)
    configureAutowinAppDataBase(undefined)
  })

  it('le compte actif change entre deux tours : le fil garde sa session, car son compte n’a pas bougé', async () => {
    await monter(() => OK('sess-pro'), etat).pilote.chat(
      fil('bonjour'),
      () => {},
      undefined,
      1,
      'conv-Q'
    )

    etat.actif = 'autre'
    const { pilote, appels } = monter(() => OK('sess-pro'), etat)
    await pilote.chat(fil('bonjour', 'r', 'suite'), () => {}, undefined, 1, 'conv-Q')

    expect(appels[0]!.options.resumeSessionId).toBe('sess-pro')
  })

  it('compte actif changé PENDANT le tour : la session n’est pas lâchée', async () => {
    const { pilote, appels } = monter((rang) => {
      if (rang === 0) {
        etat.actif = 'autre'
        return {
          ...OK('sess-pro'),
          text: '<cmd>{"name":"get_state","args":{}}</cmd>'
        } as SendResult
      }
      return OK('sess-pro')
    }, etat)

    await pilote.chat(fil('regarde l etat'), () => {}, undefined, 4, 'conv-Q')

    expect(appels.length).toBeGreaterThanOrEqual(2)
    expect(appels[1]!.options.resumeSessionId).toBe('sess-pro')
  })

  it('quota épuisé en plein tour : aucun rejeu, et le fil dit pourquoi il s’arrête', async () => {
    const { pilote, appels } = monter(
      () =>
        new ProviderCallError(
          "Claude a interrompu l'appel : You've hit your weekly limit · resets Nov 3, 1am (Europe/Paris)",
          { code: 'success', retryable: false }
        ),
      etat
    )
    const evenements: PilotEvent[] = []

    const issue = await pilote
      .chat(fil('bonjour'), (e) => evenements.push(e), undefined, 1, 'conv-Q')
      .catch((e: Error) => e)

    expect(appels).toHaveLength(1)
    expect(etat.rotations).toBe(0)
    expect(evenements.some((e) => e.kind === 'retry')).toBe(false)
    expect(JSON.stringify([issue instanceof Error ? issue.message : issue, evenements])).toContain(
      '« Compte pro »'
    )
  })
})
