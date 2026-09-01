import { describe, expect, it } from 'vitest'
import { mergeLiveAndPersisted, scopedRunsFromTimeline } from './subagent-thread-from-trace'
import type { HarnessTimeline, HarnessTimelineEvent } from './harness-timeline-model'
import type { ScopedLiveRun } from './chat-view-model'

// Fixture : les champs optionnels sont ajoutés seulement s'ils sont fournis (exactOptionalPropertyTypes).
const event = (over: Partial<HarnessTimelineEvent>): HarnessTimelineEvent =>
  ({
    id: 'e1',
    kind: 'model-response',
    actor: 'agent',
    label: '',
    content: '',
    detail: '',
    ...Object.fromEntries(Object.entries(over).filter(([, value]) => value !== undefined))
  }) as HarnessTimelineEvent

const timeline = (turns: HarnessTimeline['turns']): HarnessTimeline =>
  ({
    turns,
    anomalies: [],
    totalTokens: 0,
    totalCostUsd: 0
  }) as unknown as HarnessTimeline

const turn = (id: string, events: HarnessTimelineEvent[]): HarnessTimeline['turns'][number] => ({
  id,
  ts: '2026-07-31T10:00:00Z',
  events,
  tokens: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0
})

/**
 * Le fil des sous-agents ne vivait qu'en mémoire : « Aucune orchestration dans cette conversation »
 * s'affichait dès le remontage de la vue, alors que le GRAPHE de la même conversation restait
 * rempli — il lit la trace persistée. On projette depuis cette même source.
 */
describe('fil des sous-agents reconstruit depuis la trace persistée', () => {
  it('rend un run par tour d’orchestration, avec ses étapes', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [
          event({ id: 'm', kind: 'message', content: 'ajoute un module' }),
          event({ id: 'a', kind: 'model-response', provider: 'codex', model: 'gpt', costUsd: 0.4 }),
          event({ id: 'j', kind: 'verdict', provider: 'claude' }),
          event({ id: 'g', kind: 'gate' })
        ])
      ]),
      'conv-1'
    )

    expect(runs).toHaveLength(1)
    expect(runs[0].task).toBe('ajoute un module')
  })

  /**
   * LE TITRE D'UN BLOC DOIT ÊTRE LA DEMANDE, PAS LE CONTEXTE INJECTÉ.
   *
   * Le contenu d'un tour de chat est COMPOSÉ par `chat-turn-messages.ts` : il commence par
   * `ÉTAT DE L'APP:\n{json}` avant le message humain. En prenant le contenu brut, chaque bloc de la
   * vue Sous-agents s'intitulait `ÉTAT DE L'APP: {"tab":"chat","activeConversationId":…` — tous
   * identiques, tous illisibles, et la demande réelle invisible.
   */
  it('titre un run par la DEMANDE humaine, pas par l’état de l’app injecté', () => {
    const compose = [
      `ÉTAT DE L'APP:\n${JSON.stringify({ tab: 'chat', activeConversationId: 'conv-1056' })}`,
      'UTILISATEUR: corrige la propagation de l’erreur 529'
    ].join('\n\n')
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [
          event({ id: 'm', kind: 'message', content: compose }),
          event({ id: 'a', kind: 'model-response', provider: 'codex', model: 'gpt', costUsd: 0.4 }),
          event({ id: 'g', kind: 'gate' })
        ])
      ]),
      'conv-1'
    )

    expect(runs).toHaveLength(1)
    expect(runs[0].task).toBe('corrige la propagation de l’erreur 529')
    expect(runs[0].task).not.toContain('ÉTAT DE')
    expect(runs[0].task).not.toContain('activeConversationId')
  })

  it('un contenu SIMPLE reste intact — discriminant', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [
          event({ id: 'm', kind: 'message', content: 'ajoute un module' }),
          event({ id: 'a', kind: 'model-response', provider: 'codex', model: 'gpt', costUsd: 0.4 }),
          event({ id: 'j', kind: 'verdict', provider: 'claude' }),
          event({ id: 'g', kind: 'gate' })
        ])
      ]),
      'conv-1'
    )
    // Si ce test casse, l'extraction mange les demandes normales au lieu du seul préfixe injecté.
    expect(runs[0].task).toBe('ajoute un module')
    expect(runs[0].steps.map((step) => step.step)).toEqual(['exec', 'judge', 'gate'])
    expect(runs[0].steps[0]).toMatchObject({ provider: 'codex', model: 'gpt', costUsd: 0.4 })
  })

  it('un tour SANS étape de sous-agent (simple réponse) n’est pas un run', () => {
    const runs = scopedRunsFromTimeline(
      timeline([turn('turn-1', [event({ kind: 'message', content: 'bonjour' })])]),
      'conv-1'
    )
    expect(runs).toEqual([])
  })

  it('une étape en échec met le run au rouge', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [
          event({ kind: 'message', content: 'tâche' }),
          event({ kind: 'model-response', status: 'failed' })
        ])
      ]),
      'conv-1'
    )
    expect(runs[0].status).toBe('red')
    expect(runs[0].steps[0].status).toBe('failed')
  })

  it('plusieurs tours donnent plusieurs runs — la trace ne s’écrase pas', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [event({ kind: 'message', content: 'premier' }), event({ kind: 'gate' })]),
        turn('turn-2', [event({ kind: 'message', content: 'second' }), event({ kind: 'gate' })])
      ]),
      'conv-1'
    )
    expect(runs.map((run) => run.task)).toEqual(['premier', 'second'])
    expect(runs.map((run) => run.runPath)).toEqual(['turn-1', 'turn-2'])
  })

  it('répare à l’affichage une ancienne identité impossible codex + modèle Gemini', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-stale', [
          event({
            kind: 'verdict',
            provider: 'codex',
            model: 'gemini-2.5-pro',
            content: 'défaut'
          })
        ])
      ]),
      'conv-1',
      new Map([['turn-stale', { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' }]])
    )

    expect(runs[0].steps[0]).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol' })
  })

  it('conserve un vrai juge Gemini quand son provider est lui aussi Gemini', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-gemini', [
          event({ kind: 'verdict', provider: 'gemini', model: 'gemini-2.5-pro' })
        ])
      ]),
      'conv-1',
      new Map([['turn-gemini', { provider: 'codex', model: 'gpt-5.6-sol' }]])
    )

    expect(runs[0].steps[0]).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-pro' })
  })
})

