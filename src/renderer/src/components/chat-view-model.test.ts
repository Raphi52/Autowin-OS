import { describe, expect, it } from 'vitest'
import {
  CHAT_PANE_LIMITS,
  clampConversationPaneWidth,
  coalesceAssistantParts,
  deriveConversationState,
  groupAssistantActivity,
  isRunRequestCurrent,
  isChatNearBottom,
  hydrateStoredAssistant,
  reduceAssistantPilotEvent,
  reduceScopedLiveRuns,
  phaseLabel,
  resolveChatRuntimeIdentity,
  modelCostTier,
  stripAssistantThinking,
  turnCostEq,
  costEqTier
} from './chat-view-model'

describe('conversation state indicator', () => {
  it('prioritizes a real live run over the persisted terminal state', () => {
    expect(
      deriveConversationState({ busy: true, messageCount: 2, lastAssistantStatus: 'completed' })
    ).toMatchObject({ key: 'running', label: 'En cours', glyph: '' })
  })

  it.each([
    ['streaming', 'running', 'En cours', ''],
    ['completed', 'completed', 'À jour', '✓'],
    ['failed', 'failed', 'Erreur', '!'],
    ['interrupted', 'interrupted', 'Interrompue', 'Ⅱ'],
    ['cancelled', 'cancelled', 'Arrêtée', '×']
  ] as const)('maps persisted %s turns to %s', (status, key, label, glyph) => {
    expect(
      deriveConversationState({ busy: false, messageCount: 2, lastAssistantStatus: status })
    ).toMatchObject({ key, label, glyph })
  })

  it('distinguishes an empty conversation from a user message without an answer', () => {
    expect(deriveConversationState({ busy: false, messageCount: 0 })).toMatchObject({
      key: 'empty',
      label: 'Vide',
      glyph: '○'
    })
    expect(
      deriveConversationState({ busy: false, messageCount: 1, lastMessageRole: 'user' })
    ).toMatchObject({
      key: 'waiting',
      label: 'Sans réponse',
      glyph: '·'
    })
  })

  it('does not reuse an older completed assistant after a newer user message', () => {
    expect(
      deriveConversationState({
        busy: false,
        messageCount: 3,
        lastMessageRole: 'user',
        lastAssistantStatus: 'completed'
      })
    ).toMatchObject({ key: 'waiting', label: 'Sans réponse', glyph: '·' })
  })
})

describe('assistant reasoning sanitization', () => {
  it('removes an orphan closing think tag at the start of a message', () => {
    expect(stripAssistantThinking('</think>R\u00e9ponse visible.')).toBe('R\u00e9ponse visible.')
  })

  it('removes complete, unterminated, and partially streamed think blocks', () => {
    expect(stripAssistantThinking('<think>raisonnement</think>R\u00e9ponse')).toBe('R\u00e9ponse')
    expect(stripAssistantThinking('<think>raisonnement en cours')).toBe('')
    expect(stripAssistantThinking('R\u00e9ponse<thi')).toBe('R\u00e9ponse')
    expect(stripAssistantThinking('<thinking>contenu normal</thinking>')).toBe(
      '<thinking>contenu normal</thinking>'
    )
    expect(
      coalesceAssistantParts([
        { kind: 'text', text: '<thi' },
        { kind: 'text', text: 'nk>raisonnement</think>R\u00e9ponse' }
      ])
    ).toEqual([{ kind: 'text', text: 'R\u00e9ponse' }])
  })
})

describe('coût par tour (pastille live)', () => {
  it('calcule le coût-eq (output ×5) et classe par seuils réels', () => {
    expect(turnCostEq({ inputTokens: 3000, outputTokens: 500 })).toBe(3000 + 2500)
    expect(turnCostEq(null)).toBe(0)
    expect(costEqTier(5000).dotClass).toBe('st-ok') // < 18k
    expect(costEqTier(30000).dotClass).toBe('st-warn') // 18k-47k
    expect(costEqTier(80000).dotClass).toBe('st-err') // > 47k
  })
})

