import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendTurnEvent, readTurnJournal, type TurnJournalEvent } from './turn-journal'
import {
  closingJournalEvents,
  journalDuPiloteRegroupe,
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

/**
 * LA PENSÉE S'ÉCRIT PAR RAFALE, PAS MOT PAR MOT (conv-1431, 2026-11-02).
 *
 * Mesuré sur les journaux conv-14* : 355 683 lignes `reasoning-step` pour 28 Mo sur 51 Mo (55 %),
 * un paquet reçu = une ligne (« The », « con », « versation history se »). Le texte entier est déjà
 * écrit à la clôture sous `reasoning`, et deux lecteurs recollaient ces miettes à chaque relecture
 * (`fusionnerFragmentsDeFlux`, `model-activity-log.ts`). Le défaut se crée à l'écriture : il s'y
 * corrige.
 *
 * Entrées qui feraient échouer une correction fausse : 3 fragments puis une commande puis 2
 * fragments — une version sans tampon écrit 5 lignes, une version qui ne vide qu'à la fin met la
 * pensée APRÈS la commande ; et une pensée sans fin d'au moins 1 s, qu'une version sans minuteur
 * garderait en mémoire jusqu'au prochain geste (perdue en cas de plantage).
 */
describe('journal de tour — la pensée regroupée à l écriture', () => {
  afterEach(() => vi.useRealTimers())

  function banc(delaiMs?: number) {
    const ecrits: TurnJournalEvent[] = []
    const journal = journalDuPiloteRegroupe((e) => void ecrits.push(e), delaiMs)
    return { ecrits, journal }
  }

  it('une rafale = une ligne, à l heure du premier fragment, et un geste la coupe AVANT lui', () => {
    const { ecrits, journal } = banc()
    journal.recevoir({ kind: 'reasoning', text: 'The', iteration: 0 }, 10)
    journal.recevoir({ kind: 'reasoning', text: ' con', iteration: 0 }, 11)
    journal.recevoir({ kind: 'reasoning', text: 'versation', iteration: 0 }, 12)
    expect(ecrits).toEqual([])
    // Une commande est écrite AILLEURS (événement durable) : la rafale doit partir avant elle.
    journal.recevoir({ kind: 'command', name: 'read_file' }, 13)
    expect(ecrits).toEqual([
      { kind: 'reasoning-step', iteration: 0, text: 'The conversation', at: 10, fragments: 3 }
    ])
    journal.recevoir({ kind: 'reasoning', text: 'puis', iteration: 0 }, 20)
    journal.recevoir({ kind: 'reasoning', text: ' ça', iteration: 0 }, 21)
    journal.recevoir({ kind: 'provider-status', text: 'Bash terminé - 1 s', iteration: 0 }, 22)
    expect(ecrits.slice(1)).toEqual([
      { kind: 'reasoning-step', iteration: 0, text: 'puis ça', at: 20, fragments: 2 },
      { kind: 'provider-status', iteration: 0, text: 'Bash terminé - 1 s', at: 22 }
    ])
  })

  it('le jumeau : un fragment seul reste une ligne simple, sans compteur', () => {
    const { ecrits, journal } = banc()
    journal.recevoir({ kind: 'reasoning', text: 'seul', iteration: 2 }, 5)
    journal.vider()
    expect(ecrits).toEqual([{ kind: 'reasoning-step', iteration: 2, text: 'seul', at: 5 }])
  })

  it('une autre itération ouvre une autre rafale', () => {
    const { ecrits, journal } = banc()
    journal.recevoir({ kind: 'reasoning', text: 'a', iteration: 0 }, 1)
    journal.recevoir({ kind: 'reasoning', text: 'b', iteration: 1 }, 2)
    journal.vider()
    expect(ecrits.map((e) => [e.iteration, e.text])).toEqual([
      [0, 'a'],
      [1, 'b']
    ])
  })

  it('une pensée qui dure part au disque après le délai, sans attendre le prochain geste', () => {
    vi.useFakeTimers()
    const { ecrits, journal } = banc(1000)
    journal.recevoir({ kind: 'reasoning', text: 'longue', iteration: 0 }, 1)
    journal.recevoir({ kind: 'reasoning', text: ' pensée', iteration: 0 }, 2)
    vi.advanceTimersByTime(999)
    expect(ecrits).toEqual([])
    vi.advanceTimersByTime(1)
    expect(ecrits).toEqual([
      { kind: 'reasoning-step', iteration: 0, text: 'longue pensée', at: 1, fragments: 2 }
    ])
    // La suite ouvre une nouvelle rafale, et `vider` (clôture du tour) l'écrit.
    journal.recevoir({ kind: 'reasoning', text: 'suite', iteration: 0 }, 1500)
    journal.vider()
    expect(ecrits).toHaveLength(2)
    expect(ecrits[1]).toMatchObject({ text: 'suite', at: 1500 })
    // Plus aucun minuteur en attente : rien n'est réécrit.
    vi.advanceTimersByTime(5000)
    expect(ecrits).toHaveLength(2)
  })

  it('les lignes d état restent une par étape : ce ne sont pas des miettes', () => {
    const { ecrits, journal } = banc()
    journal.recevoir({ kind: 'provider-status', text: 'Bash · ls', iteration: 0 }, 1)
    journal.recevoir({ kind: 'provider-status', text: 'Bash terminé - 1 s', iteration: 0 }, 2)
    expect(ecrits.map((e) => e.text)).toEqual(['Bash · ls', 'Bash terminé - 1 s'])
  })

  it('un écrivain en panne ne casse pas le tour, même depuis le minuteur', () => {
    vi.useFakeTimers()
    const journal = journalDuPiloteRegroupe(() => {
      throw new Error('disque plein')
    }, 1000)
    journal.recevoir({ kind: 'reasoning', text: 'x', iteration: 0 }, 1)
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    journal.recevoir({ kind: 'reasoning', text: 'y', iteration: 0 }, 2)
    expect(() => journal.recevoir({ kind: 'error', text: 'e' }, 3)).not.toThrow()
  })
})
