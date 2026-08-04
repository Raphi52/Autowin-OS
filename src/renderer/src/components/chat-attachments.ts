/** Kind d'une pièce jointe de chat, dérivé du type/nom/taille du fichier. */
export type ChatAttachmentKind = 'text' | 'image' | 'file'

/** Extensions traitées comme texte inline même sans MIME `text/*`. */
export const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'log',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'sql',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'html',
  'py',
  'cs',
  'vb'
])

export const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024

/** Forme structurelle produite par `encodeAttachment` — compatible avec `ChatAttachment` de ChatView. */
export interface EncodedChatAttachment {
  name: string
  mimeType: string
  size: number
  kind: ChatAttachmentKind
  content: string
  thumbnail?: string
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

export function fileKind(file: File): ChatAttachmentKind {
  if (file.type.startsWith('image/')) return 'image'
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (
    file.size <= MAX_INLINE_TEXT_BYTES &&
    (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension))
  )
    return 'text'
  return 'file'
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

/** Miniature downscalée (max 96px, JPEG léger) pour une image — reconnaissable + persistable. */
export async function makeThumbnail(dataUrl: string, max = 96): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const context = canvas.getContext('2d')
      if (!context) return resolve(undefined)
      context.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.72))
    }
    img.onerror = () => resolve(undefined)
    img.src = dataUrl
  })
}

export async function encodeAttachment(file: File): Promise<EncodedChatAttachment> {
  const kind = fileKind(file)
  const mimeType = file.type || 'application/octet-stream'
  const content =
    kind === 'text' ? await file.text() : bytesToBase64(new Uint8Array(await file.arrayBuffer()))
  const thumbnail =
    kind === 'image' ? await makeThumbnail(`data:${mimeType};base64,${content}`) : undefined
  return {
    name: file.name,
    mimeType,
    size: file.size,
    kind,
    content,
    ...(thumbnail && { thumbnail })
  }
}
