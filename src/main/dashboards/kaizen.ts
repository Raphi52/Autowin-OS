// Agrégation de télémétrie type gate-counters.jsonl → patterns récurrents (candidat ⑦).

/** Un événement de gate (block/pass/revert), tel que loggé dans gate-counters.jsonl. */
export type GateEvent = {
  gate: string
  file?: string
  outcome: 'block' | 'pass' | 'revert'
  session?: string
}

/**
 * Parse un texte JSONL (1 objet par ligne) en liste de GateEvent.
 * Robuste : ignore les lignes vides et les lignes non-JSON/mal formées.
 */
export function parseJsonl(text: string): GateEvent[] {
  const events: GateEvent[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (typeof parsed !== 'object' || parsed === null) continue
    const obj = parsed as Record<string, unknown>

    if (typeof obj.gate !== 'string') continue
    if (obj.outcome !== 'block' && obj.outcome !== 'pass' && obj.outcome !== 'revert') continue

    events.push({
      gate: obj.gate,
      outcome: obj.outcome,
      file: typeof obj.file === 'string' ? obj.file : undefined,
      session: typeof obj.session === 'string' ? obj.session : undefined
    })
  }

  return events
}

/**
 * Regroupe les events par (gate) et par (gate+file), compte les 'block'+'revert'
 * (les 'pass' ne comptent pas), et retourne les groupes dont le compte >= threshold,
 * triés par compte décroissant.
 */
export function recurrentPatterns(
  events: GateEvent[],
  threshold = 3
): { key: string; count: number; gate: string; file?: string }[] {
  const counts = new Map<string, { count: number; gate: string; file?: string }>()

  for (const evt of events) {
    if (evt.outcome !== 'block' && evt.outcome !== 'revert') continue

    // Groupe par gate seul.
    const gateKey = evt.gate
    const gateEntry = counts.get(gateKey) ?? { count: 0, gate: evt.gate }
    gateEntry.count += 1
    counts.set(gateKey, gateEntry)

    // Groupe par gate+file (si un fichier est présent).
    if (evt.file !== undefined) {
      const fileKey = `${evt.gate}::${evt.file}`
      const fileEntry = counts.get(fileKey) ?? { count: 0, gate: evt.gate, file: evt.file }
      fileEntry.count += 1
      counts.set(fileKey, fileEntry)
    }
  }

  const result = Array.from(counts.entries())
    .filter(([, entry]) => entry.count >= threshold)
    .map(([key, entry]) => ({ key, count: entry.count, gate: entry.gate, file: entry.file }))

  result.sort((a, b) => b.count - a.count)
  return result
}

/** Résumé global : total d'events + compte par outcome. */
export function summary(events: GateEvent[]): {
  total: number
  blocks: number
  reverts: number
  passes: number
} {
  let blocks = 0
  let reverts = 0
  let passes = 0

  for (const evt of events) {
    if (evt.outcome === 'block') blocks += 1
    else if (evt.outcome === 'revert') reverts += 1
    else if (evt.outcome === 'pass') passes += 1
  }

  return { total: events.length, blocks, reverts, passes }
}