describe('modelCostTier', () => {
  it('classe le prix par famille de modèle', () => {
    expect(modelCostTier('cc/claude-opus-4-8').tier).toBe('high')
    expect(modelCostTier('cc/claude-haiku-4-5-20251001').tier).toBe('low')
    expect(modelCostTier('cc/claude-sonnet-4-6').tier).toBe('mid')
    expect(modelCostTier('aug/gemini-3.1-flash').tier).toBe('low')
    // Route auto → coût variable, pas de fausse assertion.
    expect(modelCostTier('auto/claude-opus').tier).toBe('unknown')
    expect(modelCostTier('auto/best-coding').tier).toBe('unknown')
    // Inconnu → gris, jamais deviné.
    expect(modelCostTier('tllm/some_weird_model').tier).toBe('unknown')
  })
})

describe('durable assistant hydration and streaming', () => {
  it('restores structured parts and terminal state without flattening actions', () => {
    expect(
      hydrateStoredAssistant({
        content: 'projection',
        turnId: 'turn-1',
        status: 'completed',
        parts: [
          { kind: 'text', text: 'Avant.' },
          {
            kind: 'action',
            actionId: 'a1',
            name: 'get_state',
            args: { target: 'chat' },
            ok: true,
            data: { source: 'disk' }
          },
          { kind: 'text', text: 'Après.' }
        ]
      })
    ).toEqual({
      role: 'assistant',
      turnId: 'turn-1',
      status: 'completed',
      done: true,
      parts: [
        { kind: 'text', text: 'Avant.' },
        {
          kind: 'action',
          actionId: 'a1',
          name: 'get_state',
          args: { target: 'chat' },
          ok: true,
          data: { source: 'disk' }
        },
        { kind: 'text', text: 'Après.' }
      ]
    })
  })

  it('hydrates legacy flat messages and ignores an event from another turn', () => {
    const legacy = hydrateStoredAssistant({ content: 'Ancien texte' })
    expect(legacy.parts).toEqual([{ kind: 'text', text: 'Ancien texte' }])
    expect(
      reduceAssistantPilotEvent(legacy, {
        kind: 'delta',
        turnId: 'other-turn',
        streamId: '0:0',
        text: 'fuite'
      })
    ).toBe(legacy)
  })

  it('binds the first turn id then reduces progressive deltas without duplication', () => {
    const empty = hydrateStoredAssistant({ content: '', status: 'streaming', parts: [] })
    const first = reduceAssistantPilotEvent(empty, {
      kind: 'delta',
      turnId: 'turn-live',
      streamId: '0:0',
      text: 'Bon'
    })
    const second = reduceAssistantPilotEvent(first, {
      kind: 'delta',
      turnId: 'turn-live',
      streamId: '0:0',
      text: 'jour'
    })
    expect(second).toMatchObject({
      turnId: 'turn-live',
      done: false,
      parts: [{ kind: 'text', streamId: '0:0', text: 'Bonjour' }]
    })
  })
})

