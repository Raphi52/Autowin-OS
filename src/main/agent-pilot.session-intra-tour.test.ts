import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { Message, SendOptions, SendResult, StreamChunk } from './providers/types'

/**
 * DEFAUT VECU le 2026-08-28 (conv-1498, diagnostique en conv-1502). L'agent avait lui-meme propose
 * une variante « 5A » deux tours plus tot ; a « je veux le 5A », il a repondu « 5A ne correspond a
 * rien dans les 961 conversations ». Amnesie au sein d'un MEME tour.
 *
 * Cause racine, lue dans `agent-pilot.ts` : `resumeSessionId` est une const capturee AVANT la boucle
 * d'iterations et n'est passee qu'a `i === 0`. Or le message `convo` est construit UNE fois, et sous
 * reprise de session `buildTurnMessages` l'ampute volontairement de tout l'historique (il vit dans la
 * session CLI). Consequence : des la 2e iteration — celle qui suit un appel d'outil, donc celle qui
 * REDIGE la reponse finale — l'appel part SANS `--resume`, vers une session VIERGE, avec un message
 * deja ampute. Le modele qui conclut n'a jamais vu le fil.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE CORRECTIF EST FAUX : armer `resumeSessionId` a chaque
 * iteration sans le mettre a jour depuis la session REELLEMENT ouverte ferait reprendre une session
 * perimee — le 2e test le verrouille en changeant le sessionId rendu entre les deux appels.
 */
type Captured = { options: SendOptions; content: string }

function pilot(captured: Captured[], sessionIds: Array<string | null>) {
  let appel = 0
  const registry = {
    send: vi.fn(
      async (
        _provider: string,
        messages: Message[],
        options: SendOptions,
        _onChunk?: (c: StreamChunk) => void
      ): Promise<SendResult> => {
        captured.push({ options, content: messages.at(-1)?.content ?? '' })
        const rang = appel++
        const sessionId = sessionIds[Math.min(rang, sessionIds.length - 1)]
        // Le PREMIER appel de CHAQUE tour emet une commande : c'est ce qui force une 2e iteration.
        // Repere : une iteration de suite porte les RESULTATS de la commande precedente.
        const suite = (messages.at(-1)?.content ?? '').includes('RÉSULTATS')
        const text = suite ? 'voila la reponse' : '<cmd>{"name":"get_state","args":{}}</cmd>'
        return { text, ...(sessionId ? { sessionId } : {}) } as SendResult
      }
    ),
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

const history = (...turns: string[]): Message[] =>
  turns.map(
    (content, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content }) as Message
  )

describe('chat() — la session survit AUX ITERATIONS du meme tour', () => {
  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-sessintra-')))
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
  })

  it('l iteration qui suit un appel d outil REPREND la session ouverte par la precedente', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, ['sess-1'])
    // Tour 1 : ouvre la session (une seule iteration, aucune commande au 2e appel).
    await p.chat(history('bonjour'), () => {}, undefined, 4, 'conv-A')
    captured.length = 0
    // Tour 2 : reprend sess-1, puis appelle un outil -> 2e iteration.
    await p.chat(history('bonjour', 'ma reponse', 'et le 5A ?'), () => {}, undefined, 4, 'conv-A')

    expect(captured.length).toBeGreaterThanOrEqual(2)
    expect(captured[0].options.resumeSessionId).toBe('sess-1')
    // LE DEFAUT : la 2e iteration partait sans reprise, vers une session vierge, avec un message
    // deja ampute de tout l'historique.
    expect(captured[1].options.resumeSessionId).toBe('sess-1')
  })

  it('reprend la session REELLEMENT ouverte, pas celle du debut du tour', async () => {
    const captured: Captured[] = []
    /*
     * Le tour 1 consomme les rangs 0-1, le tour 2 les rangs 2-3. La session change AU SEIN du tour
     * 2 : son 1er appel rend `sess-2`. Le 2e appel doit donc reprendre `sess-2` — et non `sess-1`,
     * qui etait l'etat au DEBUT du tour. C'est ce qui distingue « je propage la valeur figee du
     * debut de tour » de « je reprends la session reellement ouverte ».
     */
    const p = pilot(captured, ['sess-1', 'sess-1', 'sess-2', 'sess-2'])
    await p.chat(history('bonjour'), () => {}, undefined, 4, 'conv-A')
    captured.length = 0
    await p.chat(history('bonjour', 'r', 'suite'), () => {}, undefined, 4, 'conv-A')

    expect(captured[0].options.resumeSessionId).toBe('sess-1')
    expect(captured[1].options.resumeSessionId).toBe('sess-2')
  })
})
