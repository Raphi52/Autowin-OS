import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ArtifactEncoding, ChatArtifact } from '../../shared/artifacts'
import type { Conversation } from './conversations'
import { ensureAutowinAppData } from '../app-data'

const MAX_PERSISTED_ARTIFACT_BYTES = 256 * 1024 * 1024
export const MAX_ARTIFACT_PREVIEW_BYTES = 16 * 1024 * 1024
export const MAX_CHAT_PREVIEW_BYTES = 64 * 1024 * 1024

function safeSegment(value: string, fallback: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '')
  const readable = (safe || fallback).slice(0, 80)
  const identity = createHash('sha256').update(value).digest('hex').slice(0, 16)
  return `${readable}-${identity}`
}

export function chatArtifactRoot(base = ensureAutowinAppData()): string {
  return join(base, 'chat-artifacts')
}

function storedArtifactPath(
  artifact: ChatArtifact,
  conversationId: string,
  turnId: string,
  base?: string
): string {
  const extension = extname(artifact.name).slice(0, 16)
  const fileName = `${safeSegment(artifact.id, 'artifact')}${extension}`
  return join(
    chatArtifactRoot(base),
    safeSegment(conversationId, 'conversation'),
    safeSegment(turnId, 'turn'),
    fileName
  )
}

function decodedContent(artifact: ChatArtifact): Buffer | undefined {
  if (artifact.content === undefined) return undefined
  return Buffer.from(
    artifact.content,
    artifact.encoding === 'base64' ? 'base64' : ('utf8' satisfies BufferEncoding)
  )
}

/**
 * Copie immédiatement le résultat hors du worktree/temp supplier.
 * La conversation ne conserve ensuite qu'un chemin appartenant au stockage Autowin.
 */
export function materializeChatArtifact(
  artifact: ChatArtifact,
  conversationId: string,
  turnId: string,
  base?: string
): ChatArtifact {
  const inline = decodedContent(artifact)
  let sourcePath: string | undefined
  let size = inline?.byteLength ?? artifact.size

  if (!inline && artifact.path && existsSync(artifact.path)) {
    const sourceStats = statSync(artifact.path)
    if (!sourceStats.isFile()) throw new Error('Artefact refusé : la source n’est pas un fichier')
    size = sourceStats.size
    sourcePath = realpathSync(artifact.path)
  }
  if (!inline && !sourcePath) return artifact
  if (size > MAX_PERSISTED_ARTIFACT_BYTES)
    throw new Error('Artefact refusé : fichier supérieur à 256 Mo')

  const destination = storedArtifactPath(artifact, conversationId, turnId, base)
  mkdirSync(resolve(destination, '..'), { recursive: true })
  if (inline) writeFileSync(destination, inline)
  else copyFileSync(sourcePath!, destination)

  return {
    ...artifact,
    name: basename(artifact.name),
    size,
    path: destination,
    content: undefined,
    encoding: undefined,
    source: {
      ...artifact.source,
      originalPath: artifact.source.originalPath ?? artifact.path
    }
  }
}

export function materializeUserImageArtifact(
  attachment: { name: string; mimeType: string; size: number; content: string },
  conversationId: string,
  turnId: string,
  base?: string
): ChatArtifact {
  const attachmentHash = createHash('sha256')
    .update(Buffer.from(attachment.content, 'base64'))
    .update('\0')
    .update(attachment.name)
    .update('\0')
    .update(attachment.mimeType)
    .digest('hex')
    .slice(0, 24)
  return materializeChatArtifact(
    {
      id: `user-image-${attachmentHash}`,
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: 'image',
      size: attachment.size,
      createdAt: Date.now(),
      encoding: 'base64',
      content: attachment.content,
      source: { provider: 'user' }
    },
    conversationId,
    turnId,
    base
  )
}

export interface ChatArtifactReadResult {
  ok: boolean
  artifact?: ChatArtifact
  encoding?: ArtifactEncoding
  content?: string
  error?: string
}