describe('resolveChatRuntimeIdentity', () => {
  it('resolves the actual orchestrator provider, model and effort from the dynamic catalog', () => {
    expect(
      resolveChatRuntimeIdentity(
        {
          orchestrator: {
            slotId: 'orchestrator',
            provider: 'future-provider',
            modelId: 'future-provider/stellar',
            reasoningEffort: 'ultra'
          }
        },
        [
          {
            id: 'future-provider/stellar',
            provider: 'future-provider',
            model: 'stellar-v2',
            label: 'Stellar V2'
          }
        ]
      )
    ).toEqual({
      provider: 'future-provider',
      model: 'stellar-v2',
      modelLabel: 'Stellar V2',
      reasoningEffort: 'ultra'
    })
  })

  it('falls back to truthful ids instead of inventing a known provider', () => {
    expect(
      resolveChatRuntimeIdentity(
        {
          orchestrator: {
            slotId: 'orchestrator',
            provider: 'custom',
            modelId: 'custom/missing',
            reasoningEffort: 'high'
          }
        },
        []
      )
    ).toEqual({
      provider: 'custom',
      model: 'custom/missing',
      modelLabel: 'custom/missing',
      reasoningEffort: 'high'
    })
  })

  it('prefers the live orchestrator role consumed by chat over a stale topology', () => {
    expect(
      resolveChatRuntimeIdentity(
        {
          orchestrator: {
            provider: 'claude',
            modelId: 'claude/claude-fable-5',
            reasoningEffort: 'high'
          }
        },
        [
          {
            id: 'codex/gpt-5.6-terra',
            provider: 'codex',
            model: 'gpt-5.6-terra',
            label: 'GPT-5.6 Terra · Codex'
          }
        ],
        { provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'ultra' }
      )
    ).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-terra',
      modelLabel: 'GPT-5.6 Terra · Codex',
      reasoningEffort: 'ultra'
    })
  })
})

describe('coalesceAssistantParts', () => {
  it('merges only consecutive text fragments into one readable block', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'text', text: 'Premiere phrase.' },
        { kind: 'text', text: 'Deuxieme phrase.' },
        { kind: 'action', name: 'navigate', ok: true, data: { tab: 'memory' } },
        { kind: 'text', text: 'Conclusion.' }
      ])
    ).toEqual([
      { kind: 'text', text: 'Premiere phrase.\n\nDeuxieme phrase.' },
      { kind: 'action', name: 'navigate', ok: true, data: { tab: 'memory' } },
      { kind: 'text', text: 'Conclusion.' }
    ])
  })

  it('does not create empty text blocks', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'text', text: '  ' },
        { kind: 'action', name: 'get_state' },
        { kind: 'text', text: '' }
      ])
    ).toEqual([{ kind: 'action', name: 'get_state' }])
  })
})

describe('groupAssistantActivity', () => {
  it('groups consecutive actions without crossing surrounding text', () => {
    expect(
      groupAssistantActivity([
        { kind: 'text', text: 'Avant.' },
        { kind: 'action', name: 'navigate', ok: true },
        { kind: 'action', name: 'get_state', ok: false, data: { error: 'boom' } },
        { kind: 'text', text: 'Après.' }
      ])
    ).toEqual([
      { kind: 'text', text: 'Avant.' },
      {
        kind: 'activity',
        actions: [
          { kind: 'action', name: 'navigate', ok: true },
          { kind: 'action', name: 'get_state', ok: false, data: { error: 'boom' } }
        ]
      },
      { kind: 'text', text: 'Après.' }
    ])
  })
})

describe('chat scrolling and layout rules', () => {
  it('follows the tail only when the reader is close to the bottom', () => {
    expect(isChatNearBottom({ scrollTop: 700, clientHeight: 300, scrollHeight: 1040 })).toBe(true)
    expect(isChatNearBottom({ scrollTop: 300, clientHeight: 300, scrollHeight: 1040 })).toBe(false)
  })

  it('keeps the conversation library within usable bounds', () => {
    expect(clampConversationPaneWidth(100)).toBe(CHAT_PANE_LIMITS.conversations.min)
    expect(clampConversationPaneWidth(999)).toBe(CHAT_PANE_LIMITS.conversations.max)
    expect(clampConversationPaneWidth(344.6)).toBe(345)
  })
})

