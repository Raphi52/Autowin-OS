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
    // UNION : la part persistée n'est PAS jetée sous prétexte qu'un journal existe — elle porte la
    // réponse conservée, que ce journal-là n'a pas.
    const textes = entries.filter((entry) => entry.kind === 'text')
    expect(textes).toHaveLength(1)
    expect(textes[0]).toMatchObject({ source: 'parts', detail: 'réponse persistée' })
  })

  it('unit journal ET parts, en écartant le seul doublon EXACT', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('turn-1', [{ kind: 'text', text: 'même réponse' }])],
      journalByTurn: { 'turn-1': [{ kind: 'delta', text: 'même réponse' }] }
    })
    // Le journal et les parts disent la MÊME chose : une seule ligne, celle du journal.
    const textes = entries.filter((entry) => entry.kind === 'text')
    expect(textes).toHaveLength(1)
    expect(textes[0].source).toBe('journal')
  })

  it('lit la trace causale — injections, frontières et verdicts, avec leur charge entière', () => {
    const charge = 'ÉTAT DE L’APP: '.padEnd(3_000, 'x')
    const entries = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      causal: [
        {
          id: 'e1',
          turnId: 'turn-1',
          timestamp: '2026-09-01T07:00:00.000Z',
          type: 'injection',
          status: 'completed',
          actor: { id: 'app', kind: 'system', label: 'Autowin' },
          payloads: [{ kind: 'app-state', name: 'état', content: charge }],
          observation: { boundary: 'app', fidelity: 'exact' }
        },
        {
          id: 'e2',
          turnId: 'turn-1',
          timestamp: '2026-09-01T07:00:01.000Z',
          type: 'verdict',
          status: 'failed',
          actor: { id: 'judge', kind: 'judge', label: 'juge' },
          payloads: [{ kind: 'model-response', content: 'refusé' }]
        }
      ]
    })
    expect(entries.map((entry) => entry.kind)).toEqual(['injection', 'event'])
    expect(entries.every((entry) => entry.source === 'causal')).toBe(true)
    // la charge injectée arrive ENTIÈRE : c'est précisément ce qu'on vient y lire
    expect(entries[0].detail).toContain(charge)
    expect(entries[0].at).toBe(Date.parse('2026-09-01T07:00:00.000Z'))
    expect(entries[1]).toMatchObject({ ok: false })
    expect(entries[1].label).toContain('juge')
  })

  it('lit le journal d’activité facturée — provider, modèle, tokens, coût, durée', () => {
    const entries = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      activity: [
        {
          ts: '2026-09-01T07:00:00.000Z',
          kind: 'chat',
          label: 'tour de chat',
          provider: 'claude',
          model: 'opus',
          inputTokens: 1_200,
          outputTokens: 300,
          cacheReadTokens: 90,
          costUsd: 0.42,
          durationMs: 8_100
        }
      ]
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'usage', source: 'activity' })
    for (const attendu of ['claude', 'opus', 'in 1200', 'out 300', 'cache 90', '0.42 $', '8100 ms'])
      expect(entries[0].detail).toContain(attendu)
  })

  it('trie les quatre sources chronologiquement, sans faire flotter les lignes sans heure', () => {
    const entries = buildModelActivityLog({
      messages: [
        { role: 'user', content: 'fais X' } as Msg,
        assistant('turn-1', [{ kind: 'action', name: 'sans_heure', ok: true }])
      ],
      journalByTurn: {
        'turn-1': [{ kind: 'command', name: 'Bash', actionId: 'c1', at: 2_000 }]
      },
      causal: [
        {
          id: 'e1',
          turnId: 'turn-1',
          timestamp: new Date(1_000).toISOString(),
          type: 'injection',
          actor: { label: 'app' },
          payloads: []
        }
      ],
      activity: [{ ts: new Date(3_000).toISOString(), kind: 'chat', label: 'appel' }]
    })
    expect(entries.map((entry) => entry.label)).toEqual([
      'Demande',
      'injection · app',
      'Bash',
      'sans_heure',
      'chat · appel'
    ])
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

/**
 * CE QUE MONTRE LE BLOC « RÉFLEXION » DOIT SE RETROUVER DANS LES LOGS.
 *
 * Le bloc du fil (`ThinkingBlock`) affiche DEUX matières : la pensée du modèle et TOUTES les lignes
 * de signe de vie du fournisseur (`providerStatusLog`). Le journal, lui, les recevait sans les
 * reconnaître : `provider-status` et `reasoning-step` tombaient dans le fourre-tout « Journal », et
 * la pensée conservée par le TOUR (seule survivante après le nettoyage du journal à 7 jours) n'était
 * pas lue du tout. Trois trous entre ce qui s'affiche et ce qui se lit.
 */
describe('parité avec le bloc « Réflexion »', () => {
  it('classe `provider-status` et `reasoning-step` du journal comme signe de vie et réflexion', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('turn-1', [])],
      journalByTurn: {
        'turn-1': [
          { kind: 'provider-status', text: 'Bash(ls) en cours', iteration: 2, at: 10 },
          { kind: 'reasoning-step', text: 'je pèse les options', iteration: 2, at: 11 }
        ]
      }
    })
    const statut = entries.find((entry) => entry.kind === 'status')
    expect(statut).toMatchObject({ label: 'Bash(ls) en cours', source: 'journal', at: 10 })
    const pensee = entries.find((entry) => entry.kind === 'reasoning')
    expect(pensee).toMatchObject({ source: 'journal', at: 11 })
    expect(pensee?.detail).toContain('je pèse les options')
  })

  it('lit la pensée et les signes de vie PORTÉS PAR LE MESSAGE, même sans journal', () => {
    const message = {
      role: 'assistant',
      turnId: 'turn-1',
      parts: [],
      status: 'completed',
      done: true,
      reasoning: 'pensée conservée par le tour',
      providerStatusLog: ['appel API', 'nouvelle tentative']
    } as unknown as Msg
    const entries = buildModelActivityLog({ messages: [message], journalByTurn: {} })
    expect(entries.filter((entry) => entry.kind === 'reasoning')).toMatchObject([
      { detail: 'pensée conservée par le tour', source: 'thread', turnId: 'turn-1' }
    ])
    expect(entries.filter((entry) => entry.kind === 'status').map((entry) => entry.label)).toEqual([
      'appel API',
      'nouvelle tentative'
    ])
  })

  it('ne double pas une ligne déjà portée par le journal', () => {
    const message = {
      role: 'assistant',
      turnId: 'turn-1',
      parts: [],
      status: 'completed',
      done: true,
      reasoning: 'même pensée',
      providerStatusLog: ['Bash(ls) en cours']
    } as unknown as Msg
    const entries = buildModelActivityLog({
      messages: [message],
      journalByTurn: {
        'turn-1': [
          { kind: 'reasoning', text: 'même pensée', at: 5 },
          { kind: 'provider-status', text: 'Bash(ls) en cours', iteration: 1, at: 6 }
        ]
      }
    })
    expect(entries.filter((entry) => entry.kind === 'reasoning')).toHaveLength(1)
    expect(entries.filter((entry) => entry.kind === 'status')).toHaveLength(1)
    expect(entries.filter((entry) => entry.kind === 'status')[0].source).toBe('journal')
  })
  it('garde les champs du geste EN STRUCTURE, en plus du détail à plat', () => {
    const entries = buildModelActivityLog({
      messages: [
        {
          role: 'assistant',
          turnId: 'turn-1',
          parts: [],
          status: 'completed',
          done: true
        } as unknown as Msg
      ],
      journalByTurn: {
        'turn-1': [
          {
            kind: 'command',
            name: 'Bash',
            actionId: 'a1',
            args: { cmd: 'ls', cwd: '/tmp' },
            sessionId: 'sess-9',
            at: 1
          },
          { kind: 'result', actionId: 'a1', ok: true, data: { exit: 0 }, at: 2 }
        ]
      },
      activity: [
        { ts: '2026-09-01T10:00:00.000Z', kind: 'call', provider: 'x', model: 'm', costUsd: 0.5 }
      ]
    })
    const action = entries.find((entry) => entry.kind === 'action')
    expect(action?.fields).toMatchObject({
      name: 'Bash',
      actionId: 'a1',
      sessionId: 'sess-9',
      args: { cmd: 'ls', cwd: '/tmp' },
      // La commande ET son résultat : la fusion ne perd ni les arguments ni les données.
      data: { exit: 0 },
      ok: true
    })
    expect(typeof action?.detail).toBe('string')
    const usage = entries.find((entry) => entry.kind === 'usage')
    expect(usage?.fields).toMatchObject({ provider: 'x', model: 'm', costUsd: 0.5 })
  })
})

