import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { shouldPersistClosingText } from './runs/turn-closing'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('verite visible des actions', () => {
  it('affiche verify en echec quand son resultat metier est rouge', async () => {
    const responses = [
      '<cmd>{"name":"verify","args":{}}</cmd>',
      'Les tests echouent, je ne declare pas la tache terminee.'
    ]
    const registry = {
      send: vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'codex' })),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [{ name: 'verify', args: {}, description: 'test' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: { allowed: true, ok: false, exitCode: 1, output: '2 tests failed' }
      })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
    ).chat([{ role: 'user', content: 'verifie la suite' }], (event) => events.push(event))

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'result',
        name: 'verify',
        ok: false,
        data: expect.objectContaining({ ok: false, exitCode: 1 })
      })
    )
  })

  it('conserve la cloture d un orchestrate en erreur meme apres un preambule streame', async () => {
    const registry = {
      send: vi.fn(async () => ({
        text: 'Je lance le workflow.\n<cmd>{"name":"orchestrate","args":{"task":"corrige"}}</cmd>',
        provider: 'codex'
      })),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'transport indisponible' })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
    ).chat([{ role: 'user', content: 'corrige tout' }], (event) => events.push(event))

    const done = events.find((event) => event.kind === 'done')
    expect(done).toMatchObject({
      kind: 'done',
      outcome: { status: 'failed', error: 'transport indisponible' }
    })
    expect(done?.text).toContain('transport indisponible')
    expect(
      shouldPersistClosingText(true, done?.kind === 'done' ? done.outcome : undefined)
    ).toBe(true)
  })
})
