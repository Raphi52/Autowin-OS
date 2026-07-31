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
import type { RoleBinding } from '../roles'

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
  /** Tour Chat d'origine ; absent seulement sur les états historiques. */
  turnId?: string
  /** Binding figé du run; absent sur les états historiques. */
  bindingOverride?: RoleBinding
  /** Livrables des phases DÉJÀ terminées, dans l'ordre — rejoués tels quels à la reprise. */
  phaseOutputs: OrchestrationPhaseOutput[]
  startedAt: number
  updatedAt: number
  /**
   * Agents CLI lancés par ce run. Un CLI détaché SURVIT à la mort de l'app et continue d'écrire dans
   * son journal ; sans ces références, l'app qui revient ne sait ni s'il vit encore, ni où lire ce
   * qu'il a produit pendant son absence — elle relance donc un travail déjà fait.
   */
  agents?: Array<{
    token: string
    pid?: number
    /** Empreinte du processus au lancement — distingue notre agent d'un pid recyclé. */
    identity?: string
    journalPath?: string
    offset?: number
  }>
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
  // Deux situations à ne pas confondre :
  //  - AUCUNE phase enregistrée : le run est mort avant d'avoir produit quoi que ce soit. Il n'y a
  //    rien à sauter, donc rien à risquer : on le relance depuis le début plutôt que de PERDRE la
  //    tâche (c'est le cas le plus courant, la première phase étant la plus longue).
  //  - Des phases enregistrées mais TOUTES sans livrable (vu en réel) : les reprendre les ferait
  //    sauter sans avoir leur travail → pire que tout rejouer. Celui-là reste écarté.
  const mostRecent = (candidates: readonly OrchestrationRunState[]): OrchestrationRunState | null =>
    candidates.length === 0
      ? null
      : candidates.reduce((best, state) => (state.updatedAt > best.updatedAt ? state : best))

  // Priorité au travail DÉJÀ PAYÉ : un run porteur d'un livrable réel passe devant un run plus
  // récent qui n'a rien produit — le reprendre économise les phases déjà faites.
  const withWork = states.filter((state) =>
    state.phaseOutputs.some((output) => typeof output.text === 'string' && output.text.trim())
  )
  return mostRecent(withWork) ?? mostRecent(states.filter((state) => state.phaseOutputs.length === 0))
}

/** Normalise un libelle de tache pour comparer « la meme tache » ecrite a l'espace pres. */
export function normalizeTaskKey(task: string): string {
  return task.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface ResumeLookup {
  task: string
  /** Conversation d'origine ; un acquis d'une AUTRE conversation n'est jamais repris. */
  conversationId?: string
  /** Empêche de rejouer des phases produites par un autre modèle. */
  bindingOverride?: RoleBinding
  nowMs: number
  /** Au-dela, l'acquis est trop vieux pour etre reinjecte sans surprendre (defaut 24 h). */
  maxAgeMs?: number
}

const DEFAULT_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1_000

function bindingIdentity(binding: RoleBinding | undefined): string {
  if (!binding) return ''
  const phaseModel = Object.fromEntries(
    Object.entries(binding.phaseModel ?? {}).sort(([left], [right]) => left.localeCompare(right))
  )
  return JSON.stringify({
    provider: binding.provider,
    model: binding.model,
    reasoningEffort: binding.reasoningEffort,
    phaseModel
  })
}

/**
 * Acquis reutilisable pour une tache RELANCEE depuis le chat.
 *
 * Le chemin de reprise n'existait qu'au REDEMARRAGE de l'app : quand l'utilisateur ecrit « reprend »
 * dans une conversation, la commande `orchestrate` relancait de zero et repayait les phases deja
 * produites (constate le 2026-07-29). Ce selecteur repond a « ai-je deja paye une partie de CETTE
 * tache, dans CETTE conversation, recemment ? ».
 *
 * Conditions CUMULATIVES, volontairement strictes — reinjecter un acquis fait SAUTER des phases, donc
 * un faux positif produit un livrable base sur du travail etranger :
 *  - meme tache (a la normalisation d'espaces pres) ;
 *  - meme conversation (un acquis sans conversation n'est pas repris ici : il appartient au demarrage) ;
 *  - au moins un livrable NON VIDE (sinon on sauterait une phase sans avoir son travail) ;
 *  - moins de `maxAgeMs`.
 * Plusieurs candidats -> le plus recent.
 */
export function pickResumeForTask(
  states: readonly OrchestrationRunState[],
  lookup: ResumeLookup
): OrchestrationRunState | null {
  if (!lookup.conversationId) return null
  const wanted = normalizeTaskKey(lookup.task)
  if (!wanted) return null
  const maxAge = lookup.maxAgeMs ?? DEFAULT_RESUME_MAX_AGE_MS
  const usable = states.filter(
    (state) =>
      state.conversationId === lookup.conversationId &&
      bindingIdentity(state.bindingOverride) === bindingIdentity(lookup.bindingOverride) &&
      normalizeTaskKey(state.task) === wanted &&
      lookup.nowMs - state.updatedAt <= maxAge &&
      lookup.nowMs >= state.updatedAt &&
      state.phaseOutputs.some((output) => typeof output.text === 'string' && output.text.trim())
  )
  if (usable.length === 0) return null
  return usable.reduce((best, state) => (state.updatedAt > best.updatedAt ? state : best))
}
