// Alias stables par FAMILLE de modèle (ex. 'opus-latest'), résolus vers le
// modèle le plus récent RÉELLEMENT présent dans la liste découverte.
//
// Module PUR : aucune E/S, aucune dépendance projet → testable en isolation
// (liste de candidats + alias → id de transport concret, jamais inventé).

/** Sous-ensemble structurel d'ImportedModel suffisant pour résoudre un alias. */
export interface AliasCandidate {
  provider: string
  /** Identifiant de transport (champ `model` d'ImportedModel). */
  model: string
}

export const MODEL_ALIASES = [
  'fable-latest',
  'opus-latest',
  'sonnet-latest',
  'haiku-latest',
  'codex-latest',
  'kimi-latest'
] as const

export type ModelAlias = (typeof MODEL_ALIASES)[number]

export function isModelAlias(value: string | undefined): value is ModelAlias {
  return typeof value === 'string' && (MODEL_ALIASES as readonly string[]).includes(value)
}

const CLAUDE_FAMILY_ALIASES: Partial<Record<ModelAlias, string>> = {
  'fable-latest': 'fable',
  'opus-latest': 'opus',
  'sonnet-latest': 'sonnet',
  'haiku-latest': 'haiku'
}

function matchesAlias(candidate: AliasCandidate, alias: ModelAlias): boolean {
  const family = CLAUDE_FAMILY_ALIASES[alias]
  if (family) {
    return (
      candidate.provider === 'claude' &&
      new RegExp(`^claude-${family}(?:-|$)`).test(candidate.model)
    )
  }
  if (alias === 'codex-latest') return candidate.provider === 'codex'
  return candidate.provider === 'kimi'
}

/**
 * Clé de récence : la suite des groupes numériques de l'id de transport,
 * comparée lexicographiquement. Ex. claude-opus-4-6 → [4,6] ;
 * claude-haiku-4-5-20251001 → [4,5,20251001] ; gpt-5.6-terra → [5,6].
 */
function recencyKey(model: string): number[] {
  return (model.match(/\d+/g) ?? []).map((n) => Number.parseInt(n, 10))
}

function newer(a: number[], b: number[]): boolean {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? -1
    const bv = b[i] ?? -1
    if (av !== bv) return av > bv
  }
  return false
}

/**
 * Résout un alias vers l'id de transport CONCRET le plus récent parmi les
 * candidats fournis. Retourne undefined si aucun candidat ne correspond —
 * jamais un nom inventé. Fonction pure : (liste, alias) → id | undefined.
 */
export function resolveModelAlias(
  candidates: AliasCandidate[],
  alias: string
): string | undefined {
  if (!isModelAlias(alias)) return undefined
  let best: AliasCandidate | undefined
  let bestKey: number[] = []
  for (const candidate of candidates) {
    if (!matchesAlias(candidate, alias)) continue
    const key = recencyKey(candidate.model)
    if (!best || newer(key, bestKey)) {
      best = candidate
      bestKey = key
    }
  }
  return best?.model
}
