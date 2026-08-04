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
import type { ExecutionQuote } from '../execution-quote'
import type { ExecutionUsageSnapshot } from '../execution-supervisor'
import type { OrchestrationRuntimeSnapshot } from '../orchestrator'

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
  /** Lignée immuable d'une branche créée depuis un checkpoint persistant. */
  forkedFrom?: {
    checkpointId: string
    runId: string
    checkpointCreatedAt: string
    contentHash: string
  }
  task: string
  conversationId?: string
  /** Tour Chat d'origine ; absent seulement sur les états historiques. */
  turnId?: string
  /** Binding figé du run; absent sur les états historiques. */
  bindingOverride?: RoleBinding
  /** Topologie complete figee avant le premier appel provider; absente sur les anciens checkpoints. */
  runtimeSnapshot?: OrchestrationRuntimeSnapshot
  /** Livrables des phases DÉJÀ terminées, dans l'ordre — rejoués tels quels à la reprise. */
  phaseOutputs: OrchestrationPhaseOutput[]
  /** Devis originel : une reprise continue CE contrat, elle n'en compile pas un nouveau. */
  executionQuote?: ExecutionQuote
  /** Consommation deja engagee : une reprise ne repart jamais avec des compteurs a zero. */
  usage?: ExecutionUsageSnapshot
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
  // `rename` remplace la cible sur les plateformes supportées par Node. Supprimer d'abord le JSON
  // créerait une fenêtre de crash où seul le `.tmp` subsiste et où le loader perdrait le checkpoint.
  renameSync(temporary, target)
}

/**
 * Le spawn d'un agent arrive avant la fin de sa phase. Il faut donc checkpoint-er dans la même
 * écriture ses références de rattachement ET la réservation provider déjà active ; sinon un crash
 * entre les deux fait croire à la reprise que cet appel n'a jamais été lancé.
 */
export function saveOrchestrationAgentCheckpoint(
  root: string,
  runId: string,
  agents: NonNullable<OrchestrationRunState['agents']>,
  usage: ExecutionUsageSnapshot | undefined,
  nowMs = Date.now()
): OrchestrationRunState | null {
  const current = loadOrchestrationStates(root).find((candidate) => candidate.runId === runId)
  if (!current) return null
  const updated: OrchestrationRunState = {
    ...current,
    agents,
    ...(usage ? { usage } : {}),
    updatedAt: nowMs
  }
  saveOrchestrationState(root, updated)
  return updated
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
  return pickOrchestrationsToResume(states)[0] ?? null
}

/**
 * Tous les runs à reprendre au démarrage, dans l'ordre de priorité : travail déjà payé d'abord,
 * puis tâches mortes avant leur première phase. Les phases présentes mais vides restent exclues.
 */
export function pickOrchestrationsToResume(
  states: readonly OrchestrationRunState[]
): OrchestrationRunState[] {
  const mostRecentFirst = (candidates: readonly OrchestrationRunState[]): OrchestrationRunState[] =>
    [...candidates].sort((left, right) => right.updatedAt - left.updatedAt)

  const withWork = states.filter((state) =>
    state.phaseOutputs.some((output) => typeof output.text === 'string' && output.text.trim())
  )
  const neverStarted = states.filter((state) => state.phaseOutputs.length === 0)
  return [...mostRecentFirst(withWork), ...mostRecentFirst(neverStarted)]
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
  /** Topologie du nouveau run; requise hors override pour ne pas melanger des acquis de modeles. */
  runtimeSnapshot?: OrchestrationRuntimeSnapshot
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

function runtimeSnapshotIdentity(snapshot: OrchestrationRuntimeSnapshot | undefined): string {
  if (!snapshot) return ''
  const phaseFanOut = Object.fromEntries(
    Object.entries(snapshot.phaseFanOut)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([phase, bindings]) => [phase, (bindings ?? []).map(bindingIdentity)])
  )
  return JSON.stringify({
    roles: {
      orchestrator: bindingIdentity(snapshot.roles.orchestrator),
      subagent: bindingIdentity(snapshot.roles.subagent),
      judge: bindingIdentity(snapshot.roles.judge),
      scout: bindingIdentity(snapshot.roles.scout)
    },
    phaseFanOut,
    judgeFanOut: snapshot.judgeFanOut.map(bindingIdentity)
  })
}

/**
 * Migration explicite des checkpoints historiques : leur topologie n'existe pas sur disque, donc
 * on adopte celle qui vient d'etre admise, mais l'appelant doit ouvrir un NOUVEAU tour. L'ancienne
 * carte reste ainsi un fait historique et n'est jamais rebaptisee avec un modele actuel.
 */
