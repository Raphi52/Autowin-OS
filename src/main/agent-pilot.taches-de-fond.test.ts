import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAutowinAppDataBase } from './app-data'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * LE TOUR DE CHAT RECOIT LES COMMANDES DE FOND COUPEES, POUR LES RELANCER.
 *
 * Chaîne : le provider les met dans `SendResult.tachesDeFondARelancer` SEULEMENT si l'appelant a
 * annoncé `relancerTachesDeFond` ; le pilote d'une conversation l'annonce et émet `taches-de-fond` ;
 * `run-pilot-chat.ts` le transmet à `relancerTachesDeFond` (câblé dans index.ts).
 */
const CLOTURE = '✅ Fait.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'

function pilot(resultat: Partial<SendResult>) {
  const options: SendOptions[] = []
  const registry = {
    send: vi.fn(async (_p: string, _m: Message[], o: SendOptions): Promise<SendResult> => {
      options.push(o)
      return { text: CLOTURE, sessionId: 'sess', ...resultat } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => []),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true }))
  }
  const events: PilotEvent[] = []
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: new AgentPilot(registry as any, roles as any, bus as any),
    events,
    options,
    onEvent: (e: PilotEvent) => events.push(e)
  }
}

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'taches-fond-pilote-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

const historique: Message[] = [{ role: 'user', content: 'lance les tests' }]
const coupee = { id: 'b1', commande: 'npx vitest run', cwd: 'C:/depot' }

describe('pilote — commandes de fond coupées en fin de tour', () => {
  it('un tour de conversation annonce qu’il sait relancer, et émet les commandes coupées', async () => {
    const { p, events, options, onEvent } = pilot({ tachesDeFondARelancer: [coupee] })
    await p.chat(historique, onEvent, undefined, 4, 'conv-7')
    expect(options[0].relancerTachesDeFond).toBe(true)
    const emis = events.filter((e) => e.kind === 'taches-de-fond')
    expect(emis).toHaveLength(1)
    expect(emis[0].data).toEqual([coupee])
  })

  it('jumeau — sans conversation, rien n’est promis ni émis', async () => {
    const { p, events, options, onEvent } = pilot({ tachesDeFondARelancer: [coupee] })
    await p.chat(historique, onEvent, undefined, 4)
    expect(options[0].relancerTachesDeFond).toBeUndefined()
    expect(events.some((e) => e.kind === 'taches-de-fond')).toBe(false)
  })

  it('cas 1 — aucune commande coupée : aucun évènement', async () => {
    const { p, events, onEvent } = pilot({})
    await p.chat(historique, onEvent, undefined, 4, 'conv-7')
    expect(events.some((e) => e.kind === 'taches-de-fond')).toBe(false)
  })
})

describe('câblage — le tour de chat relance, index.ts ouvre le tour de reprise', () => {
  const chat = readFileSync(join(__dirname, 'chat', 'run-pilot-chat.ts'), 'utf8')
  const index = readFileSync(join(__dirname, 'index.ts'), 'utf8')

  it('run-pilot-chat transmet `taches-de-fond` à la relance', () => {
    expect(chat).toMatch(
      /pilotEvent\.kind === 'taches-de-fond'[\s\S]{0,400}deps\.relancerTachesDeFond\(conversationId/
    )
  })

  it('index.ts branche la relance et reprend les lots au démarrage', () => {
    expect(index).toMatch(/relancerTachesDeFond: \(conversationId, taches\) =>/)
    expect(index).toContain('const relanceurTachesDeFond = creerRelanceurSurDisque(')
    expect(index).toContain('relanceTachesDeFond.relanceur = relanceurTachesDeFond')
    expect(index).toMatch(/relanceurTachesDeFond\s*\.reprendreAuDemarrage\(\)/)
    // Le tour de reprise passe HORS du devis du tour appelant, comme chat_send (conv-53 -> conv-93).
    const bloc = index.slice(index.indexOf('relanceurTachesDeFond = creerRelanceurSurDisque('))
    expect(bloc.slice(0, 800)).toMatch(
      /runOutsideCurrent\(\(\) =>\s*scheduledChatRuntime\.runPrompt\(conversationId, prompt\)/
    )
    // Le fil occupé (message de l'utilisateur en cours) fait attendre la reprise.
    expect(bloc.slice(0, 800)).toContain('activeChatTurns.isInFlight(conversationId)')
  })
})
