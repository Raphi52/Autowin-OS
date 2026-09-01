import type { ChatArtifact } from '../../shared/artifacts'

/**
 * Contrat d'adaptateur provider — l'interface interne STABLE d'Autowin OS.
 *
 * Toute voie modèle (Claude via claude-bridge, Codex via OAuth device-code, et
 * tout futur provider) implémente `ProviderAdapter`. Le reste de l'app ne parle
 * JAMAIS à un provider directement : il passe par cette interface + le routeur.
 * C'est la garde « adaptateur souverain » du framing (l'API non documentée d'un
 * provider ne fuit jamais au-delà de son implémentation d'adaptateur).
 */

/** Rôle d'un message dans une conversation. `system` = injection kit (SOUL). */
export type Role = 'system' | 'user' | 'assistant'

export interface Attachment {
  name: string
  mimeType: string
  size: number
  kind: 'text' | 'image' | 'file'
  /** UTF-8 pour `text`, base64 sans préfixe data URL pour `image` et `file`. */
  content: string
}

export interface Message {
  role: Role
  content: string
  attachments?: Attachment[]
}

/** Options d'un tour d'envoi. */
export interface SendOptions {
  /** Modèle exact choisi dans Agents. */
  model?: string
  /** Plafond dur transmis au provider quand son transport sait l'appliquer avant la depense. */
  maxBudgetUsd?: number
  /** Surface d'outils imposee par le controleur pour les tours automatiques sensibles. */
  toolProfile?: 'watchdog-read-only'
  /**
   * Outils Brain d'un nœud SKILL, à poser sur le canal NATIF de l'adaptateur.
   *
   * INTENTION EXPLICITE, jamais déduite. La présence d'un bloc `execution` ne dit PAS qu'on sert un
   * nœud skill : les huit phases du pipeline en portent un aussi, et elles doivent rester SANS aucun
   * outil externe (contrainte posée par l'utilisateur, vérifiée hors-modèle le 2026-08-20 — sans
   * `--mcp-config`, le CLI rend bien « outil absent »). Un adaptateur qui déduirait l'intention
   * ouvrirait donc les outils aux huit phases par accident.
   *
   * Le CONTENU est calculé par le serveur d'outils (`skill-node-mcp`), jamais écrit à la main ici :
   * la forme exacte de la configuration et les noms exposés sont sa responsabilité. Cette option ne
   * fait que les TRANSPORTER jusqu'au canal du provider — même règle que `system` (cf. plus bas) :
   * l'équivalence est au niveau CONTENU, pas protocole.
   */
  skillNodeTools?: {
    /** La configuration MCP, déjà sérialisée par le serveur d'outils. */
    mcpConfig: string
    /** Les noms tels que le CLI les expose (`mcp__autowin__…`), pour l'autorisation d'usage. */
    allowedTools: string[]
    /**
     * Hériter EN PLUS des serveurs MCP configurés sur la machine (décision utilisateur du
     * 2026-08-20). Conséquence assumée et à tracer : la surface d'outils d'un nœud devient
     * machine-dépendante. Le refus runtime du lanceur reste donc la barrière AUTORITAIRE sur
     * `orchestrate` — la fermeture du catalogue, elle, ne tient plus.
     */
    inheritMachineMcp?: boolean
  }
  /** Niveau d'effort choisi dans Agents, si le provider le supporte. */
  reasoningEffort?: string
  /**
   * Bloc système à injecter (le kit condensé SOUL.md). Le routeur le fournit ;
   * chaque adaptateur est responsable de le poser sur SON canal natif
   * (request["system"] concaténé pour Claude-bridge, champ `instructions` pour
   * Codex) — l'équivalence est au niveau CONTENU, pas protocole.
   */
  system?: string
  /** F6 — décomposition observable du `system` (passthrough, jamais transmis au provider). */
  systemBlocks?: SystemBlock[]
  /** Reprise d'une session existante (cache-friendly) si l'adaptateur le gère. */
  resumeSessionId?: string
  /** Signal d'annulation coopératif. */
  signal?: AbortSignal
  /** Identité stable d'un tour, réutilisée par tous ses retries pour l'idempotence. */
  requestId?: string
  /** Observation du payload final, juste avant spawn/fetch. Jamais transmis au provider. */
  observePrompt?: (prompt: PromptEnvelope) => void
  /**
   * Journal survivable d'un appel DIRECT (chat). Distinct de `execution.onJournal` : ajouter un bloc
   * `execution` au chat ferait basculer le registre vers un exécuteur outillé et changerait le
   * provider demandé. Le contrôleur de conversation persiste ce lien AVANT le spawn pour pouvoir
   * réinjecter, après redémarrage, le résultat déjà payé au lieu de relancer le même appel.
   */
  onJournal?: (token: string, journalPath: string) => void
  /** Mode agentique local, réservé à l'étape d'exécution d'une orchestration. */
  execution?: {
    cwd: string
    sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
    /**
     * Plafond total de l'appel orchestré, dérivé du devis actif. Les adaptateurs et le registre
     * l'utilisent à la place de leur garde locale afin qu'un agent actif ne soit pas tué avant la
     * durée promise par le run. L'abort du superviseur reste la borne autoritaire du run entier.
     */
    providerTimeoutMs?: number
    /** Vrai uniquement quand ce cwd appartient exclusivement à ce run/conversation. */
    causallyIsolated?: boolean
    /** Fichiers surveillés présents dans la copie isolée, à attribuer exactement. */
    causalWatchPaths?: string[]
    /** Oracles et couverture déclarés par l'opérateur, figés avant toute mutation du run. */
    learningOracles?: TrustedLearningOracle[]
    /** Lease interne du processus CLI ; jamais transmis au fournisseur. */
    onProcess?: (pid: number, active: boolean) => void
    /** Route d'exécution réellement retenue après fallback (ex. Gemini demandé → Codex). */
    onExecutorResolved?: (provider: string) => void
    /** Barrière durable posée avant spawn, levée seulement après enregistrement du PID enfant. */
    onSpawnIntent?: (token: string, active: boolean, reservationId?: string) => void
    /** La réservation est réglée en mémoire ; son agent devient historique au prochain checkpoint. */
    onReservationSettled?: (reservationId: string) => void
    /** Remplace atomiquement l'intention par le lease du PID créé. */
    onSpawned?: (token: string, pid: number) => void
    /**
     * Enregistre la fermeture forte propre à l'adaptateur. Le registre l'invoque seulement si le
     * provider ignore l'abort au-delà de la grâce de drainage du watchdog de coordination.
     */
    registerTermination?: (terminate: (reason: string) => void) => void
    /**
     * Journal de sortie du CLI lancé, quand le provider en ouvre un.
     *
     * C'est le chaînon qui manquait pour se RATTACHER : le processus survit à la mort de l'app et
     * continue d'écrire, mais sans ce chemin l'app qui revient ne sait pas où lire. L'état persisté
     * du run le porte, et une instance ultérieure reprend la lecture à l'offset atteint — au lieu de
     * relancer un travail déjà fait, ou de demander un clic.
     */
    onJournal?: (token: string, journalPath: string) => void
  }
}