/**
 * Budget cumulé des octets envoyés au renderer. Une même carte relue n'est pas refacturée,
 * mais une conversation ne peut pas charger une collection entière de gros fichiers en parallèle.
 */
export class ChatArtifactPreviewBudget {
  private readonly scopes = new Map<string, { total: number; artifacts: Map<string, number> }>()

  constructor(private readonly maxBytes = MAX_CHAT_PREVIEW_BYTES) {}

  remaining(scope: string, artifactId: string): number {
    const current = this.scopes.get(scope)
    if (current?.artifacts.has(artifactId)) return MAX_ARTIFACT_PREVIEW_BYTES
    return Math.max(0, this.maxBytes - (current?.total ?? 0))
  }

  reserve(scope: string, artifactId: string, bytes: number): boolean {
    const current = this.scopes.get(scope) ?? { total: 0, artifacts: new Map<string, number>() }
    if (current.artifacts.has(artifactId)) return true
    if (bytes < 0 || current.total + bytes > this.maxBytes) return false
    current.artifacts.set(artifactId, bytes)
    current.total += bytes
    this.scopes.set(scope, current)
    return true
  }

  clearRenderer(rendererId: number): void {
    const prefix = `${rendererId}:`
    for (const scope of this.scopes.keys()) {
      if (scope.startsWith(prefix)) this.scopes.delete(scope)
    }
  }
}

export function findConversationArtifact(
  conversation: Conversation | undefined,
  turnId: string,
  artifactId: string
): ChatArtifact | undefined {
  if (!conversation) return undefined
  for (const candidate of conversation.messages) {
    const attachment = candidate.attachments?.find(
      (item) => item.turnId === turnId && item.artifact?.id === artifactId
    )
    if (attachment?.artifact) return attachment.artifact
  }
  const message = conversation.messages.find(
    (candidate) => candidate.role === 'assistant' && candidate.turnId === turnId
  )
  const part = message?.parts?.find(
    (candidate) => candidate.kind === 'artifact' && candidate.artifact.id === artifactId
  )
  return part?.kind === 'artifact' ? part.artifact : undefined
}

