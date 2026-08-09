import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { causalLearningContext } from '../knowledge/semantic-temporal-projection'
import {
  appendObservedOrchestrationOutcome,
  outcomeToTraceEvent
} from './orchestration-outcome-trace'
import { TraceStore } from './trace-store'

/**
 * MANQUE CONSTATE LE 2026-08-07 : l'issue d'une orchestration (`OrchestrationOutcome`) etait rendue
 * en TEXTE LIBRE dans le `done` (`agent-pilot.ts:341`, via `formatOrchestrationOutcome`) et n'etait
 * projetee dans AUCUN evenement causal type — `gateBlocked` et `reused` n'apparaissaient nulle part
 * dans `src/main/activity/` (verifie).
 *
 * Consequence : Observatory ne pouvait ni filtrer ni compter les runs BLOQUES PAR UN GATE, ni
 * distinguer un run REUTILISE d'un run reellement execute. Ces deux faits changent radicalement la
 * lecture d'un tour — un run reutilise n'a rien coute et rien produit de neuf.
 *
 * NUANCE VERIFIEE : les champs de COUT (`knownCostUsd`, `unpricedCalls`) etaient DEJA traites
 * (`chat-usage-settlement.ts`, `prompt-observability.ts`). Le manque ne portait que sur les champs
 * QUALITATIFS. Ne pas le dire aurait exagere l'ecart.
 */

const base = {
  id: 'conv1:turn1:outcome',
  conversationId: 'conv1',
  turnId: 'turn1',
  timestamp: '2026-08-07T10:00:00.000Z',
  sequence: 7
}

describe('outcomeToTraceEvent', () => {
  it('projette gateBlocked, valid et reused en clair', () => {
    const event = outcomeToTraceEvent({
      ...base,
      outcome: { status: 'green', valid: true, gateBlocked: false, reused: false, runId: 'run-1' }
    })
    const content = event.payloads[0].content
    expect(content).toContain('valid')
    expect(content).toContain('gateBlocked')
    expect(content).toContain('reused')
    expect(event.execution?.runId).toBe('run-1')
  })

  it('marque l’evenement en ECHEC quand un gate a bloque', () => {
    const event = outcomeToTraceEvent({ ...base, outcome: { gateBlocked: true } })
    expect(event.status).toBe('failed')
  })

  it('reste `completed` quand aucun gate n’a bloque', () => {
    const event = outcomeToTraceEvent({ ...base, outcome: { gateBlocked: false, valid: true } })
    expect(event.status).toBe('completed')
  })

  it('ne marque pas verte une issue explicitement rouge sans gate', () => {
    const event = outcomeToTraceEvent({
      ...base,
      outcome: { status: 'red', valid: false, gateBlocked: false }
    })
    expect(event.status).toBe('failed')
  })

  it('est de type `gate` — c’est un verdict de controle, filtrable comme tel', () => {
    const event = outcomeToTraceEvent({ ...base, outcome: { valid: true } })
    expect(event.type).toBe('gate')
  })

  it('survit a une issue VIDE sans jeter', () => {
    const event = outcomeToTraceEvent({ ...base, outcome: {} })
    expect(event.payloads[0].content.length).toBeGreaterThan(0)
  })

  it('n’invente pas un champ absent — il ne le mentionne simplement pas', () => {
    const event = outcomeToTraceEvent({ ...base, outcome: { valid: true } })
    expect(event.payloads[0].content).not.toContain('gateBlocked')
  })

  it('rend un run REUTILISE explicite — il n’a rien coute ni rien produit de neuf', () => {
    const event = outcomeToTraceEvent({ ...base, outcome: { reused: true } })
    expect(event.payloads[0].content).toContain('reused : true')
  })
})

describe('appendObservedOrchestrationOutcome', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('relie une vraie décision routée à son issue et rend cette expérience réutilisable', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-outcome-'))
    roots.push(root)
    const store = new TraceStore(root)
    store.append({
      schema: 'autowin.trace/v1',
      id: 'judge-1',
      conversationId: 'conv1',
      turnId: 'turn1',
      timestamp: '2026-08-07T10:00:00.000Z',
      sequence: 0,
      type: 'verdict',
      status: 'completed',
      actor: { id: 'judge', kind: 'judge', label: 'judge' },
      recipient: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
      channel: 'internal',
      payloads: [{ kind: 'app-state', content: 'green' }],
      observation: { boundary: 'Autowin orchestration judge', fidelity: 'exact' },
      execution: { runId: 'run-1', phase: 'judge', agentId: 'judge-1' },
      provider: { id: 'claude', model: 'sonnet' }
    })

    const outcome = appendObservedOrchestrationOutcome(store, {
      conversationId: 'conv1',
      turnId: 'turn1',
      outcome: { runId: 'run-1', valid: true, gateBlocked: false }
    })

    expect(outcome.parentId).toBe('judge-1')
    expect(causalLearningContext(store.readConversation('conv1'))).toContain(
      'judge · claude/sonnet · issue completed'
    )
  })
})
