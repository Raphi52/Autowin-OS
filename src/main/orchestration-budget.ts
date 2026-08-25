import { readDurableJson, writeDurableJson } from './durable-json'

export interface OrchestrationBudgetSettings {
  /** Maximum cumulative orchestration cost in USD. `null` deliberately disables the cost cap. */
  maxUsd: number | null
  /** Hard ceiling shared by every orchestration entrypoint. */
  maxProviderCalls: number
  /**
   * Plafond d'appels d'UN TOUR DE CHAT, distinct du plafond d'orchestration.
   *
   * Mesuré le 2026-08-25 sur conv-1397 : un tour a été coupé sur « Budget d'appels provider atteint
   * (6) » APRÈS cinq éditions réussies, juste avant sa vérification — travail à moitié posé, demande
   * perdue. Ce 6 était écrit en dur dans `os.ts`, hérité de l'époque où un tour de chat valait UN
   * appel. Un tour agentique en consomme un PAR ÉTAPE : le plafond comptait des étapes, pas de la
   * dépense.
   *
   * Volontairement très large : un tour ne doit pas mourir sur un compteur d'étapes. Les freins de
   * dépense sont les tokens et l'USD, pas le nombre de coups.
   */
  maxChatProviderCalls: number
  /** Input + output tokens. Works even when a provider exposes no USD cost. */
  maxTotalTokens: number
}

export const DEFAULT_ORCHESTRATION_BUDGET: OrchestrationBudgetSettings = {
  maxUsd: null,
  maxProviderCalls: 24,
  maxChatProviderCalls: 50,
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
    maxChatProviderCalls: isValidIntegerCap(proposed.maxChatProviderCalls)
      ? proposed.maxChatProviderCalls
      : DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls,
    maxTotalTokens: isValidIntegerCap(proposed.maxTotalTokens)
      ? proposed.maxTotalTokens
      : DEFAULT_ORCHESTRATION_BUDGET.maxTotalTokens
  }
}

function decodeOrchestrationBudgetInput(value: unknown): OrchestrationBudgetSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const proposed = value as Partial<OrchestrationBudgetSettings>
  if (proposed.maxUsd !== undefined && proposed.maxUsd !== null && !isValidCap(proposed.maxUsd)) {
    return undefined
  }
  if (proposed.maxProviderCalls !== undefined && !isValidIntegerCap(proposed.maxProviderCalls)) {
    return undefined
  }
  if (
    proposed.maxChatProviderCalls !== undefined &&
    !isValidIntegerCap(proposed.maxChatProviderCalls)
  ) {
    return undefined
  }
  if (proposed.maxTotalTokens !== undefined && !isValidIntegerCap(proposed.maxTotalTokens)) {
    return undefined
  }
  return normalizeOrchestrationBudget(value)
}

function decodeStoredOrchestrationBudget(value: unknown): OrchestrationBudgetSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const proposed = value as Partial<OrchestrationBudgetSettings>
  if (
    !Object.prototype.hasOwnProperty.call(proposed, 'maxUsd') ||
    !Object.prototype.hasOwnProperty.call(proposed, 'maxProviderCalls') ||
    !Object.prototype.hasOwnProperty.call(proposed, 'maxTotalTokens')
  ) {
    return undefined
  }
  if (proposed.maxUsd !== null && !isValidCap(proposed.maxUsd)) return undefined
  if (!isValidIntegerCap(proposed.maxProviderCalls)) return undefined
  if (!isValidIntegerCap(proposed.maxTotalTokens)) return undefined
  /*
   * `maxChatProviderCalls` est LU comme optionnel, a l'inverse des trois autres qui sont exiges.
   *
   * C'est delibere : le reglage deja ecrit sur les machines ne porte pas cette cle. L'exiger ferait
   * rejeter le fichier entier -- et un rejet LEVE (`DurableJsonError`), il ne retombe pas en silence
   * sur les defauts. Le reglage existant deviendrait donc illisible, pas seulement reinitialise. Une
   * cle absente prend le defaut ; une cle PRESENTE mais invalide reste un rejet, comme les autres.
   */
  if (
    Object.prototype.hasOwnProperty.call(proposed, 'maxChatProviderCalls') &&
    !isValidIntegerCap(proposed.maxChatProviderCalls)
  ) {
    return undefined
  }
  return {
    maxUsd: proposed.maxUsd,
    maxProviderCalls: proposed.maxProviderCalls,
    maxChatProviderCalls:
      proposed.maxChatProviderCalls ?? DEFAULT_ORCHESTRATION_BUDGET.maxChatProviderCalls,
    maxTotalTokens: proposed.maxTotalTokens
  }
}

export function loadOrchestrationBudget(path: string): OrchestrationBudgetSettings {
  return (
    readDurableJson(path, decodeStoredOrchestrationBudget) ?? {
      ...DEFAULT_ORCHESTRATION_BUDGET
    }
  )
}

export function saveOrchestrationBudget(path: string, value: unknown): OrchestrationBudgetSettings {
  const settings =
    value === null ? { ...DEFAULT_ORCHESTRATION_BUDGET } : decodeOrchestrationBudgetInput(value)
  if (!settings) {
    throw new Error('Les plafonds doivent etre des nombres finis strictement positifs, ou absents.')
  }
  writeDurableJson(path, settings, decodeStoredOrchestrationBudget)
  return settings
}