function isStoredArtifactPath(path: string, base?: string): boolean {
  const root = resolve(chatArtifactRoot(base))
  const candidate = realpathSync(path)
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function readConversationArtifact(
  conversation: Conversation | undefined,
  turnId: string,
  artifactId: string,
  base?: string,
  maxPreviewBytes = MAX_ARTIFACT_PREVIEW_BYTES
): ChatArtifactReadResult {
  const artifact = findConversationArtifact(conversation, turnId, artifactId)
  if (!artifact) return { ok: false, error: 'Artefact inconnu pour cette conversation' }
  if (artifact.content !== undefined) {
    const inlineBytes = Buffer.byteLength(
      artifact.content,
      artifact.encoding === 'base64' ? 'base64' : 'utf8'
    )
    if (inlineBytes > Math.min(MAX_ARTIFACT_PREVIEW_BYTES, maxPreviewBytes))
      return {
        ok: false,
        artifact,
        error:
          maxPreviewBytes < MAX_ARTIFACT_PREVIEW_BYTES
            ? 'Budget cumulé des aperçus atteint'
            : 'Aperçu limité à 16 Mo'
      }
    return {
      ok: true,
      artifact: { ...artifact, size: inlineBytes },
      encoding: artifact.encoding ?? 'utf8',
      content: artifact.content
    }
  }
  if (!artifact.path || !existsSync(artifact.path))
    return { ok: false, artifact, error: 'Fichier d’artefact introuvable' }
  try {
    if (!isStoredArtifactPath(artifact.path, base))
      return { ok: false, artifact, error: 'Chemin d’artefact non autorisé' }
    const stats = statSync(artifact.path)
    if (!stats.isFile()) return { ok: false, artifact, error: 'Artefact non lisible' }
    if (stats.size > Math.min(MAX_ARTIFACT_PREVIEW_BYTES, maxPreviewBytes))
      return {
        ok: false,
        artifact,
        error:
          maxPreviewBytes < MAX_ARTIFACT_PREVIEW_BYTES
            ? 'Budget cumulé des aperçus atteint'
            : 'Aperçu limité à 16 Mo'
      }
    const binary = readFileSync(artifact.path)
    const encoding: ArtifactEncoding =
      artifact.kind === 'markdown' ||
      artifact.kind === 'text' ||
      artifact.kind === 'code' ||
      artifact.kind === 'diff' ||
      artifact.kind === 'structured-data' ||
      artifact.kind === 'table' ||
      artifact.kind === 'diagram' ||
      artifact.kind === 'notebook' ||
      artifact.kind === 'web'
        ? 'utf8'
        : 'base64'
    return {
      ok: true,
      artifact: { ...artifact, size: stats.size },
      encoding,
      content: binary.toString(encoding)
    }
  } catch {
    return { ok: false, artifact, error: 'Lecture de l’artefact impossible' }
  }
}

export function revealableConversationArtifactPath(
  conversation: Conversation | undefined,
  turnId: string,
  artifactId: string,
  base?: string
): string | undefined {
  const artifact = findConversationArtifact(conversation, turnId, artifactId)
  if (!artifact?.path || !existsSync(artifact.path)) return undefined
  try {
    return isStoredArtifactPath(artifact.path, base) ? artifact.path : undefined
  } catch {
    return undefined
  }
}

export function removeConversationArtifacts(conversationId: string, base?: string): void {
  const root = resolve(chatArtifactRoot(base))
  const target = resolve(root, safeSegment(conversationId, 'conversation'))
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return
  rmSync(target, { recursive: true, force: true })
}

/** Plafond du binaire rechargé pour le modèle : au-delà, la miniature reste le bon compromis. */
export const MAX_PIECE_JOINTE_RECHARGEE_BYTES = 12 * 1024 * 1024

/**
 * Recharge le binaire ORIGINAL d'une pièce jointe image depuis le store d'artefacts.
 *
 * Le binaire est déjà persisté à l'envoi (`materializeUserImageArtifact`), mais n'était JAMAIS relu :
 * une conversation rouverte après redémarrage ne portait plus que la vignette, et le modèle lisait
 * une image dégradée (mesuré le 2026-08-27 : 3 bandes de couleur sur 4, la quatrième mal nommée).
 * Cette fonction est le chaînon manquant, côté process principal — le renderer n'a jamais le binaire.
 *
 * Fail-open par construction : tout échec rend `undefined`, jamais une exception. Un artefact effacé,
 * un disque illisible ou un chemin hors du store laissent l'appelant retomber sur la vignette ; faire
 * échouer un tour de conversation pour une image d'un vieux message serait une régression bien pire.
 */
export function rechargerContenuPieceJointe(
  attachment: { mimeType?: string; artifact?: ChatArtifact; originalUnavailable?: boolean },
  base?: string,
  maxBytes = MAX_PIECE_JOINTE_RECHARGEE_BYTES
): { content: string; mimeType: string } | undefined {
  const artifact = attachment.artifact
  if (attachment.originalUnavailable || !artifact) return undefined
  const mimeType = artifact.mimeType || attachment.mimeType || 'image/png'
  // Contenu encore inline : rien à lire sur disque.
  if (artifact.content !== undefined && artifact.encoding === 'base64')
    return Buffer.byteLength(artifact.content, 'base64') <= maxBytes
      ? { content: artifact.content, mimeType }
      : undefined
  if (!artifact.path) return undefined
  try {
    if (!existsSync(artifact.path)) return undefined
    // Le chemin doit APPARTENIR au store : sans ce controle, une entree de conversation forgee
    // ferait lire n'importe quel fichier du disque et l'enverrait au provider.
    if (!isStoredArtifactPath(artifact.path, base)) return undefined
    const stats = statSync(artifact.path)
    if (!stats.isFile() || stats.size === 0 || stats.size > maxBytes) return undefined
    return { content: readFileSync(artifact.path).toString('base64'), mimeType }
  } catch {
    return undefined
  }
}
