export interface ModelQuotaWindow {
  id: string
  label: string
  usedPercent: number
  remainingPercent: number
  resetsAt?: string
  modelFamily?: string
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