describe('fusion direct + persisté', () => {
  const persisted = (runPath: string): ScopedLiveRun<never> => ({
    convId: 'conv-1',
    runPath,
    task: 'ancien',
    steps: [],
    status: 'green'
  })

  it('le run VIVANT fait autorité sur son tour — pas de doublon', () => {
    const live: Array<[string, ScopedLiveRun<never>]> = [
      ['k', { convId: 'conv-1', runPath: 'turn-2', task: 'en cours', steps: [], status: 'running' }]
    ]
    const merged = mergeLiveAndPersisted(live, [persisted('turn-1'), persisted('turn-2')])

    expect(merged.map(([, run]) => run.task)).toEqual(['ancien', 'en cours'])
    expect(merged.filter(([, run]) => run.runPath === 'turn-2')).toHaveLength(1)
  })

  it('sans run vivant, tout le persisté s’affiche — c’est le cas qui manquait', () => {
    const merged = mergeLiveAndPersisted([], [persisted('turn-1'), persisted('turn-2')])
    expect(merged).toHaveLength(2)
  })
})

/**
 * LA PENSÉE DU SOUS-AGENT EST UNE CHARGE À PART, PAS UN PRÉAMBULE DE LA CONCLUSION.
 *
 * `stepPayloads` (main/activity) écrit DEUX charges distinctes : la conclusion (`model-response`)
 * et la délibération (`reasoning`). Le fil relu, lui, lisait `event.content` — c'est-à-dire la
 * CONCATÉNATION des deux (`harness-timeline-model.ts:194`). Résultat : un raisonnement exploratoire,
 * avec ses hypothèses abandonnées, se lisait comme la réponse effectivement remise.
 */
describe('délibération et conclusion, séparées dans le fil relu', () => {
  it('range le payload reasoning dans thinking et laisse text à la seule conclusion', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [
          event({ id: 'm', kind: 'message', content: 'répare le gate' }),
          event({
            id: 'a',
            kind: 'model-response',
            provider: 'codex',
            content: 'j’hésite entre A et B\n\nconclusion : B',
            payloads: [
              { kind: 'model-response', content: 'conclusion : B' },
              { kind: 'reasoning', content: 'j’hésite entre A et B' }
            ]
          }),
          event({ id: 'g', kind: 'gate' })
        ])
      ]),
      'conv-1'
    )

    const step = runs[0].steps[0]
    expect(step.thinking).toBe('j’hésite entre A et B')
    expect(step.text).toBe('conclusion : B')
    expect(step.text).not.toContain('j’hésite')
  })

  it('sans payload reasoning, le texte reste exactement le contenu de l’événement', () => {
    const runs = scopedRunsFromTimeline(
      timeline([
        turn('turn-1', [
          event({ id: 'm', kind: 'message', content: 'répare le gate' }),
          event({ id: 'a', kind: 'model-response', content: 'réponse simple' }),
          event({ id: 'g', kind: 'gate' })
        ])
      ]),
      'conv-1'
    )

    expect(runs[0].steps[0].text).toBe('réponse simple')
    expect(runs[0].steps[0].thinking).toBeUndefined()
  })
})
