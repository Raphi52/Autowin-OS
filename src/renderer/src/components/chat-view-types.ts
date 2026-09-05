/**
 * Types PARTAGÉS de la vue Chat, extraits de `ChatView.tsx` (levier « découpe ») SANS aucun
 * changement de forme : les mêmes déclarations, à un autre endroit. `ChatView.tsx` les ré-exporte
 * pour que les importateurs existants (`RunEntry`, `CheckpointEntry`) ne bougent pas.
 */
import type { ChatPart, HydratedAssistantMessage } from './chat-view-model'
import type { TurnRuntimeIdentity } from './subagent-thread-from-trace'
import type { ChatArtifact } from '../../../shared/artifacts'
import type { PilotEventKind } from '../../../shared/pilot-events'

export type Part = ChatPart

export interface AttachmentMeta {
  name: string
  mimeType: string
  size: number
  /** Miniature downscalée (data URL) pour les images — persistée, affichée dans le fil. */
  thumbnail?: string
  /** Original gardé uniquement dans le fil live, avant rechargement depuis le store. */
  content?: string
  /** Original durable matérialisé côté main après l’envoi. */
  artifact?: ChatArtifact
  turnId?: string
  /** L’écriture durable a échoué ; la miniature ne doit pas usurper l’original. */
  originalUnavailable?: boolean
}
export interface ChatAttachment extends AttachmentMeta {
  kind: 'text' | 'image' | 'file'
  content: string
}
export interface ComposerDraft {
  input: string
  attachments: ChatAttachment[]
  error: string | null
}
export type SendOptions = {
  keepComposerDraft?: boolean
  targetConversationId?: string
  /**
   * Reprises DÉJÀ faites après une surcharge du modèle (529) — voir shared/reprise-surcharge.ts.
   * Portée par l'option parce qu'elle doit survivre au fork : la conversation change, pas le compte.
   */
  repriseSurcharge?: number
  /** Pièces jointes IMPOSÉES (rejeu automatique) : le brouillon du composer n'est pas lu. */
  piecesJointesImposees?: ChatAttachment[]
}
export interface UserMsg {
  role: 'user'
  content: string
  attachments?: AttachmentMeta[]
  /**
   * Ce message a été ÉCRIT PENDANT un tour (orientation injectée), il ne REPOND à rien.
   *
   * Sans cette distinction, le verrou du bloc `ask` — « un message utilisateur postérieur EST la
   * réponse » — prenait toute orientation pour une réponse et fermait la question en affichant
   * « Répondu » (conv-50, 2026-09-01). Posé côté main par `enregistrerDirectiveDansLeFil`.
   */
  orientation?: boolean
}
export type AsstMsg = HydratedAssistantMessage
export type Msg = (UserMsg | AsstMsg) & { messageId?: string }

export interface PilotEvent {
  conversationId?: string
  turnId?: string
  /**
   * Même vocabulaire que le main (`src/shared/pilot-events.ts`), plus recopié ici. Cette liste avait
   * dérivé : il lui manquait `reasoning` et `prompt-call`, que le main émet — et comme la réception
   * fait `raw as PilotEvent`, le renderer les ignorait en silence au lieu de ne pas compiler.
   */
  kind: PilotEventKind
  text?: string
  streamId?: string
  actionId?: string
  iteration?: number
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
  artifact?: ChatArtifact
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number }
}

export type Conv = {
  id: string
  title: string
  provider: string
  messages?: Array<{
    role: 'user' | 'assistant'
    content: string
    ts: number
    attachments?: AttachmentMeta[]
    messageId?: string
    parentMessageId?: string
    turnId?: string
    turnConversationId?: string
    status?: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
    runtime?: TurnRuntimeIdentity
    parts?: Part[]
    error?: string
  }>
  messageCount?: number
  /**
   * Dernier message de L'UTILISATEUR, servi par la projection IPC. C'est la cle du tri « plus
   * recentes » : `updatedAt` bouge aussi sur une touche non-utilisateur (rangement, RUN.md, fork).
   */
  lastUserMessageAt?: number
  lastMessageRole?: 'user' | 'assistant'
  lastAssistantStatus?: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  /**
   * Le dernier tour pose une question a choix restee ouverte. Servi par la projection IPC
   * (`ConversationSummary.lastAssistantAsksUser`) — il etait absent de CE type, si bien que la
   * pastille `asking` ne pouvait jamais s'allumer dans la liste.
   */
  lastAssistantAsksUser?: boolean
  /**
   * Motif de l'echec du DERNIER tour, servi par la projection IPC. Il distingue, parmi toutes les
   * pastilles ROUGES, celles coupees par le mur de QUOTA — les seules qui se relancent telles
   * quelles (`estMurDeQuota`, src/shared/reprise-quota.ts).
   */
  lastAssistantError?: string
  /** Le dossier de travail qui GROUPE la conversation dans la liste. Absent → « Divers ». */
  projectPath?: string
  /** Marque une analyse Auto-Kaizen : elles vivent dans leur propre groupe, replié par défaut. */
  autoKaizen?: unknown
  updatedAt: number
}

export type RunEntry = {
  subject: string
  session: string
  path: string
  mtime: number
  summary: {
    status: string
    regime?: string
    dodTotal: number
    dodChecked: number
    journalEvents: number
    defauts: number
  }
}
export type CheckpointEntry = { id: string; runId: string; createdAt: string }

/**
 * `attachments` : une IMAGE tapee pendant un tour ne peut pas etre injectee (l'injection ne
 * transporte qu'un texte). Le message part donc en FILE avec ses pieces jointes, et le drain de
 * fin de tour les renvoie telles quelles — sans cela l'image restait dans le composer et n'etait
 * JAMAIS envoyee (constate le 2026-09-04).
 */
export type QueuedDirective = {
  id: number
  text: string
  mode?: 'btw'
  attachments?: ChatAttachment[]
}
export type DirectiveReceipt = {
  id: number
  text: string
  /**
   * `differee` : la directive est acceptee, et un run tourne. Elle n'est pas perdue et elle n'est pas
   * immediate — l'orchestrateur la draine ENTRE DEUX PHASES et l'ajoute au cadre de la suivante. On
   * ne parle pas a un sous-agent en vol : ses droits, son bureau isole et son devis sont engages, et
   * l'interrompre pour lui parler serait « interrompre ».
   *
   * Cet etat existe parce que dire « Oriente » couvrait les deux cas : mesure du 20/08, l'utilisateur
   * a oriente pendant un run et « rien ne se passe » — a l'epoque, litteralement, rien ne pouvait
   * lire sa directive.
   */
  status: 'sending' | 'sent' | 'differee' | 'failed'
  afterMessageIndex: number
  afterPartIndex: number
  afterTextOffset?: number
  /**
   * Ce texte REPOND a une question `ask`, il n'oriente rien.
   *
   * VECU le 2026-08-26 : repondre a une question pendant qu'un run tournait passait par le meme
   * chemin qu'une orientation en vol, donc la reponse s'affichait « ✓ Orienté ». L'utilisateur
   * repondait, l'ecran lui disait qu'il avait oriente. Le TRANSPORT est bien le meme (injection
   * dans le tour) ; c'est le LIBELLE qui mentait.
   */
  reponse?: boolean
}
