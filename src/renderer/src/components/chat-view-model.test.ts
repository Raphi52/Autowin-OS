import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatOrchestrationOutcome } from '../../../shared/orchestration-outcome'
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

  it('marque une conversation qui attend une décision de l’utilisateur', () => {
    expect(
      deriveConversationState({
        busy: false,
        messageCount: 2,
        lastMessageRole: 'assistant',
        lastAssistantStatus: 'completed',
        asksUser: true
      })
    ).toMatchObject({ key: 'asking', label: 'Ta réponse attendue', glyph: '?' })
  })

  it('ne marque pas « attend ta réponse » quand un tour tourne ou que l’utilisateur a repris la main', () => {
    // Entrées qui feraient échouer une correction trop large :
    expect(
      deriveConversationState({ busy: true, messageCount: 2, asksUser: true })
    ).toMatchObject({ key: 'running' })
    expect(
      deriveConversationState({
        busy: false,
        messageCount: 3,
        lastMessageRole: 'user',
        asksUser: true
      })
    ).toMatchObject({ key: 'waiting' })
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
          text: 'Tests 12/12 verts.\n\n### Publication\n⚠️ Non publiée. La publication reste à déclencher.\n📍 Maintenant — diff non commité.\n⏳ Reste à faire — gate/publication non exécutées.\n👉 Recommandé — lancer judge.\n\nClôture Autowin : gate validé, RUN fermé green.'
        }
      ]
    })

    const text = hydrated.parts.find((part) => part.kind === 'text')?.text ?? ''
    expect(text).toContain('Tests 12/12 verts.')
    expect(text).toContain('Clôture Autowin : gate validé')
    expect(text).not.toMatch(
      /non publiée|publication reste|non commité|gate\/publication|lancer judge/i
    )
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

  it.each(['failed', 'interrupted', 'cancelled'] as const)(
    'does not let an older success hide a terminal %s message',
    (status) => {
      const hydrated = hydrateStoredAssistant({
        content: 'projection',
        status,
        error: status === 'failed' ? 'timeout après orchestration' : undefined,
        parts: [
          {
            kind: 'action',
            name: 'orchestrate',
            ok: true,
            data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
          },
          { kind: 'text', text: 'Échec final : publication non exécutée.' }
        ]
      })

      const text = hydrated.parts
        .filter((part) => part.kind === 'text')
        .map((part) => part.text)
        .join('\n')
      expect(text).toContain('Échec final : publication non exécutée.')
      expect(text).not.toContain('Clôture Autowin : gate validé')
    }
  )

  it('treats a legacy message with an error and no status as failed', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      error: 'timeout après orchestration',
      parts: [
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
        },
        { kind: 'text', text: 'Échec final : publication non exécutée.' }
      ]
    })

    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')
    expect(hydrated.status).toBe('failed')
    expect(text).toContain('Échec final : publication non exécutée.')
    expect(text).not.toContain('Clôture Autowin : gate validé')
  })

  it.each(['failed', 'interrupted', 'cancelled'] as const)(
    'removes a persisted green closure when the message is %s',
    (status) => {
      const hydrated = hydrateStoredAssistant({
        content: 'projection',
        status,
        parts: [
          {
            kind: 'action',
            name: 'orchestrate',
            ok: true,
            data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
          },
          {
            kind: 'text',
            text: 'Clôture Autowin : gate validé, RUN fermé green ; publication terminée.'
          },
          { kind: 'text', text: 'Échec final : publication non exécutée.' }
        ]
      })
      const text = hydrated.parts
        .filter((part) => part.kind === 'text')
        .map((part) => part.text)
        .join('\n')

      expect(text).toContain('Échec final : publication non exécutée.')
      expect(text).not.toContain('Clôture Autowin : gate validé')
    }
  )

  it('keeps failure evidence appended to a stale closure on the same line', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'failed',
      parts: [
        {
          kind: 'text',
          text: 'Clôture Autowin : gate validé, RUN fermé green ; publication terminée. Échec final : timeout.'
        }
      ]
    })

    const text = hydrated.parts.find((part) => part.kind === 'text')?.text ?? ''
    expect(text).toBe('Échec final : timeout.')
  })

  it.each([
    '1. Clôture Autowin : gate validé, RUN fermé green ; publication terminée.',
    '- [x] Clôture Autowin : gate validé, RUN fermé green ; publication terminée.',
    '✅ Clôture Autowin : gate validé, RUN fermé green ; publication terminée.',
    '### Clôture Autowin : gate validé, RUN fermé green ; publication terminée.',
    '_Clôture Autowin : gate validé, RUN fermé green ; publication terminée._'
  ])('removes a decorated green closure from a failed message: %s', (closure) => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'failed',
      parts: [
        { kind: 'text', text: closure },
        { kind: 'text', text: 'Échec final : timeout.' }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(text).toBe('Échec final : timeout.')
  })

  it.each([
    [
      'Clôture Autowin : gate validé, RUN fermé green ; Échec final : timeout.',
      'Échec final : timeout.'
    ],
    [
      'Clôture Autowin : gate validé, RUN fermé green - Échec final : timeout.',
      'Échec final : timeout.'
    ],
    [
      'Clôture Autowin : gate validé, RUN fermé green ; publication terminée ; Échec final : timeout.',
      'Échec final : timeout.'
    ],
    [
      'Échec final : timeout. Clôture Autowin : gate validé, RUN fermé green ; publication terminée.',
      'Échec final : timeout.'
    ],
    [
      'Clôture Autowin : gate validé, RUN fermé green Échec final : timeout.',
      'Échec final : timeout.'
    ],
    [
      'Clôture Autowin : gate validé, RUN fermé green : Échec final : timeout.',
      'Échec final : timeout.'
    ],
    [
      'Clôture Autowin : gate validé, RUN fermé green ; publication terminée, Échec final : timeout.',
      'Échec final : timeout.'
    ],
    [
      'Clôture Autowin : gate validé, RUN fermé green ; publication terminée | Échec final : timeout.',
      'Échec final : timeout.'
    ],
    [
      'Clôture Autowin : gate validé, RUN fermé green ; publication terminée · Échec final : timeout.',
      'Échec final : timeout.'
    ],
    [
      'Clôture Autowin : gate validé, RUN fermé green ; publication terminée / Échec final : timeout.',
      'Échec final : timeout.'
    ]
  ])('removes only the stale closure clause from a failed line: %s', (line, expected) => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'failed',
      parts: [{ kind: 'text', text: line }]
    })

    expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(expected)
  })

  it.each([
    '**publication terminée**',
    'publication **terminée**',
    '[publication terminée](#done)'
  ])('removes a Markdown-wrapped closure suffix from a failed line: %s', (suffix) => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'failed',
      parts: [
        {
          kind: 'text',
          text: `Clôture Autowin : gate validé, RUN fermé green ; ${suffix} ; Échec final : timeout.`
        }
      ]
    })

    expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe('Échec final : timeout.')
  })

  it.each(['```', '~~~'])(
    'preserves a closure citation inside a %s fenced code block on failure',
    (fence) => {
      const text = `${fence}text\nClôture Autowin : gate validé, RUN fermé green ; publication terminée.\n${fence}\nÉchec final : timeout.`
      const hydrated = hydrateStoredAssistant({
        content: 'projection',
        status: 'failed',
        parts: [{ kind: 'text', text }]
      })

      expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(text)
    }
  )

  it('does not count a closure citation in a fenced block as the completed verdict', () => {
    const citation =
      '```text\nClôture Autowin : gate validé, RUN fermé green ; publication terminée.\n```'
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
        { kind: 'text', text: citation }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(text).toContain(citation)
    expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(2)
    expect(text.trimEnd().endsWith('publication terminée.')).toBe(true)
  })

  it.each([
    ['````', '```'],
    ['~~~~', '~~~']
  ])(
    'keeps a closure citation inside a longer %s fence containing %s on failure',
    (outerFence, innerFence) => {
      const text =
        `${outerFence}text\n${innerFence}js\n` +
        `Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n` +
        `${innerFence}\n${outerFence}\nÉchec final : timeout.`
      const hydrated = hydrateStoredAssistant({
        content: 'projection',
        status: 'failed',
        parts: [{ kind: 'text', text }]
      })

      expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(text)
    }
  )

  it.each(['```', '~~~'])(
    'does not treat a %s fence with an info-string as a closing fence on failure',
    (fence) => {
      const text =
        `${fence}text\n${fence}not-a-close\n` +
        `Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n` +
        `${fence}\nÉchec final : timeout.`
      const hydrated = hydrateStoredAssistant({
        content: 'projection',
        status: 'failed',
        parts: [{ kind: 'text', text }]
      })

      expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(text)
    }
  )

  it.each([
    ['````', '```js', '```'],
    ['~~~~', '~~~js', '~~~'],
    ['```', '```not-a-close', ''],
    ['~~~', '~~~not-a-close', '']
  ])(
    'adds the real completed verdict outside %s when %s is fenced evidence',
    (outerFence, embeddedFence, embeddedClose) => {
      const citation =
        `${outerFence}text\n${embeddedFence}\n` +
        `Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n` +
        `${embeddedClose ? `${embeddedClose}\n` : ''}${outerFence}`
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
          { kind: 'text', text: citation }
        ]
      })
      const text = hydrated.parts
        .filter((part) => part.kind === 'text')
        .map((part) => part.text)
        .join('\n')

      expect(text).toContain(citation)
      expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(2)
      expect(text.trimEnd().endsWith('publication terminée.')).toBe(true)
    }
  )

  it.each(['```', '~~~'])('shares %s fence state across persisted text parts', (fence) => {
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
        { kind: 'text', text: `${fence}text` },
        { kind: 'text', text: 'RUN reste open — lancer judge.' },
        { kind: 'text', text: fence }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(text).toContain(`${fence}text\nRUN reste open — lancer judge.\n${fence}`)
    expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(1)
  })

  it.each(['```', '~~~'])(
    'keeps a %s fenced blockquote intact and adds a real completed verdict',
    (fence) => {
      const citation =
        `> ${fence}text\n> RUN reste open — lancer judge.\n` +
        `> Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n> ${fence}`
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
          { kind: 'text', text: citation }
        ]
      })
      const text = hydrated.parts
        .filter((part) => part.kind === 'text')
        .map((part) => part.text)
        .join('\n')

      expect(text).toContain(citation)
      expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(2)
    }
  )

  it.each(['```', '~~~'])('keeps a %s fenced blockquote intact on failure', (fence) => {
    const text =
      `> ${fence}text\n` +
      `> Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n` +
      `> ${fence}\nÉchec final : timeout.`
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'failed',
      parts: [{ kind: 'text', text }]
    })

    expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(text)
  })

  it.each(['```', '~~~'])(
    'does not close a %s fence on a four-space-indented delimiter',
    (fence) => {
      const citation =
        `${fence}text\n    ${fence}\n` +
        `Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n${fence}`
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
          { kind: 'text', text: citation }
        ]
      })
      const text = hydrated.parts
        .filter((part) => part.kind === 'text')
        .map((part) => part.text)
        .join('\n')

      expect(text).toContain(citation)
      expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(2)
    }
  )

  it.each(['```', '~~~'])('inherits a %s fence opened before the successful action', (fence) => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        { kind: 'text', text: `${fence}text` },
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
        },
        { kind: 'text', text: '  RUN reste open  \n' },
        { kind: 'text', text: fence }
      ]
    })
    const texts = hydrated.parts.filter((part) => part.kind === 'text').map((part) => part.text)

    expect(texts.slice(0, 3)).toEqual([`${fence}text`, '  RUN reste open  \n', fence])
    expect(texts.join('\n').match(/Clôture Autowin : gate validé/g)).toHaveLength(1)
  })

  it('keeps an indented CommonMark code block intact and adds a real completed verdict', () => {
    const citation =
      '    Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n' +
      '    RUN reste open — lancer judge.\n\n    SHA-256 abc123 vérifié.  '
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
        { kind: 'text', text: citation }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(text).toContain(citation)
    expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(2)
  })

  it('keeps an indented CommonMark closure citation intact on failure', () => {
    const text =
      '    Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n' +
      '    RUN reste open — lancer judge.\n\nÉchec final : timeout.'
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'failed',
      parts: [{ kind: 'text', text }]
    })

    expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(text)
  })

  it.each([
    '- ```text\n  Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n  ```',
    '- ~~~text\n  Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n  ~~~',
    '10. Preuve :\n    ```text\n    Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n    ```',
    '-   Preuve :\n    ~~~text\n    Clôture Autowin : gate validé, RUN fermé green ; publication terminée.\n    ~~~'
  ])('keeps a list-contained closure citation and adds the real verdict', (citation) => {
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
        { kind: 'text', text: citation }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(text).toContain(citation)
    expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(2)
  })

  it('preserves fenced whitespace after removing an adjacent stale line', () => {
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
        { kind: 'text', text: 'RUN reste open.\n```text\n  value  \n' }
      ]
    })

    expect(hydrated.parts.filter((part) => part.kind === 'text')[0]?.text).toBe(
      '```text\n  value  \n'
    )
  })

  it.each([
    'Ancienne trace : `RUN reste open.`.',
    'Historique : [RUN reste open](#ancien).',
    'Log observé : /lancer judge/.',
    'Aucune occurrence de RUN open.',
    'Sans mention de RUN reste open.',
    'Il n’y a plus de RUN reste open.'
  ])('keeps standalone historical or negated lifecycle evidence: %s', (evidence) => {
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
        { kind: 'text', text: evidence }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(text).toContain(evidence)
    expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(1)
  })

  it('does not rewrite factual evidence emitted before the latest successful orchestration', () => {
    const hydrated = hydrateStoredAssistant({
      content: 'projection',
      status: 'completed',
      parts: [
        { kind: 'action', name: 'orchestrate', ok: false, data: { error: 'timeout' } },
        { kind: 'text', text: 'Échec initial : publication non exécutée.' },
        {
          kind: 'action',
          name: 'orchestrate',
          ok: true,
          data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
        },
        { kind: 'text', text: 'Tests 12/12 verts.' }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(text).toContain('Échec initial : publication non exécutée.')
    expect(text).toContain('Tests 12/12 verts.')
    expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(1)
  })

  it('préserve le footer autoritaire après persistance et réhydratation', () => {
    const outcome = {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result: 'Tests 12/12 verts.'
    }
    // Chemin `/skill` normal : aucune notice tardive n'est ajoutée avant le footer.
    const liveText = formatOrchestrationOutcome(true, outcome)
    const hydrated = hydrateStoredAssistant({
      content: liveText,
      status: 'completed',
      parts: [
        { kind: 'action', name: 'orchestrate', ok: true, data: outcome },
        { kind: 'text', text: liveText }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    for (const heading of ['✅ Fait', '📍 Maintenant', '⏳ Reste à faire', '👉 Recommandé']) {
      expect(text.split(heading)).toHaveLength(2)
    }
    expect(text.trimEnd()).toMatch(/👉 Recommandé : .+\.$/u)
    expect(text).not.toContain('Clôture Autowin : gate validé')
  })

  it('removes a persisted green closure when the latest orchestration failed', () => {
    const previousGreenText = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result: 'Ancienne preuve : tests 12/12 verts.'
    })
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
        { kind: 'text', text: previousGreenText },
        { kind: 'action', name: 'orchestrate', ok: false, data: { error: 'timeout' } },
        { kind: 'text', text: 'Échec final : publication non exécutée.' }
      ]
    })
    const text = hydrated.parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n')

    expect(text).toContain('Échec final : publication non exécutée.')
    expect(text).toContain('Ancienne preuve : tests 12/12 verts.')
    expect(text).not.toContain('Workflow livré : gate validé')
    expect(text).not.toContain('Reste à faire : rien')
    expect(text).not.toContain('passer à la prochaine demande')
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
          data: 'Une orchestration a deja ete lancee dans ce tour. Termine avec son resultat ; un nouveau run exige un nouveau message utilisateur.'
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

  it('recognizes a persisted closure wrapped in Markdown without adding a second one', () => {
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
          kind: 'text',
          text: '**Clôture Autowin : gate validé, RUN fermé green ; publication terminée.**'
        }
      ]
    })

    const occurrences = hydrated.parts
      .filter((part) => part.kind === 'text')
      .flatMap((part) => part.text.match(/Clôture Autowin : gate validé/g) ?? [])
    expect(occurrences).toHaveLength(1)
  })

  it('deduplicates authoritative closures concatenated on the same line', () => {
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
        { kind: 'text', text: `${closure} ${closure}` }
      ]
    })

    const text = hydrated.parts.find((part) => part.kind === 'text')?.text ?? ''
    expect(text.match(/Clôture Autowin : gate validé/g)).toHaveLength(1)
  })

  it('does not mistake a quoted closure assertion for an authoritative closure line', () => {
    const quote = 'Test vert : expect(text).toContain("Clôture Autowin : gate validé").'
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
        { kind: 'text', text: quote }
      ]
    })
    const lines = hydrated.parts
      .filter((part) => part.kind === 'text')
      .flatMap((part) => part.text.split('\n'))

    expect(lines).toContain(quote)
    expect(
      lines.filter((line) => line.startsWith('Clôture Autowin : gate validé, RUN fermé green'))
    ).toHaveLength(1)
  })

  it('preserves a quoted assertion after the authoritative closure', () => {
    const closure = 'Clôture Autowin : gate validé, RUN fermé green ; publication terminée.'
    const quote = 'Test vert : expect(text).toContain("Clôture Autowin : gate validé").'
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
        { kind: 'text', text: `${closure}\n${quote}` }
      ]
    })
    const lines = hydrated.parts
      .filter((part) => part.kind === 'text')
      .flatMap((part) => part.text.split('\n'))

    expect(lines).toContain(quote)
    expect(lines.filter((line) => line.startsWith(closure))).toHaveLength(1)
  })

  it('does not treat an explanatory sentence starting with the short label as a verdict', () => {
    const explanation =
      'Clôture Autowin : gate validé est la chaîne attendue par le test, pas le verdict.'
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
        { kind: 'text', text: explanation }
      ]
    })
    const lines = hydrated.parts
      .filter((part) => part.kind === 'text')
      .flatMap((part) => part.text.split('\n'))

    expect(lines).toContain(explanation)
    expect(
      lines.filter((line) => line.startsWith('Clôture Autowin : gate validé, RUN fermé green'))
    ).toHaveLength(1)
  })

  it('preserves a short closure citation on the same line as the real closure', () => {
    const line =
      'Clôture Autowin : gate validé, RUN fermé green ; publication terminée. Test vert : expect(text).toContain("Clôture Autowin : gate validé") — PASS.'
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
        { kind: 'text', text: line }
      ]
    })

    expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(line)
  })

  it('does not treat the full closure label followed by explanatory prose as a verdict', () => {
    const explanation =
      'Clôture Autowin : gate validé, RUN fermé green est la chaîne attendue par le test, pas le verdict.'
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
        { kind: 'text', text: explanation }
      ]
    })
    const lines = hydrated.parts
      .filter((part) => part.kind === 'text')
      .flatMap((part) => part.text.split('\n'))

    expect(lines).toContain(explanation)
    expect(
      lines.filter((line) => line.startsWith('Clôture Autowin : gate validé, RUN fermé green ;'))
    ).toHaveLength(1)
  })

  it('preserves a full canonical closure citation on the same line as the verdict', () => {
    const closure = 'Clôture Autowin : gate validé, RUN fermé green ; publication terminée.'
    const line = `${closure} Test vert : expect(text).toContain("${closure}") — PASS.`
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
        { kind: 'text', text: line }
      ]
    })

    expect(hydrated.parts.find((part) => part.kind === 'text')?.text).toBe(line)
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
      { kind: 'text', text: 'Premiere phrase.\nDeuxieme phrase.' },
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

  it('preserves source whitespace when CommonMark code spans cross text fragments', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'text', text: '    première ligne  \n' },
        { kind: 'text', text: '    seconde ligne\n' }
      ])
    ).toEqual([{ kind: 'text', text: '    première ligne  \n\n    seconde ligne\n' }])
  })

  it('carries a fenced-code continuation across an intervening action', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'text', text: '~~~text' },
        { kind: 'action', name: 'verify', ok: true },
        { kind: 'text', text: 'preuve\n~~~\nAprès.' }
      ])
    ).toEqual([
      { kind: 'text', text: '~~~text' },
      { kind: 'action', name: 'verify', ok: true },
      {
        kind: 'text',
        text: 'preuve\n~~~\nAprès.',
        markdownContinuationPrefix: '~~~text'
      }
    ])
  })
})

