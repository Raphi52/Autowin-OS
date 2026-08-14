import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { forgetEcho, noteRemembered } from './session-memory-echo'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('AgentPilot turn contract', () => {
  it('reinjecte une capture de commande comme image ephemere a iteration suivante', async () => {
    const calls: Array<Array<{ role: string; content: string; attachments?: unknown[] }>> = []
    const responses = [
      '<cmd>{"name":"desktop_observe","args":{}}</cmd>',
      'Je vois maintenant le bureau.'
    ]
    const registry = {
      send: vi.fn(async (_provider: string, messages: (typeof calls)[number]) => {
        calls.push(structuredClone(messages))
        return { text: responses.shift()!, provider: 'codex' }
      }),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const image = {
      name: 'desktop.jpg',
      mimeType: 'image/jpeg',
      size: 3,
      kind: 'image' as const,
      content: 'YWJj'
    }
    const bus = {
      catalog: () => [{ name: 'desktop_observe', args: {}, description: 'observe' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: { width: 1280, height: 720 },
        attachments: [image]
      })
    }

    await new AgentPilot(
      registry as never,
      {
        getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
      } as never,
      bus as never
    ).chat([{ role: 'user', content: 'regarde mon ecran' }], () => undefined, undefined, 2)

    expect(calls).toHaveLength(2)
    expect(calls[0][0].attachments).toBeUndefined()
    expect(calls[1][0].attachments).toEqual([image])
    expect(calls[1][0].content).not.toContain('YWJj')
  })

  it('autorise au plus une orchestration par tour, meme si le modele en emet deux', async () => {
    const responses = [
      '<cmd>{"name":"orchestrate","args":{"task":"premier run"}}</cmd>' +
        '<cmd>{"name":"orchestrate","args":{"task":"second run"}}</cmd>',
      'Le run unique est termine.'
    ]
    const registry = {
      send: vi
        .fn()
        .mockImplementation(async () => ({ text: responses.shift()!, provider: 'codex' })),
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
      catalog: () => [{ name: 'orchestrate', args: { task: 'string' }, description: 'run' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { status: 'succeeded' } })
    }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'fais la tache' }],
      () => undefined,
      undefined,
      2,
      'conv-unique',
      undefined,
      undefined,
      undefined,
      'turn-unique'
    )

    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(bus.exec).toHaveBeenCalledWith(
      'orchestrate',
      { task: 'premier run', rootTask: 'fais la tache' },
      'conv-unique',
      undefined,
      'turn-unique'
    )
  })

  it('transporte le prompt utilisateur racine sans laisser le modele le reduire a un scout', async () => {
    const rootTask =
      'Scout les defauts du workflow puis corrige-les, prouve le rouge vers vert et publie un commit.'
    const registry = {
      send: vi.fn(async () => ({
        text: '<cmd>{"name":"orchestrate","args":{"task":"liste les defauts","phase":"scout"}}</cmd>',
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
      catalog: () => [{ name: 'orchestrate', args: { task: 'string' }, description: 'run' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'succeeded', valid: true, gateBlocked: false }
      })
    }

    await new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
    ).chat([{ role: 'user', content: rootTask }], () => undefined, undefined, 2, 'conv-root')

    expect(bus.exec).toHaveBeenCalledWith(
      'orchestrate',
      { task: 'liste les defauts', phase: 'scout', rootTask },
      'conv-root'
    )
  })

  it('route un /skill vers orchestrate avant tout appel au modèle conversationnel', async () => {
    const registry = {
      send: vi.fn(),
      describePrompt: vi.fn()
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = {
      catalog: () => [],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
      })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: '/scout trouve les risques du repo' }],
      (event) => events.push(event),
      undefined,
      2,
      'conv-1'
    )

    expect(registry.send).not.toHaveBeenCalled()
    expect(bus.exec).toHaveBeenCalledWith(
      'orchestrate',
      { task: '/scout trouve les risques du repo' },
      'conv-1'
    )
    expect(events.map((event) => event.kind)).toEqual(['command', 'result', 'done'])
    const done = events.at(-1)
    expect(done?.kind === 'done' ? done.text : '').toMatch(
      /✅ Fait[\s\S]*📍 Maintenant[\s\S]*⏳ Reste à faire[\s\S]*👉 Recommandé/u
    )
  })

  it('ne relance pas un second run quand une orientation arrive pendant un /skill', async () => {
    const bus = {
      catalog: () => [],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
      })
    }
    const directives = [['resserre le correctif'], []] as string[][]
    const events: PilotEvent[] = []

    await new AgentPilot(
      { send: vi.fn(), describePrompt: vi.fn() } as never,
      {
        getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
      } as never,
      bus as never
    ).chat(
      [{ role: 'user', content: '/build corrige le bug' }],
      (event) => events.push(event),
      undefined,
      2,
      'conv-directive',
      undefined,
      () => directives.shift() ?? []
    )

    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({ kind: 'done' })
    expect((events.at(-1) as { text?: string }).text).toMatch(
      /orientation[\s\S]*aucun second run.*relanc/i
    )
    expect((events.at(-1) as { text?: string }).text?.trimEnd()).toMatch(
      /👉 Recommandé : passer à la prochaine demande\.$/u
    )
  })

  it('termine aussi le chemin orchestrate du modèle par Recommandé', async () => {
    const events: PilotEvent[] = []
    const registry = {
      send: vi.fn().mockResolvedValue({
        text: '<cmd>{"name":"orchestrate","args":{"task":"corrige le bug"}}</cmd>',
        provider: 'codex'
      }),
      describePrompt: vi.fn().mockReturnValue({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: { task: 'string' }, description: 'pipeline' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
      })
    }

    await new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
    ).chat(
      [{ role: 'user', content: 'corrige le bug' }],
      (event) => events.push(event),
      undefined,
      1
    )

    expect((events.at(-1) as { text?: string }).text?.trimEnd()).toMatch(
      /👉 Recommandé : passer à la prochaine demande\.$/u
    )
  })

  it('propage le binding par tour à un /skill explicite', async () => {
    const bus = {
      catalog: () => [],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { valid: true } })
    }
    const binding = {
      provider: 'claude',
      model: 'claude-sonnet',
      reasoningEffort: 'high' as const
    }

    await new AgentPilot(
      { send: vi.fn(), describePrompt: vi.fn() } as never,
      { getBinding: vi.fn() } as never,
      bus as never
    ).chat(
      [{ role: 'user', content: '/build corrige puis teste' }],
      () => undefined,
      undefined,
      1,
      'conv-task',
      undefined,
      undefined,
      binding
    )

    expect(bus.exec).toHaveBeenCalledWith(
      'orchestrate',
      { task: '/build corrige puis teste' },
      'conv-task',
      binding
    )
  })

  it('utilise le snapshot runtime du tour meme si le role global change ensuite', async () => {
    const snapshot = {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low' as const
    }
    const roles = {
      getBinding: vi.fn(() => ({
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        reasoningEffort: 'none' as const
      }))
    }
    const registry = {
      send: vi.fn(async () => ({ text: 'termine', provider: 'codex', systemInjected: true })),
      describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
    }
    const bus = { catalog: () => [], snapshotForPrompt }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'continue' }],
      () => undefined,
      undefined,
      1,
      'conv-snapshot',
      undefined,
      undefined,
      undefined,
      'turn-snapshot',
      snapshot
    )

    expect(registry.send).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({ model: 'gpt-5.6-sol', reasoningEffort: 'low' }),
      expect.any(Function)
    )
    expect(roles.getBinding).not.toHaveBeenCalled()
  })

  it('does not pass an authority mode from the real pilotChat IPC path', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    expect(source).toContain(
      'const supervisedSignal = os.executionSupervisor.currentSignal() ?? controller.signal'
    )
    expect(source).not.toContain('authorityMode')
  })

  it('journals the routed model and reasoning effort used by pilotChat', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    expect(source).toContain('turnPromptIdentity ??= {')
    const activityBlock = source.match(
      /appendConvActivity\(conversationId, \{[\s\S]*?kind: 'chat',[\s\S]*?\}\)/
    )?.[0]

    const normalizedActivityBlock = activityBlock?.replace(/\s+/g, ' ')
    expect(normalizedActivityBlock).toContain(
      'model: turnResolvedModel ?? turnPromptIdentity?.model ?? turnRuntimeBinding.model'
    )
    expect(normalizedActivityBlock).toContain(
      'reasoningEffort: turnPromptIdentity?.reasoningEffort ?? turnRuntimeBinding.reasoningEffort'
    )
  })

  it('journalise aussi le modele concret rapporte par le provider', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const promptCallBlock = source.match(
      /const promptCall = appendPromptCall\(\{[\s\S]*?\n\s*\}\)/
    )?.[0]

    expect(promptCallBlock).toContain('resolvedModel: pilotEvent.resolvedModel')
  })

  it('dispatches every command without an authority mode', async () => {
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
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: true })
    }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'supprime' }],
      () => undefined,
      undefined,
      2,
      'conv-1'
    )

    expect(bus.exec).toHaveBeenCalledWith('remove_conversation', { id: 'conv-1' }, 'conv-1')
  })

  it('does not interrupt the user for a structured question without an admitted blocker', async () => {
    const ask = vi.fn()
    const events: PilotEvent[] = []
    const responses = [
      '<question>{"text":"Quel nom donner ?","options":["A","B"]}</question>',
      'Je choisis un nom raisonnable et je poursuis.'
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
    const bus = { catalog: () => [], snapshotForPrompt }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'avance avec un nom raisonnable' }],
      (event) => events.push(event),
      ask,
      2,
      'conv-1'
    )

    expect(ask).not.toHaveBeenCalled()
    expect(registry.send).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({
      kind: 'done',
      text: 'Je choisis un nom raisonnable et je poursuis.'
    })
  })

  it('keeps one bounded autonomous recovery when an invalid question uses the last iteration', async () => {
    const ask = vi.fn()
    const events: PilotEvent[] = []
    const responses = [
      '<question>{"text":"Quel nom donner ?","options":["A","B"],"reason":"material-ambiguity"}</question>',
      'Je choisis A et je poursuis.'
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
    const bus = { catalog: () => [], snapshotForPrompt }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'choisis un nom raisonnable' }],
      (event) => events.push(event),
      ask,
      1,
      'conv-1'
    )

    expect(ask).not.toHaveBeenCalled()
    expect(registry.send).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: 'Je choisis A et je poursuis.' })
  })

  it('does not transport missing credentials through the observable chat channel', async () => {
    const responses = [
      '<question>{"text":"Le token sk-test-123 est-il correct ?","options":[],"reason":"secret-or-personal-data"}</question>',
      'Configure le credential du provider dans les réglages, puis relance.'
    ]
    const ask = vi.fn().mockResolvedValue('secret-value')
    const events: PilotEvent[] = []
    const registry = {
      send: vi
        .fn()
        .mockImplementation(async () => ({ text: responses.shift()!, provider: 'codex' })),
      describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'prépare le déploiement' }],
      (event) => events.push(event),
      ask,
      1,
      'conv-1'
    )

    expect(ask).not.toHaveBeenCalled()
    expect(registry.send).toHaveBeenCalledTimes(2)
    expect(events.find((event) => event.kind === 'prompt-call')?.response).not.toContain(
      'sk-test-123'
    )
    expect(JSON.stringify(registry.send.mock.calls[1][1])).not.toContain('sk-test-123')
    expect(JSON.stringify(registry.send.mock.calls[1][1])).toContain(
      '[question modèle refusée et masquée]'
    )
  })

  it('masks and recovers from an unclosed question before any observable event', async () => {
    const responses = ['<question>sk-test-123', 'Je poursuis sans question.']
    const registry = {
      send: vi
        .fn()
        .mockImplementation(async () => ({ text: responses.shift()!, provider: 'codex' })),
      describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'continue' }],
      (event) => events.push(event),
      vi.fn(),
      1,
      'conv-1'
    )

    expect(registry.send).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(events)).not.toContain('sk-test-123')
    expect(JSON.stringify(registry.send.mock.calls[1][1])).not.toContain('sk-test-123')
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: 'Je poursuis sans question.' })
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
      snapshotForPrompt,
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
      drain
    )

    expect(send).toHaveBeenCalledTimes(2)
    const firstPrompt = (send.mock.calls[0][1] as Array<{ content: string }>)[0].content
    const secondPrompt = (send.mock.calls[1][1] as Array<{ content: string }>)[0].content
    expect(firstPrompt).not.toContain('DIRECTIVE INJECTÉE')
    expect(secondPrompt).toContain('DIRECTIVE INJECTÉE EN COURS DE TOUR')
    expect(secondPrompt).toContain('priorise le module X')
  })

  it('ne perd pas une directive arrivée pendant la réponse finale', async () => {
    const queue: string[] = []
    const send = vi
      .fn()
      .mockImplementationOnce(async () => {
        queue.push('corrige aussi le module Y')
        return { text: 'Réponse devenue obsolète', provider: 'codex' }
      })
      .mockResolvedValueOnce({ text: 'Réponse orientée', provider: 'codex' })
    const registry = {
      send,
      describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: Array<{ kind: string; text?: string }> = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'go' }],
      (event) => events.push(event as { kind: string; text?: string }),
      undefined,
      6,
      'conv-1',
      undefined,
      () => queue.splice(0, queue.length)
    )

    expect(send).toHaveBeenCalledTimes(2)
    expect((send.mock.calls[1][1] as Array<{ content: string }>)[0].content).toContain(
      'corrige aussi le module Y'
    )
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: 'Réponse orientée' })
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
      snapshotForPrompt,
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
  })

  it('uses a per-turn binding without mutating the orchestrator role', async () => {
    const send = vi.fn().mockResolvedValue({ text: 'Réponse finale', provider: 'claude' })
    const describePrompt = vi.fn().mockReturnValue({
      provider: 'claude',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
    const roles = {
      getBinding: vi.fn(() => ({
        provider: 'codex',
        model: 'gpt-global',
        reasoningEffort: 'medium'
      }))
    }
    const bus = {
      catalog: () => [],
      snapshotForPrompt,
      exec: vi.fn()
    }

    await new AgentPilot({ send, describePrompt } as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test planifié' }],
      () => undefined,
      undefined,
      1,
      'conv-task',
      undefined,
      undefined,
      { provider: 'claude', model: 'claude-sonnet', reasoningEffort: 'high' }
    )

    expect(roles.getBinding).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({ model: 'claude-sonnet', reasoningEffort: 'high' }),
      expect.any(Function)
    )
    expect(describePrompt).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({ model: 'claude-sonnet', reasoningEffort: 'high' }),
      'claude-sonnet'
    )
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
    const bus = { catalog: () => [], snapshotForPrompt }
    const retrieveContext = vi
      .fn()
      .mockResolvedValue(
        '[AMITEL BRAIN REFERENCE DATA]\nknowledge evidence\n\n' +
          '[GRAPHIFY CODE EVIDENCE]\nstructural evidence'
      )

    await new AgentPilot(registry as never, roles as never, bus as never, retrieveContext).chat(
      [{ role: 'user', content: 'Explique AgentPilot' }],
      () => undefined
    )

    expect(retrieveContext).toHaveBeenCalledOnce()
    expect(retrieveContext).toHaveBeenCalledWith('Explique AgentPilot')
    // La connaissance récupérée doit ARRIVER au modèle — c'est l'invariant. Elle voyage désormais
    // dans le MESSAGE et non dans le `system` : le contexte Brain dépend de la question, donc le
    // laisser dans le system rendait le préfixe différent à chaque tour et interdisait tout cache
    // (mesuré le 2026-07-28 : cache_read = 0 sur 100 % des appels, ~16 k réécrits par tour).
    const system = send.mock.calls[0][2].system as string
    const userContent = (send.mock.calls[0][1] as Array<{ content: string }>).at(-1)?.content ?? ''
    expect(userContent).toContain('[AMITEL BRAIN REFERENCE DATA]')
    expect(userContent).toContain('[GRAPHIFY CODE EVIDENCE]')
    // Le préfixe system ne doit PLUS porter de contenu dépendant de la question.
    expect(system).not.toContain('[AMITEL BRAIN REFERENCE DATA]')
  })

  it('injects only current-workspace and global provisional memories into direct chat', async () => {
    forgetEcho()
    noteRemembered('conv-workspace-memory', {
      title: 'Compilation RIG',
      body: 'Utiliser gacRig avant le build.',
      scope: 'rigapplication',
      workspace: 'D:\\DevSrc\\RigApplication'
    })
    noteRemembered('conv-workspace-memory', {
      title: 'Préférence globale',
      body: 'Répondre de façon concise.',
      scope: 'global',
      workspace: 'global'
    })
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
    const bus = { catalog: () => [], snapshotForPrompt }

    try {
      await new AgentPilot(
        registry as never,
        roles as never,
        bus as never,
        undefined,
        () => '',
        () => 'C:\\Amitel\\Autowin OS'
      ).chat(
        [{ role: 'user', content: 'Continue ici' }],
        () => undefined,
        undefined,
        2,
        'conv-workspace-memory'
      )

      const userContent =
        (send.mock.calls[0][1] as Array<{ content: string }>).at(-1)?.content ?? ''
      expect(userContent).not.toContain('gacRig')
      expect(userContent).toContain('Répondre de façon concise.')
    } finally {
      forgetEcho()
    }
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
      snapshotForPrompt,
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
  it('never waits on the disabled model-question channel', async () => {
    const controller = new AbortController()
    const registry = {
      send: vi.fn().mockResolvedValue({
        text: '<question>{"text":"Publier ?","options":["Oui"],"reason":"external-effect"}</question>',
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
    const bus = { catalog: () => [], snapshotForPrompt }
    const ask = vi.fn(() => new Promise<string>(() => undefined))
    const pending = new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'question' }],
      () => undefined,
      ask,
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
    expect(result).toBe('resolved')
    expect(ask).not.toHaveBeenCalled()
  })

  it('OPEN BAR : une demande d’analyse d’utilisateur reçoit le catalogue COMPLET, jamais un profil bridé', async () => {
    // Choix utilisateur 2026-08-14 : plus AUCUNE classification « lecture seule » sur un tour piloté
    // par l'utilisateur. Ce test asseyait l'inverse (`toolProfile: 'watchdog-read-only'` + exec
    // bloqué sur un message d'analyse) ; il verifie maintenant que l'analyse recoit tous les outils.
    // Le profil watchdog RESTE teste, mais sur le SYSTEME (`agent-pilot.retry.test.ts`), pas sur un
    // message utilisateur.
    const send = vi.fn(
      async (_provider: string, _messages: unknown, _options: { toolProfile?: string }) => ({
        text: '<cmd>{"name":"orchestrate","args":{"task":"analyse package.json"}}</cmd>',
        provider: 'claude'
      })
    )
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
      catalog: () => [{ name: 'orchestrate', args: { task: 'string' }, description: 'pipeline' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { status: 'succeeded' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [
        {
          role: 'user',
          content: 'Analyse package.json puis dis-moi ce qu’il faut corriger. Ne modifie rien.'
        }
      ],
      (event) => events.push(event),
      undefined,
      12,
      'conv-open-bar'
    )

    // AUCUN profil bridé sur un tour utilisateur, et la commande ATTEINT le bus.
    expect(send.mock.calls[0][2].toolProfile).not.toBe('watchdog-read-only')
    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(bus.exec.mock.calls[0][0]).toBe('orchestrate')
    expect(bus.exec.mock.calls[0][1]).toMatchObject({ task: 'analyse package.json' })
    expect(events.some((event) => event.kind === 'command')).toBe(true)
  })

  it('un tour lecture seule garde les commandes de LECTURE et execute read_file', async () => {
    // Mesure sur 4 runs reels du scout de veille (conv-1154→1157) : classe read-only, l'agent
    // recevait ZERO commande et repondait « je n'ai pas pu executer les lectures obligatoires ».
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        text: '<cmd>{"name":"read_file","args":{"path":"src/a.ts"}}</cmd>',
        provider: 'claude'
      })
      .mockResolvedValue({ text: 'Synthese apres lecture.', provider: 'claude' })
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
    const bus = {
      catalog: () => [
        { name: 'orchestrate', args: { task: 'string' }, description: 'pipeline' },
        {
          name: 'read_file',
          args: { path: 'string' },
          description: 'lire',
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        }
      ],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { lu: true, contenu: '1→x' } })
    }
    const events: PilotEvent[] = []
    await new AgentPilot(
      registry as never,
      {
        getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
      } as never,
      bus as never
    ).chat([{ role: 'user', content: 'Analyse package.json sans rien modifier.' }], (event) =>
      events.push(event)
    )
    // Le pilotage est present (il porte read_file) et la lecture a REELLEMENT atteint le bus.
    expect(String(send.mock.calls[0][2].system)).toContain('read_file')
    expect(bus.exec).toHaveBeenCalledWith('read_file', { path: 'src/a.ts' }, undefined)
    expect(events.some((event) => event.kind === 'command' && event.name === 'read_file')).toBe(true)
  })

  it('OPEN BAR : une commande generee dans un tour d’analyse EXECUTE, elle n’est plus bloquee', async () => {
    // Ce test asseyait le blocage mecanique d'une commande sur un message classe « lecture seule ».
    // Open bar (choix utilisateur 2026-08-14) : plus de blocage sur un tour utilisateur — la commande
    // atteint le bus. Le blocage mecanique RESTE, mais uniquement sur le profil systeme watchdog.
    const registry = {
      send: vi.fn().mockResolvedValue({
        text: '<cmd>{"name":"orchestrate","args":{"task":"appel autorise"}}</cmd>',
        provider: 'claude'
      }),
      describePrompt: () => ({
        provider: 'claude',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: { task: 'string' }, description: 'pipeline' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { status: 'succeeded' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(
      registry as never,
      {
        getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
      } as never,
      bus as never
    ).chat([{ role: 'user', content: 'Analyse package.json sans rien modifier.' }], (event) =>
      events.push(event)
    )

    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(bus.exec.mock.calls[0][0]).toBe('orchestrate')
    expect(bus.exec.mock.calls[0][1]).toMatchObject({ task: 'appel autorise' })
    expect(events.some((event) => event.kind === 'command')).toBe(true)
    // Plus de message « bloqué » : la commande a joué.
    expect(events.at(-1)?.text ?? '').not.toMatch(/bloqu/i)
  })

  it('conserve le pilotage et les commandes pour une demande qui modifie le workspace', async () => {
    const registry = {
      send: vi.fn().mockResolvedValue({
        text: '<cmd>{"name":"orchestrate","args":{"task":"corrige package.json"}}</cmd>',
        provider: 'claude'
      }),
      describePrompt: () => ({
        provider: 'claude',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: { task: 'string' }, description: 'pipeline' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { status: 'succeeded' } })
    }

    const pilot = new AgentPilot(
      registry as never,
      {
        getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
      } as never,
      bus as never
    )

    for (const content of [
      'Analyse package.json puis corrige ses scripts obsoletes.',
      "Documente l'API dans README.md",
      'Analyse package.json sans le modifier puis publie une release.',
      'Analyse package.json sans rien modifier puis ecrase le script obsolete.'
    ]) {
      await pilot.chat([{ role: 'user', content }], () => undefined)
    }

    expect(registry.send).toHaveBeenCalledTimes(4)
    expect(
      registry.send.mock.calls.every((call) => call[2].toolProfile !== 'watchdog-read-only')
    ).toBe(true)
    expect(bus.exec).toHaveBeenCalledTimes(4)
    expect(bus.exec).toHaveBeenNthCalledWith(
      1,
      'orchestrate',
      {
        task: 'corrige package.json',
        rootTask: 'Analyse package.json puis corrige ses scripts obsoletes.'
      },
      undefined
    )
    expect(bus.exec).toHaveBeenNthCalledWith(
      2,
      'orchestrate',
      { task: 'corrige package.json', rootTask: "Documente l'API dans README.md" },
      undefined
    )
    expect(bus.exec).toHaveBeenNthCalledWith(
      3,
      'orchestrate',
      {
        task: 'corrige package.json',
        rootTask: 'Analyse package.json sans le modifier puis publie une release.'
      },
      undefined
    )
    expect(bus.exec).toHaveBeenNthCalledWith(
      4,
      'orchestrate',
      {
        task: 'corrige package.json',
        rootTask: 'Analyse package.json sans rien modifier puis ecrase le script obsolete.'
      },
      undefined
    )
  })
})