export function resolveResumableRuntime(
  state: OrchestrationRunState,
  currentRuntime: OrchestrationRuntimeSnapshot
): {
  runtimeSnapshot: OrchestrationRuntimeSnapshot
  migratedLegacyCheckpoint: boolean
} {
  return state.runtimeSnapshot
    ? { runtimeSnapshot: state.runtimeSnapshot, migratedLegacyCheckpoint: false }
    : { runtimeSnapshot: currentRuntime, migratedLegacyCheckpoint: true }
}

export interface PersistedTurnRuntimeIdentity {
  provider: string
  model?: string
  reasoningEffort?: string
}

export interface LiveReattachmentAdmission {
  identityKnown: boolean
  resumeExisting: boolean
  turnId: string
  turnBinding?: RoleBinding
  task: string
}

function sameRuntimeIdentity(
  recorded: PersistedTurnRuntimeIdentity | undefined,
  expected: RoleBinding
): boolean {
  return (
    recorded?.provider === expected.provider &&
    recorded.model === expected.model &&
    recorded.reasoningEffort === expected.reasoningEffort
  )
}

/**
 * Admet le rattachement d'un processus encore vivant sans réécrire son identité historique.
 * Un checkpoint legacy ne transporte pas le provider réellement lancé : il ouvre donc un tour
 * explicitement inconnu. Un tour existant n'est réactivé que si sa carte correspond au snapshot.
 */
export function admitLiveReattachment(
  state: OrchestrationRunState,
  recordedTurnRuntime: PersistedTurnRuntimeIdentity | undefined,
  migrationTurnId: string
): LiveReattachmentAdmission {
  if (!state.runtimeSnapshot) {
    return {
      identityKnown: false,
      resumeExisting: false,
      turnId: migrationTurnId,
      task: `[Rattachement — identité provider inconnue] ${state.task}`
    }
  }

  const turnBinding = state.bindingOverride ?? state.runtimeSnapshot.roles.orchestrator
  const resumeExisting =
    Boolean(state.turnId) && sameRuntimeIdentity(recordedTurnRuntime, turnBinding)
  return {
    identityKnown: true,
    resumeExisting,
    turnId: resumeExisting ? state.turnId! : migrationTurnId,
    turnBinding,
    task: resumeExisting ? state.task : `[Rattachement automatique] ${state.task}`
  }
}

export interface AutomaticResumeRuntimeAdmission {
  runtimeSnapshot: OrchestrationRuntimeSnapshot
  migratedLegacyCheckpoint: boolean
  resumeExisting: boolean
  turnId: string
  turnBinding: RoleBinding
  task: string
  /** Ferme l'identite admise dans l'appel : carte et provider ne peuvent plus relire deux topologies. */
  run<T>(execute: (runtimeSnapshot: OrchestrationRuntimeSnapshot) => T | Promise<T>): Promise<T>
}

/**
 * Admission atomique d'une reprise automatique. Le plan visible de la carte et le snapshot remis au
 * provider sont derives une seule fois, puis transportes ensemble par `run`.
 */
export function admitAutomaticResumeRuntime(
  state: OrchestrationRunState,
  currentRuntime: OrchestrationRuntimeSnapshot,
  migrationTurnId: string,
  recordedTurnRuntime?: PersistedTurnRuntimeIdentity
): AutomaticResumeRuntimeAdmission {
  const resolved = resolveResumableRuntime(state, currentRuntime)
  const runtimeSnapshot = resolved.runtimeSnapshot
  const turnBinding = state.bindingOverride ?? runtimeSnapshot.roles.orchestrator
  const resumeExisting =
    Boolean(state.turnId) &&
    !resolved.migratedLegacyCheckpoint &&
    sameRuntimeIdentity(recordedTurnRuntime, turnBinding)
  return {
    ...resolved,
    resumeExisting,
    turnId: resumeExisting ? state.turnId! : migrationTurnId,
    turnBinding,
    task: resumeExisting ? state.task : `[Reprise automatique] ${state.task}`,
    run: async (execute) => execute(runtimeSnapshot)
  }
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
      (lookup.bindingOverride !== undefined ||
        runtimeSnapshotIdentity(state.runtimeSnapshot) ===
          runtimeSnapshotIdentity(lookup.runtimeSnapshot)) &&
      normalizeTaskKey(state.task) === wanted &&
      lookup.nowMs - state.updatedAt <= maxAge &&
      lookup.nowMs >= state.updatedAt &&
      state.phaseOutputs.some((output) => typeof output.text === 'string' && output.text.trim())
  )
  if (usable.length === 0) return null
  return usable.reduce((best, state) => (state.updatedAt > best.updatedAt ? state : best))
}
