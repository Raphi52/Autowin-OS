import { describe, expect, it, vi } from 'vitest'
import {
  AgentPilot,
  type PilotEvent,
  type PilotProviderJournalLink,
  type RecoveredPilotProviderCall
} from './agent-pilot'
import { ProviderRegistry } from './providers/registry'
import type { ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'

/*
 * LES N PREMIERS ARGUMENTS, et non l'appel EXACT.
 *
 * `bus.exec` a gagne un parametre optionnel `onProgress` le 2026-08-25 (signe de vie d'une action
 * longue). Onze assertions `toHaveBeenCalledWith` sont alors passees au rouge d'un coup : elles
 * figeaient l'ARITE de l'appel, alors que leur intention est le nom de la commande, ses arguments et
 * sa conversation. Une assertion d'arite sur une signature qui grandit recassera au prochain
 * parametre optionnel -- c'est deja arrive une fois, autant ne pas le reprogrammer.
 *
 * On compare donc le DEBUT de chaque appel. Aucune assertion n'est desserree : les valeurs verifiees
 * sont exactement les memes, seule la queue non specifiee cesse de compter.
 */
const appeleAvec = (
  spy: { mock: { calls: unknown[][] } },
  ...attendus: unknown[]
): void => {
  expect(spy.mock.calls.map((appel) => appel.slice(0, attendus.length))).toContainEqual(attendus)
}


describe('AgentPilot — resultat provider recupere apres redemarrage', () => {
  it('publie le lien du journal direct avant de consommer la réponse', async () => {
    const links: PilotProviderJournalLink[] = []
    const adapter: ProviderAdapter = {
      id: 'fixture-journal',
      auth: async () => true,
      async *send(_messages, options): AsyncGenerator<StreamChunk, SendResult, void> {
        yield* [] as StreamChunk[]
        options?.onJournal?.('token-direct', 'C:/journals/direct.stdout.jsonl')
        return {
          text: 'Réponse bornée.',
          provider: 'fixture-journal',
          systemInjected: true
        }
      }
    }
    const registry = new ProviderRegistry().register(adapter)
    const roles = new RoleModelConfig({
      orchestrator: { provider: 'fixture-journal', model: 'fixture-model' }
    })
    const bus = {
      catalog: () => [],
      snapshot: () => ({}),
      snapshotForPrompt: async () => ({}),
      exec: vi.fn()
    }

    await new AgentPilot(registry, roles, bus as never).chat(
      [{ role: 'user', content: 'réponds' }],
      () => undefined,
      undefined,
      2,
      'conv-journal',
      undefined,
      undefined,
      undefined,
      'turn-journal',
      undefined,
      undefined,
      (link) => links.push(link)
    )

    expect(links).toEqual([
      expect.objectContaining({
        provider: 'fixture-journal',
        token: 'token-direct',
        journalPath: 'C:/journals/direct.stdout.jsonl',
        iteration: 0,
        attempt: 0,
        streamId: '0:0'
      })
    ])
  })

  it('execute la commande deja payee sans repeter son appel provider', async () => {
    let providerCalls = 0
    const adapter: ProviderAdapter = {
      id: 'fixture',
      auth: async () => true,
      async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
        yield* [] as StreamChunk[]
        providerCalls += 1
        return {
          text: 'Termine apres verification.',
          provider: 'fixture',
          systemInjected: true,
          usage: { inputTokens: 3, outputTokens: 4, cacheReadTokens: 0, costUsd: 0.03 }
        }
      }
    }
    const registry = new ProviderRegistry().register(adapter)
    const roles = new RoleModelConfig({
      orchestrator: { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' }
    })
    const exec = vi.fn(async () => ({ ok: true as const, data: { changed: true } }))
    const bus = {
      catalog: () => [{ name: 'edit_file', description: 'edit', args: {} }],
      snapshot: () => ({}),
      snapshotForPrompt: async () => ({}),
      exec
    }
    const events: PilotEvent[] = []
    const recovered: RecoveredPilotProviderCall = {
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      streamedPrefix: '',
      result: {
        text: '<cmd>{"name":"edit_file","args":{"path":"src/x.ts"}}</cmd>',
        provider: 'fixture',
        systemInjected: true,
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, costUsd: 0.42 }
      }
    }

    await new AgentPilot(registry, roles, bus as never).chat(
      [{ role: 'user', content: 'Fais tout' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-recovery',
      undefined,
      undefined,
      undefined,
      'turn-recovery',
      undefined,
      recovered
    )

    expect(exec).toHaveBeenCalledTimes(1)
    appeleAvec(exec, 
      'edit_file',
      { path: 'src/x.ts' },
      'conv-recovery',
      undefined,
      'turn-recovery'
    )
    expect(providerCalls).toBe(1)
    expect(events.find((event) => event.kind === 'done')?.usage).toEqual({
      inputTokens: 103,
      outputTokens: 24,
      costUsd: 0.44999999999999996
    })
  })

  it('ne reexecute pas une commande dont le resultat est deja durable apres un second crash', async () => {
    let providerCalls = 0
    let resumedPrompt = ''
    let resumedAttachments: unknown[] = []
    const adapter: ProviderAdapter = {
      id: 'fixture',
      auth: async () => true,
      async *send(messages): AsyncGenerator<StreamChunk, SendResult, void> {
        yield* [] as StreamChunk[]
        providerCalls += 1
        resumedPrompt = messages.map((message) => message.content).join('\n')
        resumedAttachments = messages.flatMap((message) => message.attachments ?? [])
        return {
          text: 'Ticket confirme sans duplication.',
          provider: 'fixture',
          systemInjected: true
        }
      }
    }
    const registry = new ProviderRegistry().register(adapter)
    const roles = new RoleModelConfig({
      orchestrator: { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' }
    })
    const exec = vi.fn(async () => ({ ok: true as const, data: { id: 99 } }))
    const bus = {
      catalog: () => [{ name: 'ticket_create', description: 'create', args: {} }],
      snapshot: () => ({}),
      snapshotForPrompt: async () => ({}),
      exec
    }
    const events: PilotEvent[] = []
    const image = {
      name: 'desktop.jpg',
      mimeType: 'image/jpeg',
      size: 3,
      kind: 'image' as const,
      content: 'YWJj'
    }
    const recovered: RecoveredPilotProviderCall = {
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      streamedPrefix: '',
      settledActions: [
        {
          actionId: '0:0',
          name: 'ticket_create',
          ok: true,
          data: { id: 42 },
          attachments: [image]
        }
      ],
      result: {
        text: '<cmd>{"name":"ticket_create","args":{"title":"Ne jamais dupliquer"}}</cmd>',
        provider: 'fixture',
        systemInjected: true
      }
    }

    await new AgentPilot(registry, roles, bus as never).chat(
      [{ role: 'user', content: 'Cree le ticket' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-recovery',
      undefined,
      undefined,
      undefined,
      'turn-recovery',
      undefined,
      recovered
    )

    expect(exec).not.toHaveBeenCalled()
    expect(providerCalls).toBe(1)
    expect(resumedPrompt).toContain('ticket_create → {"id":42}')
    expect(resumedAttachments).toEqual([image])
    expect(events.filter((event) => event.kind === 'command')).toEqual([])
    expect(events.filter((event) => event.kind === 'result')).toEqual([])
    expect(events.some((event) => event.kind === 'done')).toBe(true)
  })
})
