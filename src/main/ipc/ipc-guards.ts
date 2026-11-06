const MAX_IPC_STRING = 2_000_000 // ~2 Mo

export function guardString(s: unknown, name: string): string {
  if (typeof s !== 'string') throw new Error(`IPC ${name}: string attendue`)
  if (s.length > MAX_IPC_STRING) throw new Error(`IPC ${name}: payload trop volumineux`)
  return s
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

/**
 * Un profil recu du renderer, valide A LA FRONTIERE avant toute persistance.
 *
 * LE DEFAUT, mesure le 2026-08-24 : `ProfileStore.save` ne valide RIEN et ecrit la charge utile
 * telle quelle. Pire, il compose `[profile, ...list().filter(i => i.id !== profile.id)]` -- avec un
 * `id` absent, l'objet douteux atterrit EN TETE de liste. Le lecteur etant tolerant (`list()` rend
 * `[]` sur erreur), le degat n'est pas un plantage mais de la donnee pourrie, silencieuse.
 *
 * Meme classe que l'incident du meme jour sur les conversations : un ecrivain qui accepte une forme
 * que rien ne verifie. La difference est que la-bas le lecteur etait STRICT, donc l'app est devenue
 * inbootable ; ici il est tolerant, donc personne ne s'en apercoit.
 *
 * On ne valide QUE les champs que l'appelant controle reellement : `topology`, `roles` et
 * `updatedAt` sont ecrases par le handler juste apres, les valider serait du theatre.
 */
export function guardProfile(value: unknown): {
  schema: 'autowin.profile/v1'
  id: string
  name: string
  description?: string
} {
  if (!value || typeof value !== 'object') throw new Error('IPC profile: objet attendu')
  const candidat = value as Record<string, unknown>
  if (candidat.schema !== 'autowin.profile/v1') throw new Error('IPC profile: schema inattendu')
  const id = guardString(candidat.id, 'profile.id')
  if (!id.trim()) throw new Error('IPC profile.id: identifiant vide')
  const name = guardString(candidat.name, 'profile.name')
  const description =
    candidat.description === undefined
      ? undefined
      : guardString(candidat.description, 'profile.description')
  return { schema: 'autowin.profile/v1', id, name, ...(description ? { description } : {}) }
}

/** `string | null` tel que le renderer l'envoie pour « aucune conversation active ». */
export function guardStringOrNull(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null
  return guardString(value, name)
}
