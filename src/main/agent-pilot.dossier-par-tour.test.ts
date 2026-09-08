import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { Message, SendOptions, SendResult } from './providers/types'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'

/**
 * LE DOSSIER DE TRAVAIL N'EST PLUS GLOBAL (2026-09-08).
 *
 * Il etait fige au demarrage dans une variable de process : deux conversations rangees dans deux
 * projets differents travaillaient dans le MEME dossier, et le seul moyen d'aligner etait un
 * redemarrage de l'app. Le dossier est desormais RESOLU par tour depuis la conversation courante et
 * PASSE au provider (`workspaceCwd`) — la meme valeur devant servir a la cle de session, sinon le CLI
 * reclame la session depuis un autre dossier et le tour meurt a 0 message (conv-48, 2026-09-06).
 */
type Captured = { options: SendOptions; content: string }

function pilot(captured: Captured[], dossierParConversation: Record<string, string>) {
  const registry = {
    send: vi.fn(
      async (_p: string, messages: Message[], options: SendOptions): Promise<SendResult> => {
        captured.push({ options, content: messages.at(-1)?.content ?? '' })
        return { text: 'ok', sessionId: 'sess-1' } as SendResult
      }
    ),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => []),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn()
  }
  const dossier = (conversationId?: string): string =>
    (conversationId ? dossierParConversation[conversationId] : undefined) ?? ''
  return new AgentPilot(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roles as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bus as any,
    undefined,
    () => '',
    dossier
  )
}

const message = (texte: string): Message[] => [{ role: 'user', content: texte } as Message]

describe('chat() — le dossier de travail est resolu par tour', () => {
  const envInitial = process.env[AUTOWIN_WORKSPACE_ENV]
  const PROJET_A = resolve('/projets/rig')
  const PROJET_B = resolve('/projets/amitel')

  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-dossier-tour-')))
    process.env[AUTOWIN_WORKSPACE_ENV] = resolve('/depot/autowin')
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
    if (envInitial === undefined) delete process.env[AUTOWIN_WORKSPACE_ENV]
    else process.env[AUTOWIN_WORKSPACE_ENV] = envInitial
  })

  it('chaque conversation part dans SON dossier, pas dans le dossier global', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, { 'conv-A': PROJET_A, 'conv-B': PROJET_B })
    await p.chat(message('bonjour A'), () => {}, undefined, 1, 'conv-A')
    await p.chat(message('bonjour B'), () => {}, undefined, 1, 'conv-B')
    expect(captured[0].options.workspaceCwd).toBe(PROJET_A)
    expect(captured[1].options.workspaceCwd).toBe(PROJET_B)
  })

  it('deux conversations dans deux dossiers ne partagent PAS la session du CLI', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, { 'conv-A': PROJET_A, 'conv-A2': PROJET_A })
    await p.chat(message('t1'), () => {}, undefined, 1, 'conv-A')
    // Meme conversation, meme dossier : la reprise reste armee (discriminant du levier de cout).
    await p.chat(message('t2'), () => {}, undefined, 1, 'conv-A')
    expect(captured[1].options.resumeSessionId).toBe('sess-1')
  })

  it('conversation sans dossier range → repli sur le dossier global', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, {})
    await p.chat(message('bonjour'), () => {}, undefined, 1, 'conv-SANS')
    expect(captured[0].options.workspaceCwd).toBe(resolve('/depot/autowin'))
  })
})