describe('groupAssistantActivity', () => {
  /**
   * Defaut vecu le 2026-08-18 : un scout de code rendait un tableau EN LECTURE SEULE. Le panneau de
   * selection (cases + « Enchainer (frame) sur la selection »), livre le 14/08, teste et branche,
   * n'etait jamais atteint — ce chemin sortait avant lui. Aucun test ne gardait le routeur, donc la
   * fonctionnalite pouvait rester morte sans qu'un seul signal ne rougisse.
   */
  it('un tableau scout markdown devient un panneau SELECTIONNABLE, pas un tableau mort', () => {
    const tableau = [
      '| # | Impact | Effort | Type | Manquement | Pourquoi | 1er pas |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | 🟢 | 🟡 | 🔧 fix | Le journal accepte une ligne mal formee | Elle entre comme fiable | Test rouge sur `src/main/activity/ledger.ts:63` |'
    ].join('\n')

    const blocs = groupAssistantActivity([{ kind: 'text', text: tableau }])

    expect(blocs).toHaveLength(1)
    expect(blocs[0].kind).toBe('candidats-pick')
    expect(blocs[0].kind === 'candidats-pick' && blocs[0].candidats).toEqual([
      {
        titre: 'Le journal accepte une ligne mal formee',
        url: 'src/main/activity/ledger.ts:63',
        type: 'fix',
        // Les pastilles Impact/Effort suivent la ligne : sur ce format il n'y a aucun nombre, elles
        // SONT l'indication de valeur affichee a cote du titre.
        impact: 'g',
        effort: 'y',
        what: 'Le journal accepte une ligne mal formee',
        why: 'Elle entre comme fiable',
        how: 'Test rouge sur `src/main/activity/ledger.ts:63`'
      }
    ])
    // L'ancien rendu en lecture seule ne peut PLUS etre choisi : son bloc a ete retire du modele,
    // donc l'invariant est desormais tenu par le TYPE — plus fort qu'une assertion d'execution.
    expect(blocs.every((bloc) => bloc.kind === 'candidats-pick')).toBe(true)
  })

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

  it('remplace la charge JSON du scout par un panneau et conserve sa synthèse Markdown', () => {
    const texte = [
      'Fichiers lus : [index.ts](src/main/index.ts).',
      '```json',
      '[{"type":"ajout","titre":"Cockpit","url":"src/main/index.ts:1","pertinence":92}]',
      '```'
    ].join('\n')

    expect(groupAssistantActivity([{ kind: 'text', text: texte }])).toEqual([
      { kind: 'text', text: 'Fichiers lus : [index.ts](src/main/index.ts).' },
      {
        kind: 'candidats-pick',
        candidats: [
          {
            type: 'ajout',
            titre: 'Cockpit',
            url: 'src/main/index.ts:1',
            pertinence: 92
          }
        ]
      }
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
    // `behavior` corrigé le 2026-08-17 : l'intention de ce test est le RE-CIBLAGE du vrai bas, pas la
    // façon d'y aller. Ici le bas est à 900 px pour une fenêtre de 100 px — neuf hauteurs d'écran, donc
    // le saut est sec. C'est ce qui a été mesuré défaillant : un `smooth` relancé à chaque frame de
    // croissance repart d'une vitesse nulle et n'avance jamais (fil bloqué à `scrollTop` 0).
    expect(targets[0]).toEqual({ top: 1000, behavior: 'auto' })

    // Le markdown/les images finissent de se rendre : le bas RÉEL a bougé.
    element.scrollHeight = 2400
    queue.shift()?.()

    // Sans re-ciblage on resterait bloqué à 1000 — un « scroll down » qui n'atteint pas le dernier message.
    expect(targets.at(-1)?.top).toBe(2400)

    // La descente se termine par un atterrissage garanti sur le bas final.
    while (queue.length > 0) queue.shift()?.()
    expect(targets.at(-1)).toEqual({ top: 2400, behavior: 'auto' })
  })

  /**
   * MESURÉ le 2026-08-17 par sonde CDP (`scripts/cdp-sonde-bloc-cloture.mjs`, fil réel, un prompt) :
   * pendant un tour qui streame, le fil grandit de 887 → 1911 → 2575 px et `scrollTop` reste à **0**.
   * Le bloc de clôture (émis par l'itération de relance, donc en toute fin) restait donc hors champ
   * jusqu'à ce que l'utilisateur écrive un nouveau message — le défaut rapporté.
   *
   * Cause : une animation `smooth` redémarrée à chaque frame où la hauteur bouge ne progresse jamais
   * (chaque `scrollTo` repart d'une vitesse nulle). Un saut d'une hauteur de fenêtre ou plus doit
   * donc être SEC ; le `smooth` ne garde de sens que pour un dernier centimètre.
   */
  it('rattrape SEC un bas devenu lointain, au lieu de relancer une animation qui n’avance pas', () => {
    const queue: Array<() => void> = []
    const targets: Array<{ top: number; behavior?: string }> = []
    const element = {
      scrollTop: 0,
      clientHeight: 887,
      scrollHeight: 2575,
      scrollTo(options: ScrollToOptions) {
        targets.push({ top: options.top ?? 0, behavior: options.behavior })
        element.scrollTop = (options.top ?? 0) - element.clientHeight
      }
    }

    scrollChatToBottom(element, (callback) => queue.push(callback))

    expect(targets[0]).toEqual({ top: 2575, behavior: 'auto' })
    expect(isChatNearBottom(element)).toBe(true)
  })

  /**
   * Le re-rendu markdown remet `scrollTop` à 0 sous nos pieds : la garde anti-recul le prenait pour
   * un lecteur qui reprend la main et ABANDONNAIT la descente — plus aucune frame ne redescendait
   * ensuite. Discriminant : un lecteur qui remonte le fait sur un fil de hauteur STABLE ; un reset de
   * re-rendu s'accompagne d'un changement de hauteur.
   */
  it('ne prend pas un reset de re-rendu pour un lecteur qui remonte', () => {
    const queue: Array<() => void> = []
    const targets: Array<{ top: number }> = []
    const element = {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTo(options: ScrollToOptions) {
        targets.push({ top: options.top ?? 0 })
        element.scrollTop = (options.top ?? 0) - element.clientHeight
      }
    }

    scrollChatToBottom(element, (callback) => queue.push(callback))
    const apresPremiereDescente = targets.length

    // Le markdown se re-rend : la hauteur bouge ET le navigateur repose le défilement en haut.
    element.scrollHeight = 2400
    element.scrollTop = 0
    queue.shift()?.()

    expect(targets.length).toBeGreaterThan(apresPremiereDescente)
    expect(targets.at(-1)?.top).toBe(2400)
  })

  /**
   * OUVERTURE D'UNE CONVERSATION — défaut rapporté le 2026-08-28 : « la scrollbar est tout en haut au
   * lieu de tout en bas et je dois cliquer dernier message ». Le re-rendu peut reposer `scrollTop` à
   * 0 SANS que la hauteur bouge : la garde anti-recul, qui ne discrimine que par la HAUTEUR, y voyait
   * un lecteur et abandonnait le fil en haut.
   *
   * Discriminant : un saut BRUTAL à 0 depuis le bas n'est pas un geste de lecture ; une molette recule
   * progressivement. On tolère donc UN seul retour-à-zéro, puis on redescend.
   */
  it('redescend après un retour brutal en haut à hauteur STABLE (ouverture de conversation)', () => {
    const queue: Array<() => void> = []
    const targets: Array<{ top: number }> = []
    const element = {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTo(options: ScrollToOptions) {
        targets.push({ top: options.top ?? 0 })
        element.scrollTop = (options.top ?? 0) - element.clientHeight
      }
    }

    scrollChatToBottom(element, (callback) => queue.push(callback))
    const apresPremiereDescente = targets.length
    expect(element.scrollTop).toBe(900)

    element.scrollTop = 0
    queue.shift()?.()

    expect(targets.length).toBeGreaterThan(apresPremiereDescente)
    expect(targets.at(-1)?.top).toBe(1000)
  })

  /**
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER une correction trop large : un lecteur qui remonte à la molette
   * (recul PARTIEL, hauteur stable) garde la main — on ne le ramène pas en bas.
   */
  it('respecte encore un lecteur qui remonte progressivement', () => {
    const queue: Array<() => void> = []
    const targets: Array<{ top: number }> = []
    const element = {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTo(options: ScrollToOptions) {
        targets.push({ top: options.top ?? 0 })
        element.scrollTop = (options.top ?? 0) - element.clientHeight
      }
    }

    scrollChatToBottom(element, (callback) => queue.push(callback))
    const apresPremiereDescente = targets.length

    element.scrollTop = 600
    queue.shift()?.()
    while (queue.length > 0) queue.shift()?.()

    expect(targets.length).toBe(apresPremiereDescente)
  })

  /**
   * FILET DE SECOURS. Le défaut mesuré était SILENCIEUX : le fil se croyait collé au bas, donc aucun
   * bouton ne signalait le texte resté hors champ. Un cas résiduel doit rester visible.
   */
  it('signale une descente qui n’atterrit pas, et ne crie pas quand elle atterrit', () => {
    const descente = (
      croissanceParFrame: number
    ): { atterri: boolean | undefined; appels: number } => {
      const queue: Array<() => void> = []
      let atterri: boolean | undefined
      let appels = 0
      const element = {
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 1000,
        scrollTo(options: ScrollToOptions) {
          // Le fil continue de grandir sous nos pieds : on n'atteint le bas que s'il se stabilise.
          element.scrollTop = (options.top ?? 0) - element.clientHeight
          element.scrollHeight += croissanceParFrame
        }
      }
      scrollChatToBottom(
        element,
        (callback) => queue.push(callback),
        40,
        (landed) => {
          atterri = landed
          appels += 1
        }
      )
      while (queue.length > 0) queue.shift()?.()
      return { atterri, appels }
    }

    // Le fil se stabilise → on atterrit, aucun badge à armer.
    expect(descente(0)).toEqual({ atterri: true, appels: 1 })
    // Le fil grandit sans cesse plus vite que la descente → on le DIT.
    expect(descente(5_000).atterri).toBe(false)
  })

  it('ne fait pas VIBRER le fil : une descente annulée cesse de piloter le conteneur', () => {
    const queue: Array<() => void> = []
    const scrolls: ScrollToOptions[] = []
    const element = {
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 1000,
      scrollTo(options: ScrollToOptions) {
        scrolls.push(options)
        this.scrollTop = Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight)
      }
    }
    // Deux descentes concurrentes, comme deux deltas de streaming successifs.
    const annulerPremiere = scrollChatToBottom(element, (callback) => queue.push(callback))
    scrollChatToBottom(element, (callback) => queue.push(callback))
    annulerPremiere()
    const avant = scrolls.length
    element.scrollHeight = 2400
    while (queue.length > 0) queue.shift()?.()
    // La boucle annulée ne replanifie plus rien : les cibles restent celles de la SEULE survivante.
    expect(scrolls.slice(avant).every((o) => o.top === 2400)).toBe(true)
    expect(element.scrollTop).toBe(2300)
  })

  it("ne relance pas un smooth qui avance déjà (relance par frame = tremblement)", () => {
    const queue: Array<() => void> = []
    const scrolls: ScrollToOptions[] = []
    const element = {
      scrollTop: 0,
      clientHeight: 1000,
      scrollHeight: 1050,
      scrollTo(options: ScrollToOptions) {
        scrolls.push(options)
      }
    }
    scrollChatToBottom(element, (callback) => queue.push(callback))
    expect(scrolls[0]?.behavior).toBe('smooth')
    // L'animation avance d'elle-même pendant que le fil grandit un peu.
    for (let i = 1; i <= 3; i += 1) {
      element.scrollTop += 10
      element.scrollHeight += 5
      queue.shift()?.()
    }
    // Aucun smooth ré-émis tant qu'il progresse.
    expect(scrolls.filter((o) => o.behavior === 'smooth')).toHaveLength(1)
  })

  it('câble le filet de secours dans ChatView (exposé sans appelant = théâtre)', () => {
    const vue = readFileSync(join(__dirname, 'ChatView.tsx'), 'utf8')
    expect(vue).toMatch(/scrollChatToBottom\(\s*scroll,\s*requestAnimationFrame,\s*40,/u)
    expect(vue).toMatch(/if \(!landed\) setHasNewActivity\(true\)/u)
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

  it('abandonne la descente si le lecteur remonte lui-même entre deux frames', () => {
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
