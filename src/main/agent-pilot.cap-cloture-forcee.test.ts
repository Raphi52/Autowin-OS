import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * LE CAP D'ITÉRATIONS TUAIT LE TOUR AU LIEU DE LE FAIRE CONCLURE.
 *
 * Mesuré (conv-1485) : « ⚠️ Le tour a échoué — Cap d'itérations (6) atteint sans réponse finale ».
 * Le modèle n'est JAMAIS averti qu'il arrive au bout : il continue d'agir, et le tour meurt sur une
 * erreur terminale qui jette le texte déjà dit. Le cap doit être RÉINJECTÉ comme consigne de
 * clôture forcée : à la dernière itération, l'agent est prévenu, il règle/rapporte l'erreur en
 * cours et conclut.
 *
 * ENTRÉE QUI FERAIT ÉCHOUER CE TEST SI LA CORRECTION ÉTAIT FAUSSE : un modèle qui n'émet JAMAIS de
 * réponse finale (ici, une commande à chaque itération). Si la consigne n'était injectée qu'au
 * hasard d'un chemin de recovery, ou si le repli terminal restait un `error`, ces cas resteraient
 * rouges.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const harnais = (
  reponses: string[]
): {
  pilot: AgentPilot
  send: ReturnType<typeof vi.fn>
  events: PilotEvent[]
} => {
  const send = vi.fn(async (_p: unknown, _m: unknown) => ({
    text: reponses.shift() ?? '<cmd>{"name":"noop","args":{}}</cmd>',
    provider: 'claude'
  }))
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'claude',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const roles = {
    getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
  }
  const bus = {
    catalog: () => [{ name: 'noop', args: {}, description: 'sans effet' }],
    snapshotForPrompt,
    exec: vi.fn().mockResolvedValue({ ok: false, error: 'échec simulé' })
  }
  const events: PilotEvent[] = []
  return {
    pilot: new AgentPilot(registry as never, roles as never, bus as never),
    send,
    events
  }
}

const contenu = (send: ReturnType<typeof vi.fn>, appel: number): string =>
  String((send.mock.calls[appel]?.[1] as Array<{ content: string }>)[0].content)

describe('cap d’itérations — consigne de clôture forcée', () => {
  it('avertit le modèle à la DERNIÈRE itération, pas avant', async () => {
    const h = harnais([])
    // Le tour MEURT (le modèle ne conclut jamais) : ce test inspecte les PROMPTS envoyés.
    await expect(
      h.pilot.chat(
      [{ role: 'user', content: 'répare le module de facturation' }],
      (e) => h.events.push(e),
      undefined,
      3,
      'conv-cap-consigne'
    )
    ).rejects.toThrow(/Cap d/)
    expect(h.send.mock.calls.length).toBeGreaterThanOrEqual(3)
    const dernier = contenu(h.send, h.send.mock.calls.length - 1)
    expect(dernier).toContain('DERNIÈRE ITÉRATION')
    expect(contenu(h.send, 0)).not.toContain('DERNIÈRE ITÉRATION')
  })

  it('la consigne exige de régler/rapporter l’erreur puis de conclure sans nouvelle commande', async () => {
    const h = harnais([])
    // Le tour MEURT (le modèle ne conclut jamais) : ce test inspecte les PROMPTS envoyés.
    await expect(
      h.pilot.chat(
      [{ role: 'user', content: 'répare le module de facturation' }],
      (e) => h.events.push(e),
      undefined,
      3,
      'conv-cap-consigne-2'
    )
    ).rejects.toThrow(/Cap d/)
    const dernier = contenu(h.send, h.send.mock.calls.length - 1)
    expect(dernier).toMatch(/n['’]émets plus (aucune|de) commande/i)
    expect(dernier).toMatch(/erreur/i)
  })

  it('ne meurt plus sur le cap quand le modèle a parlé : le texte dit devient la clôture', async () => {
    const h = harnais([
      '<cmd>{"name":"noop","args":{}}</cmd>',
      'La correction est posée, mais l’outil a échoué.<cmd>{"name":"noop","args":{}}</cmd>',
      'Bilan : l’outil noop échoue, rien n’est appliqué.<cmd>{"name":"noop","args":{}}</cmd>'
    ])
    await h.pilot.chat(
      [{ role: 'user', content: 'répare le module de facturation' }],
      (e) => h.events.push(e),
      undefined,
      3,
      'conv-cap-cloture'
    )
    const dernier = h.events.at(-1)
    expect(dernier?.kind).toBe('done')
    expect(String((dernier as { text?: string }).text)).toContain('Bilan')
    expect(h.events.some((e) => e.kind === 'error')).toBe(false)
  })
})
