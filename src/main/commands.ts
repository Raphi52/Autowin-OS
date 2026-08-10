import { applyEdit, decideEdit, editDiff } from './edit-file-command'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { brainCorpusForWorkspace, scopeBrainRetrieval } from './brain-corpus-scope'
import { buildBrainOutcome, decideBrainQuery, type BrainQueryOutcome } from './brain-query-command'
import { retrieveBrainContext } from './brain-retrieval'
import { spawn } from 'node:child_process'
import { capVerifyOutput, decideVerifyCommand, type VerifyOutcome } from './verify-command'
import type { AutowinOS } from './os'
import type { Message } from './providers/types'
import type { Role, RoleBinding } from './roles'
import {
  closeConvRun,
  reuseOrCreateConvRun,
  populateConvRunSections,
  saveConvRunTrace
} from './runs/conv-runs'
import { appendNativeTrace } from './activity/native-trace-spool'
import { appendBrainTrace } from './activity/brain-trace-spool'
import {
  appendConversationFileTrace,
  appendExecutionEvidenceFileTrace,
  normalizeWorkspaceTracePath,
  workspaceTracePathKey
} from './activity/conversation-file-trace-spool'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from './providers/workspace-mutation-evidence'
import { appendConvActivity } from './activity/conv-activity'
import { createTicketFromCommand, type TicketCreateArgs } from './ticket-create-command'
import { searchTicketsFromCommand, type TicketSearchArgs } from './ticket-search-command'
import { getTicketFromCommand, type TicketGetArgs } from './ticket-get-command'
import { updateTicketFromCommand, type TicketUpdateArgs } from './ticket-update-command'
import type {
  TicketCreateRequest,
  TicketGetRequest,
  TicketUpdateRequest
} from './ticket-providers/provider-contract'
import type { TicketItem, TicketListRequest, TicketSourceProfile } from '../shared/tickets'
import { buildAutowinKaizenTask, collectAutowinKaizenEvidence } from './autowin-kaizen-context'
import type { OrchestrationStep, OrchestrationPhase } from './orchestrator'
import {
  persistOrchestrationPhaseStart,
  persistOrchestrationStep,
  persistRunLifecycle
} from './activity/orchestration-observability'
import { createHash, randomUUID } from 'node:crypto'
import { APP_DESTINATIONS, resolveAppLocation, type AppDestination } from '../shared/navigation'
import { formatExecutionCostCoverage } from '../shared/orchestration-outcome'
import type { RunLifecycleEvent } from '../shared/run-execution'
import { collectOrchestrationContext } from './orchestration-context'
import { rememberFact } from './brain-remember'
import { noteRemembered } from './session-memory-echo'
import { brainServiceToken } from './brain-retrieval'
import { classifyRegime } from './task-regime'
import {
  runGraphify,
  type GraphifyCommandInput,
  type GraphifyCommandResult
} from './graphify-command'
import { ensureAutowinAppData } from './app-data'
import type { TraceStore } from './activity/trace-store'
import { redactTrace } from './activity/trace-redact'
import { reconcileLateRunLifecycle } from './activity/late-run-usage-settlement'
import { addedLineFingerprints } from './exact-line-fingerprint'
import type { WatchdogMutationClaimsSink } from './task-manager/types'
import type { DesktopController } from './desktop-control'

/** Le log déclencheur reste une preuve en lecture seule ; l'agent reçoit un chemin relatif au bureau. */
export function isolateWatchdogPromptPaths(
  prompt: string,
  watchedPaths: readonly string[],
  workspaceRoot: string
): string {
  let isolated = prompt
  for (const watchedPath of watchedPaths) {
    const absolute = isAbsolute(watchedPath)
      ? resolve(watchedPath)
      : resolve(workspaceRoot, watchedPath)
    const rel = relative(workspaceRoot, absolute)
    if (!rel || rel === '..' || /^\.\.[\\/]/.test(rel) || isAbsolute(rel)) continue
    const replacement = rel.replaceAll('\\', '/')
    for (const candidate of [watchedPath, watchedPath.replaceAll('\\', '/'), absolute]) {
      isolated = isolated.split(candidate).join(replacement)
    }
  }
  return watchedPaths.length
    ? `${isolated}\n\nCONTRAINTE WATCHDOG : la source surveillée est une preuve en lecture seule. Ne la modifie, ne la tronque et ne la recrée jamais ; corrige uniquement la cause dans les fichiers du bureau isolé.`
    : isolated
}

/**
 * Bus de commandes de l'app — le PLAN DE CONTRÔLE que les agents pilotent.
 * Chaque commande mute l'état applicatif et DIFFUSE (broadcast) le changement au
 * renderer (l'UI se met à jour en direct → l'humain ET l'agent voient l'effet).
 * Le catalogue est donné au modèle ; l'agent émet des commandes, on les exécute ici.
 */
export interface CommandSpec {
  name: string
  description: string
  args: Record<string, string> // nom → description courte du type
  annotations?: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}
export interface CommandResult {
  ok: boolean
  data?: unknown
  error?: string
  /** Pieces jointes ephemeres pour l'iteration modele suivante ; jamais journalisees dans le texte. */
  attachments?: NonNullable<Message['attachments']>
}

/** Instantané de l'état que l'agent PEUT VOIR (ce qu'il pilote). */
export interface AppSnapshot {
  tab: AppDestination
  activeConversationId?: string
  providers: string[]
  roles: Record<string, { provider: string; model?: string }>
  conversations: Array<{ id: string; title: string; category: string }>
  runs: Array<{ subject: string; status: string; blocked: boolean }>
  budgetUsd: number
}

/**
 * Projection MINIMALE de l'état, injectée dans le PROMPT de l'agent à chaque tour
 * (≠ `AppSnapshot`, destiné à l'UI complète via `os:appState`). On évite d'injecter les
 * ~60 conversations et les runs non bloqués : c'était l'essentiel du poids. L'agent liste
 * les conversations à la demande via une commande, il n'en a pas besoin inline.
 */
export interface PromptSnapshot {
  tab: AppDestination
  activeConversationId?: string
  providers: string[]
  runsBlocked: Array<{ subject: string; status: string }>
  conversationsCount: number
}

export type AppEvent =
  | { type: 'navigate'; tab: string; origin?: string }
  | { type: 'refresh'; scope: string; convId?: string }
  | { type: 'toast'; text: string }
  // Orchestration LIVE (statut temps réel + fil des sous-agents), diffusée par étape.
  | { type: 'orchestrate-start'; convId?: string; runPath?: string; task: string }
  | { type: 'orchestrate-phase'; convId?: string; runPath?: string; phase: OrchestrationPhase }
  | {
      type: 'orchestrate-delta'
      convId?: string
      runPath?: string
      deltaStep: 'exec' | 'judge'
      delta: string
    }
  | { type: 'orchestrate-step'; convId?: string; runPath?: string; step: OrchestrationStep }
  | {
      type: 'orchestrate-end'
      convId?: string
      runPath?: string
      status: 'green' | 'red'
      /** Cause terminale structurée : permet au Watchdog de filtrer budget/quota/annulation. */
      detail?: string
    }
  | { type: 'orchestrate-usage'; convId?: string; runPath?: string }
  | { type: 'causal-trace-updated'; convId: string }