/** Enveloppe observable réellement remise à l'adaptateur, avant transport provider. */
/** F6 — un bloc nommé composant le `system` injecté (skill/discipline/style/capacités/contexte). */
export interface SystemBlock {
  name: string
  chars: number
}

export interface PromptEnvelope {
  provider: string
  model?: string
  transport: string
  system?: string
  /** F6 — décomposition du `system` en blocs nommés, pour auditer ce qui a été injecté. */
  systemBlocks?: SystemBlock[]
  messages: Message[]
  options: Record<string, unknown>
  limitation: string
}

/** Fragment de réponse streamée. */
export interface StreamChunk {
  /** Texte incrémental de la RÉPONSE (ce que l'utilisateur lit). */
  delta: string
  /**
   * Raisonnement incrémental du modèle (blocs `thinking`), à afficher EN DIRECT pendant qu'il
   * réfléchit. Distinct de `delta` : ne fait pas partie de la réponse et n'est jamais persisté
   * dans le message — sans quoi l'utilisateur attend devant un écran figé (mesuré : 6 à 13 s
   * de réflexion avant le premier mot avec un gros modèle).
   */
  reasoning?: string
  /**
   * Signe de vie TECHNIQUE du provider — outil en cours, tâche de fond, retry API. Distinct de
   * `reasoning` : ce n'est PAS du raisonnement, cela remplace le précédent au lieu de s'accumuler,
   * et l'UI l'affiche hors du bloc « Réflexion ».
   */
  status?: string
  /** Artefacts structurés disponibles avant la fin du flux, si le supplier les émet ainsi. */
  artifacts?: ChatArtifact[]
}

