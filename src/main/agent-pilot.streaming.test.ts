import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../shared/chat-turn'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('AgentPilot chat streaming', () => {
  it('ne repaie pas un appel pour reformuler un remember auxiliaire refusé après une réponse complète', async () => {
    const responses = [
      'Scout livré.<cmd>{"name":"remember","args":{"type":"constraint"}}</cmd>',
      'Le dépôt mémoire a échoué.'
    ]
    const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
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
      catalog: () => [{ name: 'remember', args: {}, description: 'mémoire auxiliaire' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'type invalide' })
    }
    const events: PilotEvent[] = []

    /**
     * Le message porte une demande MUTANTE : c'est la seule route où une `<cmd>` atteint le bus,
     * donc la seule où « ne pas repayer un appel » se mesure.
     *
     * Il disait « scout la vue Chat » et ce test était rouge : depuis que le classifieur reconnaît
     * un contrat scout sans slash (`orchestrator.scout-readonly`), ce libellé ouvre un tour
     * `direct-read-only`, où une commande générée est bloquée AVANT le bus par défense en
     * profondeur — comportement délibéré, couvert par `agent-pilot.turn-contract` (« bloque
     * mecaniquement une commande generee dans un tour lecture seule »). Le scénario visé ici
     * n'était donc plus exercé du tout. La garantie testée, elle, est inchangée.
     */
    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'ajoute une note de contrainte dans la memoire' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-remember-cost'
    )

    expect(send).toHaveBeenCalledTimes(1)
    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'result',
        name: 'remember',
        ok: false,
        data: 'type invalide'
      })
    )
    expect(events.at(-1)).toMatchObject({ kind: 'done' })
  })

  it('bloque une commande emise pendant un tour LECTURE SEULE, sans perdre la reponse dite', async () => {
    // Comportement apparu avec le classement lecture-seule et que RIEN ne nommait sur ce chemin :
    // un message commencant par « scout » ouvre un tour sans catalogue de commandes ; si le modele
    // en emet une quand meme, elle ne doit JAMAIS atteindre le bus — et le texte deja livre doit
    // survivre, sinon on jette le travail rendu pour punir une balise de trop.
    const responses = [
      'Scout livré.<cmd>{"name":"remember","args":{"type":"constraint"}}</cmd>',
      'Deuxième appel qui ne devrait pas avoir lieu.'
    ]
    const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
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
      catalog: () => [{ name: 'remember', args: {}, description: 'mémoire auxiliaire' }],
      snapshotForPrompt,
      exec: vi.fn()
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'scout la vue Chat' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-read-only-guard'
    )

    expect(bus.exec).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    // Le texte livre survit au blocage : c'est le travail, la balise n'etait qu'un extra.
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: 'Scout livré.' })
  })

  it('demande une conclusion quand la réponse ne contient qu’un remember auxiliaire', async () => {
    const responses = [
      '<cmd>{"name":"remember","args":{"type":"constraint"}}</cmd>',
      'Le dépôt mémoire a échoué, mais le travail demandé est terminé.'
    ]
    const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
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
      catalog: () => [{ name: 'remember', args: {}, description: 'mémoire auxiliaire' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'type invalide' })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'mémorise puis conclus' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-remember-muted'
    )

    expect(send).toHaveBeenCalledTimes(2)
    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'result',
        name: 'remember',
        ok: false,
        data: 'type invalide'
      })
    )
    expect(events.at(-1)).toMatchObject({
      kind: 'done',
      text: 'Le dépôt mémoire a échoué, mais le travail demandé est terminé.'
    })
  })

  it('clôt mécaniquement un orchestrate terminal sans repayer un appel ni demander un second judge', async () => {
    const send = vi.fn(
      async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const text =
          'Je lance.<cmd>{"name":"orchestrate","args":{"task":"corrige puis teste","phase":"build"}}</cmd>' +
          ' Je lancerai ensuite judge.'
        onChunk?.({ delta: text })
        return { text, provider: 'codex' }
      }
    )
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
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          status: 'succeeded',
          valid: true,
          gateBlocked: false,
          reused: false,
          runPath: 'C:/runs/conv/build-settings-workspace/RUN.md',
          result: 'Tests cibles 11/11 verts.\nNext: commit final puis livraison.'
        }
      })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'fais tout' }],
      (event) => events.push(event),
      undefined,
      12,
      'conv-1'
    )

    expect(send).toHaveBeenCalledTimes(1)
    expect(bus.exec).toHaveBeenCalledTimes(1)
    expect(events.filter((event) => event.kind === 'command')).toHaveLength(1)
    const done = events.find((event) => event.kind === 'done')
    expect(done?.text).toContain('Workflow terminé')
    expect(done?.text).toContain('aucune autre orchestration')
    expect(done?.text).toContain('Tests cibles 11/11 verts.')
    expect(done?.text).not.toContain('Next:')
    expect(done?.text).not.toContain('commit final')
  })

  it('ne forge pas une clôture verte depuis un outcome incomplet', async () => {
    const text = '<cmd>{"name":"orchestrate","args":{"task":"corrige"}}</cmd>'
    const registry = {
      send: vi.fn(async () => ({ text, provider: 'codex' })),
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
      catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { status: 'succeeded' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'fais tout' }],
      (event) => events.push(event),
      undefined,
      12,
      'conv-malformed'
    )

    const done = events.find((event) => event.kind === 'done')
    expect(done?.text).toContain('résultat terminal rendu')
    expect(done?.text).not.toContain('gate validé')
    expect(done?.text).not.toContain('✅')
  })

  it('emits progressive visible deltas while suppressing fragmented command markup', async () => {
    const responses = [
      {
        chunks: [
          'Je ',
          'réponds. ',
          '<cm',
          'd>{"name":"get_state","args":{"target":"chat"}}</cmd>',
          ' Après action.'
        ],
        text: 'Je réponds. <cmd>{"name":"get_state","args":{"target":"chat"}}</cmd> Après action.'
      },
      { chunks: ['Tout ', 'est bon.'], text: 'Tout est bon.' }
    ]
    const send = vi.fn(
      async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const response = responses.shift()!
        for (const delta of response.chunks) onChunk?.({ delta })
        return { text: response.text, provider: 'codex' }
      }
    )
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
    const bus = {
      catalog: () => [{ name: 'get_state', args: {}, description: 'state' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { source: 'fixture' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-1'
    )

    const deltas = events.filter((event) => event.kind === 'delta')
    expect(deltas.length).toBeGreaterThanOrEqual(4)
    expect(deltas.map((event) => event.text).join('')).toBe(
      'Je réponds.  Après action.Tout est bon.'
    )
    expect(JSON.stringify(deltas)).not.toContain('<cmd>')
    expect(JSON.stringify(deltas)).not.toContain('get_state')
    const command = events.find((event) => event.kind === 'command')
    const result = events.find((event) => event.kind === 'result')
    const commandIndex = events.indexOf(command!)
    const resultIndex = events.indexOf(result!)
    const trailingTextIndex = events.findIndex(
      (event) => event.kind === 'delta' && event.text?.includes('Après action')
    )
    expect(command?.actionId).toBeTruthy()
    expect(result?.actionId).toBe(command?.actionId)
    expect(commandIndex).toBeLessThan(resultIndex)
    expect(resultIndex).toBeLessThan(trailingTextIndex)
  })

  it('produces durable text-action-text parts through the real pilot event path', async () => {
    const responses = [
      {
        chunks: ['Avant.', '<cmd>{"name":"get_state","args":{"token":"secret"}}</cmd>', ' Après.'],
        text: 'Avant.<cmd>{"name":"get_state","args":{"token":"secret"}}</cmd> Après.'
      },
      { chunks: [], text: '' }
    ]
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        const response = responses.shift()!
        for (const delta of response.chunks) onChunk?.({ delta })
        return { text: response.text, provider: 'codex' }
      },
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
      exec: vi.fn().mockResolvedValue({ ok: true, data: { source: 'fixture' } })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    let turn = createChatTurn('turn-1')
    for (const event of events) {
      let durable: ChatTurnEvent | undefined
      if (event.kind === 'delta' && event.streamId)
        durable = { kind: 'delta', streamId: event.streamId, text: event.text ?? '' }
      else if (event.kind === 'stream-reset' && event.streamId)
        durable = { kind: 'stream-reset', streamId: event.streamId }
      else if (event.kind === 'command' && event.actionId && event.name)
        durable = {
          kind: 'command',
          actionId: event.actionId,
          name: event.name,
          args: event.args
        }
      else if (event.kind === 'result' && event.actionId && event.name)
        durable = {
          kind: 'result',
          actionId: event.actionId,
          name: event.name,
          ok: event.ok,
          data: event.data
        }
      else if (event.kind === 'done') durable = { kind: 'done' }
      if (durable) turn = reduceChatTurn(turn, durable)
    }

    expect(turn.status).toBe('completed')
    expect(turn.parts.map((part) => part.kind)).toEqual(['text', 'action', 'text'])
    expect(turn.parts[0]).toMatchObject({ kind: 'text', text: 'Avant.' })
    expect(turn.parts[1]).toMatchObject({
      kind: 'action',
      name: 'get_state',
      args: { token: '[masqué]' },
      ok: true,
      data: { source: 'fixture' }
    })
    expect(turn.parts[2]).toMatchObject({ kind: 'text', text: ' Après.' })
  })

  it('resets partial text from a failed provider attempt before retrying', async () => {
    let attempt = 0
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        attempt += 1
        onChunk?.({ delta: attempt === 1 ? 'Texte perdu' : 'Texte valide' })
        if (attempt === 1) throw new Error('transport')
        return { text: 'Texte valide', provider: 'codex' }
      },
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
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    expect(events.map((event) => event.kind)).toContain('stream-reset')
    const failedStream = events.find((event) => event.kind === 'stream-reset')?.streamId
    expect(events.some((event) => event.kind === 'delta' && event.streamId === failedStream)).toBe(
      true
    )
    expect(events.filter((event) => event.kind === 'delta').at(-1)?.text).toBe('Texte valide')
  })

  it('keeps the last partial stream when the final provider attempt fails', async () => {
    let attempt = 0
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        attempt += 1
        onChunk?.({ delta: attempt === 1 ? 'Premier partiel' : 'Dernier partiel' })
        throw new Error(`échec ${attempt}`)
      },
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
    const events: PilotEvent[] = []

    await expect(
      new AgentPilot(registry as never, roles as never, bus as never).chat(
        [{ role: 'user', content: 'test' }],
        (event) => events.push(event)
      )
    ).rejects.toThrow('échec 2')

    expect(events.filter((event) => event.kind === 'stream-reset')).toHaveLength(1)
    const finalDelta = events.filter((event) => event.kind === 'delta').at(-1)
    expect(finalDelta?.text).toBe('Dernier partiel')
    expect(
      events.some(
        (event) => event.kind === 'stream-reset' && event.streamId === finalDelta?.streamId
      )
    ).toBe(false)
  })

  it.each([
    '<cm',
    '<cmd>{"name":"get_state"',
    '<question>{"question":"privé"',
    '<question>sk-test-123',
    '<QUESTION>sk-test-123'
  ])('never falls back to raw incomplete control markup: %s', async (response) => {
    const registry = {
      send: async (
        _provider: string,
        _messages: unknown,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        onChunk?.({ delta: response })
        return { text: response, provider: 'codex' }
      },
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
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'test' }],
      (event) => events.push(event)
    )

    expect(events.filter((event) => ['delta', 'think'].includes(event.kind))).toEqual([])
    expect(JSON.stringify(events)).not.toContain('sk-test-123')
  })
})