describe('les gestes DÉJÀ écrits par le journal ont leur propre catégorie', () => {
  it('range prompt-system, usage et outcome hors du fourre-tout « Journal »', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('turn-1', [])],
      journalByTurn: {
        'turn-1': [
          { kind: 'prompt-system', text: 'tu es un agent', at: 1 },
          { kind: 'usage', inputTokens: 12, outputTokens: 3, costUsd: 0.04, at: 2 },
          { kind: 'outcome', status: 'succeeded', at: 3 }
        ]
      }
    })
    const parKind = Object.fromEntries(entries.map((entry) => [entry.kind, entry]))
    expect(entries.some((entry) => entry.kind === 'event')).toBe(false)
    expect(parKind.prompt).toMatchObject({ label: 'Prompt système', source: 'journal' })
    expect(parKind.prompt.detail).toContain('tu es un agent')
    expect(parKind.usage).toMatchObject({ source: 'journal' })
    expect(parKind.usage.detail).toContain('12')
    expect(parKind.done).toMatchObject({ source: 'journal' })
    expect(parKind.done.detail).toContain('succeeded')
  })

  it('garde le fourre-tout « Journal » pour un type FUTUR inconnu', () => {
    const entries = buildModelActivityLog({
      messages: [assistant('turn-1', [])],
      journalByTurn: { 'turn-1': [{ kind: 'quelque-chose-de-neuf', valeur: 42, at: 1 }] }
    })
    expect(entries[0]).toMatchObject({ kind: 'event', label: 'quelque-chose-de-neuf' })
  })
})

