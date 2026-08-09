import type { StructuredSchedule } from './schedule'
import type { ReasoningEffort } from '../roles'

export type TaskExecutionMode = 'windows' | 'active-only'

export type TaskDestination =
  | {
      kind: 'existing'
      conversationId: string
      /** Modèle explicite de la tâche; absent sur les tâches historiques. */
      provider?: string
      model?: string
      reasoningEffort?: ReasoningEffort
    }
  | {
      kind: 'new'
      title: string
      category: string
      provider: string
      /** Modèle explicite de la tâche; absent sur les tâches historiques. */
      model?: string
      reasoningEffort?: ReasoningEffort
      /** Conversation dédiée créée au premier déclenchement, puis réutilisée. */
      conversationId?: string
    }

/**
 * Ce qui REVEILLE un agent quand ce n'est pas l'horloge.
 *
 * `file-match` : une ligne AJOUTEE au fichier satisfait la condition. Seules les lignes nouvelles
 * comptent — l'historique d'un log au premier demarrage n'est pas un evenement.
 * `app-event` : un incident deja emis par l'application. La liste est volontairement COURTE et ne
 * contient que des signaux dont l'emission a ete verifiee dans le code, jamais un nom suppose.
 */
export type WatchdogSource =
  | { kind: 'file-match'; path: string; pattern: string; caseSensitive?: boolean }
  | { kind: 'app-event'; events: WatchdogAppEvent[] }

/**
 * Incidents REELLEMENT emis aujourd'hui (verifies un par un dans le code) — pas un catalogue souhaite.
 *
 * Les trois `workflow-*` repondent a « comment detecter un probleme de workflow ? ». La detection
 * existait deja, enfouie dans `auto-kaizen-supervisor.incidentFromPilotEvent` ; elle n'etait
 * simplement exposee nulle part :
 *  - `workflow-gate-failed`  : le gate a REFUSE la preuve (`result.gateBlocked === true`) ;
 *  - `workflow-unverified`   : le workflow s'est termine « succeeded » SANS preuve de validation
 *    globale (`status === 'succeeded' && result.valid !== true`). C'est le plus dangereux des trois :
 *    il annonce un succes que rien n'etaye, et personne ne va le lire ;
 *  - `workflow-proof-lost`   : une reprise a perdu des preuves de son propre journal.
 */
export type WatchdogAppEvent =
  | 'orchestration-red'
  | 'workflow-gate-failed'
  | 'workflow-unverified'
  | 'workflow-proof-lost'
  | 'task-failed'
  | 'task-missed'

/**
 * Les bornes qui rendent le reveil evenementiel tenable. Elles ne sont pas facultatives : un
 * declencheur sur evenement, contrairement a une heure, peut se declencher mille fois par minute et,
 * en autorite `auto`, se declencher LUI-MEME.
 */
export interface WatchdogGuards {
  /** Un signal de meme signature revu dans cette fenetre est ignore. */
  dedupWindowMs: number
  /** Plafond de reveils par heure glissante, pour cette regle. */
  maxTriggersPerHour: number
  /**
   * Profondeur maximale de la chaine causale. 0 = un reveil ne peut pas en engendrer un autre.
   * C'est la parade a la boucle auto-entretenue : une reparation qui reecrit dans le fichier
   * surveille ne peut pas se re-declencher indefiniment.
   */
  maxChainDepth: number
  /**
   * Nombre total de reveils issus d'une MEME cause racine.
   *
   * Borne la LARGEUR de la cascade, pas sa profondeur. Repris de `AutoKaizenLimits.maxPerRoot`, qui
   * l'a appris a ses depens : mesure du 2026-08-04 dans ce depot, la garde en profondeur TENAIT
   * pendant que la cascade s'elargissait de 8 -> 11 -> 104 -> 681 par niveau, chacun lancant son run
   * avant que le plafond horaire ne morde. Une garde en profondeur seule ne borne pas une croissance
   * geometrique — deux dimensions, deux gardes.
   */
  maxPerRoot: number
}

/**
 * Ce que fait l'agent reveille.
 *
 * `chat` : un tour de conversation — l'agent lit, conclut, rapporte.
 * `orchestration` : le PIPELINE complet (scout/frame/terrain/build/clean/judge), avec son gate a
 * preuve et son juge. C'est la reponse au « et la verification ? » : elle existe deja dans le
 * workflow, il n'y a pas a la redevelopper par declencheur.
 */
export type WatchdogAction = 'chat' | 'orchestration'

