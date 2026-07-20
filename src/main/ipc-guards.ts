import type { Message } from './providers/types'

const MAX_IPC_STRING = 2_000_000 // ~2 Mo

export function guardString(s: unknown, name: string): string {
  if (typeof s !== 'string') throw new Error(`IPC ${name}: string attendue`)
  if (s.length > MAX_IPC_STRING) throw new Error(`IPC ${name}: payload trop volumineux`)
  return s
}

export function guardMessages(m: unknown): Message[] {
  if (!Array.isArray(m)) throw new Error('IPC messages: tableau attendu')
  if (m.length > 1000) throw new Error('IPC messages: trop de messages')
  for (const x of m) guardString((x as Message)?.content, 'message.content')
  return m as Message[]
}

export function guardBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`IPC ${name}: boolean attendu`)
  return value
}

export interface GuardedAttachment {
  name: string
  mimeType: string
  size: number
  kind: 'text' | 'image' | 'file'
  content: string
  thumbnail?: string
}

const MAX_ATTACHMENTS = 8
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024
const MAX_TEXT_CHARS = 2_000_000
const MAX_BASE64_CHARS = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4
const MAX_THUMBNAIL_CHARS = 300_000

export function guardAttachments(value: unknown): GuardedAttachment[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('IPC attachments: tableau attendu')
  if (value.length > MAX_ATTACHMENTS) throw new Error('IPC attachments: trop de fichiers')

  let totalBytes = 0
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`IPC attachment ${index}: objet attendu`)
    const candidate = raw as Partial<GuardedAttachment>
    if (typeof candidate.name !== 'string' || !candidate.name || candidate.name.length > 255)
      throw new Error(`IPC attachment ${index}: nom invalide`)
    if (typeof candidate.mimeType !== 'string' || candidate.mimeType.length > 200)
      throw new Error(`IPC attachment ${index}: type invalide`)
    if (!['text', 'image', 'file'].includes(candidate.kind ?? ''))
      throw new Error(`IPC attachment ${index}: nature invalide`)
    if (
      typeof candidate.size !== 'number' ||
      !Number.isSafeInteger(candidate.size) ||
      candidate.size < 0 ||
      candidate.size > MAX_ATTACHMENT_BYTES
    )
      throw new Error(`IPC attachment ${index}: fichier trop volumineux`)
    if (typeof candidate.content !== 'string')
      throw new Error(`IPC attachment ${index}: contenu invalide`)
    if (candidate.kind === 'text' && candidate.content.length > MAX_TEXT_CHARS)
      throw new Error(`IPC attachment ${index}: texte trop volumineux`)
    if (candidate.kind !== 'text' && candidate.content.length > MAX_BASE64_CHARS)
      throw new Error(`IPC attachment ${index}: contenu trop volumineux`)

    // Miniature optionnelle : on ne garde qu'une data URL image bornée, sinon on l'écarte.
    if (
      typeof candidate.thumbnail !== 'string' ||
      !candidate.thumbnail.startsWith('data:image/') ||
      candidate.thumbnail.length > MAX_THUMBNAIL_CHARS
    ) {
      delete candidate.thumbnail
    }

    totalBytes += candidate.size
    if (totalBytes > MAX_ATTACHMENTS_BYTES)
      throw new Error('IPC attachments: volume total trop volumineux')
    return candidate as GuardedAttachment
  })
}
