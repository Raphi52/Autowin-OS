import type { HarnessTimelineEvent } from './harness-timeline-model'

export interface ObservatoryDecisionEntry {
  decisionId: string
  hypothesis: string
  expectedSignal?: string
  observation?: string
  gate?: string
  verdict?: string
  status: 'open' | 'closed'
}

function decisionText(content: string): { hypothesis: string; expectedSignal?: string } {
  const fallback = content.trim() || 'Décision sans hypothèse exposée'
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const hypothesis = [parsed.hypothesis, parsed.hypothèse, parsed.decision, parsed.reason].find(
      (item) => typeof item === 'string'
    )
    const expectedSignal = [parsed.expectedSignal, parsed.signalAttendu, parsed.signal].find(
      (item) => typeof item === 'string'
    )
    return {
      hypothesis: typeof hypothesis === 'string' ? hypothesis : fallback,
      ...(typeof expectedSignal === 'string' ? { expectedSignal } : {})
    }
  } catch {
    return { hypothesis: fallback }
  }
}

export function buildObservatoryDecisionLedger(
  events: readonly HarnessTimelineEvent[]
): ObservatoryDecisionEntry[] {
  const byId = new Map(events.map((event) => [event.id, event]))
  const inputOrder = new Map(events.map((event, index) => [event.id, index]))
  const descendsFrom = (event: HarnessTimelineEvent, ancestorId: string): boolean => {
    const visited = new Set<string>()
    let parentId = event.parentId
    while (parentId && !visited.has(parentId)) {
      if (parentId === ancestorId) return true
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (parent?.kind === 'decision') return false
      parentId = parent?.parentId
    }
    return false
  }

  return events
    .filter((event) => event.kind === 'decision' && !event.authority)
    .map((decision) => {
      const related = events.filter((event) => descendsFrom(event, decision.id))
      const latestRelated = [...related].sort((a, b) => {
        if (a.sequence != null && b.sequence != null && a.sequence !== b.sequence)
          return b.sequence - a.sequence
        const aTime = a.timestamp ? Date.parse(a.timestamp) : Number.NaN
        const bTime = b.timestamp ? Date.parse(b.timestamp) : Number.NaN
        if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime)
          return bTime - aTime
        return (inputOrder.get(b.id) ?? 0) - (inputOrder.get(a.id) ?? 0)
      })
      const observation = latestRelated.find((event) =>
        ['tool-result', 'model-response', 'error'].includes(event.kind)
      )
      const gate = latestRelated.find((event) => event.kind === 'gate')
      const verdict = latestRelated.find((event) => event.kind === 'verdict')
      const terminalGate = gate?.status === 'completed' ? gate : undefined
      const terminalVerdict =
        verdict && (verdict.status == null || verdict.status === 'completed') ? verdict : undefined
      const parsed = decisionText(decision.content)
      return {
        decisionId: decision.id,
        ...parsed,
        ...(observation?.content ? { observation: observation.content } : {}),
        ...(gate?.content ? { gate: gate.content } : {}),
        ...(verdict?.content ? { verdict: verdict.content } : {}),
        status: terminalGate || terminalVerdict ? ('closed' as const) : ('open' as const)
      }
    })
}
