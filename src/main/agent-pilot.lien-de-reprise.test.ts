import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const registryFixture = (responses: string[]): unknown => ({
  send: vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'codex' })),
  describePrompt: () => ({
    provider: 'codex',
    transport: 'fixture',
    messages: [],
    options: {},
    limitation: 'test'
  })
})

const jouer = async (responses: string[], exec: unknown): Promise<PilotEvent[]> => {
  const events: PilotEvent[] = []
  await new AgentPilot(
    registryFixture(responses) as never,
    { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
    {
      catalog: () => [{ name: 'edit_file', args: {}, description: 'edite' }],
      snapshotForPrompt,
      exec
    } as never
  ).chat([{ role: 'user', content: 'corrige' }], (event) => events.push(event))
  return events
}

describe('lien entre une action echouee et celle qui la rattrape', () => {
  it('marque la seconde tentative avec l actionId de l echec', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'copie de travail bloquee' })
      .mockResolvedValueOnce({ ok: true, data: 'ecrit' })
    const events = await jouer(
      [
        '<cmd>{"name":"edit_file","args":{"path":"a.ts"}}</cmd>',
        '<cmd>{"name":"edit_file","args":{"path":"a.ts"}}</cmd>',
        'Corrige.'
      ],
      exec
    )
    const echec = events.find((e) => e.kind === 'result' && e.ok === false)
    const commandes = events.filter((e) => e.kind === 'command')
    expect(echec?.actionId).toBeTruthy()
    expect(commandes).toHaveLength(2)
    expect(commandes[0].repriseProbableDe).toBeUndefined()
    expect(commandes[1].repriseProbableDe).toBe(echec?.actionId)
  })

  it('ne marque rien quand aucune action n a echoue', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true, data: 'ecrit' })
    const events = await jouer(
      [
        '<cmd>{"name":"edit_file","args":{"path":"a.ts"}}</cmd>',
        '<cmd>{"name":"edit_file","args":{"path":"b.ts"}}</cmd>',
        'Fait.'
      ],
      exec
    )
    for (const commande of events.filter((e) => e.kind === 'command'))
      expect(commande.repriseProbableDe).toBeUndefined()
  })
})

describe('la cible compte autant que le nom', () => {
  it('ne lie pas un echec sur a.ts a une action sur b.ts', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'copie de travail bloquee' })
      .mockResolvedValueOnce({ ok: true, data: 'ecrit' })
    const events = await jouer(
      [
        '<cmd>{"name":"edit_file","args":{"path":"a.ts"}}</cmd>',
        '<cmd>{"name":"edit_file","args":{"path":"b.ts"}}</cmd>',
        'Fait.'
      ],
      exec
    )
    const commandes = events.filter((e) => e.kind === 'command')
    expect(commandes).toHaveLength(2)
    // a.ts a echoue et n'a JAMAIS ete repris : la ligne sur b.ts ne doit rien affirmer.
    expect(commandes[1].repriseProbableDe).toBeUndefined()
  })

  it('un echec abandonne ne recoit aucun lien entrant', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: false, error: 'refuse' })
    const events = await jouer(['<cmd>{"name":"edit_file","args":{"path":"a.ts"}}</cmd>', 'Abandon.'], exec)
    const echec = events.find((e) => e.kind === 'result' && e.ok === false)
    expect(echec?.actionId).toBeTruthy()
    const liens = events.filter((e) => e.kind === 'command' && e.repriseProbableDe === echec?.actionId)
    expect(liens).toHaveLength(0)
  })
})
