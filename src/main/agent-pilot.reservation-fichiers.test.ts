import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAutowinAppDataBase } from './app-data'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { confReservationFichiers } from './providers/claude'
import type { Message, SendOptions, SendResult } from './providers/types'

/*
 * LE FIL QUI ÉCRIT VOYAGE JUSQU'AU HOOK DES AGENTS (conv-1083, 2026-10-22).
 *
 * Chaîne : le tour de chat pose `conversationId` dans ses options → l'adaptateur Claude écrit
 * `reservation.json` (fil + registre) à côté du script de hook → le hook réserve ou refuse
 * (`shared/reservation-fichiers.ts`). Entrée qui ferait échouer ce banc si un maillon manquait : un
 * tour de `conv-7` dont les options ne portent pas `conv-7`.
 */
const CLOTURE = '✅ Fait.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'

function pilot() {
  const options: SendOptions[] = []
  const registry = {
    send: vi.fn(async (_p: string, _m: Message[], o: SendOptions): Promise<SendResult> => {
      options.push(o)
      return { text: CLOTURE, sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => []),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true }))
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: new AgentPilot(registry as any, roles as any, bus as any),
    options,
    onEvent: (e: PilotEvent) => void e
  }
}

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'reservation-pilote-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

const historique: Message[] = [{ role: 'user', content: 'corrige le bouton' }]

describe('le tour de chat nomme son fil pour la réservation des fichiers', () => {
  it('un tour de conv-7 porte conv-7 dans ses options', async () => {
    const { p, options, onEvent } = pilot()
    await p.chat(historique, onEvent, undefined, 4, 'conv-7')
    expect(options[0].conversationId).toBe('conv-7')
  })

  it('jumeau — sans conversation, aucun fil n’est inventé', async () => {
    const { p, options, onEvent } = pilot()
    await p.chat(historique, onEvent, undefined, 4)
    expect(options[0].conversationId).toBeUndefined()
  })
})

describe('confReservationFichiers — ce que le hook lit à côté de son script', () => {
  it('le fil du chat, sinon celui du run (AUTOWIN_CONVERSATION_ID), et un registre unique', () => {
    expect(confReservationFichiers({ conversationId: 'conv-7' }, 'D:/donnees')).toEqual({
      fil: 'conv-7',
      registre: join('D:/donnees', 'reservations-fichiers.json')
    })
    expect(
      confReservationFichiers(
        {
          execution: { agentEnv: { AUTOWIN_CONVERSATION_ID: 'conv-9' } }
        } as unknown as SendOptions,
        'D:/donnees'
      )?.fil
    ).toBe('conv-9')
  })

  it('sans fil connu, pas de fichier : le hook ne réserve rien', () => {
    expect(confReservationFichiers({}, 'D:/donnees')).toBeUndefined()
  })

  it('claude.ts écrit reservation.json À CÔTÉ du script de hook, hors du bloc qui retire les réglages', () => {
    const source = readFileSync(join(__dirname, 'providers', 'claude.ts'), 'utf8')
    expect(source).toMatch(
      /confReservationFichiers\(opts, autowinAppDataRoot\(\)\)[\s\S]{0,400}join\(settingsDir, 'reservation\.json'\)/
    )
  })
})
