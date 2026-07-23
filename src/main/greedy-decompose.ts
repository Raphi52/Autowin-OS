import type { ProviderRegistry } from './providers/registry'
import type { RoleModelConfig } from './roles'
import type { GreedyTaskNode } from './orchestrator'

/**
 * Décomposeur de tâche pour le mode greedy : demande au modèle ORCHESTRATEUR un DAG de sous-tâches
 * (JSON) puis le parse/valide. Le PARSER est pur (unit-testé) ; l'appel modèle est branché par
 * `buildOrchestratorDecomposer`. Un plan invalide/trivial ⇒ [] ⇒ l'orchestrateur retombe en séquentiel.
 */

/** Consigne remise au modèle orchestrateur pour produire le plan. Format STRICT attendu = tableau JSON. */
export function decompositionPrompt(task: string): string {
  return (
    `Tu es l'ORCHESTRATEUR. Découpe la TÂCHE en sous-tâches indépendantes ou enchaînables, pour un ` +
    `dispatch PARALLÈLE greedy. Renvoie UNIQUEMENT un tableau JSON, sans prose autour :\n` +
    `[{"id":"<court>","prompt":"<consigne autoportante de la sous-tâche>","deps":["<id prérequis>", ...]}]\n` +
    `Règles : ids uniques ; "deps" = ids qui DOIVENT finir avant (souvent vide) ; maximise l'indépendance ` +
    `(plus de parallélisme) ; PAS de cycle ; 2 à 8 sous-tâches. Si la tâche est atomique, renvoie [].\n` +
    `TÂCHE: ${task}`
  )
}

/** Extrait le 1ᵉʳ tableau JSON équilibré du texte (le modèle peut entourer de prose / fences). */
function extractJsonArray(text: string): string | undefined {
  const start = text.indexOf('[')
  if (start === -1) return undefined
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return undefined
}

/**
 * Parse + VALIDE un plan de décomposition. Renvoie [] (⇒ fallback séquentiel) si : pas de JSON, JSON
 * invalide, aucun nœud exploitable, ids dupliqués, dépendance inconnue, ou cycle. Robuste au bruit
 * (fences ```json, prose). Ne fait JAMAIS confiance aveuglément à la sortie du modèle.
 */
export function parseDecompositionPlan(text: string): GreedyTaskNode[] {
  const json = extractJsonArray(text ?? '')
  if (!json) return []
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const nodes: GreedyTaskNode[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return []
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id.trim()) return []
    if (typeof o.prompt !== 'string' || !o.prompt.trim()) return []
    const deps = Array.isArray(o.deps) ? o.deps : []
    if (!deps.every((d) => typeof d === 'string')) return []
    nodes.push({ id: o.id.trim(), prompt: o.prompt.trim(), deps: (deps as string[]).map((d) => d.trim()) })
  }
  if (nodes.length === 0) return []
  // Validation structurelle : ids uniques, deps connues, pas de cycle (sinon plan rejeté → séquentiel).
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length) return []
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!ids.has(d) || d === n.id) return []
    }
  }
  if (hasCycle(nodes)) return []
  return nodes
}

/** Détection de cycle (Kahn) — un plan cyclique est rejeté. */
function hasCycle(nodes: GreedyTaskNode[]): boolean {
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, n.deps.length]))
  const dependents = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const n of nodes) for (const d of n.deps) dependents.get(d)!.push(n.id)
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  let removed = 0
  while (queue.length) {
    const id = queue.shift()!
    removed++
    for (const dep of dependents.get(id)!) {
      const left = indeg.get(dep)! - 1
      indeg.set(dep, left)
      if (left === 0) queue.push(dep)
    }
  }
  return removed !== nodes.length
}

/**
 * Fabrique le décomposeur PROD : interroge le modèle orchestrateur (rôle `orchestrator`) en lecture
 * seule et parse sa sortie. NB : l'appel modèle est runtime (non couvert par les tests) ; le PARSER,
 * lui, est unit-testé. Toute défaillance (réseau, JSON invalide) ⇒ [] ⇒ séquentiel (jamais bloquant).
 */
export function buildOrchestratorDecomposer(deps: {
  registry: ProviderRegistry
  roles: RoleModelConfig
  cwd: string
}): (task: string) => Promise<GreedyTaskNode[]> {
  return async (task: string): Promise<GreedyTaskNode[]> => {
    const binding = deps.roles.getBinding('orchestrator')
    try {
      const res = await deps.registry.send(
        binding.provider,
        [{ role: 'user', content: decompositionPrompt(task) }],
        {
          model: binding.model,
          reasoningEffort: binding.reasoningEffort,
          execution: { cwd: deps.cwd, sandbox: 'read-only' }
        }
      )
      return parseDecompositionPlan(res.text ?? '')
    } catch {
      return [] // décomposeur best-effort : jamais bloquant, fallback séquentiel
    }
  }
}
