/**
 * Cockpit worktree (Mix 2) — modèle PUR alimentant la frise "métro" + le journal humain.
 *
 * Objectif produit : rendre les git worktrees compréhensibles à quelqu'un qui n'y connaît RIEN.
 * Ce module ne parle JAMAIS git (pas de HEAD/detached/rebase) : il traduit l'activité brute des
 * agents en (a) des LANES de frise (une copie part de la ligne principale et y revient) et (b) des
 * ENTRÉES de journal en langage humain (conséquences, pas commandes). Aucune dépendance UI ni Node
 * → testable directement. Rendu par `WorktreeActivityView` (composant séparé).
 */

export type WorktreeState = 'isolated' | 'working' | 'ready' | 'merged' | 'conflict'
export type FileChangeKind = 'add' | 'mod' | 'del'

export interface WorktreeFileChange {
  path: string
  kind: FileChangeKind
}

/** Activité brute d'un agent sur SA copie isolée (fournie par l'orchestration). */
export interface WorktreeAgentActivity {
  agentId: string
  agentName: string
  role?: string
  state: WorktreeState
  files: WorktreeFileChange[]
  startedAtMs: number
  /** Fin (merge réussi ou conflit détecté) ; absent si l'agent travaille encore. */
  endedAtMs?: number
  /** Noms des autres agents touchant le même fichier (rempli quand state = conflict). */
  conflictWith?: string[]
  /** Fichier en cause du conflit (affiché à l'utilisateur). */
  conflictFile?: string
}

/** Une copie qui part de la ligne principale et (peut-être) y revient — géométrie normalisée 0..1. */
export interface FriezeLane {
  agentId: string
  agentName: string
  /** Position de départ le long de la ligne principale (0 = début, 1 = fin). */
  startOffset: number
  /** Position de retour (0..1) ; null si la copie est encore ouverte (agent au travail). */
  endOffset: number | null
  outcome: 'merged' | 'conflict' | 'open'
  fileCount: number
}

export type JournalKind = 'started' | 'working' | 'merged' | 'conflict'

export interface JournalEntry {
  agentId: string
  agentName: string
  atMs: number
  kind: JournalKind
  /** Message en langage humain, zéro jargon git. */
  message: string
  files: WorktreeFileChange[]
  conflictWith?: string[]
  conflictFile?: string
}

export interface WorktreeActivityModel {
  lanes: FriezeLane[]
  journal: JournalEntry[]
  agentsTotal: number
  /** Nombre de copies qui attendent une décision de l'utilisateur (conflits). */
  needsAttention: number
}

function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`
}

function outcomeOf(state: WorktreeState): FriezeLane['outcome'] {
  if (state === 'merged') return 'merged'
  if (state === 'conflict') return 'conflict'
  return 'open'
}

function messageFor(a: WorktreeAgentActivity): { kind: JournalKind; message: string } {
  switch (a.state) {
    case 'merged':
      return { kind: 'merged', message: `${a.agentName} a rendu son travail — ajouté à ton code automatiquement.` }
    case 'conflict': {
      const others = joinNames(a.conflictWith ?? [])
      const who = others ? `${a.agentName} et ${others}` : a.agentName
      return { kind: 'conflict', message: `${who} ont modifié le même fichier — à toi de trancher.` }
    }
    case 'working':
      return { kind: 'working', message: `${a.agentName} travaille en ce moment sur sa copie.` }
    case 'ready':
      return { kind: 'working', message: `${a.agentName} a fini sa copie, prête à être rangée.` }
    case 'isolated':
    default:
      return { kind: 'started', message: `${a.agentName} a pris une copie du projet — ton code principal reste intact.` }
  }
}

/**
 * Construit le modèle du cockpit à partir de l'activité des agents.
 * @param agents activité brute (ordre libre ; trié par temps ici)
 * @param nowMs instant courant (pour normaliser les copies encore ouvertes) ; défaut = max des temps connus
 */
export function buildWorktreeActivity(
  agents: WorktreeAgentActivity[],
  nowMs?: number
): WorktreeActivityModel {
  if (agents.length === 0) {
    return { lanes: [], journal: [], agentsTotal: 0, needsAttention: 0 }
  }

  const times: number[] = []
  for (const a of agents) {
    times.push(a.startedAtMs)
    if (a.endedAtMs != null) times.push(a.endedAtMs)
  }
  const t0 = Math.min(...times)
  const tEnd = nowMs ?? Math.max(...times)
  const span = Math.max(tEnd - t0, 1)
  const norm = (t: number): number => Math.min(Math.max((t - t0) / span, 0), 1)

  const lanes: FriezeLane[] = agents.map((a) => ({
    agentId: a.agentId,
    agentName: a.agentName,
    startOffset: norm(a.startedAtMs),
    endOffset: a.endedAtMs != null ? norm(a.endedAtMs) : null,
    outcome: outcomeOf(a.state),
    fileCount: a.files.length
  }))

  const journal: JournalEntry[] = agents
    .map((a) => {
      const { kind, message } = messageFor(a)
      return {
        agentId: a.agentId,
        agentName: a.agentName,
        atMs: a.endedAtMs ?? a.startedAtMs,
        kind,
        message,
        files: a.files,
        conflictWith: a.conflictWith,
        conflictFile: a.conflictFile
      }
    })
    .sort((x, y) => x.atMs - y.atMs)

  const needsAttention = agents.filter((a) => a.state === 'conflict').length

  return { lanes, journal, agentsTotal: agents.length, needsAttention }
}
