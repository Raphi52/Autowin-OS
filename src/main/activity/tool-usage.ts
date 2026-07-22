import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import { TraceStore } from './trace-store'

/**
 * Usage RÉEL des outils — agrège les événements causaux `tool-call` (émis par
 * persistOrchestrationStep depuis l'executionEvidence des sous-agents) sur TOUTES les
 * conversations. Contrairement au catalogue Hermes (décoratif, jamais invoqué par les
 * modèles Autowin), ceci reflète ce que Codex/Claude ont réellement exécuté sur la machine.
 * Forme compatible avec l'item de la vue Capacités (id/label/description/enabled/mutable).
 */
export interface ToolUsageItem {
  id: string
  label: string
  description: string
  enabled: boolean
  mutable: boolean
  count: number
  lastUsedAt?: string
}

const KIND_LABEL: Record<string, string> = {
  mutation: 'Écriture / patch fichier',
  verification: 'Test / vérification',
  inspection: 'Lecture / inspection',
  other: 'Autre action'
}

export function aggregateToolUsage(
  root = join(ensureAutowinAppData(), 'causal-trace')
): ToolUsageItem[] {
  if (!existsSync(root)) return []
  const store = new TraceStore(root)
  const byKind = new Map<string, { count: number; lastUsedAt?: string }>()
  for (const file of readdirSync(root)) {
    if (!file.endsWith('.jsonl')) continue
    const conversationId = file.slice(0, -'.jsonl'.length)
    let events
    try {
      events = store.readConversation(conversationId)
    } catch {
      continue // conversation illisible/corrompue → ignorée, pas fatale
    }
    for (const event of events) {
      if (event.type !== 'tool-call') continue
      const kind = event.actor.id || 'other'
      const agg = byKind.get(kind) ?? { count: 0 }
      agg.count += 1
      if (!agg.lastUsedAt || event.timestamp > agg.lastUsedAt) agg.lastUsedAt = event.timestamp
      byKind.set(kind, agg)
    }
  }
  return [...byKind.entries()]
    .map(([kind, agg]) => ({
      id: kind,
      label: KIND_LABEL[kind] ?? kind,
      description:
        `${agg.count} action${agg.count > 1 ? 's' : ''} réelle${agg.count > 1 ? 's' : ''}` +
        (agg.lastUsedAt
          ? ` · dernière le ${new Date(agg.lastUsedAt).toLocaleDateString('fr-FR')}`
          : ''),
      enabled: true,
      mutable: false,
      count: agg.count,
      lastUsedAt: agg.lastUsedAt
    }))
    .sort((a, b) => b.count - a.count)
}
