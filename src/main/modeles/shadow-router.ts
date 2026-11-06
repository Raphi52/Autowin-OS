export interface RouteIdentity {
  readonly provider: string
  readonly model: string
}

export interface RouteSample extends RouteIdentity {
  readonly phase: string
  readonly cost: number
  readonly durationMs: number
  readonly green: boolean
}

export interface RouteMetrics {
  readonly route: RouteIdentity
  readonly sampleCount: number
  readonly greenRate: number
  readonly averageCost: number
  readonly averageDurationMs: number
}

export interface ShadowRouteRequest {
  readonly phase: string
  readonly champion: RouteIdentity
  readonly minimumSamples?: number
}

export interface ShadowRouteRecommendation {
  readonly status: 'recommendation'
  readonly phase: string
  readonly decision: 'keep-champion' | 'trial-challenger'
  readonly confidence: 'low' | 'medium' | 'high'
  readonly champion: RouteMetrics
  readonly challenger: RouteMetrics
  readonly explanation: string
}

export interface ShadowRouteInsufficientData {
  readonly status: 'insufficient-data'
  readonly confidence: 'insufficient'
  readonly phase: string
  readonly reason: string
}

export type ShadowRouteResult = ShadowRouteRecommendation | ShadowRouteInsufficientData

function routeKey(route: RouteIdentity): string {
  return `${route.provider}\u0000${route.model}`
}

function sameRoute(left: RouteIdentity, right: RouteIdentity): boolean {
  return left.provider === right.provider && left.model === right.model
}

function average(values: readonly number[]): number {
  return (
    [...values].sort((left, right) => left - right).reduce((total, value) => total + value, 0) /
    values.length
  )
}

function metricsFor(samples: readonly RouteSample[]): RouteMetrics {
  const first = samples[0]
  return {
    route: { provider: first.provider, model: first.model },
    sampleCount: samples.length,
    greenRate: samples.filter((sample) => sample.green).length / samples.length,
    averageCost: average(samples.map((sample) => sample.cost)),
    averageDurationMs: average(samples.map((sample) => sample.durationMs))
  }
}

function compareMetrics(left: RouteMetrics, right: RouteMetrics): number {
  const measuredDifference =
    right.greenRate - left.greenRate ||
    left.averageCost - right.averageCost ||
    left.averageDurationMs - right.averageDurationMs
  if (measuredDifference) return measuredDifference
  const leftKey = routeKey(left.route)
  const rightKey = routeKey(right.route)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function isImprovement(challenger: RouteMetrics, champion: RouteMetrics): boolean {
  return compareMetrics(challenger, champion) < 0
}

function validateSamples(samples: readonly RouteSample[]): void {
  for (const sample of samples) {
    if (!Number.isFinite(sample.cost) || sample.cost < 0) {
      throw new TypeError('Chaque coût doit être un nombre fini positif ou nul.')
    }
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) {
      throw new TypeError('Chaque durée doit être un nombre fini positif ou nul.')
    }
  }
}

export function recommendShadowRoute(
  samples: readonly RouteSample[],
  request: ShadowRouteRequest
): ShadowRouteResult {
  validateSamples(samples)
  const minimumSamples = request.minimumSamples ?? 3
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1) {
    throw new RangeError('minimumSamples doit être un entier strictement positif.')
  }

  const phaseSamples = samples.filter((sample) => sample.phase === request.phase)
  const championSamples = phaseSamples.filter((sample) => sameRoute(sample, request.champion))
  if (championSamples.length < minimumSamples) {
    return {
      status: 'insufficient-data',
      confidence: 'insufficient',
      phase: request.phase,
      reason: `Le champion requiert au moins ${minimumSamples} échantillons; ${championSamples.length} disponibles.`
    }
  }

  const grouped = new Map<string, RouteSample[]>()
  for (const sample of phaseSamples) {
    if (sameRoute(sample, request.champion)) continue
    const key = routeKey(sample)
    const group = grouped.get(key) ?? []
    group.push(sample)
    grouped.set(key, group)
  }
  const challengers = [...grouped.values()]
    .filter((group) => group.length >= minimumSamples)
    .map(metricsFor)
    .sort(compareMetrics)
  if (challengers.length === 0) {
    return {
      status: 'insufficient-data',
      confidence: 'insufficient',
      phase: request.phase,
      reason: `Aucun challenger ne dispose de ${minimumSamples} échantillons.`
    }
  }

  const champion = metricsFor(championSamples)
  const challenger = challengers[0]
  const decision = isImprovement(challenger, champion) ? 'trial-challenger' : 'keep-champion'
  const evidenceSize = Math.min(champion.sampleCount, challenger.sampleCount)
  const confidence = evidenceSize >= 10 ? 'high' : evidenceSize >= minimumSamples ? 'medium' : 'low'
  const explanation =
    decision === 'trial-challenger'
      ? `Le challenger est mieux classé : qualité verte ${(challenger.greenRate * 100).toFixed(1)} % contre ${(champion.greenRate * 100).toFixed(1)} %, puis coût et durée comme départage.`
      : `Le champion reste mieux classé : qualité verte ${(champion.greenRate * 100).toFixed(1)} %, puis coût et durée comme départage.`

  return {
    status: 'recommendation',
    phase: request.phase,
    decision,
    confidence,
    champion,
    challenger,
    explanation
  }
}
