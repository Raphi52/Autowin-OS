import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { CHAT_MEDIA_SCHEME, parseChatMediaUrl, type ChatMediaIdentite } from '../shared/chat-media'
import { artifactKindFor, artifactMimeType } from './providers/artifacts'
import { revealableConversationArtifactPath } from './store/chat-artifact-store'
import type { Conversation } from './store/conversations'

/**
 * LECTURE D'UNE VIDÉO DU FIL DEPUIS LE DISQUE, PAR MORCEAUX (kaizen conv-260, 2026-10-11).
 *
 * Cause : la seule voie vers le lecteur était une copie base64 plafonnée à 16 Mo
 * (`readConversationArtifact`). La pub du tour 41ab69ad-0ff8-4a45-8ecd-efb9be30e4a2 (74,6 Mo,
 * 1080p 60 i/s) ne pouvait donc s'ouvrir dans AUCUN lecteur du fil. Une vidéo se lit ici comme le
 * ferait un serveur web : le navigateur demande des plages d'octets (`Range`) et peut sauter à
 * n'importe quel instant sans charger le fichier entier en mémoire.
 *
 * Mêmes gardes que l'aperçu : la fenêtre ne donne qu'un triplet d'identité, le fichier doit être
 * DANS le stockage du fil (`revealableConversationArtifactPath`), et seuls la vidéo et le son
 * passent — une image ou un PDF garde son chemin habituel.
 */

export interface MediaResolu {
  chemin: string
  mimeType: string
}

export type ResoudreMedia = (identite: ChatMediaIdentite) => MediaResolu | undefined

export type PlageMedia = { statut: 200 | 206; debut: number; fin: number } | { statut: 416 }

/**
 * Plage d'octets demandée, selon RFC 9110 §14 : une seule plage est servie ; une en-tête illisible
 * est ignorée (fichier entier) ; une plage qui commence après la fin rend 416.
 */
export function plageMedia(entete: string | null | undefined, taille: number): PlageMedia {
  const entier: PlageMedia = { statut: 200, debut: 0, fin: Math.max(0, taille - 1) }
  if (!entete) return entier
  const correspondance = /^bytes=(\d*)-(\d*)$/i.exec(entete.split(',')[0].trim())
  if (!correspondance) return entier
  const [, brutDebut, brutFin] = correspondance
  if (brutDebut === '' && brutFin === '') return entier
  if (taille === 0) return { statut: 416 }
  if (brutDebut === '') {
    // `bytes=-N` : les N derniers octets.
    const suffixe = Number(brutFin)
    if (suffixe === 0) return { statut: 416 }
    return { statut: 206, debut: Math.max(0, taille - suffixe), fin: taille - 1 }
  }
  const debut = Number(brutDebut)
  if (debut >= taille) return { statut: 416 }
  const fin = brutFin === '' ? taille - 1 : Math.min(Number(brutFin), taille - 1)
  if (fin < debut) return entier
  return { statut: 206, debut, fin }
}

function entetesCommunes(mimeType: string): Record<string, string> {
  return {
    'Accept-Ranges': 'bytes',
    'Content-Type': mimeType,
    // Le lecteur du fil peut copier une image de la vidéo dans un canevas : sans cette en-tête,
    // le canevas serait « contaminé » et la copie refusée par Chromium.
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  }
}

export function reponseMedia(
  media: MediaResolu,
  entete: string | null | undefined,
  methode = 'GET'
): Response {
  const taille = statSync(media.chemin).size
  const plage = plageMedia(entete, taille)
  if (plage.statut === 416)
    return new Response(null, {
      status: 416,
      headers: { ...entetesCommunes(media.mimeType), 'Content-Range': `bytes */${taille}` }
    })
  const longueur = taille === 0 ? 0 : plage.fin - plage.debut + 1
  const entetes: Record<string, string> = {
    ...entetesCommunes(media.mimeType),
    'Content-Length': String(longueur)
  }
  if (plage.statut === 206) entetes['Content-Range'] = `bytes ${plage.debut}-${plage.fin}/${taille}`
  const corps =
    methode === 'HEAD' || longueur === 0
      ? null
      : (Readable.toWeb(
          createReadStream(media.chemin, { start: plage.debut, end: plage.fin })
        ) as unknown as ReadableStream<Uint8Array>)
  return new Response(corps, { status: plage.statut, headers: entetes })
}

export function servirMediaDuFil(requete: Request, resoudre: ResoudreMedia): Response {
  if (requete.method !== 'GET' && requete.method !== 'HEAD')
    return new Response(null, { status: 405 })
  const identite = parseChatMediaUrl(requete.url)
  if (!identite) return new Response('Adresse de média invalide', { status: 400 })
  let media: MediaResolu | undefined
  try {
    media = resoudre(identite)
  } catch {
    media = undefined
  }
  if (!media) return new Response('Média introuvable dans le stockage du fil', { status: 404 })
  return reponseMedia(media, requete.headers.get('range'), requete.method)
}

/** Résout un triplet d'identité en vidéo/son CONSERVÉ dans le stockage du fil, sinon rien. */
export function resoudreMediaConserve(
  conversation: Conversation | undefined,
  identite: ChatMediaIdentite,
  base?: string
): MediaResolu | undefined {
  const chemin = revealableConversationArtifactPath(
    conversation,
    identite.turnId,
    identite.artifactId,
    base
  )
  if (!chemin) return undefined
  const genre = artifactKindFor(chemin)
  if (genre !== 'video' && genre !== 'audio') return undefined
  return { chemin, mimeType: artifactMimeType(chemin) }
}

/**
 * À appeler dans le CORPS du module principal, avant `app.whenReady` : Electron n'accepte de
 * déclarer un schéma privilégié qu'avant l'évènement `ready`. `stream` autorise la lecture par
 * plages, `secure`/`standard` en font une origine sûre que la politique de contenu peut citer.
 */
export function declarerSchemaMediaDuFil(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CHAT_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ])
}

/** À appeler APRÈS `app.whenReady`. */
export function brancherMediaDuFil(resoudre: ResoudreMedia): void {
  protocol.handle(CHAT_MEDIA_SCHEME, (requete) => servirMediaDuFil(requete, resoudre))
}