export interface WatchdogRule {
  source: WatchdogSource
  guards: WatchdogGuards
  /** Absent = `chat` (comportement des regles ecrites avant l'ajout de l'orchestration). */
  action?: WatchdogAction
}

/** Ce que l'agent reveille a CONCLU. Le tri est le livrable, pas un effet de bord. */
export type WatchdogOutcome = 'benign' | 'report' | 'investigate' | 'repair'

export interface ScheduledTaskInput {
  title: string
  prompt: string
  enabled: boolean
  mode: TaskExecutionMode
  destination: TaskDestination
  /**
   * Absent sur une tache reveillee par EVENEMENT : elle n'a pas d'heure, donc pas de `nextRunAt`.
   * Reste requis de fait pour une tache horaire — c'est l'absence de `watchdog` qui l'exige.
   */
  schedule?: StructuredSchedule
  /** Present = tache reveillee par evenement. Absent = tache horaire (comportement inchange). */
  watchdog?: WatchdogRule
}

export interface ScheduledTask extends ScheduledTaskInput {
  id: string
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

export type TaskOccurrenceStatus =
  'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'missed'

/** Contexte de l'evenement qui a reveille l'agent — sans lui, l'agent repart de zero et invente. */
export interface WatchdogSignal {
  /** Ce qui identifie le signal pour la deduplication (ligne normalisee, id d'evenement). */
  signature: string
  /** Texte lisible remis a l'agent : la ligne qui a matche, son voisinage, la source. */
  context: string
  /** Rang dans la chaine causale : 0 = declenche par le monde, 1+ = declenche par un reveil. */
  depth: number
  /** Cause RACINE de la cascade : sert a borner sa largeur, pas seulement sa profondeur. */
  rootSignature: string
  source: WatchdogSource['kind']
  observedAt: number
}

/** Mutations qu'un run revendique, y compris lorsqu'elles sont publiées après son retour. */
export interface WatchdogMutationClaims {
  /** Identifiant stable d'une publication rejouable, pour dédupliquer dans un même processus. */
  eventId?: string
  mutatedPaths?: readonly string[]
  mutatedLineFingerprints?: Record<string, readonly string[]>
  mutatedPathGenerationMarkers?: Record<string, string>
}

export type WatchdogMutationClaimsSink = (claims: WatchdogMutationClaims) => void

export interface TaskOccurrence {
  id: string
  taskId: string
  scheduledFor: number
  mode: TaskExecutionMode | 'legacy-unknown'
  status: TaskOccurrenceStatus
  claimedAt: number
  startedAt?: number
  finishedAt?: number
  conversationId?: string
  turnId?: string
  error?: string
  /** Nombre d'échéances représentées par cette occurrence agrégée (absent = une seule). */
  missedCount?: number
  /** Dernière échéance couverte par un retard agrégé. */
  lastMissedFor?: number
  /** Absent sur les occurrences historiques : elles sont toutes horaires. */
  trigger?: 'schedule' | 'manual' | 'watchdog'
  /** Present seulement sur un reveil evenementiel. */
  watchdog?: WatchdogSignal
  /** Le tri rendu par l'agent, quand il a pu etre lu dans sa reponse. */
  outcome?: WatchdogOutcome
}

export interface TaskAlert {
  id: string
  taskId: string
  occurrenceId: string
  kind: 'missed' | 'failed'
  message: string
  createdAt: number
  acknowledgedAt?: number
}

export interface TaskStoreSnapshot {
  schemaVersion: 1
  tasks: ScheduledTask[]
  occurrences: TaskOccurrence[]
  alerts: TaskAlert[]
  /**
   * Semis deja poses (par identifiant stable).
   *
   * Une tache livree d'origine doit etre SUPPRIMABLE pour de bon : sans cette memoire, l'utilisateur
   * qui efface la regle auto-kaizen la verrait renaitre au prochain demarrage — ce ne serait plus sa
   * tache, ce serait une tache imposee. Absent des fichiers ecrits avant cette version, ce qui est
   * correct : ils n'ont encore recu aucun semis.
   */
  seeds?: string[]
}

export interface TaskManagerSnapshot extends TaskStoreSnapshot {
  /** Diagnostic live des règles : coût récent et panne de leur source, indexés par tâche. */
  watchdogs: Record<string, { admittedLastHour: number; complaint?: string }>
  scheduler: {
    running: boolean
    nextWakeAt: number | null
    relayAvailable: boolean
    relayError?: string
  }
}
