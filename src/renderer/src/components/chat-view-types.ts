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
export type SendOptions = { keepComposerDraft?: boolean; targetConversationId?: string }
export interface UserMsg {
  role: 'user'
  content: string
  attachments?: AttachmentMeta[]
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

export type QueuedDirective = { id: number; text: string; mode?: 'btw' }
export type DirectiveReceipt = {
  id: number
  text: string
  status: 'sending' | 'sent' | 'failed'
  afterMessageIndex: number
  afterPartIndex: number
  afterTextOffset?: number
}