describe('conversation-scoped workflow state', () => {
  it('keeps a live run attached to its conversation across navigation', () => {
    const started = reduceScopedLiveRuns(
      {},
      {
        type: 'start',
        convId: 'conversation-a',
        runPath: 'run-a',
        task: 'audit A'
      }
    )
    const stepped = reduceScopedLiveRuns(started, {
      type: 'step',
      convId: 'conversation-a',
      runPath: 'run-a',
      step: { type: 'exec', label: 'worker A' }
    })

    expect(stepped['conversation-a']).toMatchObject({ task: 'audit A', status: 'running' })
    expect(stepped['conversation-a']?.steps).toEqual([{ type: 'exec', label: 'worker A' }])
    expect(stepped['conversation-b']).toBeUndefined()
  })

  it('tracks the active phase then clears it when the step is recorded', () => {
    const started = reduceScopedLiveRuns(
      {},
      { type: 'start', convId: 'conversation-a', runPath: 'run-a', task: 'audit A' }
    )
    const phased = reduceScopedLiveRuns(started, {
      type: 'phase',
      convId: 'conversation-a',
      runPath: 'run-a',
      phase: { step: 'exec', provider: 'claude', role: 'subagent' }
    })
    expect(phased['conversation-a']?.phase).toEqual({
      step: 'exec',
      provider: 'claude',
      role: 'subagent'
    })

    const stepped = reduceScopedLiveRuns(phased, {
      type: 'step',
      convId: 'conversation-a',
      runPath: 'run-a',
      step: { type: 'exec', label: 'worker A' }
    })
    expect(stepped['conversation-a']?.phase).toBeUndefined()
    expect(stepped['conversation-a']?.steps).toEqual([{ type: 'exec', label: 'worker A' }])
  })

  it('accumulates streamed deltas then clears them when the step lands', () => {
    let state = reduceScopedLiveRuns({}, { type: 'start', convId: 'c', runPath: 'r', task: 't' })
    state = reduceScopedLiveRuns(state, {
      type: 'phase',
      convId: 'c',
      runPath: 'r',
      phase: { step: 'exec' }
    })
    state = reduceScopedLiveRuns(state, { type: 'delta', convId: 'c', runPath: 'r', delta: 'Hel' })
    state = reduceScopedLiveRuns(state, { type: 'delta', convId: 'c', runPath: 'r', delta: 'lo' })
    expect(state['c']?.liveText).toBe('Hello')

    // Une nouvelle phase repart d'un texte vierge.
    state = reduceScopedLiveRuns(state, {
      type: 'phase',
      convId: 'c',
      runPath: 'r',
      phase: { step: 'judge' }
    })
    expect(state['c']?.liveText).toBe('')

    const stepped = reduceScopedLiveRuns(state, {
      type: 'step',
      convId: 'c',
      runPath: 'r',
      step: { type: 'judge' }
    })
    expect(stepped['c']?.liveText).toBeUndefined()
  })

  it('rejects a runs response when its conversation or scope is no longer current', () => {
    const requested = { id: 4, scope: 'conv' as const, convId: 'conversation-a' }

    expect(isRunRequestCurrent(requested, requested)).toBe(true)
    expect(isRunRequestCurrent(requested, { id: 5, scope: 'conv', convId: 'conversation-b' })).toBe(
      false
    )
    expect(isRunRequestCurrent(requested, { id: 4, scope: 'tous', convId: null })).toBe(false)
  })
})

describe('phaseLabel (A4 — libellé de phase live)', () => {
  it('nomme la phase pipeline en clair', () => {
    expect(phaseLabel({ step: 'exec', phase: 'scout' })).toBe('sous-agent · scout')
    expect(phaseLabel({ step: 'exec', phase: 'frame' })).toBe('sous-agent · cadrage')
    expect(phaseLabel({ step: 'exec', phase: 'clean' })).toBe('sous-agent · nettoyage')
  })

  it('retombe sur le libellé d’étape si pas de phase', () => {
    expect(phaseLabel({ step: 'exec' })).toBe('sous-agent')
    expect(phaseLabel({ step: 'judge' })).toBe('juge')
    expect(phaseLabel({ step: 'gate' })).toBe('gate')
  })
})
