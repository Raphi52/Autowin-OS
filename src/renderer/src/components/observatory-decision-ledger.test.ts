import { describe, expect, it } from 'vitest'
import { buildObservatoryDecisionLedger } from './observatory-decision-ledger'
import type { HarnessTimelineEvent, HarnessTimelineEventKind } from './harness-timeline-model'

function event(
  id: string,
  kind: HarnessTimelineEventKind,
  parentId?: string,
  content = ''
): HarnessTimelineEvent {
  return { id, kind, parentId, actor: 'agent', label: id, content, detail: '', payloads: [] }
}

describe('registre de décisions Observatory', () => {
  it('relie une décision à son signal, son observation et son verdict par causalité', () => {
    const ledger = buildObservatoryDecisionLedger([
      event(
        'decision-1',
        'decision',
        undefined,
        JSON.stringify({
          hypothesis: 'Le cache est périmé',
          expectedSignal: 'test rouge puis vert'
        })
      ),
      event('observation-1', 'tool-result', 'decision-1', 'test vert'),
      event('gate-1', 'gate', 'observation-1', 'clean vert'),
      event('verdict-1', 'verdict', 'gate-1', 'accepté'),
      event('decision-open', 'decision', undefined, 'Essayer une autre route'),
      event('foreign-verdict', 'verdict', undefined, 'ne doit pas être lié')
    ])

    expect(ledger).toHaveLength(2)
    expect(ledger[0]).toMatchObject({
      decisionId: 'decision-1',
      hypothesis: 'Le cache est périmé',
      expectedSignal: 'test rouge puis vert',
      observation: 'test vert',
      gate: 'clean vert',
      verdict: 'accepté',
      status: 'closed'
    })
    expect(ledger[1]).toMatchObject({ decisionId: 'decision-open', status: 'open' })
    expect(ledger[1].verdict).toBeUndefined()
  })

  it('ne duplique pas un reçu d’autorité dans le registre des décisions métier', () => {
    const authority = {
      ...event('authority-1', 'decision', undefined, '{"id":"conv-1"}'),
      authority: {
        mode: 'auto' as const,
        commandAuthority: 'automatic' as const,
        mutates: true,
        decision: 'allow' as const
      }
    }

    expect(buildObservatoryDecisionLedger([authority])).toEqual([])
  })

  it('laisse ouverte une décision dont la gate descendante a échoué', () => {
    const failedGate = { ...event('gate-failed', 'gate', 'decision', 'rouge'), status: 'failed' }
    const ledger = buildObservatoryDecisionLedger([
      event('decision', 'decision', undefined, 'Hypothèse'),
      failedGate
    ])

    expect(ledger[0]).toMatchObject({ status: 'open', gate: 'rouge' })
  })

  it('ne laisse pas le verdict d’une décision imbriquée clôturer sa parente', () => {
    const ledger = buildObservatoryDecisionLedger([
      event('outer', 'decision', undefined, 'Parente'),
      event('inner', 'decision', 'outer', 'Enfant'),
      { ...event('inner-verdict', 'verdict', 'inner', 'accepté'), status: 'completed' }
    ])

    expect(ledger.find((entry) => entry.decisionId === 'outer')).toMatchObject({ status: 'open' })
    expect(ledger.find((entry) => entry.decisionId === 'inner')).toMatchObject({
      status: 'closed',
      verdict: 'accepté'
    })
  })
})
