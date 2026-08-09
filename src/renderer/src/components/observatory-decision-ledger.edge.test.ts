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

describe('registre de decisions Observatory - etats terminaux', () => {
  it('laisse ouverte une decision dont la gate est encore en attente', () => {
    const ledger = buildObservatoryDecisionLedger([
      event('decision', 'decision', undefined, 'Hypothese'),
      { ...event('gate-pending', 'gate', 'decision', 'en attente'), status: 'pending' }
    ])

    expect(ledger[0]).toMatchObject({ status: 'open', gate: 'en attente' })
  })

  it('cloture une decision sur une gate explicitement reussie sans inventer un verdict', () => {
    const ledger = buildObservatoryDecisionLedger([
      event('decision', 'decision', undefined, 'Hypothese'),
      { ...event('gate-complete', 'gate', 'decision', 'signal vert'), status: 'completed' }
    ])

    expect(ledger[0]).toMatchObject({ status: 'closed', gate: 'signal vert' })
    expect(ledger[0].verdict).toBeUndefined()
  })

  it('retient le dernier resultat lorsqu une gate echouee est retentee avec succes', () => {
    const ledger = buildObservatoryDecisionLedger([
      event('decision', 'decision', undefined, 'Hypothese'),
      { ...event('gate-failed', 'gate', 'decision', 'signal rouge'), status: 'failed' },
      {
        ...event('gate-complete', 'gate', 'decision', 'signal vert apres retry'),
        status: 'completed'
      }
    ])

    expect(ledger[0]).toMatchObject({ status: 'closed', gate: 'signal vert apres retry' })
  })

  it('ordonne un retry multi-tour par sequence plutot que par position d affichage', () => {
    const decision = { ...event('decision', 'decision', undefined, 'Hypothese'), sequence: 1 }
    const oldGate = {
      ...event('gate-failed', 'gate', 'decision', 'premier rouge'),
      sequence: 2,
      status: 'failed'
    }
    const retryGate = {
      ...event('gate-complete', 'gate', 'decision', 'retry vert'),
      sequence: 8,
      status: 'completed'
    }

    expect(buildObservatoryDecisionLedger([retryGate, decision, oldGate])[0]).toMatchObject({
      status: 'closed',
      gate: 'retry vert'
    })
  })
})
