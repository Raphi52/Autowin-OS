// Alias stables par famille, résolus AU RUNTIME contre le catalogue découvert.
//
// Module PUR (zéro I/O) : la résolution prend le catalogue en paramètre et ne
// renvoie que des modèles qui y existent réellement — un alias non résoluble
// renvoie `undefined`, il n'invente JAMAIS un modèle.

import type { ImportedModel } from './models'

/** Un alias de famille (ex. 'claude/opus-latest' → le meilleur opus du catalogue). */
export interface ModelAlias {
  /** Identité canonique de l'alias (ex. 'claude/opus-latest', 'codex/flagship'). */
  id: string
  /** Provider ciblé par l'alias. */
  provider: string
  /** Famille visée ('fable' | 'haiku' | 'opus' | 'sonnet' pour claude ; 'flagship' pour codex). */
  family: string
}

/**
 * Regex canonique des identifiants Claude versionnés — source UNIQUE, partagée
 * avec `labelClaudeModel` (models.ts) pour éviter toute duplication.
 */
export const CLAUDE_MODEL_RE = /^claude-(fable|haiku|opus|sonnet)-(\d+)(?:-(\d+))?(?:-(\d{8}))?$/

const CLAUDE_FAMILIES = ['fable', 'haiku', 'opus', 'sonnet'] as const

/**
 * Alias connus — dérivés MÉCANIQUEMENT des familles de la regex, pas figés par modèle.
 * - claude : une famille par valeur de la regex → `claude/<family>-latest`.
 * - moteurs retirés (codex, kimi, gemini) : plus aucun alias — un alias ne se résout que contre le
 *   catalogue courant, qui ne les contient plus, il ne pouvait donc que rendre `undefined`.
 */
export const KNOWN_ALIASES: ModelAlias[] = [
  ...CLAUDE_FAMILIES.map((family) => ({
    id: `claude/${family}-latest`,
    provider: 'claude',
    family
  }))
]

export function isKnownAlias(id: string): boolean {
  return KNOWN_ALIASES.some((alias) => alias.id === id)
}

export interface ClaudeVersion {
  family: string
  major: number
  minor: number
  date: string | null
}

/** Parse un identifiant Claude versionné ; null si l'id ne suit pas le schéma. */
export function parseClaudeVersion(model: string): ClaudeVersion | null {
  const match = CLAUDE_MODEL_RE.exec(model)
  if (!match) return null
  const [, family, major, minor, date] = match
  return {
    family,
    major: Number(major),
    minor: minor ? Number(minor) : 0,
    date: date ?? null
  }
}

/**
 * Ordre de fraîcheur : major → minor → datation.
 * Choix documenté : à version égale, l'id NON daté est préféré à l'id daté —
 * une date présente signale un SNAPSHOT figé, l'id non daté suit la révision
 * courante du provider. Entre deux snapshots, la date la plus récente gagne.
 */
export function compareClaudeVersions(a: ClaudeVersion, b: ClaudeVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if ((a.date === null) !== (b.date === null)) return a.date === null ? 1 : -1
  if (a.date !== null && b.date !== null && a.date !== b.date) return a.date < b.date ? -1 : 1
  return 0
}

/**
 * Résout un alias contre le catalogue fourni. `undefined` si l'alias est inconnu
 * ou si aucun modèle du catalogue ne le satisfait (on n'invente rien).
 */
export function resolveAlias(
  aliasId: string,
  catalog: ImportedModel[]
): ImportedModel | undefined {
  const alias = KNOWN_ALIASES.find((a) => a.id === aliasId)
  if (!alias) return undefined

  if (alias.provider === 'claude') {
    let best: { model: ImportedModel; version: ClaudeVersion } | undefined
    for (const model of catalog) {
      if (model.provider !== 'claude') continue
      const version = parseClaudeVersion(model.model)
      if (!version || version.family !== alias.family) continue
      if (!best || compareClaudeVersions(version, best.version) > 0) best = { model, version }
    }
    return best?.model
  }

  if (alias.provider === 'codex') {
    // « flagship » = priority min parmi les modèles listés (visibility 'list').
    // Un modèle sans visibility (seed hors ligne) est traité comme listé ; un
    // modèle sans priority passe en dernier (le catalogue live la fournit).
    let best: ImportedModel | undefined
    for (const model of catalog) {
      if (model.provider !== 'codex') continue
      if (model.visibility !== undefined && model.visibility !== 'list') continue
      const rank = model.priority ?? Number.POSITIVE_INFINITY
      const bestRank = best ? (best.priority ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
      if (!best || rank < bestRank) best = model
    }
    return best
  }

  return undefined
}
