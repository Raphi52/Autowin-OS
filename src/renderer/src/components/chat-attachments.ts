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
async function makeThumbnail(dataUrl: string, max = 96): Promise<string | undefined> {
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

/**
 * Pieces jointes d'un message PASSE, telles qu'elles doivent traverser l'IPC.
 *
 * CAUSE RACINE mesuree le 2026-08-27 : `flatten()` (ChatView) reduisait chaque message a
 * `{ role, content }`, puis rattachait a la main les seules pieces jointes du message COURANT.
 * Le process principal ne recevait donc JAMAIS celles des tours passes — et le correctif pose en
 * aval, dans `agent-pilot`, collectait un tuyau vide. Une image jointe au tour 1 etait invisible
 * au tour 2, quoi qu'en dise le code du dessous.
 *
 * On ne renvoie que la MINIATURE, jamais le binaire d'origine, pour deux raisons :
 *  - le volume : 40 messages porteurs d'images franchiraient les gardes IPC (8 fichiers, 20 Mo par
 *    message) et alourdiraient chaque tour d'un fil ancien ;
 *  - la COHERENCE : le fil ne PERSISTE que la miniature, donc renvoyer l'original pour un fil vivant
 *    et la miniature pour un fil rehydrate ferait dependre la reponse du fait que l'app a redemarre.
 * Le nom porte la mention : une reduction ne doit jamais passer pour sa source.
 */
export function pieceJointePasseePourLeFil(piece: {
  name: string
  mimeType?: string
  size?: number
  kind?: string
  content?: string
  thumbnail?: string
}): { name: string; mimeType: string; size: number; kind: 'image'; content: string } | undefined {
  /*
   * L'ORIGINAL D'ABORD quand il est encore la.
   *
   * Mesure du 2026-08-27 : en ne faisant voyager que la miniature, le modele a lu 3 bandes sur 4 et
   * s'est trompe sur la quatriere (cyan annonce « vert fluo ») — une perte de fidelite payee pour
   * rien quand le binaire d'origine est encore en memoire du fil. La miniature reste le repli des
   * messages rehydrates du disque, ou l'original n'existe plus.
   */
  if (piece.kind === 'image' && typeof piece.content === 'string' && piece.content.length > 0) {
    return {
      name: piece.name,
      mimeType: piece.mimeType ?? 'image/png',
      size: piece.size ?? piece.content.length,
      kind: 'image',
      content: piece.content
    }
  }
  const thumbnail = piece.thumbnail
  if (typeof thumbnail !== 'string' || !thumbnail.startsWith('data:image/')) return undefined
  const virgule = thumbnail.indexOf(',')
  const content = virgule >= 0 ? thumbnail.slice(virgule + 1) : ''
  if (!content) return undefined
  const pointVirgule = thumbnail.indexOf(';')
  return {
    name: `${piece.name} (miniature)`,
    mimeType: pointVirgule > 5 ? thumbnail.slice(5, pointVirgule) : 'image/png',
    size: content.length,
    kind: 'image',
    content
  }
}
