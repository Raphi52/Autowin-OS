import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * DEFAUT VECU le 2026-09-06 (conv-312). Un appel `retrospective` a injecte 2 860 957 caracteres
 * dans le prompt ; le fournisseur a repondu « Prompt is too long ». Le tour SUIVANT ne pesait que
 * 65 k caracteres et echouait a l'identique : il reprenait la MEME session (`--resume`), qui porte
 * encore le prompt geant cote fournisseur. Le fil devenait un CUL-DE-SAC — plus aucun message ne
 * pouvait y passer, et chaque relance rejouait l'echec.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE CORRECTIF EST FAUX : retenter en gardant
 * `resumeSessionId` (le second appel porterait encore la session), ou abandonner la session sans
 * retenter (aucun second appel).
 */
type Captured = { options: SendOptions }

function pilot(captured: Captured[], sessionParAppel: Array<string | null>) {
  let appel = 0
  const registry = {
    send: vi.fn(
      async (_p: string, _messages: Message[], options: SendOptions): Promise<SendResult> => {
        captured.push({ options: { ...options } })
        const rang = appel++
        // Le 1er appel du 2e tour (rang 1) explose : c'est la session reprise qui est trop lourde.
        if (rang === 1) throw new Error('Claude a interrompu l appel : Prompt is too long')
        const sessionId = sessionParAppel[Math.min(rang, sessionParAppel.length - 1)]
        return { text: 'voila la reponse', ...(sessionId ? { sessionId } : {}) } as SendResult
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

describe('chat() — une session devenue trop longue est ABANDONNEE, pas rejouee', () => {
  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-troplong-')))
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
  })

  it('retente SANS reprise apres « Prompt is too long », et le tour aboutit', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, ['sess-1', null, 'sess-2'])
    await p.chat(history('bonjour'), () => {}, undefined, 4, 'conv-T')
    captured.length = 0

    const sortie: string[] = []
    await p.chat(
      history('bonjour', 'ma reponse', 'et maintenant ?'),
      (e) => {
        if (e.kind === 'done') sortie.push(e.text ?? '')
      },
      undefined,
      4,
      'conv-T'
    )

    expect(captured.length).toBeGreaterThanOrEqual(2)
    expect(captured[0].options.resumeSessionId).toBe('sess-1')
    // LE CORRECTIF : le second essai part A BLANC — sinon on rejoue le prompt qui vient d'exploser.
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(sortie.join('')).toContain('voila la reponse')
  })

  it('oublie la session pour les tours suivants', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, ['sess-1', null, null])
    await p.chat(history('bonjour'), () => {}, undefined, 4, 'conv-T')
    await p.chat(history('bonjour', 'r', 'suite'), () => {}, undefined, 4, 'conv-T')
    captured.length = 0
    await p.chat(history('bonjour', 'r', 'suite', 'r2', 'encore'), () => {}, undefined, 4, 'conv-T')
    // La session empoisonnee ne doit plus JAMAIS etre reprise.
    expect(captured[0].options.resumeSessionId).toBeUndefined()
  })
})
