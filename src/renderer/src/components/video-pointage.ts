/**
 * POINTER UNE IMAGE PRÉCISE D'UNE VIDÉO DANS LE CHAT (conv-253, 2026-10-11).
 *
 * Demande : « je pourrais te dire modifie telle frame a telle seconde et on pourra echanger plus
 * fluidement ». Le lecteur du fil insère dans la saisie une RÉFÉRENCE que l'agent relit sans
 * ambiguïté (chemin d'origine + numéro d'image, compté à partir de 0 comme ffmpeg).
 *
 * Calcul pur, sans DOM : c'est ici que vivent les pièges mesurés.
 * - `floor(t * fps)` seul décale 22 images sur 1188 dans le film B6 (30 i/s, 39,6 s) : k/30 * 30
 *   retombe juste sous k en virgule flottante (ex. image 123).
 * - Chromium rend l'heure de l'image affichée (`requestVideoFrameCallback`, `mediaTime`) ARRONDIE
 *   À LA MICROSECONDE : l'image 31 arrive en 1.033333 s, et 1.033333 × 30 = 30,99999 (mesuré dans
 *   l'instance cachée : l'étiquette affichait « image 30 » quand la référence citait 31). La marge
 *   est donc en SECONDES (2 µs), pas en images : elle couvre l'arrondi à toute cadence et reste
 *   négligeable devant une image (4,2 ms à 240 i/s).
 * - La fin du film (39,6 s) est l'image 1187, pas 1188 : borne haute = total − 1.
 * - Le temps ÉCRIT dans la référence est le DÉBUT de l'image (N / fps), pas la cible de
 *   déplacement (N + 0,5) / fps : l'image 372 s'écrit `00:12.40`, pas `00:12.41`.
 */
import { formaterNombre } from '../langue'

/** Repli quand ffprobe n'a pas pu mesurer les images/s : affiché comme « supposé », jamais tu. */
export const FPS_SUPPOSE = 30
const FPS_MAX = 240
const MARGE_SECONDES = 2e-6

/** Un fps utilisable, sinon `undefined` (0, négatif, NaN, infini, > 240 ou texte). */
export function fpsValide(valeur: unknown): number | undefined {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) return undefined
  if (valeur <= 0 || valeur > FPS_MAX) return undefined
  return valeur
}

/**
 * Cadence à AFFICHER : ffprobe mesure les cadences NTSC en fraction (30000/1001), que le texte
 * brut rendait « 29.97002997002997 ». Arrondie au millième (23,976 · 29,97 · 59,94), séparateur
 * décimal de la langue (virgule en français, point en anglais — conv-1170) ; le calcul des images
 * garde la valeur exacte.
 */
export function libelleCadence(fps: number): string {
  return formaterNombre(Math.round(fps * 1000) / 1000, {
    maximumFractionDigits: 3,
    useGrouping: false
  })
}

/** Nombre d'images d'une vidéo de `duree` secondes, ou `undefined` si la durée est inconnue. */
export function nombreDImages(duree: number, fps: number): number | undefined {
  if (!Number.isFinite(duree) || duree <= 0) return undefined
  return Math.max(1, Math.round(duree * fps))
}

/** Image affichée à l'instant `temps` (0 = première), bornée à [0 ; total − 1]. */
export function imageAuTemps(temps: number, fps: number, total?: number): number {
  // fix-ok: cause mesurée — Chromium rend mediaTime arrondi à la µs (image 31 à 30 i/s = 1.033333 s) et floor(t × fps + 1e-6) donnait 30 ; remise en place, l'ancienne formule fait échouer video-pointage.test.ts (code 1), la marge de 2 µs le rend vert (code 0).
  const brute = Math.floor((Math.max(0, temps) + MARGE_SECONDES) * fps)
  return total === undefined ? brute : Math.min(brute, Math.max(0, total - 1))
}

/** Instant où se placer pour MONTRER l'image N : son milieu, loin des deux frontières. */
export function tempsDeLImage(image: number, fps: number): number {
  return (Math.max(0, image) + 0.5) / fps
}

/** `mm:ss.cc`, arrondi au centième (59,999 s → `01:00.00`, jamais `00:59.100`). */
export function formatTemps(secondes: number): string {
  const centiemes = Math.round(Math.max(0, Number.isFinite(secondes) ? secondes : 0) * 100)
  const minutes = Math.floor(centiemes / 6000)
  const reste = centiemes - minutes * 6000
  const s = Math.floor(reste / 100)
  const c = reste - s * 100
  return `${String(minutes).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

export interface MomentVideo {
  nom: string
  image: number
  total?: number
  fps: number
  fpsSuppose: boolean
  /** Le chemin d'ORIGINE (`source.originalPath`), pas la copie conservée par le fil. */
  chemin: string
}

/**
 * `[vidéo <nom> · 00:12.40 · image 372/1188 · <chemin>]` — ce que l'agent relit. RESTE EN FRANÇAIS
 * quelle que soit la langue de l'app (conv-1170) : son format est décrit à l'agent mot pour mot
 * (outil `show_video`), et une référence traduite ne serait plus reconnue.
 */
export function referenceVideo(moment: MomentVideo): string {
  const image = moment.total === undefined ? `${moment.image}` : `${moment.image}/${moment.total}`
  const suppose = moment.fpsSuppose ? ` · ${moment.fps} i/s supposé` : ''
  return `[vidéo ${moment.nom} · ${formatTemps(moment.image / moment.fps)} · image ${image}${suppose} · ${moment.chemin}]`
}

/** Nom du PNG joint : même vidéo + même image ⇒ même nom (le dédoublonnage des pièces jointes s'y fie). */
export function nomImagePointee(nomVideo: string, image: number): string {
  return `${nomVideo.replace(/\.[^./\\]+$/, '')}-i${image}.png`
}
