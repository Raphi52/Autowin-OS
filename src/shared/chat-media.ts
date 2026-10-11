/**
 * ADRESSE D'UN MÉDIA DU FIL LU DEPUIS LE DISQUE (kaizen conv-260, 2026-10-11).
 *
 * Cause mesurée : une vidéo du fil n'avait qu'un seul chemin vers le lecteur, une copie encodée en
 * base64 renvoyée par `os:chatArtifact:read` et plafonnée à 16 Mo (`chat-artifact-store.ts`,
 * `MAX_ARTIFACT_PREVIEW_BYTES`). La pub livrée au tour 41ab69ad-0ff8-4a45-8ecd-efb9be30e4a2 pèse
 * 74,6 Mo : aucun lecteur n'aurait pu l'ouvrir, la carte aurait affiché « Aperçu limité à 16 Mo ».
 *
 * Désormais une vidéo ou un son CONSERVÉ dans le stockage du fil se lit par cette adresse, servie
 * par morceaux (requêtes `Range`) par `src/main/chat-media-protocol.ts`. La fenêtre ne donne
 * toujours AUCUN chemin : seulement le triplet conversation · tour · artefact, que le processus
 * principal résout lui-même dans le stockage du fil.
 */
export const CHAT_MEDIA_SCHEME = 'autowin-media'

const HOTE = 'artefact'

export interface ChatMediaIdentite {
  conversationId: string
  turnId: string
  artifactId: string
}

export function chatMediaUrl(conversationId: string, turnId: string, artifactId: string): string {
  return `${CHAT_MEDIA_SCHEME}://${HOTE}/${[conversationId, turnId, artifactId]
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

export function isChatMediaUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith(`${CHAT_MEDIA_SCHEME}://${HOTE}/`)
}

export function parseChatMediaUrl(url: string): ChatMediaIdentite | undefined {
  if (!isChatMediaUrl(url)) return undefined
  let chemin: string
  try {
    chemin = new URL(url).pathname
  } catch {
    return undefined
  }
  const segments = chemin.split('/').filter((segment) => segment !== '')
  if (segments.length !== 3) return undefined
  try {
    const [conversationId, turnId, artifactId] = segments.map((segment) =>
      decodeURIComponent(segment)
    )
    if (!conversationId || !turnId || !artifactId) return undefined
    return { conversationId, turnId, artifactId }
  } catch {
    return undefined
  }
}
