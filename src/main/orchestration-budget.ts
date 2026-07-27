import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CircuitBreakerLimits } from './cost-circuit-breaker'

export interface OrchestrationBudgetSettings {
  /** Maximum cumulative orchestration cost in USD. `null` deliberately disables the cost cap. */
  maxUsd: number | null
}

export const DEFAULT_ORCHESTRATION_BUDGET: OrchestrationBudgetSettings = { maxUsd: null }

function isValidCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function normalizeOrchestrationBudget(value: unknown): OrchestrationBudgetSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ORCHESTRATION_BUDGET }
  const maxUsd = (value as Partial<OrchestrationBudgetSettings>).maxUsd
  return { maxUsd: isValidCap(maxUsd) ? maxUsd : null }
}

export function loadOrchestrationBudget(path: string): OrchestrationBudgetSettings {
  if (!existsSync(path)) return { ...DEFAULT_ORCHESTRATION_BUDGET }
  try {
    return normalizeOrchestrationBudget(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT_ORCHESTRATION_BUDGET }
  }
}

export function saveOrchestrationBudget(path: string, value: unknown): OrchestrationBudgetSettings {
  const settings = normalizeOrchestrationBudget(value)
  if (
    value !== null &&
    (!value ||
      typeof value !== 'object' ||
      ((value as Partial<OrchestrationBudgetSettings>).maxUsd !== null &&
        !isValidCap((value as Partial<OrchestrationBudgetSettings>).maxUsd)))
  ) {
    throw new Error('Le budget USD doit être un nombre fini strictement positif, ou absent.')
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8')
  return settings
}

/** Maps the persisted user setting onto the exact limits consumed by the runtime breaker. */
export function costLimitsFromSettings(
  settings: OrchestrationBudgetSettings
): CircuitBreakerLimits {
  return settings.maxUsd === null ? {} : { maxUsd: settings.maxUsd }
}
