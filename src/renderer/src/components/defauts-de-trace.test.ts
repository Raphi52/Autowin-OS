import { describe, expect, it } from 'vitest'
import { buildCausalPath } from './causal-path-model'
import { defautsDeTrace } from './defauts-de-trace'
import type { HarnessTimelineEvent } from './harness-timeline-model'

const etape = (
  id: string,
  kind: NonNullable<HarnessTimelineEvent['display']>['kind'],
  status: string,
  durationMs?: number,
  parentId?: string
): HarnessTimelineEvent =>
  ({
    id,
    parentId,
    kind: 'handoff',
    actor: id,
    label: id,
    content: '',
    status,
    durationMs,
    payloads: [],
    display: { kind, title: id }
  }) as unknown as HarnessTimelineEvent

const defauts = (events: HarnessTimelineEvent[], id: string): string[] =>
  defautsDeTrace(buildCausalPath(events).byId.get(id)!)

describe('defautsDeTrace — l’orange pour les seuls défauts', () => {
  it('une étape en cours, en attente ou interrompue n’a pas encore de durée : pas un défaut', () => {
    for (const status of ['running', 'pending', 'interrupted'])
      expect(defauts([etape('a', 'agent', status)], 'a')).toEqual([])
  })

  it('une étape instantanée ou de structure n’a pas de durée par nature : pas un défaut', () => {
    expect(defauts([etape('r', 'event', 'completed')], 'r')).toEqual([])
    expect(defauts([etape('s', 'skill', 'completed')], 's')).toEqual([])
  })

  it('un agent ou un outil FINI sans durée est un vrai trou dans la trace', () => {
    expect(defauts([etape('a', 'agent', 'completed')], 'a')).toEqual(['missing-duration'])
    expect(defauts([etape('t', 'tool', 'failed')], 't')).toEqual(['missing-duration'])
  })

  it('un enfant qui tourne encore ne rend pas son parent « partiel », un enfant fini sans durée si', () => {
    const parent = etape('p', 'skill', 'running', 5_000)
    expect(defauts([parent, etape('c', 'agent', 'running', undefined, 'p')], 'p')).toEqual([])
    expect(defauts([parent, etape('c', 'agent', 'completed', undefined, 'p')], 'p')).toEqual([
      'incomplete-child-timing'
    ])
  })

  it('un parent introuvable reste un défaut, quel que soit le statut', () => {
    expect(defauts([etape('o', 'agent', 'running', undefined, 'absent')], 'o')).toEqual([
      'missing-parent'
    ])
  })
})
