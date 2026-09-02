import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendTurnEvent, readTurnJournal } from './turn-journal'
import {
  closingJournalEvents,
  pilotJournalEvents,
  promptCallJournalEvents
} from './turn-journal-enrich'
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
    // `user` en tete depuis le 2026-09-02 : la demande TAPEE est ecrite avant l'appel qu'elle declenche.
    expect(events.map((e) => e.kind)).toEqual(['user', 'prompt-system', 'prompt-call'])
    expect(events[1].text).toBe('TU ES AUTOWIN')
    expect(events[1].blocks).toEqual([{ name: 'discipline', chars: 12 }])
    const call = events[2] as Record<string, unknown>
    expect(call.provider).toBe('anthropic')
    expect(call.resolvedModel).toBe('claude-opus-5')
    expect(call.usage).toMatchObject({ costUsd: 0.02, inputTokens: 10 })
    expect(call.durationMs).toBe(1235)
    expect(call.sessionId).toBe('sess-1')
    expect(call.responseChars).toBe(7)
  })

  it('masque les secrets des options provider', () => {
    const [, , call] = promptCallJournalEvents(promptCall(), {}, 1)
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
    const [, , call] = promptCallJournalEvents(
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

/**
 * LE TROU RESTANT — mesuré sur `applyDurableEvent` (`src/main/index.ts`) : le pilote émet 14 `kind`,
 * mais seuls 8 deviennent un événement durable (delta, stream-reset, think, command, result,
 * artifact, done, cancellation) et 1 est journalisé à part (prompt-call). `error`, `retry`,
 * `provider-status`, `action-progress` et le `reasoning` PAR ITÉRATION n'atteignaient donc AUCUN
 * fichier : une erreur provider, une nouvelle tentative ou l'avancement d'une commande longue
 * étaient produits puis jetés à la frontière d'écriture. C'est exactement « on ne voit rien ».
 */
describe('journal de tour — les evenements du pilote jetes a l ecriture', () => {
  it('journalise erreur, nouvelle tentative, statut provider, avancement et raisonnement', () => {
    expect(pilotJournalEvents({ kind: 'error', text: 'plafond atteint' }, 7)).toEqual([
      { kind: 'error', text: 'plafond atteint', at: 7 }
    ])
    expect(
      pilotJournalEvents(
        { kind: 'retry', iteration: 2, name: 'anthropic', text: 'surcharge', data: { attempt: 1 } },
        8
      )
    ).toEqual([
      {
        kind: 'retry',
        iteration: 2,
        name: 'anthropic',
        text: 'surcharge',
        data: { attempt: 1 },
        at: 8
      }
    ])
    expect(
      pilotJournalEvents({ kind: 'provider-status', text: 'file d attente', iteration: 1 }, 9)
    ).toEqual([{ kind: 'provider-status', iteration: 1, text: 'file d attente', at: 9 }])
    expect(
      pilotJournalEvents({ kind: 'action-progress', actionId: 'a1', text: '12 fichiers lus' }, 10)
    ).toEqual([{ kind: 'action-progress', actionId: 'a1', text: '12 fichiers lus', at: 10 }])
    expect(pilotJournalEvents({ kind: 'reasoning', text: 'je cherche', iteration: 3 }, 11)).toEqual(
      [{ kind: 'reasoning-step', iteration: 3, text: 'je cherche', at: 11 }]
    )
  })

  it('ne double JAMAIS ce qui est deja ecrit ailleurs', () => {
    for (const kind of [
      'delta',
      'stream-reset',
      'think',
      'command',
      'result',
      'artifact',
      'done',
      'cancellation',
      'prompt-call'
    ])
      expect(pilotJournalEvents({ kind, text: 'x' }, 1)).toEqual([])
  })

  it('un kind INCONNU est ecrit quand meme, jamais jete en silence', () => {
    expect(pilotJournalEvents({ kind: 'quota-reset', text: 'demain 9h' }, 12)).toEqual([
      { kind: 'quota-reset', text: 'demain 9h', at: 12 }
    ])
  })

  it('masque les secrets et ne casse pas sur un evenement vide', () => {
    const [event] = pilotJournalEvents(
      { kind: 'retry', text: 'echec', data: { apiKey: 'sk-secret' } },
      1
    )
    expect(JSON.stringify(event)).not.toContain('sk-secret')
    expect(pilotJournalEvents({}, 1)).toEqual([])
  })
})

/**
 * PREUVE SUR FICHIER — un mapping vert ne prouve rien si l'événement n'atteint pas le disque. On
 * écrit ici les événements du pilote par le VRAI écrivain, puis on relit le `.jsonl`.
 */
describe('journal de tour — l evenement du pilote atteint bien le fichier', () => {
  it('relit erreur, tentative et avancement dans le .jsonl', () => {
    const root = mkdtempSync(join(tmpdir(), 'journal-pilote-'))
    try {
      for (const pilotEvent of [
        { kind: 'provider-status', text: 'file d attente', iteration: 0 },
        { kind: 'retry', iteration: 0, name: 'anthropic', text: 'surcharge' },
        { kind: 'action-progress', actionId: 'a1', text: '12 fichiers lus' },
        { kind: 'error', text: 'plafond atteint' }
      ])
        for (const journalEvent of pilotJournalEvents(pilotEvent, 42))
          appendTurnEvent(root, 'conv-70', 'tour-1', journalEvent)
      const relu = readTurnJournal(root, 'conv-70', 'tour-1')
      expect(relu.map((e) => e.kind)).toEqual([
        'provider-status',
        'retry',
        'action-progress',
        'error'
      ])
      expect(relu[1]).toMatchObject({ name: 'anthropic', text: 'surcharge' })
      expect(relu[3]).toMatchObject({ text: 'plafond atteint', at: 42 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('journal de tour — la demande de l utilisateur', () => {
  it('ecrit le TEXTE du dernier message utilisateur, pas seulement leur nombre', () => {
    const events = promptCallJournalEvents(
      promptCall({
        prompt: {
          ...basePrompt,
          messages: [
            { role: 'user', content: 'premier' },
            { role: 'assistant', content: 'reponse' },
            { role: 'user', content: 'repare les journaux' }
          ]
        }
      }),
      {},
      111
    )
    const call = events.find((e) => e.kind === 'prompt-call') as unknown as {
      messages: number
      demande?: string
    }
    expect(call.messages).toBe(3)
    expect(call.demande).toBe('repare les journaux')
  })

  it('borne la demande pour ne pas recopier un prompt entier dans le journal', () => {
    const long = 'x'.repeat(5000)
    const events = promptCallJournalEvents(
      promptCall({ prompt: { ...basePrompt, messages: [{ role: 'user', content: long }] } }),
      {},
      111
    )
    const call = events.find((e) => e.kind === 'prompt-call') as unknown as { demande?: string }
    expect(call.demande?.length).toBe(2000)
  })

  it('n invente pas de demande quand aucun message utilisateur n existe', () => {
    const events = promptCallJournalEvents(
      promptCall({ prompt: { ...basePrompt, messages: [{ role: 'assistant', content: 'seul' }] } }),
      {},
      111
    )
    const call = events.find((e) => e.kind === 'prompt-call') as unknown as { demande?: string }
    expect(call.demande).toBeUndefined()
  })
})
