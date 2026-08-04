import type { ProviderRegistry } from './providers/registry'
import type { RoleBinding, RoleModelConfig } from './roles'
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
 * Pourquoi un plan a été écarté. `atomic` n'est PAS un échec : le modèle a délibérément répondu
 * « cette tâche ne se découpe pas ». Toutes les autres valeurs sont des défaillances.
 */
export type DecompositionRejection =
  | 'no-json' // aucun tableau JSON dans la réponse (prose seule, réponse vide)
  | 'invalid-json' // tableau trouvé mais JSON.parse échoue, ou n'en produit pas un
  | 'malformed-node' // un nœud sans id/prompt exploitable, ou deps non-string
  | 'duplicate-ids' // deux sous-tâches partagent le même id
  | 'unknown-dep' // une dep pointe un id absent du plan (ou elle-même)
  | 'cycle' // le DAG n'en est pas un
  | 'provider-error' // l'appel modèle a jeté (réseau, quota, sandbox)

/**
 * Issue d'une décomposition, où « le modèle juge la tâche atomique » est DISTINCT de « la
 * décomposition a échoué ». Les deux retombent en séquentiel, mais seul le second est un incident :
 * les confondre rendait invisible un orchestrateur qui n'orchestrait plus.
 */
export type DecompositionOutcome =
  | { kind: 'plan'; nodes: GreedyTaskNode[] }
  | { kind: 'atomic' }
  | { kind: 'rejected'; reason: DecompositionRejection }

/**
 * Parse + VALIDE un plan de décomposition, en NOMMANT pourquoi il est écarté. Robuste au bruit
 * (fences ```json, prose). Ne fait JAMAIS confiance aveuglément à la sortie du modèle.
 */
export function analyzeDecomposition(text: string): DecompositionOutcome {
  const rejected = (reason: DecompositionRejection): DecompositionOutcome => ({
    kind: 'rejected',
    reason
  })
  const json = extractJsonArray(text ?? '')
  if (!json) return rejected('no-json')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return rejected('invalid-json')
  }
  // Garde défensif : `extractJsonArray` ne rend qu'une tranche `[...]` équilibrée, donc un parse
  // réussi produit toujours un tableau. Le garde reste, mais aucun motif propre ne lui est dédié.
  if (!Array.isArray(raw)) return rejected('invalid-json')
  const nodes: GreedyTaskNode[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return rejected('malformed-node')
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id.trim()) return rejected('malformed-node')
    if (typeof o.prompt !== 'string' || !o.prompt.trim()) return rejected('malformed-node')
    const deps = Array.isArray(o.deps) ? o.deps : []
    if (!deps.every((d) => typeof d === 'string')) return rejected('malformed-node')
    nodes.push({
      id: o.id.trim(),
      prompt: o.prompt.trim(),
      deps: (deps as string[]).map((d) => d.trim())
    })
  }
  // Un tableau vide est la réponse ATTENDUE sur une tâche atomique — pas un échec.
  if (nodes.length === 0) return { kind: 'atomic' }
  // Validation structurelle : ids uniques, deps connues, pas de cycle (sinon plan rejeté → séquentiel).
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length) return rejected('duplicate-ids')
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!ids.has(d) || d === n.id) return rejected('unknown-dep')
    }
  }
  if (hasCycle(nodes)) return rejected('cycle')
  return { kind: 'plan', nodes }
}

/**
 * Vue « nœuds seuls » de {@link analyzeDecomposition} : [] ⇒ fallback séquentiel, que la tâche soit
 * atomique ou que le plan ait été rejeté. Conservée pour les appelants qui n'ont pas besoin du motif ;
 * préférer `analyzeDecomposition` dès qu'il faut distinguer les deux.
 */
export function parseDecompositionPlan(text: string): GreedyTaskNode[] {
  const outcome = analyzeDecomposition(text)
  return outcome.kind === 'plan' ? outcome.nodes : []
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
  /**
   * Notifié à CHAQUE décomposition, y compris quand elle retombe en séquentiel. C'est le seul point
   * d'où l'on peut voir la différence entre « tâche atomique » et « le modèle a foiré son JSON » :
   * sans ce sink, les deux cas produisent le même silence côté logs.
   */
  onOutcome?: (outcome: DecompositionOutcome, task: string) => void
}): (
  task: string,
  bindingOverride?: RoleBinding,
  onOutcome?: (outcome: DecompositionOutcome, task: string) => void
) => Promise<GreedyTaskNode[]> {
  return async (
    task: string,
    bindingOverride?: RoleBinding,
    // Sink PAR APPEL, en plus de celui de construction. Il existe parce que le sink de construction
    // ne peut RIEN savoir du run en cours : le décomposeur est fabriqué une fois, au démarrage, hors
    // de tout `runId` et de tout canal `onStep`. Sans ce second point d'entrée, l'issue ne pouvait
    // être qu'écrite dans un log — invisible aux tests comme à l'UI.
    onOutcome?: (outcome: DecompositionOutcome, task: string) => void
  ): Promise<GreedyTaskNode[]> => {
    const binding = bindingOverride ?? deps.roles.getBinding('orchestrator')
    const report = (outcome: DecompositionOutcome): GreedyTaskNode[] => {
      // Un sink qui jette ne doit pas faire échouer la décomposition : il n'est qu'observateur.
      // Chacun est isolé : un observateur cassé n'empêche pas l'autre d'être notifié.
      for (const sink of [deps.onOutcome, onOutcome]) {
        try {
          sink?.(outcome, task)
        } catch {
          /* observateur best-effort */
        }
      }
      return outcome.kind === 'plan' ? outcome.nodes : []
    }
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
      return report(analyzeDecomposition(res.text ?? ''))
    } catch {
      // décomposeur best-effort : jamais bloquant, fallback séquentiel — mais l'incident est NOMMÉ.
      return report({ kind: 'rejected', reason: 'provider-error' })
    }
  }
}
