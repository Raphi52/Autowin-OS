/**
 * Types du bus de commandes : spécification, résultat, instantanés et événements diffusés.
 *
 * Code libre sorti de `commands.ts` tel quel (conv-1580, lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 */

import type { Message } from '../providers/types'
import type { SchemaArgument } from '../skill-node-mcp'
import type { ChatArtifact } from '../../shared/artifacts'
import type { AppDestination } from '../../shared/navigation'
import type { HypotheseDeCadrage } from '../../shared/cadrage-confiance'
import type { OrchestrationStep, OrchestrationPhase } from '../orchestrator'

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
  /**
   * Le VRAI type d'un argument de `args`, publié au modèle (`schemaEntree`, skill-node-mcp.ts). Sans
   * lui, l'argument part en texte. Mesure de conv-1370 (2026-10-31) : tout partait en `string`, y
   * compris les listes et les nombres. Clés = celles d'`args` : une autre clé n'est jamais publiée
   * (test `commands.outils-natifs.test.ts`). La commande accepte toujours AUSSI le texte, seul format
   * du chemin `<cmd>`.
   */
  argsTypes?: Record<string, SchemaArgument>
  /**
   * Présent, y compris vide : c'est LA liste des arguments facultatifs, le mot « facultatif » en tête
   * de description n'est plus lu. 20 arguments sur 11 outils étaient exigés à tort (conv-1370).
   */
  argsFacultatifs?: string[]
  annotations?: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
  /**
   * Present = la commande n'est PAS servie au chat comme outil direct du modele (`chat-mcp.ts`) ;
   * elle reste au texte `<cmd>`. La valeur est le MOTIF, rendu au modele dans le refus. L'exclusion
   * vit ici, sur la commande, pour qu'aucune seconde liste ne puisse diverger du catalogue.
   */
  horsCanalNatif?: string
  /**
   * Vrai = le modele fait deja ce geste avec ses propres outils (Read, Grep, Glob, Edit, Write). La
   * consigne du chat ne l'annonce donc plus quand les outils directs sont servis (conv-1352 : 3 appels
   * en 676 tours). La commande reste au catalogue : un `<cmd>` emis s'execute toujours.
   */
  fichierCouvertParLeModele?: boolean
}
export interface CommandResult {
  ok: boolean
  data?: unknown
  error?: string
  /** Pieces jointes ephemeres pour l'iteration modele suivante ; jamais journalisees dans le texte. */
  attachments?: NonNullable<Message['attachments']>
  /**
   * Cartes à montrer dans le FIL de l'utilisateur, JAMAIS envoyées au modèle IA (`show_video`).
   * Séparé d'`attachments`, qui part tel quel dans le prochain message du modèle.
   */
  artifacts?: ChatArtifact[]
  /**
   * Blocs de TEXTE posés dans la réponse du fil à la place de l'appel (`montrer_bloc`), jamais
   * envoyés au modèle IA : il n'en reçoit que le résumé de `data`.
   */
  blocs?: string[]
}

