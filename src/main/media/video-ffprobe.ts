import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * IMAGES/S ET NOMBRE D'IMAGES D'UNE VIDÉO, MESURÉS PAR FFPROBE (conv-253, 2026-10-11).
 *
 * Demande : « ffprobe en échec = 30 i/s affiché comme supposé ». La mesure fait foi ; tout échec
 * rend `{ ok: false, raison }` (jamais une exception) et la carte part SANS `fps` : le lecteur
 * affiche alors « 30 supposé » et l'écrit dans la référence.
 *
 * Piège relevé (ffprobe 8.0.1) : le code de sortie ne dit pas si le fichier est une vidéo. Un son
 * seul rend le code 0, une image renommée aussi (avec un flux « vidéo »), un texte renommé le
 * code 1. La sortie est donc lue, et le format réellement reconnu avec elle.
 *
 * Trois réponses d'ffprobe disent « ce n'est pas une vidéo », et rendent `sansFluxVideo: true` :
 * `show_video` refuse alors la carte au lieu de montrer un lecteur vide. Relevé avec ffprobe 8.0.1 :
 * - .mp4 / .webm son seul, ou son + pochette : code 0, `streams: []` avec `V:0` (pochette exclue ;
 *   `v:0` la rendait comme un flux à 90000/1) ;
 * - image renommée en .mp4, .webm ou .mov : code 0, un flux à 25/1 (PNG, JPEG) ou 10/1 (GIF), mais
 *   un format lu `png_pipe`, `jpeg_pipe`, `gif` — aucun des conteneurs que `show_video` accepte ;
 * - texte, JSON, script ou octets au hasard renommés en .mp4, .webm ou .mov : code 1 et
 *   « Invalid data found when processing input » sur stderr.
 * « 30 supposé » reste réservé aux vrais échecs : binaire absent, autre code non nul, délai dépassé,
 * sortie illisible, cadence illisible.
 */

/** Même plafond que le lecteur (`video-pointage.ts`) : au-delà, la cadence n'est pas crue. */
const FPS_MAX = 240
const DELAI_MS = 10_000
/**
 * Conteneurs des seules extensions que `show_video` accepte (.mp4, .mov → `mov,mp4,m4a,3gp,3g2,mj2` ;
 * .webm → `matroska,webm`, relevés avec ffprobe 8.0.1). Tout autre format lu = pas une vidéo.
 */
const CONTENEURS_VIDEO = new Set(['mov', 'mp4', 'matroska', 'webm'])

export type MesureVideo =
  { ok: true; fps: number; images?: number } | { ok: false; raison: string; sansFluxVideo?: true }

export type ExecuteurFfprobe = (args: string[]) => Promise<{ stdout: string }>

const execFileAsync = promisify(execFile)

const executerFfprobe: ExecuteurFfprobe = async (args) => {
  const { stdout } = await execFileAsync('ffprobe', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: DELAI_MS
  })
  return { stdout: String(stdout) }
}

function cadence(valeur: unknown): number | undefined {
  if (typeof valeur !== 'string') return undefined
  const morceaux = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(valeur)
  if (!morceaux) return undefined
  const numerateur = Number(morceaux[1])
  const denominateur = morceaux[2] === undefined ? 1 : Number(morceaux[2])
  if (!(denominateur > 0)) return undefined
  const fps = numerateur / denominateur
  return Number.isFinite(fps) && fps > 0 && fps <= FPS_MAX ? fps : undefined
}

function nombreDImagesLu(valeur: unknown): number | undefined {
  const n = typeof valeur === 'string' && /^\d+$/.test(valeur.trim()) ? Number(valeur) : valeur
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 ? n : undefined
}

/**
 * Lit la sortie JSON de
 * `ffprobe -select_streams V:0 -show_entries format=format_name:stream=r_frame_rate,nb_frames`.
 */