describe('le raisonnement DURABLE ne doit ni disparaître ni faire doublon', () => {
  const long = 'pensée '.repeat(2_000).trim()

  it('garde la version ENTIÈRE du journal, pas la copie tronquée du tour', () => {
    const message = {
      role: 'assistant',
      turnId: 'turn-1',
      parts: [],
      status: 'completed',
      done: true,
      reasoning: long.slice(-4_000)
    } as unknown as Msg
    const entries = buildModelActivityLog({
      messages: [message],
      journalByTurn: { 'turn-1': [{ kind: 'reasoning', text: long, at: 5 }] }
    })
    const pensees = entries.filter((entry) => entry.kind === 'reasoning')
    expect(pensees).toHaveLength(1)
    expect(pensees[0].source).toBe('journal')
    expect(pensees[0].detail?.length).toBe(long.length)
  })

  it('garde la pensée du tour quand le journal a été nettoyé (au-delà de 7 jours)', () => {
    const message = {
      role: 'assistant',
      turnId: 'turn-1',
      parts: [{ kind: 'text', text: 'réponse' }],
      status: 'completed',
      done: true,
      reasoning: 'pensée survivante'
    } as unknown as Msg
    const entries = buildModelActivityLog({ messages: [message], journalByTurn: {} })
    const pensees = entries.filter((entry) => entry.kind === 'reasoning')
    expect(pensees).toHaveLength(1)
    expect(pensees[0]).toMatchObject({ source: 'thread', detail: 'pensée survivante' })
  })
})