/** Instantané de l'état que l'agent PEUT VOIR (ce qu'il pilote). */
export interface AppSnapshot {
  tab: AppDestination
  activeConversationId?: string
  providers: string[]
  roles: Record<string, { provider: string; model?: string }>
  /**
   * Les DEUX dates sont exposées, et c'est le point : sans elles, « quelle est la dernière
   * conversation ? » n'avait aucune réponse dans cet état — seuls `id`, `title` et `category` y
   * figuraient. L'ordre du tableau (récence d'`updatedAt`) portait l'information de façon
   * implicite, ce qui invitait à la deviner puis à raconter une méthode qui n'a pas eu lieu
   * (mesuré conv-1291, 2026-08-18 : un protocole en 5 étapes décrit avec aplomb, dont aucune
   * n'était réalisable avec ces données).
   *
   * `updatedAt` = dernière fois que la conversation a été TOUCHÉE, y compris par ce qui ne vient
   * pas de l'utilisateur (delta de streaming, attache d'un RUN.md, fork).
   * `lastUserMessageAt` = dernière fois que L'UTILISATEUR y a écrit. C'est cette clé qui répond à
   * « la dernière conversation que j'ai utilisée » ; elle est absente s'il n'a rien écrit.
   */
  conversations: Array<{
    id: string
    title: string
    category: string
    updatedAt: number
    lastUserMessageAt?: number
    /**
     * Un tour de chat est-il EN VOL dans cette conversation, à l'instant de la lecture ? Présent
     * seulement quand c'est vrai — absent = au repos.
     *
     * Ajouté 2026-09-08 (conv-346). Sans ce champ, « est-ce que ça tourne encore ? » n'avait aucune
     * réponse dans cet état : les journaux `activity/` et `causal-trace/` ne s'écrivent qu'en FIN de
     * tour, donc les lire pendant un tour vivant fait conclure à sa mort. Le main le sait déjà —
     * c'est la même vérité que la sonde `os:pilotChat:active` du renderer.
     */
    tourEnCours?: boolean
  }>
  /** Les 12 runs les plus récents, PLUS tout run bloqué plus ancien lu dans la fenêtre du scan. */
  runs: Array<{ subject: string; status: string; blocked: boolean; decisionAttendue?: true }>
  /**
   * RUN.md NON LUS par le scan borné (au-delà des `LIMITE_RUNS_SNAPSHOT` plus récents) — ABSENT
   * quand rien n'a été écarté. Présent = `runs` et `runsBlocked` sont PARTIELS : un run bloqué plus
   * ancien n'y figure pas. Ajouté le 2026-09-25 (conv-861) : ce compte était calculé puis jeté.
   */
  runsNonExamines?: number
  /**
   * Worktrees ENCORE connus d'Autowin (un worktree nettoyé/fermé n'y figure PLUS) — permet de répondre
   * « le workspace s'est-il fermé ? » par une VÉRITÉ LIVE au lieu d'un « non vérifié » : absent d'ici
   * pour une conversation = nettoyé/fermé. Ajouté 2026-08-14 (get_state ne portait que le statut des runs,
   * jamais le cycle de vie disque du worktree — d'où le « non vérifiable avec get_state »).
   */
  worktrees: Array<{ workspacePath: string; state: string; conversationId?: string }>
  /**
   * LES TRAVAUX QUI ATTENDENT — des runs finis dont le code n'a jamais rejoint la base.
   *
   * DEFAUT VECU le 2026-08-26 (run `ef845009a251-1`) : l'utilisateur demande « fusionne », l'agent
   * repond « rien a fusionner », et le commit dort dans son propre bureau. Le recensement existait
   * (`os.travauxNonPublies`) et son IPC servait le renderer -- mais `get_state`, le seul etat que
   * l'agent sache lire, ne le portait pas. Reparer le recensement sans l'exposer ICI laisse le
   * defaut intact a l'endroit exact ou il se produit.
   *
   * `fichiers` est ce qui rend l'entree reconnaissable : un `agentId` seul ne dit rien a personne.
   */
  travauxNonPublies: Array<{ agentId: string; date: string; fichiers: string[] }>
  /**
   * Coût cumulé RÉELLEMENT tarifé. C'est un PLANCHER, pas un total : les tours sans `costUsd`
   * comptent 0. Les deux champs suivants disent de combien ce plancher est en dessous du réel —
   * sans eux, `budgetUsd` se lit comme un total complet et ment (sur les données réelles,
   * la majorité des tours de `cost.jsonl` n'est pas tarifée).
   */
  budgetUsd: number
  budgetUnpricedTurns: number
  budgetIsPartial: boolean
}

/**
 * Projection MINIMALE de l'état, injectée dans le PROMPT de l'agent à chaque tour
 * (≠ `AppSnapshot`, destiné à l'UI complète via `os:appState`). On évite d'injecter les
 * ~60 conversations et les runs non bloqués : c'était l'essentiel du poids. L'agent liste
 * les conversations à la demande via une commande, il n'en a pas besoin inline.
 *
 * fix-ok: conv-253 tour bdfe38d3-5ba5-4693-bad2-f70b39bc845e — raisonnement mesuré « The background
 * watcher process ended with the session » : l'état poussé au modèle taisait la copie d'Autowin
 * (champ `tachesDeFondSuiviesParAutowin`) ; 4 édits = import + champ + fonction + branchement ;
 * commands.taches-de-fond-suivies.test.ts rouge puis vert. Posé ICI, hors du bloc de 2eb85687,
 * pour que ce commit s'annule seul d'un `git revert`.
 */
