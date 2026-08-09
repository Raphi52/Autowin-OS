import { describe, expect, it } from 'vitest'
import {
  CHAT_PANE_LIMITS,
  clampConversationPaneWidth,
  coalesceAssistantParts,
  deriveConversationState,
  groupAssistantActivity,
  isRunRequestCurrent,
  isChatNearBottom,
  scrollChatToBottom,
  hydrateStoredAssistant,
  createLiveRunDeltaBatcher,
  reduceAssistantPilotEvent,
  reduceScopedLiveRuns,
  phaseLabel,
  resolveChatRuntimeIdentity,
  modelCostTier,
  stripAssistantThinking,
  turnCostEq,
  costEqTier
} from './chat-view-model'

describe('live orchestration delta batching', () => {
  it('coalesces a burst into one renderer update and preserves all text', () => {
    const scheduled: Array<() => void> = []
    const batches: string[][] = []
    const batcher = createLiveRunDeltaBatcher<string>(
      (batch) => batches.push(batch),
      (flush) => {
        scheduled.push(flush)
        return scheduled.length
      },
      () => undefined
    )

    for (let index = 0; index < 5_000; index += 1) batcher.enqueue(String(index))

    expect(scheduled).toHaveLength(1)
    expect(batches).toHaveLength(0)
    scheduled[0]()
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(5_000)
    expect(batches[0].join('')).toContain('4999')
  })

  it('cancels pending work without applying stale deltas', () => {
    const scheduled: Array<() => void> = []
    const cancelled: number[] = []
    const batches: string[][] = []
    const batcher = createLiveRunDeltaBatcher<string>(
      (batch) => batches.push(batch),
      (flush) => {
        scheduled.push(flush)
        return 42
      },
      (handle) => cancelled.push(handle)
    )

    batcher.enqueue('stale')
    batcher.cancel()
    scheduled[0]()

    expect(cancelled).toEqual([42])
    expect(batches).toEqual([])
  })

  it('cancels the scheduled callback when an ordering event forces a flush', () => {
    const scheduled: Array<() => void> = []
    const cancelled: number[] = []
    const batches: string[][] = []
    const batcher = createLiveRunDeltaBatcher<string>(
      (batch) => batches.push(batch),
      (flush) => {
        scheduled.push(flush)
        return scheduled.length
      },
      (handle) => cancelled.push(handle)
    )

    batcher.enqueue('before-step')
    batcher.flush()
    batcher.enqueue('after-step')
    scheduled[0]()

    expect(cancelled).toEqual([1])
    expect(batches).toEqual([['before-step']])
  })
})

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

  it('reconciles stale worker advice with the successful structured outcome on reload', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: {
            status: 'succeeded',
            valid: true,
            gateBlocked: false,
            reused: false,
            runId: 'run-1'
          }
        },
        {
          kind: 'text',
          text:
            'Tests 12/12 verts.\n\n### Publication\n⚠️ Non publiée. La publication reste à déclencher.\n📍 Maintenant — diff non commité.\n⏳ Reste à faire — gate/publication non exécutées.\n👉 Recommandé — lancer judge.\n\nClôture Autowin : gate validé, RUN fermé green.'
        }
      ]
    })

    const text = hydrated.parts.find((part) => part.kind === 'text')?.text ?? ''
    expect(text).toContain('Tests 12/12 verts.')
    expect(text).toContain('Clôture Autowin : gate validé')
    expect(text).not.toMatch(/non publiée|publication reste|non commité|gate\/publication|lancer judge/i)
  })

  it('preserves unresolved advice when the structured outcome is not a delivered success', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: { status: 'failed', valid: false, gateBlocked: true }
        },
        { kind: 'text', text: 'Gate/publication non exécutées.' }
      ]
    })

    expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toContain(
      'Gate/publication non exécutées.'
    )
  })

  it('adds the authoritative closure when an older successful message did not persist one', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
        },
        { kind: 'text', text: 'Tests verts. RUN toujours open.' }
      ]
    })

    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')
    expect(text).not.toContain('RUN toujours open')
    expect(text).toContain('Clôture Autowin : gate validé, RUN fermé green')
  })

  it('does not let an older success hide a later failed orchestration', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
        },
        { kind: 'text', text: 'Premier run livré.' },
        { kind: 'action', name: 'orchestrate', ok: false, data: { error: 'timeout' } },
        { kind: 'text', text: 'Dernier run en échec : publication non exécutée.' }
      ]
    })

    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')
    expect(text).toContain('Dernier run en échec')
    expect(text).not.toContain('Clôture Autowin : gate validé')
  })

  it('ignores the historical same-turn duplicate refusal because it launched no run', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
        },
        {
          kind: 'action',
          name: 'orchestrate',
          ok: false,
          data:
            'Une orchestration a deja ete lancee dans ce tour. Termine avec son resultat ; un nouveau run exige un nouveau message utilisateur.'
        },
        { kind: 'text', text: 'RUN open — lancer judge.' }
      ]
    })

    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')
    expect(text).not.toContain('RUN open')
    expect(text).toContain('Clôture Autowin : gate validé')
  })

  it('refuses to synthesize a closure from incomplete structured data', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        { kind: 'action', name: 'orchestrate', ok: true, data: { status: 'succeeded' } },
        { kind: 'text', text: 'Publication non exécutée.' }
      ]
    })

    expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(
      'Publication non exécutée.'
    )
  })

  it('deduplicates an authoritative closure persisted in multiple text parts', () => {
    const closure = 'Clôture Autowin : gate validé, RUN fermé green ; publication terminée.'
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
        },
        { kind: 'text', text: `Preuve.\n\n${closure}` },
        { kind: 'text', text: closure }
      ]
    })

    const occurrences = hydrated.parts
      .filter((part) => part.kind === 'text')
      .flatMap((part) => part.text.match(/Clôture Autowin : gate validé/g) ?? [])
    expect(occurrences).toHaveLength(1)
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

  it('atteint le VRAI bas même quand le contenu grandit pendant la descente', () => {
    const queue: Array<() => void> = []
    const targets: Array<{ top: number; behavior?: string }> = []
    const element = {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTo(options: ScrollToOptions) {
        targets.push({ top: options.top ?? 0, behavior: options.behavior })
      }
    }

    scrollChatToBottom(element, (callback) => queue.push(callback))
    expect(targets[0]).toEqual({ top: 1000, behavior: 'smooth' })

    // Le markdown/les images finissent de se rendre : le bas RÉEL a bougé.
    element.scrollHeight = 2400
    queue.shift()?.()

    // Sans re-ciblage on resterait bloqué à 1000 — un « scroll down » qui n'atteint pas le dernier message.
    expect(targets.at(-1)?.top).toBe(2400)

    // La descente se termine par un atterrissage garanti sur le bas final.
    while (queue.length > 0) queue.shift()?.()
    expect(targets.at(-1)).toEqual({ top: 2400, behavior: 'auto' })
  })

  it('arrête la descente quand le fil est démonté, sans replanifier de frame', () => {
    const queue: Array<() => void> = []
    const scrolls: ScrollToOptions[] = []
    const element = {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
      isConnected: true,
      scrollTo(options: ScrollToOptions) {
        scrolls.push(options)
      }
    }

    scrollChatToBottom(element, (callback) => queue.push(callback))
    expect(queue).toHaveLength(1)

    element.isConnected = false
    const scrollsBeforeUnmount = scrolls.length
    queue.shift()?.()

    // Sans ce garde, la boucle survivait au démontage et rappelait un window détruit.
    expect(queue).toHaveLength(0)
    // Et elle ne doit plus scroller un élément démonté.
    expect(scrolls).toHaveLength(scrollsBeforeUnmount)
  })

  it("abandonne la descente si le lecteur remonte lui-même entre deux frames", () => {
    const queue: Array<() => void> = []
    const targets: Array<{ top: number }> = []
    const element = {
      scrollTop: 500,
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTo(options: ScrollToOptions) {
        targets.push({ top: options.top ?? 0 })
      }
    }

    scrollChatToBottom(element, (callback) => queue.push(callback))
    const beforeReaderActs = targets.length

    element.scrollTop = 40 // le lecteur reprend la main et remonte
    while (queue.length > 0) queue.shift()?.()

    expect(targets).toHaveLength(beforeReaderActs)
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

  it('garde le fil des sous-agents une fois le run TERMINÉ — c’est la preuve de ce qui a été fait', () => {
    // Séquence exacte que le chat exécutait : start → step → end, puis un `clear` planifié 4 s plus tard
    // (ChatView.tsx, `orchestrate-end`). Le `clear` faisait `delete next[convId]` : l'entrée partait avec
    // ses `steps`, et rien ne les reprenait — `RunSummary` ne porte aucun step.
    const started = reduceScopedLiveRuns(
      {},
      { type: 'start', convId: 'conversation-a', runPath: 'run-a', task: 'audit A' }
    )
    const stepped = reduceScopedLiveRuns(started, {
      type: 'step',
      convId: 'conversation-a',
      runPath: 'run-a',
      step: { type: 'exec', label: 'worker A' }
    })
    const ended = reduceScopedLiveRuns(stepped, {
      type: 'end',
      convId: 'conversation-a',
      runPath: 'run-a',
      status: 'green'
    })
    expect(ended['conversation-a']?.steps).toHaveLength(1)

    // Même si un `clear` arrive quand même, un run TERMINÉ ne doit plus pouvoir être détruit : la garde
    // est structurelle, pas une promesse de ne plus appeler la fonction.
    const afterStrayClear = reduceScopedLiveRuns(ended, {
      type: 'clear',
      convId: 'conversation-a',
      runPath: 'run-a'
    })
    expect(afterStrayClear['conversation-a']?.steps).toHaveLength(1)
    expect(afterStrayClear['conversation-a']?.status).toBe('green')
  })

  it('un run ENCORE EN COURS reste effaçable — la garde doit DISCRIMINER', () => {
    const started = reduceScopedLiveRuns(
      {},
      { type: 'start', convId: 'conversation-a', runPath: 'run-a', task: 'audit A' }
    )
    const cleared = reduceScopedLiveRuns(started, {
      type: 'clear',
      convId: 'conversation-a',
      runPath: 'run-a'
    })
    expect(cleared['conversation-a']).toBeUndefined()
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
