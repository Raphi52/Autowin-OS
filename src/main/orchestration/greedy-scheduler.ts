/**
 * Ordonnanceur GREEDY completion-driven pour un DAG de tâches.
 *
 * Principe (le cœur du mode « pipeline greedy » de l'orchestrateur) :
 *  1. On dispatche TOUT ce qui est indépendant d'un coup (borné par `concurrency`).
 *  2. On traite CHAQUE tâche DÈS SON ARRIVÉE (jamais d'`await Promise.all` — pas de barrière).
 *  3. Chaque arrivée peut débloquer de nouvelles tâches aval (leurs dépendances viennent d'être satisfaites)
 *     → on les dispatche immédiatement, sans attendre les tâches encore en cours.
 *
 * Wall-clock = la plus longue CHAÎNE de dépendances, pas la somme des attentes. Le nœud lent ne bloque
 * plus les rapides. Pur / injectable → testable sans réseau ni Electron.
 */

export interface GreedyNode<T> {
  /** Identifiant unique dans le DAG. */
  id: string
  /** Ids des nœuds qui doivent RÉUSSIR avant que celui-ci soit éligible (peut être vide). */
  deps: string[]
  /** Exécute la tâche ; reçoit les résultats (réussis) de ses dépendances, indexés par id. */
  run: (depResults: Record<string, T>) => Promise<T>
}

export interface GreedySettleEvent<T> {
  id: string
  /** true = réussi, false = échec (rejet) OU sauté (dépendance en échec). */
  ok: boolean
  value?: T
  error?: unknown
  /** true si la tâche n'a jamais tourné car une de ses dépendances a échoué/été sautée. */
  skipped?: boolean
  /** Rang d'ARRIVÉE (1-based) — reflète l'ordre de traitement, pas l'ordre de dispatch. */
  order: number
}

export interface GreedyOptions<T> {
  /** Plafond de tâches simultanées (défaut: illimité). */
  concurrency?: number
  /** Appelé pour CHAQUE nœud à son arrivée (réussite/échec) ou quand il est sauté, dans l'ordre d'arrivée. */
  onSettled?: (event: GreedySettleEvent<T>) => void
}

export interface GreedyRunResult<T> {
  /** Résultats des nœuds réussis, par id. */
  results: Record<string, T>
  /** Ids des nœuds dont le `run` a rejeté. */
  failed: string[]
  /** Ids des nœuds jamais lancés car une dépendance a échoué/été sautée (cascade). */
  skipped: string[]
}

/** Détecte deps inconnues + cycles (Kahn) AVANT de lancer quoi que ce soit. */
function validateDag<T>(nodes: GreedyNode<T>[], byId: Map<string, GreedyNode<T>>): void {
  const ids = new Set(byId.keys())
  if (ids.size !== nodes.length) throw new Error('greedy-scheduler: id de nœud dupliqué')
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!ids.has(d)) throw new Error(`greedy-scheduler: dépendance inconnue "${d}" du nœud "${n.id}"`)
      if (d === n.id) throw new Error(`greedy-scheduler: le nœud "${n.id}" dépend de lui-même`)
    }
  }
  // Kahn : retire itérativement les nœuds à 0 dépendance restante ; s'il reste des nœuds → cycle.
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, n.deps.length]))
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const dependents = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const n of nodes) for (const d of n.deps) dependents.get(d)!.push(n.id)
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
  if (removed !== nodes.length) throw new Error('greedy-scheduler: cycle de dépendances détecté')
}

/**
 * Exécute le DAG en greedy. Résout quand tous les nœuds sont réglés (réussis, échoués ou sautés).
 * Ne rejette jamais sur l'échec d'un nœud : un rejet devient `failed`, ses dépendants deviennent `skipped`.
 */
export async function runGreedy<T>(
  nodes: GreedyNode<T>[],
  options: GreedyOptions<T> = {}
): Promise<GreedyRunResult<T>> {
  const concurrency = options.concurrency && options.concurrency > 0 ? options.concurrency : Infinity
  const byId = new Map(nodes.map((n) => [n.id, n]))
  validateDag(nodes, byId)

  const results: Record<string, T> = {}
  const succeeded = new Set<string>()
  const failed = new Set<string>()
  const skipped = new Set<string>()
  const remaining = new Set<string>(nodes.map((n) => n.id))
  const running = new Map<string, Promise<{ id: string; ok: boolean; value?: T; error?: unknown }>>()
  let order = 0

  const depsSatisfied = (id: string): boolean => byId.get(id)!.deps.every((d) => succeeded.has(d))
  const depBroken = (id: string): boolean =>
    byId.get(id)!.deps.some((d) => failed.has(d) || skipped.has(d))

  const launch = (id: string): void => {
    const node = byId.get(id)!
    remaining.delete(id)
    const depResults: Record<string, T> = {}
    for (const d of node.deps) depResults[d] = results[d]
    const p = Promise.resolve()
      .then(() => node.run(depResults))
      .then(
        (value) => {
          results[id] = value
          succeeded.add(id)
          return { id, ok: true, value }
        },
        (error) => {
          failed.add(id)
          return { id, ok: false, error }
        }
      )
      .then((ev) => {
        running.delete(id)
        return ev
      })
    running.set(id, p)
  }

  // Marque en cascade tous les nœuds dont une dépendance a cassé (jamais lancés) → skipped + événement.
  const cascadeSkips = (): void => {
    let changed = true
    while (changed) {
      changed = false
      for (const id of [...remaining]) {
        if (depBroken(id)) {
          remaining.delete(id)
          skipped.add(id)
          order++
          changed = true
          options.onSettled?.({ id, ok: false, skipped: true, error: new Error('dépendance en échec'), order })
        }
      }
    }
  }

  // Dispatche tous les nœuds éligibles (deps réussies) dans la limite de concurrence.
  const dispatchEligible = (): void => {
    for (const id of [...remaining]) {
      if (running.size >= concurrency) break
      if (depBroken(id)) continue // sera traité par cascadeSkips
      if (depsSatisfied(id)) launch(id)
    }
  }

  cascadeSkips() // au cas où (deps déjà cassées impossible au 1er tour, mais garde la logique unique)
  dispatchEligible()

  while (running.size > 0) {
    const ev = await Promise.race(running.values())
    order++
    options.onSettled?.({ id: ev.id, ok: ev.ok, value: ev.value, error: ev.error, order })
    cascadeSkips() // un échec vient peut-être de casser des dépendants
    dispatchEligible() // une réussite vient peut-être d'en débloquer
  }

  return { results, failed: [...failed], skipped: [...skipped] }
}
