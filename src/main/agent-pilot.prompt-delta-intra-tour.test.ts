import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * LE FIL N'EST PAS REPAYÉ À CHAQUE ITÉRATION D'UN MÊME TOUR.
 *
 * Mesuré le 2026-08-31 sur conv-1 : le livrable d'une phase `frame` (≈ 6 000 caractères, plus
 * « 6106 caractères de plus » annoncés) réapparaissait VERBATIM à chaque itération suivante du même
 * tour — cinq fois — alors que sa conclusion utile tenait en cinq lignes.
 *
 * La cause n'est pas la taille du livrable mais la RÉPÉTITION : `convo` était rejoint en entier à
 * chaque appel, y compris quand l'appel REPREND la session du provider, laquelle porte déjà tous
 * les segments précédents. On n'envoie donc que les segments NOUVEAUX quand la session est
 * réellement reprise — et le fil ENTIER dès qu'elle ne l'est pas (le repli reste sûr).
 */
type Captured = { options: SendOptions; content: string }

function pilot(captured: Captured[], honoursResume: boolean) {
  let appel = 0
  const registry = {
    send: vi.fn(
      async (_p: string, messages: Message[], options: SendOptions): Promise<SendResult> => {
        const content = messages.at(-1)?.content ?? ''
        captured.push({ options, content })
        appel += 1
        return {
          text: content.includes('RÉSULTATS')
            ? 'Conclusion écrite pour l’utilisateur.'
            : '<cmd>{"name":"get_state","args":{}}</cmd>',
          sessionId: `sess-${appel}`
        } as SendResult
      }
    ),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => honoursResume)
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

const LIVRABLE = 'CADRAGE VERBATIM ' + 'x'.repeat(4_000)

describe('les itérations d’un tour ne réexpédient pas le fil déjà envoyé', () => {
  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-promptdelta-')))
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
  })

  it('sous reprise de session, la 2e itération ne renvoie PAS le livrable déjà payé', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, true)
    await p.chat(
      [
        { role: 'user', content: 'cadre le besoin' },
        { role: 'assistant', content: LIVRABLE },
        { role: 'user', content: 'et maintenant ?' }
      ] as Message[],
      () => {},
      undefined,
      4,
      'conv-delta'
    )

    expect(captured.length).toBeGreaterThanOrEqual(2)
    // La 2e itération reprend bien la session ouverte par la 1re.
    expect(captured[1].options.resumeSessionId).toBe('sess-1')
    // Elle porte les RÉSULTATS neufs…
    expect(captured[1].content).toContain('RÉSULTATS')
    // …mais plus le fil déjà expédié.
    expect(captured[1].content).not.toContain('CADRAGE VERBATIM')
    expect(captured[1].content.length).toBeLessThan(captured[0].content.length)
  })

  it('sans reprise de session, le fil ENTIER repart — le repli reste sûr', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, false)
    await p.chat(
      [
        { role: 'user', content: 'cadre le besoin' },
        { role: 'assistant', content: LIVRABLE },
        { role: 'user', content: 'et maintenant ?' }
      ] as Message[],
      () => {},
      undefined,
      4,
      'conv-delta-2'
    )

    expect(captured.length).toBeGreaterThanOrEqual(2)
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('CADRAGE VERBATIM')
  })
})
