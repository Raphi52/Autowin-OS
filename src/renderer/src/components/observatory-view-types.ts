import type { NativeTraceSummaryInput } from './native-trace-summary'
import type { ActivitySessionMeta } from './useObservatorySources'

/**
 * Formes de données lues par la vue Observatory. Elles étaient déclarées dans
 * `ObservatoryView.tsx` : les sous-composants de rendu extraits le 2026-08-11 en ont besoin sans
 * importer la vue elle-même (cycle). Aucun champ n'est modifié par ce déplacement.
 */
export interface ConversationItem {
  id: string
  title: string
  provider: string
  updatedAt: number
}

export interface PromptCall {
  id: string
  brainTraceId?: string
  ts: string
  conversationId: string
  turnId: string
  provider: string
  actor?: string
  phase?: string
  model?: string
  boundary: string
  limitation: string
  system?: string
  messages: Array<{ role: string; content: string }>
  options: Record<string, unknown>
  response: string
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; costUsd?: number }
}

/**
 * Trace native COMPLETE — la requete brute, par opposition au RESUME (`NativeTraceSummaryInput`)
 * dont elle herite. L'ancien nom, `NativeRawTrace`, ne disait pas cette opposition : rien
 * n'indiquait lequel des deux portait le payload integral.
 */
export interface NativeRawTrace extends NativeTraceSummaryInput {
  apiRequestId: string
  messageCount: number
  toolCount: number
  request: Record<string, unknown>
  fidelity: 'exact-redacted'
}

export interface ActivitySession {
  meta: ActivitySessionMeta
  turns: Array<{ kind: 'user' | 'assistant'; text: string }>
  images: Array<{ path: string; exists: boolean }>
  totalToolCalls: number
}