export interface PromptSnapshot {
  tab: AppDestination
  activeConversationId?: string
  providers: string[]
  runsBlocked: Array<{ subject: string; status: string; decisionAttendue?: true }>
  /**
   * RUN.md NON EXAMINÉS pour `runsBlocked` — ABSENT quand le scan a tout lu. Présent, il dit que
   * `runsBlocked` ne couvre que les runs les plus récents : une liste vide n'y prouve PAS l'absence de
   * run bloqué (conv-861, 2026-09-25).
   */
  runsNonExamines?: number
  conversationsCount: number
  /**
   * Les commandes `/` REELLEMENT invocables, lues sur disque a chaque tour.
   *
   * Defaut vecu le 2026-08-28 : `/look` s'affichait dans la palette, etait routee comme commande
   * explicite et son SKILL.md etait injecte — mais l'agent du chat ignorait jusqu'a son existence
   * tant que l'utilisateur ne l'avait pas tapee, et repondait donc « cette skill n'existe pas ».
   * Seuls les IDENTIFIANTS voyagent ici : le corps d'une skill reste paye a l'invocation.
   */
  skillsDisponibles?: string[]
  /**
   * DU TRAVAIL NON FUSIONNE, et la consigne pour le trier — ABSENT quand il n'y en a pas.
   *
   * Le recensement repare le 2026-08-26 rend ces travaux VISIBLES dans `get_state`. Mais voir n'est
   * pas agir : le defaut d'origine (« rien a fusionner » repondu alors que le commit existait)
   * venait d'un agent sans procedure, pas d'un agent mal informe.
   *
   * La consigne vit donc ICI, dans le snapshot serialise a CHAQUE tour — et non dans une regle
   * permanente du prompt, qui se dilue quand elle est vraie une fois sur cent. Presente seulement
   * quand du travail attend reellement : zero bruit le reste du temps.
   */
  travauxNonFusionnes?: {
    compte: number
    /** Nomme le skill a invoquer ; une consigne qui decrit un devoir sans outil n'est pas suivie. */
    consigne: string
    /** De quoi reconnaitre les travaux sans relancer le recensement. */
    apercu: Array<{ agentId: string; date: string; fichiers: string[] }>
  }
  /**
   * Commandes de fond qu'Autowin a relancées hors du tour et qui tournent encore. Le CLI repris les
   * dit « stopped » : c'est SA copie. Sans ce champ, le modèle croyait sa surveillance morte et en
   * relançait une seconde (conv-253, tour bdfe38d3-5ba5-4693-bad2-f70b39bc845e). Absent quand rien
   * ne tourne.
   */
  tachesDeFondSuiviesParAutowin?: {
    consigne: string
    taches: Array<{ conversationId: string; tache: string; commande: string; depuis: string }>
  }
}

export type AppEvent =
  | { type: 'navigate'; tab: string; origin?: string }
  | { type: 'refresh'; scope: string; convId?: string }
  | { type: 'toast'; text: string; noticeId?: number }
  // Clic sur la notification de fin de tour (conv-1038) : ouvrir CE fil, pas celui affiché.
  | { type: 'open-conversation'; convId: string }
  // Bouton de suite de la même notification (conv-1038) : envoyer CETTE suite dans CE fil.
  | { type: 'suite-depuis-notification'; convId: string; texte: string }
  // Orchestration LIVE (statut temps réel + fil des sous-agents), diffusée par étape.
  | { type: 'orchestrate-start'; convId?: string; runPath?: string; task: string }
  | { type: 'orchestrate-phase'; convId?: string; runPath?: string; phase: OrchestrationPhase }
  | {
      type: 'orchestrate-delta'
      convId?: string
      runPath?: string
      deltaStep: 'exec' | 'judge'
      delta: string
      /**
       * Activité courante de la phase, hors livrable : « Bash en cours — 2 min 30 s ».
       *
       * Champ distinct de `delta` : le texte est la réponse et finit persisté, la note dit
       * seulement que le sous-agent travaille encore. Les mêler ferait entrer un battement
       * d'outil dans le livrable.
       */
      note?: string
      /**
       * Fragment du RAISONNEMENT du sous-agent, tel que le fournisseur le diffuse (quelques mots).
       *
       * Il voyageait dans `note` et devenait la ligne de vie du bloc Orchestration : des bouts de
       * phrase (« and now 1/2 could ») qui s'ecrasaient toutes les secondes et qu'on ne retrouvait
       * nulle part en depliant le bloc (conv-918, 2026-10-13). Champ a part : le fil l'ACCUMULE
       * sous la phase qui le produit, la ligne de vie ne garde que ce que l'agent FAIT.
       */
      reasoning?: string
      /** Phase en cours quand ce raisonnement a ete emis, pour le ranger sous la bonne ligne. */
      reasoningPhase?: string
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
  /**
   * ORIENTATIONS ARRIVEES TROP TARD — rendues a l'ecran au lieu d'etre jetees.
   *
   * Une directive acceptee pendant un tour n'est lue qu'aux points d'iteration de la boucle pilote.
   * Si le tour se termine avant d'en atteindre un, elle restait dans `pendingDirectives` et le
   * `finally` la SUPPRIMAIT en silence : le texte s'affichait dans le fil, mais le modele ne l'avait
   * jamais vu — « quand j'oriente ca oublie parfois » (2026-09-11). Le tour les renvoie desormais a
   * l'ecran, qui les remet en file : elles repartent comme un tour normal, et le fil le dit.
   */
  | { type: 'directives-orphelines'; convId: string; textes: string[] }
  /**
   * Le CADRAGE remonte les affirmations sur lesquelles il repose SANS les avoir verifiees, au moment
   * ou la phase se termine — pas a la fin du run. Le run ne s'arrete pas : ce qui change, c'est que
   * l'hypothese devient contestable AVANT que tout soit construit dessus.
   */
  | {
      type: 'orchestrate-hypotheses'
      convId: string
      runPath?: string
      hypotheses: HypotheseDeCadrage[]
    }
  | { type: 'causal-trace-updated'; convId: string }

export const DEFAULT_COMMAND_ANNOTATIONS: NonNullable<CommandSpec['annotations']> = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
}
