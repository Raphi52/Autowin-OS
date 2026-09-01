import { describe, expect, it } from 'vitest'
import { buildModelActivityLog, type ModelActivityInput } from './model-activity-log'
import type { Msg } from './chat-view-types'

const assistant = (turnId: string, parts: Array<Record<string, unknown>>): Msg =>
  ({ role: 'assistant', turnId, parts, status: 'completed', done: true }) as unknown as Msg

describe('buildModelActivityLog', () => {
  it('trace les actions durables du fil, avec leur verdict', () => {
    const input: ModelActivityInput = {
      messages: [
        { role: 'user', content: 'fais X' } as Msg,
        assistant('turn-1', [
          { kind: 'text', text: 'Je lance la commande.' },
          { kind: 'action', actionId: 'a1', name: 'run_tests', args: { filter: 'chat' }, ok: true },
          { kind: 'artifact', artifact: { id: 'art-1', name: 'capture.png', kind: 'image' } }
        ])
      ],
      journalByTurn: {}
    }
    const entries = buildModelActivityLog(input)
    expect(entries.map((entry) => entry.kind)).toEqual(['prompt', 'text', 'action', 'artifact'])
    expect(entries[2]).toMatchObject({ label: 'run_tests', ok: true, turnId: 'turn-1' })
    expect(entries[2].detail).toContain('chat')
    expect(entries[3].label).toBe('capture.png')
  })

  it('préfère le journal du tour quand il existe (raisonnement, appel modèle, usage)', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('turn-1', [{ kind: 'text', text: 'réponse persistée' }])],
      journalByTurn: {
        'turn-1': [
          { kind: 'prompt-call', name: 'gpt-5', args: { effort: 'high' } },
          { kind: 'reasoning', text: 'je réfléchis' },
          { kind: 'command', name: 'Bash', actionId: 'c1', args: { command: 'ls' } },
          { kind: 'result', name: 'Bash', actionId: 'c1', ok: false, data: 'exit 1' },
          { kind: 'done', usage: { input_tokens: 12, output_tokens: 3 }, outcome: 'ok' }
        ]
      }
    })
    const kinds = entries.map((entry) => entry.kind)
    expect(kinds).toContain('reasoning')
    expect(kinds).toContain('model-call')
    expect(kinds).toContain('done')
    // le résultat retombe sur la commande : une seule ligne d'action, avec son verdict
    const actions = entries.filter((entry) => entry.kind === 'action')
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ label: 'Bash', ok: false })
    // pas de doublon avec les parts persistées du même tour
    expect(entries.filter((entry) => entry.kind === 'text')).toHaveLength(0)
  })

  it('ne perd pas les tours sans journal (rétention 7 j) et garde l’ordre du fil', () => {
    const entries = buildModelActivityLog({
      messages: [
        assistant('vieux', [{ kind: 'action', name: 'read_file', ok: true }]),
        assistant('recent', [{ kind: 'text', text: 'ok' }])
      ],
      journalByTurn: { recent: [{ kind: 'delta', text: 'ok' }] }
    })
    expect(entries.map((entry) => entry.turnId)).toEqual(['vieux', 'recent'])
    expect(entries[1].kind).toBe('text')
  })

  it('remonte les erreurs comme telles', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('t', [{ kind: 'error', cause: 'turn', message: 'boom' }])],
      journalByTurn: {}
    })
    expect(entries[0]).toMatchObject({ kind: 'error', label: 'Erreur (turn)', detail: 'boom' })
  })

  it('identifiants uniques et stables', () => {
    const entries = buildModelActivityLog({
      messages: [
        assistant('t', [
          { kind: 'text', text: 'a' },
          { kind: 'text', text: 'b' }
        ])
      ],
      journalByTurn: {}
    })
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length)
  })
})

describe('horodatage', () => {
  it('reporte l’heure écrite par le journal (`at`) sur la ligne, et la laisse absente sinon', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('turn-1', [{ kind: 'action', name: 'read_file', ok: true }])],
      journalByTurn: {
        'turn-1': [
          { kind: 'command', name: 'Bash', actionId: 'c1', args: {}, at: 1_700_000_000_000 },
          { kind: 'done', outcome: 'ok' }
        ]
      }
    })
    const action = entries.find((entry) => entry.kind === 'action')
    expect(action?.at).toBe(1_700_000_000_000)
    expect(entries.find((entry) => entry.kind === 'done')?.at).toBeUndefined()
  })
})

describe('rien ne se perd — le journal est lu à la place de l’Observatory', () => {
  it('trace les gestes hors liste blanche (provider-journal, stream-reset, resumed) avec leurs champs', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('t', [])],
      journalByTurn: {
        t: [
          { kind: 'resumed' },
          {
            kind: 'provider-journal',
            at: 1_700_000_000_000,
            provider: 'codex',
            attempt: 2,
            requestId: 'req-9',
            token: 'jeton',
            journalPath: 'C:/j.log'
          },
          { kind: 'stream-reset', at: 1_700_000_000_001, streamId: 's1' }
        ]
      }
    })
    expect(entries.map((entry) => entry.label)).toEqual([
      'resumed',
      'provider-journal',
      'stream-reset'
    ])
    expect(entries.every((entry) => entry.kind === 'event')).toBe(true)
    expect(entries[1].detail).toContain('codex')
    expect(entries[1].detail).toContain('req-9')
    expect(entries[1].at).toBe(1_700_000_000_000)
    expect(entries[2].detail).toContain('s1')
  })

  it('ne tronque plus le détail : raisonnement et réponse arrivent entiers', () => {
    const long = 'x'.repeat(3_000)
    const entries = buildModelActivityLog({
      messages: [assistant('t', [])],
      journalByTurn: {
        t: [
          { kind: 'reasoning', text: long },
          { kind: 'delta', text: `ligne 1\nligne 2 ${long}` }
        ]
      }
    })
    expect(entries[0].detail).toHaveLength(3_000)
    expect(entries[1].detail).toContain('\n')
    expect(entries[1].detail?.length).toBeGreaterThan(3_000)
    expect(entries.some((entry) => entry.detail?.endsWith('…'))).toBe(false)
  })

  it('garde les champs déjà lus mais jetés (sessionId d’un `done`, erreur d’un `failed`)', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('t', [])],
      journalByTurn: {
        t: [
          { kind: 'failed', at: 1, error: 'stream 500' },
          { kind: 'done', at: 2, sessionId: 'sess-42' }
        ]
      }
    })
    expect(entries[0]).toMatchObject({ kind: 'error', ok: false })
    expect(entries[0].detail).toContain('stream 500')
    expect(entries[1]).toMatchObject({ kind: 'done', label: 'Tour terminé' })
    expect(entries[1].detail).toContain('sess-42')
  })

  it('un `cancelled` clôt le tour au lieu de disparaître', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('t', [])],
      journalByTurn: { t: [{ kind: 'cancelled', at: 3 }] }
    })
    expect(entries[0]).toMatchObject({ kind: 'done', label: 'Tour annulé', at: 3 })
  })

  it('une part persistée de type inattendu reste visible', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('t', [{ kind: 'reasoning', text: 'je pense' }])],
      journalByTurn: {}
    })
    expect(entries[0]).toMatchObject({ kind: 'event', label: 'reasoning' })
    expect(entries[0].detail).toContain('je pense')
  })
})