/**
 * Consommation réelle d'un tour, NORMALISÉE par l'adaptateur — pas la sémantique brute du provider.
 *
 * L'INVARIANT, car les providers ne s'accordent pas et un consommateur ne peut pas deviner : mesuré le
 * 2026-08-04 sur le journal réel, codex rend `cacheRead <= input` (1 048 cas, 0 exception : le cache est
 * un sous-ensemble de l'input) tandis que claude rend `cacheRead > input` (486 cas, 0 exception : les
 * deux sont disjoints). `execution-supervisor` n'en supposait qu'une, donc comptait un tour claude de
 * 13 492 tokens comme un tour de 6.
 *
 * Chaque adaptateur DOIT donc rendre :
 *   - `inputTokens`      : l'input TOTAL du tour, cache INCLUS ;
 *   - `cacheReadTokens`  : la part de cet input relue depuis le cache, donc toujours ≤ `inputTokens`.
 */
export interface Usage {
  /** Input total du tour, cache inclus. */
  inputTokens: number
  outputTokens: number
  /** Sous-ensemble de `inputTokens` relu depuis le cache — jamais une quantité qui s'y ajoute. */
  cacheReadTokens?: number
  /**
   * Sous-ensemble de `inputTokens` ÉCRIT dans le cache — jamais un ajout. Distinct de la lecture
   * parce qu'il se facture 1,25× le tarif d'entrée là où la lecture se facture 0,1× : fondu dans
   * l'entrée, il était sous-facturé de 25 % sans que rien ne le signale.
   */
  cacheCreationTokens?: number
  costUsd?: number
}

/**
 * Echec TERMINAL rapporte par un provider apres avoir quand meme consomme un appel.
 *
 * Un simple `Error` perdait les compteurs du `result` Claude et la boucle de chat relancait le meme
 * prompt : le coupe-circuit `--max-budget-usd` coutait alors deux fois sa borne et l'occurrence
 * affichait une reservation theorique de 500 000 tokens. Ce contrat transporte la consommation
 * reelle jusqu'au superviseur et dit explicitement si repayer une tentative est autorise.
 */
export class ProviderCallError extends Error {
  readonly code?: string
  readonly retryable: boolean
  readonly usage?: Usage
  readonly resolvedModel?: string

  constructor(
    message: string,
    details: { code?: string; retryable?: boolean; usage?: Usage; resolvedModel?: string } = {}
  ) {
    super(message)
    this.name = 'ProviderCallError'
    this.code = details.code
    this.retryable = details.retryable ?? true
    this.usage = details.usage
    this.resolvedModel = details.resolvedModel
  }
}

export interface ExecutionEvidence {
  type: string
  kind: 'mutation' | 'verification' | 'inspection' | 'other'
  status: string
  ok: boolean
  /** Oracle explicitement classé stable par le producteur de preuve ; absent = non publiable seul. */
  oracleStable?: boolean
  /** Hash de la déclaration opérateur qui atteste commande + couverture. */
  oracleAttestation?: string
  summary: string
  /** Commande exécutée (command_execution) — affichée telle quelle dans le Chat. */
  command?: string
  /** Code de sortie de la commande (command_execution). */
  exitCode?: number
  /** Sortie brute agrégée (stdout+stderr) — pour affichage lisible inline, plus large que `summary`. */
  stdout?: string
  /** Diff / changements d'un file_change, prêt à afficher. */
  diff?: string
  /** Chemin(s) du fichier touché (file_change). */
  path?: string
  /** Chemins structurés exacts, utilisés pour l'attribution causale par conversation. */
  paths?: string[]
  /** Empreintes exactes rapportées par l'outil, bornées ; aucun contenu de fichier n'est transporté. */
  writtenLineFingerprints?: string[]
  /** Empreintes exactes par chemin quand une preuve couvre plusieurs fichiers. */
  writtenLineFingerprintsByPath?: Record<string, string[]>
  /** Workspace où la mutation a réellement eu lieu (base ou worktree isolé). */
  workspaceRoot?: string
  /** Empreinte du diff Git juste après la mutation, indexée par chemin normalisé. */
  pathFingerprints?: Record<string, string>
  /** Empreinte avant mutation ; `null` signifie que le chemin était Git-clean. */
  pathBaseFingerprints?: Record<string, string | null>
  /** Génération filesystem après mutation, pour détecter une réécriture externe à l'identique. */
  pathGenerationMarkers?: Record<string, string>
  /** Génération filesystem avant mutation ; complète le hash de base pour chaîner causalement. */
  pathBaseGenerationMarkers?: Record<string, string | null>
}

