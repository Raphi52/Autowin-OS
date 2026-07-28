import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { PipelinePhase } from '../skill-pipeline'

/**
 * SURVIE NIVEAU 3 — état reprenable d'une ORCHESTRATION.
 *
 * Les niveaux 1 et 2 couvrent déjà : l'app reste vivante en tray quand la fenêtre se ferme, et un
 * CLI enfant spawné détaché continue d'écrire dans son journal même si le process main meurt. Mais
 * la BOUCLE d'orchestration (scout→frame→…→judge) vit dans le process main : tué en pleine phase,
 * les phases restantes ne s'exécutaient JAMAIS — on pouvait relire ce qui avait été produit, pas
 * reprendre l'exécution. D'où « 1 action interrompue · Orchestration ».
 *
 * Ce module persiste, APRÈS CHAQUE PHASE, de quoi redémarrer à la phase suivante : la tâche, la
 * conversation, et le livrable de chaque phase déjà faite. Au démarrage, l'app relance le run en
 * REJOUANT cet acquis (aucune phase refaite, aucun token regaspillé).
 *
 * Robustesse : écriture par fichier-par-run (aucun verrou partagé), lecture qui IGNORE un fichier
 * illisible (un crash en pleine écriture ne doit pas empêcher de reprendre les autres runs).
 */
export interface OrchestrationPhaseOutput {
  phase: PipelinePhase
  text: string
}

export interface OrchestrationRunState {
  runId: string
  task: string
  conversationId?: string
  /** Livrables des phases DÉJÀ terminées, dans l'ordre — rejoués tels quels à la reprise. */
  phaseOutputs: OrchestrationPhaseOutput[]
  startedAt: number
  updatedAt: number
}

/** Un `runId` est un nom de fichier : on refuse tout ce qui pourrait sortir du dossier. */
function safeRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(runId)) throw new Error('runId invalide')
  return runId
}

function statePath(root: string, runId: string): string {
  return join(root, `${safeRunId(runId)}.json`)
}

export function saveOrchestrationState(root: string, state: OrchestrationRunState): void {
  mkdirSync(root, { recursive: true })
  // Écriture atomique : un kill au milieu d'un `writeFileSync` laisserait un JSON tronqué que la
  // reprise devrait jeter. On écrit à côté puis on renomme (rename = atomique sur le même volume).
  const target = statePath(root, state.runId)
  const temporary = `${target}.tmp`
  writeFileSync(temporary, JSON.stringify(state), 'utf8')
  try {
    rmSync(target, { force: true })
  } catch {
    /* cible absente : normal au premier enregistrement */
  }
  renameSync(temporary, target)
}

export function clearOrchestrationState(root: string, runId: string): void {
  try {
    rmSync(statePath(root, runId), { force: true })
  } catch {
    /* déjà supprimé / dossier absent : rien à faire */
  }
}

/** États encore présents = runs qui n'ont jamais atteint leur clôture (l'app est morte avant). */
export function loadOrchestrationStates(root: string): OrchestrationRunState[] {
  if (!existsSync(root)) return []
  const states: OrchestrationRunState[] = []
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(join(root, entry), 'utf8')) as OrchestrationRunState
      if (
        typeof parsed?.runId === 'string' &&
        typeof parsed.task === 'string' &&
        parsed.task.trim() &&
        Array.isArray(parsed.phaseOutputs)
      ) {
        states.push(parsed)
      }
    } catch {
      // JSON tronqué par un crash : on ignore ce run plutôt que de perdre les autres.
    }
  }
  return states
}

/**
 * Run à reprendre = le plus récemment actif, et seulement s'il a DÉJÀ produit au moins une phase
 * (sans acquis, une reprise équivaut à relancer de zéro — c'est à l'utilisateur de le décider, pas
 * à l'app de dépenser des tokens à son insu). Rien à reprendre → `null`.
 */
export function pickOrchestrationToResume(
  states: readonly OrchestrationRunState[]
): OrchestrationRunState | null {
  // Un acquis VIDE (phase persistée sans livrable — vu en réel) n'est pas un acquis : le reprendre
  // ferait SAUTER la phase sans avoir son travail. On exige au moins un livrable porteur de contenu.
  const usable = states.filter((state) =>
    state.phaseOutputs.some((output) => typeof output.text === 'string' && output.text.trim())
  )
  if (usable.length === 0) return null
  return usable.reduce((best, state) => (state.updatedAt > best.updatedAt ? state : best))
}
