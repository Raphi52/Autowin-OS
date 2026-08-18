// @vitest-environment happy-dom
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from '../../../main/agent-pilot'
import { CodexAdapter } from '../../../main/providers/codex'
import type { Message, SendOptions, SendResult, StreamChunk } from '../../../main/providers/types'
import {
  materializeChatArtifact,
  readConversationArtifact
} from '../../../main/store/chat-artifact-store'
import { ConversationStore } from '../../../main/store/conversations'
import { ArtifactPreview } from './ArtifactPreview'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder()
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < events.length
            ? { done: false, value: encoder.encode(events[index++]) }
            : { done: true, value: undefined }
      })
    }
  } as unknown as Response
}

describe('pipeline artefact provider -> chat rechargé -> renderer', () => {
  it('conserve et rend un output_file Codex attribué au bon tour après rechargement', async () => {
    const adapter = new CodexAdapter({
      loadTokensFn: () => ({
        accessToken: 'token',
        refreshToken: 'refresh',
        obtainedAt: Date.now(),
        expiresInSec: 3600
      }),
      fetchFn: vi.fn(async () =>
        sseResponse([
          'data: {"type":"response.output_text.delta","delta":"Rapport prêt"}\n',
          'data: {"type":"response.output_item.done","item":{"id":"report-1","type":"message","content":[{"type":"output_file","filename":"rapport.md","mime_type":"text/markdown","file_data":"data:text/markdown;base64,IyBMaXZyYWlzb24KClZlcmlmaWVl"}]}}\n',
          'data: {"type":"response.completed","response":{"id":"resp-roundtrip"}}\n'
        ])
      ) as unknown as typeof fetch
    })
    const registry = {
      describePrompt: vi.fn(() => ({ provider: 'codex', messages: [], transport: 'test' })),
      send: async (
        _provider: string,
        messages: Message[],
        options: SendOptions,
        onChunk: (chunk: StreamChunk) => void
      ): Promise<SendResult> => {
        const generator = adapter.send(messages, options)
        let step = await generator.next()
        while (!step.done) {
          onChunk(step.value)
          step = await generator.next()
        }
        return step.value
      }
    }
    const roles = {
      getBinding: vi.fn(() => ({ provider: 'codex', model: 'gpt-roundtrip' }))
    }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn()
    }
    const base = mkdtempSync(join(tmpdir(), 'autowin-artifact-pipeline-'))
    const store = new ConversationStore(() => 1)
    const conversation = store.create({ title: 'Pipeline', provider: 'codex' })
    const turnId = 'turn-roundtrip'
    store.beginTurn(conversation.id, { content: 'Génère un rapport' }, { turnId })

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'Génère un rapport' }],
      (event) => {
        if (event.kind === 'artifact' && event.artifact) {
          const stored = materializeChatArtifact(event.artifact, conversation.id, turnId, base)
          store.applyTurnEvent(conversation.id, turnId, { kind: 'artifact', artifact: stored })
        }
        if (event.kind === 'done') store.applyTurnEvent(conversation.id, turnId, { kind: 'done' })
      },
      undefined,
      2,
      conversation.id,
      undefined,
      undefined,
      undefined,
      turnId
    )

    const reloaded = new ConversationStore(() => 2)
    reloaded.hydrate(JSON.parse(JSON.stringify(store.list())))
    const storedPart = reloaded
      .get(conversation.id)
      ?.messages.find((message) => message.turnId === turnId)
      ?.parts?.find((part) => part.kind === 'artifact')
    expect(storedPart?.kind).toBe('artifact')
    if (!storedPart || storedPart.kind !== 'artifact') throw new Error('Artefact non persisté')
    expect(storedPart.artifact.source).toEqual(
      expect.objectContaining({ provider: 'codex', model: 'gpt-roundtrip' })
    )

    const read = vi.fn(async () =>
      readConversationArtifact(reloaded.get(conversation.id), turnId, storedPart.artifact.id, base)
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { readChatArtifact: read }
    })
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: undefined
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <ArtifactPreview
          artifact={storedPart.artifact}
          conversationId={conversation.id}
          turnId={turnId}
        />
      )
    })
    await act(async () => {})

    expect(read).toHaveBeenCalledWith(conversation.id, turnId, storedPart.artifact.id)
    expect(container.querySelector('.brain-markdown h1')?.textContent).toBe('Livraison')
    expect(container.textContent).toContain('codex · gpt-roundtrip')
    act(() => root.unmount())
    container.remove()
  })
})