describe('buildModelActivityLog — la source BRAIN', () => {
  const trace = (part: Record<string, unknown>): Record<string, unknown> => ({
    id: 'b1',
    timestamp: '2026-09-02T10:00:00.000Z',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    query: 'contrainte du graphe',
    injectedChars: 1_200,
    ...part
  })

  it('rend la récupération Brain avec sa nature, sa requête et le volume injecté', () => {
    const [ligne] = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      brain: [trace({ kind: 'query', status: 'found', found: true })]
    })
    expect(ligne.source).toBe('brain')
    expect(ligne.kind).toBe('brain')
    expect(ligne.label).toContain('brain_query')
    expect(ligne.detail).toContain('contrainte du graphe')
    expect(ligne.detail).toContain('1200 caractères injectés')
    expect(ligne.ok).toBe(true)
    // La ligne rejoint le TOUR qui l'a déclenchée, pas un journal à part.
    expect(ligne.turnId).toBe('turn-1')
  })

  it('marque en échec une récupération vide ou indisponible — elle explique une réponse pauvre', () => {
    const [vide] = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      brain: [trace({ kind: 'automatic', status: 'unavailable', found: false })]
    })
    expect(vide.ok).toBe(false)
    expect(vide.label).toContain('contexte préchargé')
  })

  it('nomme le DÉPÔT d’un fait, pas seulement les lectures', () => {
    const [depot] = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      brain: [trace({ kind: 'depot', query: 'leçon sur les logs' })]
    })
    expect(depot.label).toContain('dépôt')
    expect(depot.fields).toMatchObject({ conversationId: 'conv-1' })
  })

  it('n’invente aucune ligne quand la source Brain est absente', () => {
    expect(buildModelActivityLog({ messages: [], journalByTurn: {} })).toEqual([])
  })
})

describe('buildModelActivityLog — les APPELS PROMPT', () => {
  const appel = (part: Record<string, unknown>): Record<string, unknown> => ({
    id: 'p1',
    ts: '2026-09-02T10:00:00.000Z',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    iteration: 2,
    actor: 'producteur',
    provider: 'claude',
    model: 'opus-5',
    messages: [{ role: 'user', content: 'fais X' }],
    options: {},
    response: 'voici X',
    ...part
  })

  it('nomme l’acteur, la phase et l’étape, et garde tout l’appel en champs bruts', () => {
    const [ligne] = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      promptCalls: [appel({ phase: 'build', status: 'completed', durationMs: 4_200 })]
    })
    expect(ligne.source).toBe('prompts')
    expect(ligne.kind).toBe('prompt')
    expect(ligne.label).toContain('producteur')
    expect(ligne.label).toContain('build')
    expect(ligne.label).toContain('étape 2')
    expect(ligne.detail).toContain('4200 ms')
    expect(ligne.ok).toBe(true)
    expect(ligne.turnId).toBe('turn-1')
    // Le contenu ENTIER reste disponible, jamais aplati.
    expect(ligne.fields).toMatchObject({ response: 'voici X' })
  })

  it('dit quel modèle a RÉELLEMENT servi quand il diffère du modèle demandé', () => {
    const [ligne] = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      promptCalls: [appel({ resolvedModel: 'opus-5-20260901' })]
    })
    expect(ligne.detail).toContain('opus-5 → opus-5-20260901')
  })

  it('nomme les blocs du prompt système et du contexte injecté, avec leur taille', () => {
    const [ligne] = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      promptCalls: [
        appel({
          systemBlocks: [{ name: 'discipline', chars: 1_800 }],
          contextBlocks: [{ name: 'savoir Brain', chars: 640 }]
        })
      ]
    })
    expect(ligne.detail).toContain('discipline (1800)')
    expect(ligne.detail).toContain('savoir Brain (640)')
  })

  it('marque l’appel en échec et remonte son erreur', () => {
    const [ligne] = buildModelActivityLog({
      messages: [],
      journalByTurn: {},
      promptCalls: [appel({ status: 'failed', error: '529 Overloaded' })]
    })
    expect(ligne.ok).toBe(false)
    expect(ligne.detail).toContain('529 Overloaded')
  })
})
