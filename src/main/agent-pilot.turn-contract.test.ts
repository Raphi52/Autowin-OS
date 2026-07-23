import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

describe('AgentPilot turn contract', () => {
  it('passes the persisted authority mode from the real pilotChat IPC path', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    expect(source).toMatch(
      /pilot\.chat\([\s\S]*?conversationId,[\s\S]*?controller\.signal,[\s\S]*?authorityMode/
    )
  })

  it('journals the routed model and reasoning effort used by pilotChat', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    expect(source).toContain('turnPromptIdentity ??= {')
    const activityBlock = source.match(
      /appendConvActivity\(conversationId, \{[\s\S]*?kind: 'chat',[\s\S]*?\}\)/
    )?.[0]

    const normalizedActivityBlock = activityBlock?.replace(/\s+/g, ' ')
    expect(normalizedActivityBlock).toContain(
      'model: turnPromptIdentity?.model ?? orchestratorBinding.model'
    )
    expect(normalizedActivityBlock).toContain(
      'reasoningEffort: turnPromptIdentity?.reasoningEffort ?? orchestratorBinding.reasoningEffort'
    )
  })

  it('binds the conversation authority mode to every command in the turn', async () => {
    const responses = [
      '<cmd>{"name":"remove_conversation","args":{"id":"conv-1"}}</cmd>',
      'Refus confirmé'
    ]
    const registry = {
      send: vi
        .fn()
        .mockImplementation(async () => ({ text: responses.shift()!, provider: 'codex' })),
      describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'remove_conversation', args: { id: 'id' }, description: 'remove' }],
      snapshot: async () => ({}),
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'Action interdite en mode Plan' })
    }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'supprime' }],
      () => undefined,
      undefined,
      2,
      'conv-1',
      undefined,
      'plan'
    )

    expect(bus.exec).toHaveBeenCalledWith('remove_conversation', { id: 'conv-1' }, 'conv-1', 'plan')
  })

  it('injecte une directive utilisateur au prochain point d’itération du tour', async () => {
    const responses = ['<cmd>{"name":"get_state","args":{}}</cmd>', 'Terminé']
    const send = vi
      .fn()
      .mockImplementation(async () => ({ text: responses.shift()!, provider: 'codex' }))
    const registry = {
      send,
      describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const queue: string[] = []
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'état' }],
      snapshot: async () => ({}),
      // La directive arrive PENDANT l'itération 1 (l'utilisateur tape pendant que l'agent agit).
      exec: vi.fn().mockImplementation(async () => {
        queue.push('priorise le module X')
        return { ok: true, data: {} }
      })
    }
    const drain = (): string[] => queue.splice(0, queue.length)

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'go' }],
      () => undefined,
      undefined,
      6,
      'conv-1',
      undefined,
      'ask',
      drain
    )

    expect(send).toHaveBeenCalledTimes(2)
    const firstPrompt = (send.mock.calls[0][1] as Array<{ content: string }>)[0].content
    const secondPrompt = (send.mock.calls[1][1] as Array<{ content: string }>)[0].content
    expect(firstPrompt).not.toContain('DIRECTIVE INJECTÉE')
    expect(secondPrompt).toContain('DIRECTIVE INJECTÉE EN COURS DE TOUR')
    expect(secondPrompt).toContain('priorise le module X')
  })

  it('keeps the provider and model binding immutable for the whole chat turn', async () => {
    const responses = ['<cmd>{"name":"get_state","args":{}}</cmd>', 'RÃ©ponse finale']
    const send = vi.fn().mockImplementation(async () => ({
      text: responses.shift()!,
      provider: 'fixture'
    }))
    const describePrompt = vi.fn().mockReturnValue({
      provider: 'codex',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
    const initialBinding = {
      provider: 'codex',
      model: 'gpt-initial',
      reasoningEffort: 'low'
    }
    const mutatedBinding = {
      provider: 'native',
      model: 'model-mutated',
      reasoningEffort: 'high'
    }
    let bindingReadCount = 0
    const roles = {
      getBinding: vi.fn(() => (bindingReadCount++ === 0 ? initialBinding : mutatedBinding))
    }
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'state' }],
      snapshot: async () => ({}),
      exec: vi.fn().mockResolvedValue({ ok: true, data: {} })
    }

    await new AgentPilot({ send, describePrompt } as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      () => undefined
    )

    expect(roles.getBinding).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2)
    for (const call of send.mock.calls) {
      expect(call[0]).toBe('codex')
      expect(call[2]).toMatchObject({ model: 'gpt-initial', reasoningEffort: 'low' })
      expect(call[2].system).toMatch(/ne dis jamais que tu ne peux pas modifier le code/i)
      expect(call[2].system).toContain(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION)
    }
    for (const call of describePrompt.mock.calls) {
      expect(call[3]).toBe('gpt-initial')
    }

    const runSend = vi.fn().mockResolvedValue({ text: 'DONE: ok', provider: 'codex' })
    await new AgentPilot(
      { send: runSend } as never,
      { getBinding: () => initialBinding } as never,
      bus as never
    ).run('test', () => undefined)
    expect(runSend.mock.calls[0][2].system).toContain(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION)
  })

  it('injects Amitel Brain and Graphify evidence into the exact provider prompt', async () => {
    const send = vi.fn().mockResolvedValue({ text: 'Réponse finale', provider: 'codex' })
    const registry = {
      send,
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshot: async () => ({}) }
    const retrieveContext = vi.fn().mockResolvedValue(
      '[AMITEL BRAIN REFERENCE DATA]\nknowledge evidence\n\n' +
        '[GRAPHIFY CODE EVIDENCE]\nstructural evidence'
    )

    await new AgentPilot(
      registry as never,
      roles as never,
      bus as never,
      retrieveContext
    ).chat([{ role: 'user', content: 'Explique AgentPilot' }], () => undefined)

    expect(retrieveContext).toHaveBeenCalledOnce()
    expect(retrieveContext).toHaveBeenCalledWith('Explique AgentPilot')
    const system = send.mock.calls[0][2].system as string
    expect(system).toContain('[AMITEL BRAIN REFERENCE DATA]')
    expect(system).toContain('[GRAPHIFY CODE EVIDENCE]')
  })

  it('reports the iteration cap as an error terminal event, never as done', async () => {
    const registry = {
      send: vi.fn().mockResolvedValue({
        text: '<cmd>{"name":"get_state","args":{}}</cmd>',
        provider: 'codex'
      }),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'state' }],
      snapshot: async () => ({}),
      exec: vi.fn().mockResolvedValue({ ok: true, data: {} })
    }
    const events: PilotEvent[] = []

    await expect(
      new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'boucle' }],
        (event) => events.push(event),
        undefined,
        1
      )
    ).rejects.toThrow("Cap d'itérations (1) atteint sans réponse finale")

    expect(events.at(-1)?.kind).toBe('error')
    expect(events.at(-1)?.text).toMatch(/^Cap d'.*\(1\).*sans r.*ponse finale$/)
    expect(events.some((event) => event.kind === 'done')).toBe(false)
  })
  it('stops waiting for a model question when the turn is aborted', async () => {
    const controller = new AbortController()
    const registry = {
      send: vi.fn().mockResolvedValue({
        text: '<question>{"text":"Continuer ?","options":["Oui"]}</question>',
        provider: 'codex'
      }),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshot: async () => ({}) }
    const pending = new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'question' }],
      () => undefined,
      () => new Promise<string>(() => undefined),
      6,
      'conv-1',
      controller.signal
    )

    controller.abort('conversation-deleted')
    const result = await Promise.race([
      pending.then(
        () => 'resolved',
        () => 'rejected'
      ),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30))
    ])
    expect(result).toBe('rejected')
  })
})
