import { describe, expect, it } from 'vitest'
import { closingJournalEvents, promptCallJournalEvents } from './turn-journal-enrich'
import type { PromptCallLike } from './turn-journal-enrich'

const basePrompt = {
  provider: 'anthropic',
  model: 'claude',
  transport: 'sdk',
  system: 'TU ES AUTOWIN',
  systemBlocks: [{ name: 'discipline', chars: 12 }],
  messages: [{ role: 'user', content: 'salut' }],
  options: { reasoningEffort: 'high', apiKey: 'sk-secret' },
  limitation: 'aucune'
}

const promptCall = (over: Partial<PromptCallLike> = {}): PromptCallLike => ({
  iteration: 0,
  prompt: basePrompt,
  response: 'bonjour',
  status: 'completed',
  callUsage: { inputTokens: 10, outputTokens: 5, costUsd: 0.02 },
  callDurationMs: 1234.7,
  sessionId: 'sess-1',
  resolvedModel: 'claude-opus-5',
  ...over
})

describe('journal de tour — ce que l Observatory savait et que le log ignorait', () => {
  it('ecrit le prompt systeme, les options, l usage et le modele resolu', () => {
    const events = promptCallJournalEvents(promptCall(), {}, 111)
    expect(events.map((e) => e.kind)).toEqual(['prompt-system', 'prompt-call'])
    expect(events[0].text).toBe('TU ES AUTOWIN')
    expect(events[0].blocks).toEqual([{ name: 'discipline', chars: 12 }])
    const call = events[1] as Record<string, unknown>
    expect(call.provider).toBe('anthropic')
    expect(call.resolvedModel).toBe('claude-opus-5')
    expect(call.usage).toMatchObject({ costUsd: 0.02, inputTokens: 10 })
    expect(call.durationMs).toBe(1235)
    expect(call.sessionId).toBe('sess-1')
    expect(call.responseChars).toBe(7)
  })

  it('masque les secrets des options provider', () => {
    const [, call] = promptCallJournalEvents(promptCall(), {}, 1)
    expect((call.options as Record<string, unknown>).apiKey).toBe('[masqué]')
    expect((call.options as Record<string, unknown>).reasoningEffort).toBe('high')
  })

  it('ne reecrit le prompt systeme que lorsqu il change', () => {
    const memory = {}
    expect(promptCallJournalEvents(promptCall(), memory, 1).map((e) => e.kind)).toContain(
      'prompt-system'
    )
    expect(promptCallJournalEvents(promptCall(), memory, 2).map((e) => e.kind)).toEqual([
      'prompt-call'
    ])
    const autre = promptCall({ prompt: { ...basePrompt, system: 'AUTRE SOCLE' } })
    expect(promptCallJournalEvents(autre, memory, 3).map((e) => e.kind)).toEqual([
      'prompt-system',
      'prompt-call'
    ])
  })

  it('journalise un appel echoue avec son erreur', () => {
    const [, call] = promptCallJournalEvents(
      promptCall({ status: 'failed', error: '429 overloaded', response: '' }),
      {},
      1
    )
    expect(call.status).toBe('failed')
    expect(call.error).toBe('429 overloaded')
  })

  it('ecrit raisonnement, cout du tour et verdict a la cloture', () => {
    const events = closingJournalEvents(
      {
        reasoning: '  je pese les options  ',
        usage: { costUsd: 0.31, totalTokens: 4200 },
        outcome: { valid: true, gateBlocked: false, runPath: 'runs/x' }
      },
      7
    )
    expect(events.map((e) => e.kind)).toEqual(['reasoning', 'usage', 'outcome'])
    expect(events[0].text).toBe('je pese les options')
    expect(events[1]).toMatchObject({ costUsd: 0.31, totalTokens: 4200, at: 7 })
    expect(events[2]).toMatchObject({ valid: true, runPath: 'runs/x' })
  })

  it('n ecrit rien quand il n y a rien a dire', () => {
    expect(closingJournalEvents({ reasoning: '   ', usage: {}, outcome: {} }, 1)).toEqual([])
    expect(promptCallJournalEvents({}, {}, 1)).toEqual([])
  })
})
