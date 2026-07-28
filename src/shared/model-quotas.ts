export interface ModelQuotaWindow {
  id: string
  label: string
  usedPercent: number
  remainingPercent: number
  resetsAt?: string
  modelFamily?: string
  /**
   * Tokens réellement CONSOMMÉS sur la fenêtre, quand ils sont mesurés (source locale).
   * Présent sans `limitKnown` ⇒ on connaît la consommation mais pas le plafond.
   */
  usedTokens?: number
  /**
   * `false` = aucun plafond officiel connu → `usedPercent`/`remainingPercent` ne veulent RIEN dire
   * et NE DOIVENT PAS être affichés comme un quota (honnêteté : on montre les tokens consommés).
   * Absent/`true` = quota officiel exposé par le provider.
   */
  limitKnown?: boolean
}

export type ModelQuotaAvailability = 'available' | 'stale' | 'unavailable'
export type ModelQuotaLevel = 'healthy' | 'warning' | 'critical' | 'unknown'

export interface ModelQuota {
  modelId: string
  model: string
  label: string
  provider: string
  shared: boolean
  status: ModelQuotaAvailability
  source: string
  observedAt?: string
  windows: ModelQuotaWindow[]
  error?: string
}

export interface ModelQuotaSnapshot {
  observedAt: string
  summary: {
    remainingPercent?: number
    status: ModelQuotaLevel
  }
  models: ModelQuota[]
}
