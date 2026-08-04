import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CircuitBreakerLimits } from './cost-circuit-breaker'

export interface OrchestrationBudgetSettings {
  /** Maximum cumulative orchestration cost in USD. `null` deliberately disables the cost cap. */
  maxUsd: number | null
  /** Hard ceiling shared by every orchestration entrypoint. */
  maxProviderCalls: number
  /** Input + output tokens. Works even when a provider exposes no USD cost. */
  maxTotalTokens: number
}

export const DEFAULT_ORCHESTRATION_BUDGET: OrchestrationBudgetSettings = {
  maxUsd: null,
  maxProviderCalls: 24,
  maxTotalTokens: 15_000_000
}

function isValidCap(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isValidIntegerCap(value: unknown): value is number {
  return isValidCap(value) && Number.isSafeInteger(value)
}

export function normalizeOrchestrationBudget(value: unknown): OrchestrationBudgetSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ORCHESTRATION_BUDGET }
  const proposed = value as Partial<OrchestrationBudgetSettings>
  return {
    maxUsd: isValidCap(proposed.maxUsd) ? proposed.maxUsd : null,
    maxProviderCalls: isValidIntegerCap(proposed.maxProviderCalls)
      ? proposed.maxProviderCalls
      : DEFAULT_ORCHESTRATION_BUDGET.maxProviderCalls,
    maxTotalTokens: isValidIntegerCap(proposed.maxTotalTokens)
      ? proposed.maxTotalTokens
      : DEFAULT_ORCHESTRATION_BUDGET.maxTotalTokens
  }
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
        (value as Partial<OrchestrationBudgetSettings>).maxUsd !== undefined &&
        !isValidCap((value as Partial<OrchestrationBudgetSettings>).maxUsd)) ||
      ((value as Partial<OrchestrationBudgetSettings>).maxProviderCalls !== undefined &&
        !isValidIntegerCap((value as Partial<OrchestrationBudgetSettings>).maxProviderCalls)) ||
      ((value as Partial<OrchestrationBudgetSettings>).maxTotalTokens !== undefined &&
        !isValidIntegerCap((value as Partial<OrchestrationBudgetSettings>).maxTotalTokens)))
  ) {
    throw new Error('Les plafonds doivent etre des nombres finis strictement positifs, ou absents.')
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8')
  return settings
}

/** Maps the persisted user setting onto the exact limits consumed by the runtime breaker. */
export function costLimitsFromSettings(
  settings: OrchestrationBudgetSettings
): CircuitBreakerLimits {
  return {
    ...(settings.maxUsd === null ? {} : { maxUsd: settings.maxUsd }),
    maxTokens: settings.maxTotalTokens
  }
}
