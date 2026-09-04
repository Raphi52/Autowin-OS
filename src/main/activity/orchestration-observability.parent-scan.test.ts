import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { persistOrchestrationStep } from './orchestration-observability'
import type { TraceEventV1 } from './trace-event'
import type { TraceStore } from './trace-store'

/**
 * Garde-fou de non-regression (banc /arena /heal du 2026-09-04) : la resolution du parent causal
 * d'un pas relisait la liste complete du fil QUATRE fois par pas persiste. Le compteur ci-dessous
 * plafonne le nombre de lectures du champ `execution` de la liste : si un filtre supplementaire
 * revient un jour, ce test repasse rouge au lieu de laisser la lenteur passer inapercue.
 */
describe('resolution du parent causal — cout de parcours', () => {
  const buildFil = (
    count: number,
    onExecutionRead: () => void
  ): TraceEventV1[] =>
    Array.from({ length: count }, (_, index) => {
      const brut = {
        schema: 'autowin.trace/v1',
        id: `evt-${index}`,
        conversationId: 'conv-scan',
        turnId: 'turn-scan',
        timestamp: new Date(1000 + index).toISOString(),
        sequence: index,
        type: 'handoff',
        status: 'completed',
        actor: { id: 'a', kind: 'agent', label: 'a' },
        recipient: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
        channel: 'internal',
        payloads: [],
        observation: { boundary: 'test', fidelity: 'exact' },
        execution: { runId: 'run-scan', taskId: `task-${index}` }
      } as unknown as TraceEventV1
      return new Proxy(brut, {
        get(cible, propriete, recepteur) {
          if (propriete === 'execution') onExecutionRead()
          return Reflect.get(cible, propriete, recepteur)
        }
      }) as TraceEventV1
    })

  it('ne lit pas la liste du fil plus d’une fois par pas persiste', () => {
    const taille = 400
    let lectures = 0
    const fil = buildFil(taille, () => {
      lectures += 1
    })
    const store = {
      readConversation: () => fil,
      nextSequence: () => taille,
      append: () => undefined
    } as unknown as TraceStore

    persistOrchestrationStep(
      {
        step: 'exec',
        role: 'build',
        iteration: 1,
        status: 'completed',
        execution: { groupId: 'grp-1', dependencyIds: ['task-7', 'task-9'], taskId: 'task-new' }
      } as never,
      { conversationId: 'conv-scan', turnId: 'turn-scan', runId: 'run-scan', iteration: 1 } as never,
      mkdtempSync(join(tmpdir(), 'autowin-parent-scan-')),
      store
    )

    expect(lectures).toBeLessThanOrEqual(taille + 1)
  })
})