export function lireSortieFfprobe(stdout: string): MesureVideo {
  let sortie: unknown
  try {
    sortie = JSON.parse(stdout)
  } catch {
    return { ok: false, raison: 'sortie d’ffprobe illisible' }
  }
  // fix-ok: conv-253 — une image renommée en .mp4 sort en code 0 avec UN flux (`png_pipe`/`jpeg_pipe`
  // à 25/1, `gif` à 10/1, ffprobe 8.0.1 mesuré) : le premier flux était pris tel quel et la carte
  // partait à « 25 i/s » mesuré sur un lecteur mort. Le format lu tranche ; video-ffprobe.test.ts
  // rouge (code 1, 3 tests) sans cette lecture, vert avec. Format absent = pas de jugement.
  const format =
    typeof sortie === 'object' && sortie !== null
      ? (sortie as { format?: { format_name?: unknown } }).format?.format_name
      : undefined
  if (
    typeof format === 'string' &&
    !format.split(',').some((nom) => CONTENEURS_VIDEO.has(nom.trim()))
  )
    return {
      ok: false,
      sansFluxVideo: true,
      raison: `contenu lu comme « ${format} », pas une vidéo MP4, MOV ou WebM`
    }
  const liste =
    typeof sortie === 'object' && sortie !== null
      ? (sortie as { streams?: unknown }).streams
      : undefined
  if (!Array.isArray(liste)) return { ok: false, raison: 'sortie d’ffprobe sans liste de flux' }
  if (liste.length === 0)
    return { ok: false, sansFluxVideo: true, raison: 'aucun flux vidéo trouvé' }
  const flux = liste[0] as Record<string, unknown> | undefined
  if (!flux || typeof flux !== 'object') return { ok: false, raison: 'flux vidéo illisible' }
  const fps = cadence(flux.r_frame_rate)
  if (fps === undefined)
    return { ok: false, raison: `cadence illisible (${String(flux.r_frame_rate ?? 'absente')})` }
  const images = nombreDImagesLu(flux.nb_frames)
  return images === undefined ? { ok: true, fps } : { ok: true, fps, images }
}

function raisonDEchec(erreur: unknown): string {
  const e = erreur as { code?: unknown; killed?: boolean; signal?: unknown; message?: unknown }
  if (e?.code === 'ENOENT') return 'ffprobe introuvable sur ce poste'
  if (e?.killed || e?.signal) return `ffprobe n’a pas répondu en ${DELAI_MS / 1000} s`
  if (typeof e?.code === 'number') return `ffprobe a échoué (code ${e.code})`
  return `ffprobe a échoué (${String(e?.message ?? erreur)})`
}

/** ffprobe a lu le fichier et ne le reconnaît pas comme vidéo (code non nul + ce message précis). */
function illisibleCommeVideo(erreur: unknown): boolean {
  const e = erreur as { code?: unknown; killed?: boolean; stderr?: unknown }
  return (
    typeof e?.code === 'number' &&
    e.code !== 0 &&
    !e.killed &&
    /Invalid data found when processing input/.test(String(e.stderr ?? ''))
  )
}

/** Mesure la vidéo `chemin`. Ne lève jamais : un échec est une raison lisible. */
export async function mesurerVideo(
  chemin: string,
  executer: ExecuteurFfprobe = executerFfprobe
): Promise<MesureVideo> {
  try {
    const { stdout } = await executer([
      '-v',
      'error',
      // `V:0` (majuscule) : premier flux vidéo qui n'est PAS une pochette ; `v:0` rendait la pochette
      // d'un son à 90000/1 (mesuré), donc « 30 supposé » sur un lecteur sans image.
      '-select_streams',
      'V:0',
      '-show_entries',
      'format=format_name:stream=r_frame_rate,nb_frames',
      '-of',
      'json',
      chemin
    ])
    return lireSortieFfprobe(stdout)
  } catch (erreur) {
    // fix-ok: conv-253 — un texte/JSON/script renommé en .mp4 sort en code 1 + « Invalid data found
    // when processing input » (ffprobe 8.0.1, mesuré) ; seul `streams: []` sous code 0 était reconnu,
    // la carte partait vide en « 30 supposé ». Test video-ffprobe.test.ts rouge (code 1), vert avec.
    if (illisibleCommeVideo(erreur))
      return {
        ok: false,
        sansFluxVideo: true,
        raison: 'fichier illisible comme vidéo (Invalid data found when processing input)'
      }
    return { ok: false, raison: raisonDEchec(erreur) }
  }
}