const CATALOG: CommandSpec[] = [
  {
    name: 'desktop_observe',
    description:
      "Capturer l'ecran Windows courant. L'image est fournie visuellement a l'iteration suivante. A utiliser avant toute action pointeur et apres les gestes pour verifier leur effet.",
    args: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'desktop_act',
    description:
      "Agir sur le PC Windows apres desktop_observe. Les coordonnees x/y vont de 0 a 1000 dans l'image capturee. Envoyer une courte sequence puis observer de nouveau.",
    args: {
      actions:
        "tableau (max 20) de {type:'move',x,y}, {type:'click',x,y,button?,clicks?}, {type:'scroll',delta,x?,y?}, {type:'type',text}, {type:'key',keys:['CTRL','A']}, {type:'open',target,args?}, {type:'wait',ms}"
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'navigate',
    description: 'Afficher une vue',
    args: { tab: APP_DESTINATIONS.map(({ id }) => id).join('|') },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'chat_send',
    description: 'Envoyer un message de chat',
    args: { message: 'texte', provider: 'claude|codex (optionnel)', role: 'rôle (optionnel)' }
  },
  {
    name: 'orchestrate',
    description:
      'Lancer un agent de développement capable de lire, modifier et tester le code ou les fichiers du workspace',
    args: {
      task: 'la tâche',
      // Le modèle DÉCIDE déjà (mesuré : 101 orchestrations sur 103 viennent de lui, contre 2 du
      // routage déterministe). Il ne pouvait pourtant PAS nommer la phase : il devait espérer que
      // l'heuristique de régime devine. Ce paramètre lui donne la capacité — même mouvement que
      // `verify` et `brain_query`, et sa décision devient TRAÇABLE au lieu d'être implicite.
      phase:
        'facultatif — la seule phase à jouer : « scout » (chercher quoi faire), « frame » (cadrer un besoin), « terrain », « build » (exécuter), « clean », « judge » (auditer un livrable existant). Omettre pour laisser le pipeline choisir.'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'create_conversation',
    description: 'Créer une conversation',
    args: { title: 'titre', category: 'claude|codex' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'rename_conversation',
    description: 'Renommer',
    args: { id: 'id', title: 'nouveau titre' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'remove_conversation',
    description: 'Supprimer',
    args: { id: 'id' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'attach_run',
    description: 'Attacher un RUN.md (workflow) existant à la conversation courante',
    args: { path: 'chemin du RUN.md', conversationId: 'id (optionnel, défaut = conv active)' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'load_graph',
    description: 'Charger un graphe brain (par id)',
    args: { brainId: 'id du brain' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  { name: 'get_state', description: 'Relire l’état courant de l’app', args: {} },
  {
    name: 'verify',
    // Aucun argument : le modele demande « verifie », il ne choisit JAMAIS la commande.
    description:
      'Rejouer la vérification déclarée par le projet (script « test ») et rendre son exit code — la seule façon de prouver « vert »',
    args: {},
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'remember',
    description:
      'Retenir DURABLEMENT un fait vérifié (cause racine, décision technique, contrainte d’un système) — dépose un candidat dans la boîte de réception du Brain, qu’un humain promeut. Pas pour une règle de comportement, ni pour ce qui ne vaut que ce tour-ci',
    args: {
      title: 'titre court et retrouvable',
      fact: 'le fait, autoporté — compréhensible dans 3 mois sans cette conversation',
      type: 'lesson | decision | preference | domain',
      scope: 'le projet concerné, ou « global »',
      // Les FORMES viennent de la validation reelle du Brain, decouverte par un essai live : le serveur
      // ne verifie pas un prefixe, il verifie que le locator est VERIFIABLE. Sans ces formes, le modele
      // produisait des candidats refuses (`file:src/…` relatif -> refuse, le serveur cherche le fichier
      // depuis SA racine).
      source:
        'sa provenance VÉRIFIABLE. Pour un fait de code : git:<chemin>@<sha> (ex. git:src/main/x.ts@9218eaf). Autres formes : url:https://… | ticket:ABC-123 | session:<id> | email:qui@ex.fr | meeting:AAAA-MM-JJ | file:<chemin ABSOLU existant>',
      tags: 'facultatif — quelques mots-clés',
      confidence: 'facultatif — low | medium | high'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'brain_query',
    description:
      'Interroger le savoir curé du Brain (décisions, leçons, contraintes déjà établies) — à préférer à une exploration du repo quand la question porte sur un acquis',
    args: { question: 'la question, en langage naturel' },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'ticket_create',
    description:
      'Créer une fiche (work item) chez le fournisseur de tickets configuré — écrit dans le backlog de l’équipe, sous l’identité de l’utilisateur : ne l’utiliser que sur une demande explicite',
    args: {
      title: 'titre court et explicite de la fiche (obligatoire)',
      description: 'facultatif — contexte, reproduction, critère de fin',
      workItemType: 'facultatif — ex. Bug, Task, User Story ; défaut = celui du fournisseur',
      assignee: 'facultatif — identifiant de la personne assignée',
      sourceId:
        'facultatif si une seule source est configurée ; OBLIGATOIRE s’il y en a plusieurs (on ne devine pas le projet cible)'
    },
    annotations: {
      readOnlyHint: false,
      // Non destructif (on ajoute, on ne supprime rien) mais NON idempotent : deux appels créent
      // DEUX fiches. Et `openWorldHint` : l'effet sort de l'app, chez un tiers.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'ticket_get',
    description:
      'Lire UNE fiche (work item) par son numéro — à utiliser dès qu’un numéro de fiche est mentionné ; chercher ce numéro avec ticket_search ne le trouvera PAS (la recherche porte sur les titres)',
    args: {
      id: 'le numéro de la fiche (ex. 1227)',
      sourceId:
        'facultatif si une seule source est configurée ; OBLIGATOIRE s’il y en a plusieurs (on ne devine pas le projet)'
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'ticket_update',
    description:
      'Mettre à jour une fiche existante après preuve du travail : publier un compte-rendu factuel, changer son état ou son assigné',
    args: {
      id: 'le numéro de la fiche (ex. 1227)',
      comment: 'facultatif — preuves, changements et vérifications réellement effectués',
      state: 'facultatif — état final exact accepté par le fournisseur',
      assignee: 'facultatif — personne à assigner',
      sourceId: 'facultatif si une seule source est configurée ; OBLIGATOIRE s’il y en a plusieurs'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'ticket_search',
    description:
      'Lire les fiches (work items) du fournisseur de tickets configuré, avec une recherche par titre — à utiliser AVANT de créer une fiche, pour vérifier qu’un doublon n’existe pas déjà',
    args: {
      query:
        'facultatif — mots-clés cherchés dans le TITRE ; sans lui la liste part des fiches les plus anciennes',
      pageSize: 'facultatif — nombre de fiches à rendre (1 à 100, défaut 25)',
      cursor: 'facultatif — pour continuer une lecture précédente',
      sourceId:
        'facultatif si une seule source est configurée ; OBLIGATOIRE s’il y en a plusieurs (on ne devine pas le projet)'
    },
    annotations: {
      // Lecture pure : rien n'est modifié chez le fournisseur, et deux appels identiques rendent la
      // même chose. Mais `openWorldHint` : la donnée vient d'un tiers, hors de l'app.
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'graphify',
    description:
      "Créer le graphe Graphify d'une codebase du workspace, ou le mettre à jour s'il existe déjà, avant une exploration large",
    args: {
      path: 'facultatif — chemin relatif de la codebase dans le workspace ; défaut = workspace entier'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'edit_file',
    description:
      'Remplacer un extrait UNIQUE dans un bureau isolé, vérifier ce bureau automatiquement, puis publier seulement si le test passe',
    args: {
      path: 'chemin du fichier, relatif au workspace',
      oldText: 'extrait exact à remplacer (doit être unique dans le fichier)',
      newText: 'texte de remplacement'
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  }
]

const DEFAULT_COMMAND_ANNOTATIONS: NonNullable<CommandSpec['annotations']> = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)])
  )
}

function actionFingerprint(
  name: string,
  args: Record<string, unknown>,
  scope?: { conversationId?: string }
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue({ name, args, scope })), 'utf8')
    .digest('hex')
}

function redactedArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === 'orchestrate') return { task: '[redacted]' }
  if (name === 'attach_run') return { path: '[redacted]', conversationId: '[redacted]' }
  if (name === 'chat_send')
    return { message: '[redacted]', provider: args.provider, role: args.role }
  if (name === 'edit_file') {
    return {
      path: args.path,
      oldText: '[REDACTED]',
      newText: '[REDACTED]'
    }
  }
  return redactTrace(args) as Record<string, unknown>
}

/**
 * Phases qu'un MODÈLE peut demander. Liste FERMÉE : une valeur hors liste est ignorée plutôt que
 * transmise, sinon un modèle pourrait préfixer la tâche de n'importe quoi. `kaizen` est volontairement
 * absent — il a son propre chemin de construction de tâche, plus bas dans ce même `case`.
 */
const ORCHESTRATE_PHASES = new Set(['scout', 'frame', 'terrain', 'build', 'clean', 'judge'])

export class AppCommandBus {
  private tab: AppDestination = 'chat'
  private traceStore?: TraceStore
  /** Hook de traçage (ledger) — chaque commande exécutée y laisse une ligne. */
  trace?: (name: string, args: Record<string, unknown>, ok: boolean) => void
  /** Conversation active (contexte posé par le chat) : les workflows créés s'y rattachent. */
  activeConversationId?: string
  /** Orchestrations en vol, par conversation : permet de STOPPER le sous-agent. */
  private readonly activeOrchestrations = new Map<string, AbortController>()
  /**
   * Rang d'appel des orchestrations, par conversation. L'AbortController n'est armé qu'APRÈS un
   * préambule asynchrone : deux lancements rapprochés sur la même conversation peuvent l'atteindre
   * dans l'ordre INVERSE de leur appel. Sans ce rang, le run le plus ANCIEN écrasait l'entrée du
   * plus récent, puis la supprimait dans son `finally` (la garde d'identité ne voit rien : l'entrée
   * courante est bien la sienne) → le bouton Stop du run en cours devenait un no-op silencieux.
   */
  private orchestrationRank = 0
  private readonly orchestrationRankByConv = new Map<string, number>()

  /** Arme le Stop pour ce run — sauf si un lancement PLUS RÉCENT a déjà pris la place. */
  private claimOrchestration(convId: string, rank: number, controller: AbortController): void {
    if ((this.orchestrationRankByConv.get(convId) ?? 0) > rank) return
    this.orchestrationRankByConv.set(convId, rank)
    this.activeOrchestrations.set(convId, controller)
  }
  /** Déduplique un même lancement tant que son orchestration est encore en vol. */
  private readonly activeOrchestrationByFingerprint = new Map<
    string,
    Promise<{ path: string; reused: boolean } | undefined>
  >()
  /** Sérialise écriture → snapshot → journal : aucune autre conversation ne peut s'intercaler. */
  private editFileTail: Promise<void> = Promise.resolve()

  /** Abort l'orchestration (sous-agent/juge) en cours pour une conversation. */
  abortOrchestration(convId: string): boolean {
    const controller = this.activeOrchestrations.get(convId)
    if (!controller) return false
    controller.abort()
    return true
  }

  /**
   * Abort + vide TOUTES les orchestrations en vol. Appelé par le filet de crash global : sur une
   * exception non catchée, le `finally` du handler os:orchestrate ne s'exécute pas → sans ça, les
   * AbortControllers resteraient dans le registre et `abortOrchestration` deviendrait un no-op
   * permanent jusqu'au redémarrage. (Faithful minor.)
   */
  abortAllOrchestrations(): void {
    for (const controller of this.activeOrchestrations.values()) {
      try {
        controller.abort()
      } catch {
        /* best-effort : couper les autres même si l'un jette */
      }
    }
    this.activeOrchestrations.clear()
    this.orchestrationRankByConv.clear()
    this.activeOrchestrationByFingerprint.clear()
  }

  /**
   * Enregistre une orchestration STOPPABLE dans le MÊME registre que le chemin `commands.ts` interne,
   * pour que `abortOrchestration(convId)` puisse la couper. Utilisé par le handler IPC direct
   * `os:orchestrate` (#2) qui, sinon, ne câblait aucun AbortController → bouton annuler no-op.
   * Retourne le controller dont il faut passer `.signal` à `runTask`. Toujours appeler
   * `clearOrchestration(convId)` en `finally`.
   */
  registerOrchestration(convId: string): AbortController {
    // Coupe une orchestration précédente laissée pendante sur la même conversation avant d'en armer une.
    this.activeOrchestrations.get(convId)?.abort()
    const controller = new AbortController()
    this.claimOrchestration(convId, ++this.orchestrationRank, controller)
    return controller
  }

  /**
   * Retire l'orchestration du registre (à appeler en finally). Ne supprime QUE si l'entrée courante
   * est bien CE controller : si un run plus récent (même conversation) l'a remplacé entre-temps, on
   * ne doit pas effacer son entrée (sinon son cancel deviendrait un no-op silencieux). (Corrector #2.)
   */
  clearOrchestration(convId: string, controller?: AbortController): void {
    if (controller && this.activeOrchestrations.get(convId) !== controller) return
    this.activeOrchestrations.delete(convId)
    this.orchestrationRankByConv.delete(convId)
  }

  setTraceStore(traceStore: TraceStore): void {
    this.traceStore = traceStore
  }

  constructor(
    private readonly os: AutowinOS,
    private readonly broadcast: (e: AppEvent) => void,
    private readonly onChat?: (
      provider: string | undefined,
      role: string | undefined,
      msg: string
    ) => Promise<string>,
    private readonly graphify: (
      input: GraphifyCommandInput
    ) => Promise<GraphifyCommandResult> = runGraphify,
    private readonly isCommandEnabled: (name: string) => boolean = () => true,
    private readonly retrieveBrain: typeof retrieveBrainContext = retrieveBrainContext,
    /**
     * Sources Tickets configurées, relues à CHAQUE appel : le modèle nomme au plus un `sourceId`,
     * jamais un profil. Défaut vide → `ticket_create` refusera en disant de configurer une source.
     */
    private readonly listTicketSources: () => readonly TicketSourceProfile[] = () => [],
    /** Créateur réel, câblé depuis index.ts. Absent → la commande annonce l'indisponibilité. */
    private readonly createTicket?: (request: TicketCreateRequest) => Promise<TicketItem>,
    /** Lecture réelle des tickets, câblée depuis index.ts. Absente → la commande annonce l'indisponibilité. */
    private readonly listTickets?: (
      request: TicketListRequest
    ) => Promise<{ items: TicketItem[]; hasMore: boolean; cursor?: string }>,
    /** Lecture d'UNE fiche par id, câblée depuis index.ts. */
    private readonly getTicket?: (request: TicketGetRequest) => Promise<TicketItem>,
    /** Controle Windows local, reserve aux commandes explicites du chat. */
    private readonly desktop?: DesktopController,
    /** Retour réel vers une fiche existante, câblé depuis index.ts. */
    private readonly updateTicket?: (request: TicketUpdateRequest) => Promise<TicketItem>
  ) {}

  catalog(): CommandSpec[] {
    return CATALOG.filter((command) => this.isCommandEnabled(command.name)).map((command) => ({
      ...command,
      annotations:
        command.annotations ??
        (command.name === 'get_state'
          ? { ...DEFAULT_COMMAND_ANNOTATIONS, readOnlyHint: true, idempotentHint: true }
          : DEFAULT_COMMAND_ANNOTATIONS)
    }))
  }

  async snapshot(): Promise<AppSnapshot> {
    const runs = await this.os.runsWithGate()
    return {
      tab: this.tab,
      activeConversationId: this.activeConversationId,
      providers: this.os.registry.ids(),
      roles: this.os.roles.all(),
      conversations: this.os.conversations
        .list()
        .map((c) => ({ id: c.id, title: c.title, category: c.category })),
      runs: runs
        .slice(0, 12)
        .map((r) => ({ subject: r.subject, status: r.summary.status, blocked: r.blocked })),
      budgetUsd: this.os.budget().spent
    }
  }

  /** Version réduite pour l'injection prompt — voir {@link PromptSnapshot}. */
  async snapshotForPrompt(): Promise<PromptSnapshot> {
    const full = await this.snapshot()
    return {
      tab: full.tab,
      activeConversationId: full.activeConversationId,
      providers: full.providers,
      runsBlocked: full.runs
        .filter((r) => r.blocked)
        .map((r) => ({ subject: r.subject, status: r.status })),
      conversationsCount: full.conversations.length
    }
  }

  /** Exécute une commande nommée, mute l'app, diffuse le changement. */
  async exec(
    name: string,
    args: Record<string, unknown> = {},
    conversationId?: string,
    bindingOverride?: RoleBinding,
    turnId?: string
  ): Promise<CommandResult> {
    try {
      const specification = CATALOG.find((command) => command.name === name)
      if (!specification) throw new Error(`Commande inconnue: ${name}`)
      if (!this.isCommandEnabled(name)) throw new Error(`Capacité désactivée: ${name}`)
      if (name === 'desktop_observe') {
        if (!this.desktop) throw new Error('Controle desktop indisponible')
        const observed = await this.desktop.observe()
        this.trace?.(name, redactedArgs(name, args), true)
        return { ok: true, data: observed.data, attachments: [observed.attachment] }
      }
      const data = await this.run(name, args, conversationId, bindingOverride, turnId)
      this.trace?.(name, redactedArgs(name, args), true)
      return { ok: true, data }
    } catch (e) {
      this.trace?.(name, redactedArgs(name, args), false)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private async run(
    name: string,
    a: Record<string, unknown>,
    conversationId?: string,
    bindingOverride?: RoleBinding,
    turnId?: string
  ): Promise<unknown> {
    const s = (k: string): string => String(a[k] ?? '')
    switch (name) {
      case 'desktop_act': {
        if (!this.desktop) throw new Error('Controle desktop indisponible')
        return await this.desktop.act(a.actions)
      }
      case 'navigate': {
        const requestedTab = s('tab')
        const location = resolveAppLocation(requestedTab)
        this.tab = location.destination
        const origin = typeof a.origin === 'string' ? a.origin : undefined
        this.broadcast({
          type: 'navigate',
          tab: requestedTab,
          ...(origin ? { origin } : {})
        })
        return { tab: location.destination, section: location.section }
      }
      case 'chat_send': {
        const text = this.onChat
          ? await this.onChat(
              a.provider ? s('provider') : undefined,
              a.role ? s('role') : undefined,
              s('message')
            )
          : (
              await this.os.chat(
                a.provider ? s('provider') : undefined,
                (a.role ? s('role') : undefined) as Role | undefined,
                [{ role: 'user', content: s('message') } as Message],
                () => {}
              )
            ).text
        this.broadcast({ type: 'refresh', scope: 'chat' })
        return { reply: text }
      }
      case 'orchestrate': {
        // Une tâche lancée depuis une conversation laisse SON workflow (RUN.md) dans
        // le dossier de la conversation — clos green/red selon le gate, red si crash.
        // Les ÉTAPES (sous-agent → juge → gate) sont diffusées LIVE + persistées (fil sous-agents).
        // Priorité à args.conversationId : un pilotage PROGRAMMATIQUE (agent, driver) peut
        // cibler une vraie conversation sans passer par l'UI (sinon fallback __autonomous__,
        // non ouvrable depuis le badge « agents actif »).
        const convId =
          (typeof a.conversationId === 'string' && a.conversationId) ||
          conversationId ||
          this.activeConversationId ||
          '__autonomous__'
        const causalWatchPaths = Array.isArray(a.causalWatchPaths)
          ? a.causalWatchPaths
              .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
              .slice(0, 16)
          : []
        const onLateMutationClaims =
          typeof a.onLateMutationClaims === 'function'
            ? (a.onLateMutationClaims as WatchdogMutationClaimsSink)
            : undefined
        // Rang pris ICI, dans le préfixe synchrone de `exec` : c'est le seul point qui reflète
        // l'ordre d'APPEL. Plus loin, le préambule asynchrone peut réordonner les lancements.
        const orchestrationRank = ++this.orchestrationRank
        // PHASE demandée par le modèle : préfixée à la tâche sous la forme `/<phase> …`, exactement la
        // forme qu'une commande explicite de l'utilisateur produit. On réutilise donc la machinerie
        // éprouvée (`matchExplicitPhase` → `regimePhases`) au lieu d'ouvrir un second chemin.
        // Une valeur inconnue est IGNORÉE : le modèle ne doit pas pouvoir inventer une phase.
        const requestedPhase = typeof a.phase === 'string' ? a.phase.trim().toLowerCase() : ''
        /**
         * UNE PHASE CHOISIE PAR LE MODÈLE N'AMPUTE PAS UNE TÂCHE À RISQUE.
         *
         * Défaut que j'ai failli livrer : une phase NOMMÉE écrase le régime, y compris `critical` —
         * vérifié, `regimePhases('/frame refactorer toute l'architecture de securite')` rend
         * `['frame']` au lieu des cinq phases. Venant de l'UTILISATEUR (`/frame …` tapé dans le chat)
         * c'est une décision explicite, donc légitime. Venant du MODÈLE, ce serait une réduction
         * silencieuse d'un chantier d'architecture ou de sécurité — exactement ce que l'audit du
         * 2026-07-29 a fait corriger sur le routage par intention. Les deux chemins sont
         * indistinguables en aval (même préfixe `/<phase> `), donc la garde est posée ICI, à l'entrée.
         */
        const modelPhaseAllowed =
          ORCHESTRATE_PHASES.has(requestedPhase) && classifyRegime(s('task')) !== 'critical'
        const phasePrefix = modelPhaseAllowed ? `/${requestedPhase} ` : ''
        const requestedTask = `${phasePrefix}${s('task')}`
        const conversation = this.os.conversations.get(convId)
        const kaizenEvidenceConversation =
          conversation?.autoKaizen?.role === 'analysis'
            ? (this.os.conversations.get(conversation.autoKaizen.sourceConversationId) ??
              conversation)
            : conversation
        const rawTask =
          /^\/kaizen(?=\s|$)/i.test(requestedTask) && kaizenEvidenceConversation
            ? buildAutowinKaizenTask(
                requestedTask,
                collectAutowinKaizenEvidence(kaizenEvidenceConversation)
              )
            : requestedTask
        const task = isolateWatchdogPromptPaths(
          rawTask,
          causalWatchPaths,
          this.os.executionWorkspace
        )
        const fingerprint = actionFingerprint('orchestrate', {
          convId,
          task,
          bindingOverride,
          causalWatchPaths
        })
        const existingRun = this.activeOrchestrationByFingerprint.get(fingerprint)
        if (existingRun) {
          const existing = await existingRun
          return {
            runId: existing?.path,
            runPath: existing?.path,
            status: 'running',
            reused: true
          }
        }
        const substantial = classifyRegime(task) !== 'trivial'
        let collectedContext = ''
        const unavailable: string[] = []
        if (substantial) {
          let app: Awaited<ReturnType<AppCommandBus['snapshot']>> | undefined
          try {
            app = await this.snapshot()
          } catch {
            unavailable.push('état application')
          }
          if (!conversation) unavailable.push('conversation')
          collectedContext = collectOrchestrationContext({
            task,
            conversation,
            app: app && { tab: app.tab },
            runs: app?.runs,
            unavailable
          })
        }
        const runReady = substantial
          ? reuseOrCreateConvRun(convId, requestedTask)
          : Promise.resolve(undefined)
        this.activeOrchestrationByFingerprint.set(fingerprint, runReady)
        let run: { path: string; reused: boolean } | undefined
        try {
          run = await runReady
        } catch (error) {
          if (this.activeOrchestrationByFingerprint.get(fingerprint) === runReady) {
            this.activeOrchestrationByFingerprint.delete(fingerprint)
          }
          throw error
        }
        const runPath = run?.path
        const orchestrationTurnId = turnId ?? randomUUID()
        const steps: OrchestrationStep[] = []
        // Sous-agent STOPPABLE : un AbortController par conversation, coupé par abortOrchestration.
        const abortController = new AbortController()
        this.claimOrchestration(convId, orchestrationRank, abortController)
        try {
          await this.os.waitUntilReady?.()
          const runtimeSnapshot = this.os.captureOrchestrationRuntime?.()
          // REPRISE depuis le chat : le chemin de reprise n'existait qu'au REDEMARRAGE de l'app, donc
          // « reprend » relancait de zero et REPAYAIT les phases deja produites (2026-07-29). On cherche
          // un acquis de la MEME tache dans LA MEME conversation, recent et non vide.
          const resumable =
            this.os.resumableOrchestrationForTask?.(
              task,
              convId,
              Date.now(),
              bindingOverride,
              runtimeSnapshot
            ) ?? null
          const resumeOutputs = resumable?.phaseOutputs ?? []
          this.broadcast({ type: 'orchestrate-start', convId, runPath, task: requestedTask })
          let currentRunId: string | undefined
          let terminalLifecycle: Extract<RunLifecycleEvent, { stage: 'closure' }> | undefined
          let resumedCheckpointReleased = false
          let phaseStartIteration = 0
          const r = await this.os.runTask(
            task,
            (step) => {
              steps.push(step)
              persistOrchestrationStep(
                step,
                {
                  conversationId: convId,
                  turnId: orchestrationTurnId,
                  iteration: step.step === 'exec' ? 0 : 1,
                  runId: currentRunId
                },
                undefined,
                this.traceStore
              )
              // A3 — peuplement LIVE du RUN.md : à chaque phase exec terminée, on réécrit le
              // livrable dans le RUN.md que Workflows affiche (au lieu d'un template vide 7 min).
              // Chantier 3 — trace native (spool Autowin) pour l'observabilité RAG/injection.
              if (step.prompt) {
                appendNativeTrace({
                  provider: step.prompt.provider,
                  model: step.prompt.model,
                  conversationId: convId,
                  turnId: orchestrationTurnId,
                  system: step.prompt.system,
                  messages: step.prompt.messages,
                  timestamp: new Date().toISOString()
                })
              }
              if (runPath && step.step === 'exec' && step.text) {
                const livePhases = steps
                  .filter((s) => s.step === 'exec' && s.text)
                  .map((s) => ({
                    phase:
                      (s.detail ?? '').replace(/^phase /, '').replace(/ \(réparation\)$/, '') ||
                      'build',
                    text: s.text as string
                  }))
                populateConvRunSections(runPath, livePhases)
              }
              this.broadcast({ type: 'orchestrate-step', convId, runPath, step })
              // Journal d'activité de la conversation : chaque étape facturée + coût tokens.
              if (convId) {
                appendConvActivity(convId, {
                  kind: step.step,
                  label: step.role ?? step.step,
                  provider: step.provider,
                  model: step.model,
                  inputTokens: step.usage?.inputTokens,
                  outputTokens: step.usage?.outputTokens,
                  cacheReadTokens: step.usage?.cacheReadTokens,
                  costUsd: step.usage?.costUsd ?? step.costUsd,
                  usageCallId: step.usageCallId,
                  // La duree etait DEJA mesuree par l'orchestrateur et jetee ici : sans elle, on ne
                  // pouvait repondre qu'a « quelle phase coute », pas a « quelle phase est LENTE ».
                  durationMs: step.durationMs,
                  text: step.text ?? step.detail
                })
              }
            },
            (phase) => {
              if (currentRunId) {
                persistOrchestrationPhaseStart(
                  phase,
                  {
                    conversationId: convId,
                    turnId: orchestrationTurnId,
                    iteration: phaseStartIteration++,
                    runId: currentRunId
                  },
                  this.traceStore
                )
              }
              this.broadcast({ type: 'orchestrate-phase', convId, runPath, phase })
            },
            (step, delta) => {
              this.broadcast({ type: 'orchestrate-delta', convId, runPath, deltaStep: step, delta })
            },
            abortController.signal,
            collectedContext,
            resumeOutputs,
            // `conversationId` MANQUAIT aussi : sans lui, l'acquis persiste sans conversation et une
            // reprise ne peut plus etre rattachee a son fil.
            convId,
            bindingOverride,
            (brain) =>
              appendBrainTrace({
                ...brain,
                conversationId: convId,
                turnId: orchestrationTurnId,
                kind: 'automatic'
              }),
            orchestrationTurnId,
            (lifecycle) => {
              currentRunId = lifecycle.runId
              // Le supervisor refuse une reprise avec provider encore actif AVANT d'entrer ici.
              // Conserver l'ancien checkpoint jusque ce premier evenement evite de perdre les phases
              // deja payees lorsqu'une admission echoue. Une fois admis, le nouveau run prend le relais.
              if (resumable && !resumedCheckpointReleased) {
                resumedCheckpointReleased = true
                // La reprise conserve désormais son runId pour rouvrir le même worktree. Dans ce
                // cas l'orchestrateur vient de réécrire CE checkpoint : l'effacer ici détruirait la
                // prochaine reprise si le process retombe avant la phase suivante.
                if (currentRunId !== resumable.runId) {
                  this.os.forgetResumableOrchestration(resumable.runId)
                }
                const reused = resumeOutputs.map((output) => output.phase).join(', ')
                this.broadcast({
                  type: 'orchestrate-step',
                  convId,
                  runPath,
                  step: {
                    step: 'exec',
                    role: 'subagent',
                    text: '',
                    status: 'completed',
                    detail: `reprise : phases deja acquises reutilisees (${reused})`
                  } as OrchestrationStep
                })
              }
              if (lifecycle.stage === 'closure') {
                terminalLifecycle = lifecycle
                // Le lifecycle terminal est le premier verdict durable du moteur. Un commit peut
                // redémarrer Electron avant que runTask retourne : attendre ce retour laissait alors
                // le RUN.md ouvert malgré une clôture déjà acquise dans la trace.
                if (runPath && lifecycle.closure.status !== 'open') {
                  closeConvRun(
                    runPath,
                    lifecycle.closure.status !== 'red',
                    `Cycle de vie terminal: ${lifecycle.closure.status} (${lifecycle.closure.totalDurationMs} ms).`
                  )
                  this.broadcast({ type: 'refresh', scope: 'workflows' })
                }
              }
              persistRunLifecycle(
                lifecycle,
                {
                  conversationId: convId,
                  turnId: orchestrationTurnId
                },
                this.traceStore
              )
            },
            resumable ?? undefined,
            (usage) => {
              if (!currentRunId) return
              const settledLifecycle = reconcileLateRunLifecycle(terminalLifecycle, usage)
              if (!settledLifecycle) return
              terminalLifecycle = settledLifecycle
              persistRunLifecycle(
                terminalLifecycle,
                { conversationId: convId, turnId: orchestrationTurnId },
                this.traceStore
              )
              const costCoverage = formatExecutionCostCoverage({
                costUsd: usage.knownCostUsd ?? 0,
                knownCostUsd: usage.knownCostUsd,
                unpricedCalls: usage.unpricedCalls
              })
              if (runPath) {
                closeConvRun(
                  runPath,
                  terminalLifecycle.closure.status === 'green',
                  `Usage provider finalisee apres cloture: ${usage.totalTokens} tokens, ${costCoverage ?? 'cout non rapporte'}, ${usage.activeCalls} appel(s) actif(s).`
                )
              }
              this.broadcast({ type: 'orchestrate-usage', convId, runPath })
              this.broadcast({ type: 'refresh', scope: 'workflows' })
              this.broadcast({ type: 'refresh', scope: 'orchestration' })
            },
            runtimeSnapshot,
            causalWatchPaths,
            onLateMutationClaims
          )
          if (!r.gateBlocked) {
            const causalEvidence = causalWatchPaths.length
              ? (r.causalMutationEvidence ?? [])
              : steps.flatMap((step) => step.evidence ?? [])
            appendExecutionEvidenceFileTrace(causalEvidence, {
              conversationId: convId,
              turnId: orchestrationTurnId,
              workspaceRoot: this.os.executionWorkspace,
              published: true
            })
          }
          if (runPath) {
            const costCoverage = formatExecutionCostCoverage({
              costUsd: r.costUsd,
              knownCostUsd: r.usage?.knownCostUsd,
              unpricedCalls: r.usage?.unpricedCalls
            })
            saveConvRunTrace(runPath, steps)
            populateConvRunSections(runPath, r.phaseOutputs) // J2 — RUN.md peuplé du vrai livrable
            closeConvRun(
              runPath,
              !r.gateBlocked,
              r.gateBlocked
                ? `Gate BLOQUÉ: ${r.gateReasons.join('; ')}`
                : `Juge: validé — clôture autorisée (${costCoverage ?? 'coût non rapporté'}).`
            )
          }
          this.broadcast({
            type: 'orchestrate-end',
            convId,
            runPath,
            status: r.gateBlocked ? 'red' : 'green',
            ...(r.gateBlocked ? { detail: r.gateReasons.join('; ') } : {})
          })
          this.broadcast({ type: 'refresh', scope: 'workflows' })
          this.broadcast({ type: 'refresh', scope: 'orchestration' })
          return {
            valid: r.valid,
            gateBlocked: r.gateBlocked,
            costUsd: r.costUsd,
            knownCostUsd: r.usage?.knownCostUsd,
            unpricedCalls: r.usage?.unpricedCalls,
            result: r.result,
            gateReasons: r.gateReasons,
            turnId: orchestrationTurnId,
            runId: runPath,
            runPath,
            status: r.gateBlocked ? 'failed' : 'succeeded',
            reused: run?.reused ?? false
          }
        } catch (e) {
          if (runPath) {
            saveConvRunTrace(runPath, steps)
            closeConvRun(runPath, false, `Orchestration en échec: ${String(e).slice(0, 120)}`)
          }
          this.broadcast({
            type: 'orchestrate-end',
            convId,
            runPath,
            status: 'red',
            detail: e instanceof Error ? e.message : String(e)
          })
          this.broadcast({ type: 'refresh', scope: 'workflows' })
          throw e
        } finally {
          this.clearOrchestration(convId, abortController)
          if (this.activeOrchestrationByFingerprint.get(fingerprint) === runReady) {
            this.activeOrchestrationByFingerprint.delete(fingerprint)
          }
        }
      }
      case 'create_conversation': {
        const c = this.os.conversations.create({
          title: s('title'),
          category: s('category') || 'claude',
          provider: s('category') || 'claude'
        })
        this.broadcast({ type: 'refresh', scope: 'conversations' })
        return c
      }
      case 'rename_conversation': {
        const c = this.os.conversations.rename(s('id'), s('title'))
        this.broadcast({ type: 'refresh', scope: 'conversations' })
        return c
      }
      case 'remove_conversation': {
        const id = s('id')
        return { removed: this.os.conversations.remove(id) }
      }
      case 'attach_run': {
        const convId =
          (a.conversationId
            ? s('conversationId')
            : (conversationId ?? this.activeConversationId)) ?? ''
        if (!convId) throw new Error('aucune conversation active pour attacher le run')
        const path = s('path')
        const c = this.os.conversations.attachRun(convId, path)
        return { conversation: c.id, runPaths: c.runPaths }
      }
      case 'load_graph': {
        const brain = this.os.listBrains().find((b) => b.id === s('brainId'))
        if (!brain) throw new Error(`brain inconnu: ${s('brainId')}`)
        const g = this.os.loadBrainGraph(brain.path, 300)
        this.broadcast({ type: 'navigate', tab: 'memory' })
        return { brain: brain.id, nodes: g.nodes.length, links: g.links.length }
      }
      case 'get_state':
        return await this.snapshot()
      case 'verify':
        return await this.runVerify()
      case 'brain_query':
        return await this.runBrainQuery(a.question, conversationId, turnId)
      case 'ticket_create':
        // Écriture chez un tiers : la cible et les bornes sont décidées hors du modèle
        // (`ticket-create-command.ts` + `TicketService`), jamais d'après les arguments bruts.
        return await createTicketFromCommand(a as TicketCreateArgs, {
          listSources: this.listTicketSources,
          ...(this.createTicket ? { create: this.createTicket } : {})
        })
      case 'ticket_get':
        return await getTicketFromCommand(a as TicketGetArgs, {
          listSources: this.listTicketSources,
          ...(this.getTicket ? { get: this.getTicket } : {})
        })
      case 'ticket_update':
        return await updateTicketFromCommand(a as TicketUpdateArgs, {
          listSources: this.listTicketSources,
          ...(this.updateTicket ? { update: this.updateTicket } : {})
        })
      case 'ticket_search':
        // Lecture chez un tiers : même garde de cible que la création (le modèle nomme au plus un
        // `sourceId`), et le filtre est échappé plus bas dans la chaîne, jamais ici.
        return await searchTicketsFromCommand(a as TicketSearchArgs, {
          listSources: this.listTicketSources,
          ...(this.listTickets ? { list: this.listTickets } : {})
        })
      case 'graphify':
        return await this.withIsolatedMutation(
          'graphify',
          conversationId,
          async (workspaceRoot) => {
            const result = await this.graphify({
              workspaceRoot,
              ...(typeof a.path === 'string' && a.path.trim() ? { path: a.path.trim() } : {})
            })
            return this.retainGraphifyResult(workspaceRoot, result)
          }
        )
      case 'remember': {
        const outcome = await rememberFact(a, {
          token: brainServiceToken(),
          authorAgent: 'autowin-os',
          model: this.os.roles.getBinding('orchestrator').model ?? 'autowin',
          workspace: this.os.executionWorkspace
        })
        /**
         * ÉCHO : sans ça, le modèle écrit sans jamais relire — la moitié manquante de la mécanique de
         * claude.exe.
         *
         * On alimente dès que le fait est RECEVABLE (`outcome.fact` présent), et pas seulement sur un
         * dépôt réussi. Défaut relevé le 2026-07-30 : quand le Brain ne répond pas — service SMB partagé,
         * préchauffage de 30-40 s, donc cas courant — le fait n'était retenu NI durablement NI dans le
         * fil. Zéro mémoire, soit exactement la régression que l'écho existe pour fermer. L'état du dépôt
         * voyage avec le fait pour que rien ne soit présenté comme partagé alors qu'il ne l'est pas.
         *
         * Le contenu vient de `outcome.fact` — ce qui a été VALIDÉ — et jamais de `a.*`.
         */
        if (outcome.fact) {
          const convId = conversationId ?? this.activeConversationId ?? ''
          const attache = noteRemembered(convId, {
            title: outcome.fact.title,
            body: outcome.fact.body,
            scope: outcome.fact.scope,
            workspace:
              outcome.fact.scope.trim().toLowerCase() === 'global'
                ? 'global'
                : this.os.executionWorkspace,
            note: outcome.note,
            state: outcome.stored ? 'depose' : outcome.unknown ? 'inconnu' : 'local'
          })
          // Sans conversation, l'écho ne peut pas s'attacher : le DIRE plutôt que le perdre en silence.
          if (!attache) {
            return {
              ...outcome,
              detail: `${outcome.detail} (non rattaché à ce fil : aucune conversation active)`
            }
          }
        }
        return outcome
      }
      case 'edit_file': {
        return await this.runTracedEditFile(
          { path: a.path, oldText: a.oldText, newText: a.newText },
          conversationId,
          turnId
        )
      }
      default:
        throw new Error(`commande inconnue: ${name}`)
    }
  }

  /**
   * VERIFICATION — le seul point d'execution ouvert a la demande d'un modele.
   *
   * Le modele ne transmet AUCUN argument : il demande « verifie », et `decideVerifyCommand` choisit
   * (ou refuse) a partir du script `test` declare par le projet. La voie alternative — donner Bash au
   * CLI avec `--allowedTools "Bash(npm test)"` — a ete testee sur le vrai binaire et INVALIDEE : le
   * pattern ne restreint rien (`echo BONJOUR` passait, avec et sans bypassPermissions). C'est donc
   * ici, et seulement ici, que la frontiere est tenue.
   *
   * `shell: false` + argv separes : aucune interpolation, donc aucune injection possible meme si la
   * liste blanche evoluait.
   */

  /**
   * Interrogation du Brain a la demande. Lecture seule : aucun effet de bord possible.
   * `retrieveBrainContext` degrade deja proprement (pas de token, serveur absent, timeout 5s → ''),
   * et `buildBrainOutcome` distingue « rien trouve » d'une panne — l'agent ne doit pas transformer un
   * silence en reponse negative.
   */

  /**
   * Petite edition ciblee — le « chemin du milieu » entre parler et orchestrer.
   *
   * C'est le SEUL point qui donne le droit d'ecrire hors pipeline. Il ne l'est que parce que l'agent
   * peut desormais PROUVER (`verify`) ce qu'il vient de changer. Toutes les bornes vivent dans
   * `decideEdit` (module pur, 16 tests de refus : traversee de chemin, .git, secrets, correspondance
   * ambigue, creation de fichier) — jamais dans un outil du CLI, dont les patterns d'autorisation ont
   * ete mesures inoperants le meme jour.
   */
  private async withIsolatedMutation<T>(
    command: 'edit_file' | 'graphify',
    conversationId: string | undefined,
    action: (workspaceRoot: string) => T | Promise<T>
  ): Promise<T> {
    if (!this.os.worktrees) {
      throw new Error(`isolation workspace indisponible : ${command} refusé`)
    }
    const runId = `command-${command === 'edit_file' ? 'edit' : 'graphify'}-${randomUUID()}`
    const beginOptions = {
      task: command,
      role: 'command',
      ...(conversationId ? { conversationId } : {})
    }
    const workspaceRoot = this.os.worktrees.beginAsync
      ? await this.os.worktrees.beginAsync(runId, `Commande ${command}`, true, beginOptions)
      : this.os.worktrees.begin(runId, `Commande ${command}`, true, beginOptions)
    if (!workspaceRoot) throw new Error(`isolation workspace indisponible : ${command} refusé`)
    let completed = false
    try {
      const result = await action(workspaceRoot)
      if (command === 'edit_file') {
        const verification = await this.runVerifyAt(workspaceRoot)
        if (!verification.allowed) {
          throw new Error(`Vérification du bureau impossible : ${verification.reason}`)
        }
        if (!verification.ok) {
          throw new Error(
            `Vérification du bureau échouée (${verification.command}) : ${verification.output}`
          )
        }
      }
      const finalized = this.os.worktrees.endAsync
        ? await this.os.worktrees.endAsync(runId, { merge: true })
        : this.os.worktrees.end(runId, { merge: true })
      completed = true
      if (
        finalized?.outcome !== 'merged' &&
        finalized?.outcome !== 'nothing' &&
        finalized?.outcome !== 'cleanup-pending' &&
        finalized?.outcome !== 'published-residue'
      ) {
        throw new Error(`Le bureau ${command} a été conservé : publication automatique incomplète`)
      }
      return result
    } catch (error) {
      if (!completed) {
        if (this.os.worktrees.endAsync) await this.os.worktrees.endAsync(runId, { merge: false })
        else this.os.worktrees.end(runId, { merge: false })
      }
      throw error
    }
  }

  /**
   * Graphify écrit un cache régénérable. Il travaille dans le bureau isolé, puis le seul artefact
   * utile est copié dans l'AppData Autowin avant que le bureau soit rangé. Le repo principal n'est
   * donc jamais utilisé comme dossier de cache.
   */
  private retainGraphifyResult(
    workspaceRoot: string,
    result: GraphifyCommandResult
  ): GraphifyCommandResult {
    if (isAbsolute(result.graph)) throw new Error('Chemin Graphify absolu refusé')
    const source = resolve(workspaceRoot, result.graph)
    const rel = relative(workspaceRoot, source)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Chemin Graphify hors du bureau isolé')
    }
    if (!existsSync(source)) return result
    const repoKey = createHash('sha256')
      .update(resolve(this.os.executionWorkspace).toLowerCase())
      .digest('hex')
      .slice(0, 20)
    const destination = join(ensureAutowinAppData(), 'graphify-cache', repoKey, rel)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    return { ...result, graph: destination }
  }

  private runEditFile(
    input: { path: unknown; oldText: unknown; newText: unknown },
    workspaceRoot: string
  ): {
    allowed: boolean
    reason?: string
    path?: string
    diff?: string
  } {
    const decision = decideEdit(input, workspaceRoot, (absolutePath) =>
      existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null
    )
    if (!decision.allowed) return { allowed: false, reason: decision.reason }
    const content = readFileSync(decision.absolutePath, 'utf8')
    writeFileSync(
      decision.absolutePath,
      applyEdit(content, decision.oldText, decision.newText),
      'utf8'
    )
    this.broadcast({ type: 'refresh', scope: 'conversations' })
    return {
      allowed: true,
      path: decision.relativePath,
      diff: editDiff(decision.oldText, decision.newText)
    }
  }

  private async runTracedEditFile(
    input: { path: unknown; oldText: unknown; newText: unknown },
    conversationId?: string,
    turnId?: string
  ): Promise<{ allowed: boolean; reason?: string; path?: string; diff?: string }> {
    const previous = this.editFileTail
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.editFileTail = previous.then(() => current)
    await previous
    try {
      const baseDecision = decideEdit(input, this.os.executionWorkspace, (absolutePath) =>
        existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null
      )
      const baseContentBefore = baseDecision.allowed
        ? readFileSync(baseDecision.absolutePath, 'utf8')
        : undefined
      const before = await captureWorkspaceMutationSnapshot(this.os.executionWorkspace)
      const outcome = await this.withIsolatedMutation(
        'edit_file',
        conversationId,
        (workspaceRoot) => this.runEditFile(input, workspaceRoot)
      )
      const path =
        outcome.allowed && outcome.path
          ? normalizeWorkspaceTracePath(outcome.path, this.os.executionWorkspace)
          : null
      if (conversationId && path) {
        const after = await captureWorkspaceMutationSnapshot(this.os.executionWorkspace)
        const key = workspaceTracePathKey(path)
        const fingerprint = [...after].find(
          ([candidate]) => workspaceTracePathKey(candidate) === key
        )?.[1]
        const baseFingerprint = [...before].find(
          ([candidate]) => workspaceTracePathKey(candidate) === key
        )?.[1]
        const baseGenerationMarker = [...before.generationMarkers].find(
          ([candidate]) => workspaceTracePathKey(candidate) === key
        )?.[1]
        const generationMarker = await captureWorkspacePathGenerationMarker(
          this.os.executionWorkspace,
          path
        )
        const baseContentAfter = existsSync(resolve(this.os.executionWorkspace, path))
          ? readFileSync(resolve(this.os.executionWorkspace, path), 'utf8')
          : ''
        appendConversationFileTrace({
          timestamp: new Date().toISOString(),
          conversationId,
          ...(turnId ? { turnId } : {}),
          workspaceRoot: this.os.executionWorkspace,
          source: 'edit_file',
          paths: [path],
          ...(fingerprint ? { pathFingerprints: { [path]: fingerprint } } : {}),
          pathBaseFingerprints: { [path]: baseFingerprint ?? null },
          pathGenerationMarkers: { [path]: generationMarker },
          pathBaseGenerationMarkers: { [path]: baseGenerationMarker ?? null },
          ...(baseContentBefore !== undefined
            ? {
                pathLineFingerprints: {
                  [path]: addedLineFingerprints(baseContentBefore, baseContentAfter)
                }
              }
            : {})
        })
      }
      return outcome
    } finally {
      release()
    }
  }

  private async runBrainQuery(
    question: unknown,
    conversationId?: string,
    turnId?: string
  ): Promise<BrainQueryOutcome & { allowed: boolean; reason?: string }> {
    const decision = decideBrainQuery(question)
    if (!decision.allowed) {
      return {
        allowed: false,
        reason: decision.reason,
        found: false,
        query: '',
        knowledge: '',
        status: 'not-requested'
      }
    }
    const corpus = brainCorpusForWorkspace(this.os.executionWorkspace)
    const brain =
      corpus?.length === 0
        ? { context: '', status: 'empty' as const }
        : await this.retrieveBrain(decision.query, { corpus })
    // MEME PORTEE que la voie poussee : le contexte, le statut et la navigation sont projetés ensemble.
    const scoped = scopeBrainRetrieval(brain, corpus)
    const outcome = buildBrainOutcome(decision.query, scoped.context, scoped.status)
    if (conversationId) {
      appendBrainTrace({
        timestamp: new Date().toISOString(),
        conversationId,
        ...(turnId ? { turnId } : {}),
        kind: 'query',
        query: decision.query,
        found: outcome.found,
        status: scoped.status,
        injectedChars: outcome.knowledge.length,
        navigation: scoped.navigation
      })
    }
    return { allowed: true, ...outcome }
  }

  private async runVerify(): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
    return this.runVerifyAt(this.os.executionWorkspace)
  }

  private async runVerifyAt(
    workspaceRoot: string | undefined
  ): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
    const decision = decideVerifyCommand(workspaceRoot)
    if (!decision.allowed) {
      return {
        allowed: false,
        reason: decision.reason,
        ok: false,
        exitCode: null,
        command: '',
        output: ''
      }
    }
    const [file, ...rest] = decision.command.split(' ')
    const sharedBin = this.os.executionWorkspace
      ? join(this.os.executionWorkspace, 'node_modules', '.bin')
      : undefined
    const env =
      sharedBin && existsSync(sharedBin)
        ? {
            ...process.env,
            PATH: `${sharedBin}${delimiter}${process.env.PATH ?? ''}`
          }
        : process.env
    return await new Promise((resolve) => {
      // Windows : depuis le correctif CVE-2024-27980, Node REFUSE de spawner un `.cmd` sans shell
      // (`spawn EINVAL`) — constate en essai reel, l'agent recevait un echec d'environnement alors
      // que sa correction etait bonne. On passe donc par `cmd.exe /c` avec des ARGV SEPARES : pas de
      // chaine interpolee, donc aucune surface d'injection — et de toute façon la commande vient
      // d'une liste blanche, le modele ne la choisit jamais.
      const child =
        process.platform === 'win32'
          ? spawn('cmd.exe', ['/c', file, ...rest], {
              shell: false,
              windowsHide: true,
              cwd: decision.cwd,
              env
            })
          : spawn(file, rest, { shell: false, cwd: decision.cwd, env })
      let output = ''
      const collect = (chunk: Buffer): void => {
        output += chunk.toString('utf8')
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      child.on('error', (error) =>
        resolve({
          allowed: true,
          ok: false,
          exitCode: null,
          command: decision.command,
          output: capVerifyOutput(`lancement impossible : ${String(error)}`)
        })
      )
      child.on('close', (code) =>
        resolve({
          allowed: true,
          ok: code === 0,
          exitCode: code,
          command: decision.command,
          output: capVerifyOutput(output)
        })
      )
    })
  }
}
