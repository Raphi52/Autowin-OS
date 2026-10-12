import { statSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import type { ChatArtifact } from '../shared/artifacts'
import { artifactKindFor } from './providers/artifacts'
import { preparerVideoAMontrer, type VideoAMontrer } from './show-video-command'

/**
 * LA VIDÉO LIVRÉE PENDANT LE TOUR ARRIVE DANS LE LECTEUR DU FIL (conv-253, 2026-10-11).
 *
 * Cause : une carte du fil naît d'un bloc image d'un outil natif (`claude.ts`) — une image LUE
 * arrive donc seule — ou de `show_video`, que l'agent doit PENSER à appeler. Constat conv-260
 * (~22:10) : l'agent rend une pub par ffmpeg, écrit son chemin, et l'utilisateur doit réclamer
 * « tu dois me la montrer dans un lecteur ». Le tour lui-même sait la montrer : la réponse NOMME
 * le fichier, et le disque dit s'il vient d'être écrit.
 *
 * Pertinent = cité dans la réponse ET modifié depuis le début du tour. Une vidéo ancienne
 * simplement nommée (« la v1 est restée à côté ») ne déclenche rien. Le chemin d'une commande
 * `<cmd>` n'est pas lu : `show_video` en fait déjà sa carte. Même filtre que `show_video`
 * (dossier du tour, taille, ffprobe) : un refus ne montre rien et ne fait pas échouer le tour.
 */

/** Au-delà, une réponse qui énumère des rendus noierait le fil sous les lecteurs. */
export const MAX_VIDEOS_AUTO_PAR_REPONSE = 3

/** Tolérance d'horloge entre le début du tour et la date d'écriture du fichier. */
const TOLERANCE_MS = 2_000

/** Clé d'identité d'un fichier : chemin résolu, insensible à la casse sous Windows. */
export function cleDeVideo(chemin: string): string {
  const absolu = resolve(chemin)
  return process.platform === 'win32' ? absolu.toLowerCase() : absolu
}

/** Chemins de vidéo (.mp4, .webm, .mov…) cités dans le texte parlé, dans l'ordre, sans doublon. */
export function cheminsVideoCites(texte: string): string[] {
  const parle = texte.replace(/<cmd>[\s\S]*?<\/cmd>/g, ' ').replace(/\\\\/g, '\\')
  const vus = new Set<string>()
  const chemins: string[] = []
  for (const brut of parle.split(/[\s`'"*<>|()[\]{},;]+/)) {
    let jeton = brut.replace(/^[.:!?]+(?=[^\\/.])/, '').replace(/[.:!?]+$/, '')
    // Chemin de shell Git Bash (/d/Autowin/…) : même fichier que D:/Autowin/….
    if (process.platform === 'win32')
      jeton = jeton.replace(/^\/([a-zA-Z])\//, (_, lettre: string) => `${lettre.toUpperCase()}:/`)
    if (!jeton || artifactKindFor(basename(jeton)) !== 'video') continue
    if (vus.has(jeton)) continue
    vus.add(jeton)
    chemins.push(jeton)
  }
  return chemins
}

/**
 * Cartes des vidéos citées par `texte` et écrites depuis `debutDuTourMs`. `dejaMontrees` est lu ET
 * complété : une vidéo montrée ici (ou par `show_video` plus tôt dans le tour) ne revient pas.
 */
export async function videosLivreesDuTour(
  texte: string,
  dossierDuTour: string,
  debutDuTourMs: number,
  dejaMontrees: Set<string>,
  preparer: (
    args: Record<string, unknown>,
    dossier: string
  ) => Promise<VideoAMontrer> = preparerVideoAMontrer
): Promise<ChatArtifact[]> {
  const racine = dossierDuTour.trim()
  if (!racine || !texte) return []
  const versAbsolu = (chemin: string): string =>
    isAbsolute(chemin) ? resolve(chemin) : resolve(racine, chemin)
  // La même réponse peut citer le fichier ET appeler `show_video` dessus : la commande s'exécute
  // APRÈS cette lecture et fait sa propre carte — en faire une ici donnerait deux lecteurs.
  const confieesAShowVideo = new Set<string>()
  for (const [, corps] of texte.matchAll(/<cmd>([\s\S]*?)<\/cmd>/g)) {
    try {
      const commande = JSON.parse(corps) as { name?: unknown; args?: { path?: unknown } }
      if (commande.name === 'show_video' && typeof commande.args?.path === 'string')
        confieesAShowVideo.add(cleDeVideo(versAbsolu(commande.args.path.trim())))
    } catch {
      // Bloc illisible : le pilote le signale lui-même ; il ne réserve aucune vidéo.
    }
  }
  const cartes: ChatArtifact[] = []
  for (const cite of cheminsVideoCites(texte)) {
    if (cartes.length >= MAX_VIDEOS_AUTO_PAR_REPONSE) break
    const absolu = versAbsolu(cite)
    const cle = cleDeVideo(absolu)
    if (dejaMontrees.has(cle) || confieesAShowVideo.has(cle)) continue
    let ecritA: number
    try {
      ecritA = statSync(absolu).mtimeMs
    } catch {
      continue
    }
    if (ecritA < debutDuTourMs - TOLERANCE_MS) continue
    let video: VideoAMontrer
    try {
      video = await preparer({ path: absolu }, racine)
    } catch (erreur) {
      // Montrer est un SUPPLÉMENT au tour, déjà payé : son échec reste visible au journal, il ne
      // fait pas tomber la réponse. La vidéo suivante est quand même examinée.
      console.warn('[videos-livrees] carte impossible pour', absolu, erreur)
      continue
    }
    if (!video.ok) continue
    dejaMontrees.add(cle)
    cartes.push(video.artifact)
  }
  return cartes
}
