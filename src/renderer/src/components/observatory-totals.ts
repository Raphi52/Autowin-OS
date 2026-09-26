/**
 * Agrégats d'une liste d'appels modèle, SOURCE UNIQUE pour le bandeau d'Observatory et pour
 * l'export. Ils vivaient en ligne dans `ObservatoryView.tsx` et ne sommaient que input/output/
 * cache/cost : la durée (portée par chaque appel, `PromptCallRecord.durationMs`) et les appels en
 * échec (`status: 'failed'`) étaient jetés, alors que l'en-tête promet « les durées et les erreurs ».
 */
export interface ObservatoryTotalsCall {
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    costUsd?: number
  }
  durationMs?: number
  status?: string
}

export interface ObservatoryTotals {
  calls: number
  input: number
  output: number
  cache: number
  cost: number
  /** Somme des durées MESURÉES. 0 avec des appels = durée non exposée, jamais « instantané ». */
  durationMs: number
  /** Appels dont le journal porte `status: 'failed'`. */
  errors: number
}

export function computeObservatoryTotals(
  // Volontairement TOLERANT : la vue passe des PromptCall, l export des objets deja serialises.
  // On ne LIT que les champs nommes ci-dessus.
  calls: readonly ObservatoryTotalsCall[]
): ObservatoryTotals {
  return calls.reduce<ObservatoryTotals>(
    (sum, call) => ({
      calls: sum.calls + 1,
      input: sum.input + (call.usage?.inputTokens ?? 0),
      output: sum.output + (call.usage?.outputTokens ?? 0),
      cache: sum.cache + (call.usage?.cacheReadTokens ?? 0),
      cost: sum.cost + (call.usage?.costUsd ?? 0),
      durationMs: sum.durationMs + (call.durationMs ?? 0),
      errors: sum.errors + (call.status === 'failed' ? 1 : 0)
    }),
    { calls: 0, input: 0, output: 0, cache: 0, cost: 0, durationMs: 0, errors: 0 }
  )
}

/** Durée lisible : « 1,2 s », « 3 min 04 s ». Rien à afficher si aucune durée n'est mesurée. */
export function formatObservatoryDuration(durationMs: number): string {
  if (durationMs <= 0) return ''
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  const seconds = durationMs / 1000
  if (seconds < 60) return `${seconds.toFixed(1).replace('.', ',')} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${String(Math.round(seconds - minutes * 60)).padStart(2, '0')} s`
}
