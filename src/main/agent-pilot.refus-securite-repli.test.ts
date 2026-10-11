import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import { deciderRepliApresRefus } from './chat-rejeu-surcharge'
import { ProviderCallError } from './providers/types'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * Message REEL du tour `d9a2ca62-65b1-498d-ad32-32c45d4f3558` (conv-239, 2026-10-11 06:46) : appel
 * claude-opus-5-5 en reprise de session, facture 3,70 USD, et le fil s'arretait la. L'adaptateur le
 * rend NON rejouable (`retryable: false`) parce qu'il a ete facture.
 */
const MESSAGE_REFUS =
  "Claude a interrompu l'appel : API Error: Opus 5.5's safeguards flagged this message " +
  '(https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal conversations. ' +
  "Claude Code can't respond to this message with Opus 5.5.\n\n" +
  'Try rephrasing the request in a new session or change your model.\n\n' +
  'Details: `[reasoning_extraction]`'

const refus = (): ProviderCallError =>
  new ProviderCallError(MESSAGE_REFUS, { retryable: false, resolvedModel: 'claude-opus-5-5' })

interface Appel {
  model?: string
  resumeSessionId?: string
  contenu: string
}

/** Un fournisseur qui refuse les `controle.refus` prochains appels, puis repond. */
function pilote(model: string, appels: Appel[], controle: { refus: number }): AgentPilot {
  let sessions = 0
  const registry = {
    send: vi.fn(async (_p: string, m: Message[], o: SendOptions): Promise<SendResult> => {
      appels.push({
        ...(o.model ? { model: o.model } : {}),
        ...(o.resumeSessionId ? { resumeSessionId: o.resumeSessionId } : {}),
        contenu: String(m[0]?.content ?? '')
      })
      if (controle.refus > 0) {
        controle.refus -= 1
        throw refus()
      }
      sessions += 1
      return { text: 'Réponse livrée.', sessionId: `sess-${sessions}` } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model })) }
  const bus = {
    catalog: vi.fn(() => []),
    snapshotForPrompt: vi.fn(async () => ({})),
    exec: vi.fn()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AgentPilot(registry as any, roles as any, bus as any)
}

const fil = (...tours: string[]): Message[] =>
  tours.map(
    (content, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content }) as Message
  )

describe('deciderRepliApresRefus — la regle', () => {
  const base = { message: MESSAGE_REFUS, sessionHeriteeLachable: true, dejaTente: false }

  it('Opus refuse -> le Sonnet de la meme generation, session gardee', () => {
    expect(deciderRepliApresRefus({ ...base, modele: 'claude-opus-5-5' })).toEqual({
      mode: 'modele',
      modele: 'claude-sonnet-5-5'
    })
  })

  it('pas de modele voisin -> une session neuve, si la session heritee peut etre lachee', () => {
    expect(deciderRepliApresRefus({ ...base, modele: 'claude-sonnet-5-5' })).toEqual({
      mode: 'session'
    })
    expect(
      deciderRepliApresRefus({
        ...base,
        modele: 'claude-sonnet-5-5',
        sessionHeriteeLachable: false
      })
    ).toBeUndefined()
  })

  it('une seule fois par tour, et seulement pour un refus du filtre', () => {
    expect(
      deciderRepliApresRefus({ ...base, modele: 'claude-opus-5-5', dejaTente: true })
    ).toBeUndefined()
    expect(
      deciderRepliApresRefus({
        ...base,
        message: 'API Error: 500 Internal server error',
        modele: 'claude-opus-5-5'
      })
    ).toBeUndefined()
  })
})

describe('chat() — un refus « safeguards flagged » ne bloque plus le fil', () => {
  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-refus-repli-')))
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
  })

  it('Opus refuse : le tour est relance UNE fois sur Sonnet, dans la meme session, et aboutit', async () => {
    const appels: Appel[] = []
    const controle = { refus: 0 }
    const p = pilote('claude-opus-5-5', appels, controle)
    await p.chat(fil('tour 1'), () => {}, undefined, 1, 'conv-A')

    controle.refus = 1
    const events: PilotEvent[] = []
    await p.chat(
      fil('tour 1', 'Réponse livrée.', 'parfait met claude en full maj'),
      (e) => events.push(e),
      undefined,
      1,
      'conv-A'
    )

    expect(appels).toHaveLength(3)
    expect(appels[1]).toMatchObject({ model: 'claude-opus-5-5', resumeSessionId: 'sess-1' })
    expect(appels[2]).toMatchObject({ model: 'claude-sonnet-5-5', resumeSessionId: 'sess-1' })
    expect(events.find((e) => e.kind === 'done')?.text).toContain('Réponse livrée.')
    const relance = events.find((e) => e.kind === 'retry')
    expect(relance?.text).toContain('nouvel essai sur claude-sonnet-5-5')
    expect(relance?.data).toMatchObject({ repliApresRefus: 'modele', modele: 'claude-sonnet-5-5' })
  })

  it('sans modele voisin : session neuve, et le fil entier repart avec elle', async () => {
    const appels: Appel[] = []
    const controle = { refus: 0 }
    const p = pilote('claude-sonnet-5-5', appels, controle)
    await p.chat(fil('tour 1'), () => {}, undefined, 1, 'conv-B')

    controle.refus = 1
    const events: PilotEvent[] = []
    await p.chat(
      fil('tour 1', 'Échange précédent ZQX-42.', 'tour 2'),
      (e) => events.push(e),
      undefined,
      1,
      'conv-B'
    )

    expect(appels).toHaveLength(3)
    // L'appel refuse reprenait la session : son message ne portait pas l'historique.
    expect(appels[1].resumeSessionId).toBe('sess-1')
    expect(appels[1].contenu).not.toContain('ZQX-42')
    // Le repli lache la session ET renvoie le fil — sinon le modele repartirait sans contexte.
    expect(appels[2].resumeSessionId).toBeUndefined()
    expect(appels[2].model).toBe('claude-sonnet-5-5')
    expect(appels[2].contenu).toContain('TOI: Échange précédent ZQX-42.')
    expect(appels[2].contenu).toContain(
      'UTILISATEUR: <message_utilisateur>tour 2</message_utilisateur>'
    )
    expect(events.find((e) => e.kind === 'retry')?.data).toMatchObject({
      repliApresRefus: 'session'
    })
  })

  it('un second refus remonte : le repli ne se joue qu une fois', async () => {
    const appels: Appel[] = []
    const controle = { refus: 0 }
    const p = pilote('claude-opus-5-5', appels, controle)
    await p.chat(fil('tour 1'), () => {}, undefined, 1, 'conv-C')

    controle.refus = 5
    await expect(
      p.chat(fil('tour 1', 'Réponse livrée.', 'tour 2'), () => {}, undefined, 1, 'conv-C')
    ).rejects.toThrow(/safeguards flagged/)
    // tour 1 + l'appel refuse + UN seul repli
    expect(appels).toHaveLength(3)
  })
})