export interface TrustedLearningOracle {
  command: string
  covers: string[]
  attestedFiles: string[]
  attestation: string
  /**
   * La couverture vient des ARGUMENTS de la commande, pas de `covers`.
   *
   * Une seule forme le justifie aujourd'hui : `vitest related <chemins>` joue precisement les tests
   * qui IMPORTENT les fichiers qu'on lui nomme. Sa couverture est donc PROUVEE par construction --
   * on confronte ses arguments aux chemins reellement mutes -- au lieu d'etre declaree dans une liste
   * qu'il faudrait croire. C'est un oracle plus fort que les autres, pas un assouplissement : si UN
   * SEUL chemin mute manque aux arguments, l'attestation est refusee.
   */
  couvreSesArguments?: boolean
}

/** Résultat final d'un tour, après consommation du stream. */
export interface SendResult {
  /** Texte complet assemblé. */
  text: string
  /** Identité du provider ayant répondu (traçabilité / log de tour). */
  provider: string
  /** Id de session à réutiliser pour un `resume` ultérieur, si fourni. */
  sessionId?: string
  /** Le bloc système a-t-il bien été injecté sur ce tour (preuve d'injection). */
  systemInjected: boolean
  /** Tokens/coût réels du tour (undefined si le provider ne les remonte pas). */
  usage?: Usage
  /** Traces bornées observées par le runner local, jamais inventées depuis le texte final. */
  executionEvidence?: ExecutionEvidence[]
  /** Raisonnement/thinking du modèle (blocs reasoning/thinking du stream), conservé pour observation. */
  thinking?: string
  /** Modèle RÉELLEMENT utilisé, tel que rapporté par le provider (peut différer du demandé sur reroute). */
  model?: string
  /** Images/fichiers produits pendant ce tour, normalisés indépendamment du supplier. */
  artifacts?: ChatArtifact[]
}

/**
 * Un adaptateur provider. Contrat minimal : identité, auth, envoi streamé, reprise.
 * `send` est un async-generator : il yield des `StreamChunk` puis retourne un
 * `SendResult` final (via la valeur de retour du generator).
 */
export interface ProviderAdapter {
  /** Identifiant stable, ex. 'claude' | 'codex'. */
  readonly id: string
  /** Le provider possède un vrai runner local (terminal/fichiers), pas seulement du chat. */
  readonly supportsExecution?: boolean
  /**
   * L'adaptateur REPREND réellement une session passée via `resumeSessionId`.
   *
   * À déclarer `true` UNIQUEMENT si `send` transmet l'identifiant au provider. Rendre un `sessionId`
   * ne suffit pas : `codex` rend son `thread_id` sans savoir le reprendre. L'appelant qui élide
   * l'historique en s'appuyant sur une reprise doit consulter CETTE capacité, jamais la seule
   * présence d'un `sessionId` — sinon il ampute le fil au profit d'une session qui n'existe pas.
   */
  readonly honoursSessionResume?: boolean

  /**
   * S'assure que l'adaptateur est authentifié (OAuth abonnement, PAS clé API).
   * Retourne true si prêt à servir des complétions.
   */
  auth(): Promise<boolean>
  /** Ouvre, si disponible, le flux de connexion interactif officiel du provider. */
  startLogin?(): void

  /**
   * Envoie une conversation et streame la réponse.
   * @returns un async generator qui yield des chunks et RETOURNE le SendResult final.
   */
  send(messages: Message[], opts?: SendOptions): AsyncGenerator<StreamChunk, SendResult, void>
  describePrompt?(messages: Message[], opts: SendOptions, model?: string): PromptEnvelope
}
