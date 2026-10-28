import { useContext, useEffect, useRef, useState } from 'react'
import type { ChatArtifact } from '../../../shared/artifacts'
import { langueCourante } from '../langue'
import {
  traduireArtefactsEtBandeaux,
  useTextesArtefactsEtBandeaux,
  type CleArtefactsEtBandeaux
} from '../textes-ecrans/artefacts-et-bandeaux'
import { PointerMomentVideo } from './video-pointage-context'
import {
  FPS_SUPPOSE,
  formatTemps,
  fpsValide,
  imageAuTemps,
  libelleCadence,
  nomImagePointee,
  nombreDImages,
  referenceVideo,
  tempsDeLImage
} from './video-pointage'

/**
 * LECTEUR VIDÉO IMAGE PAR IMAGE DU FIL (conv-253, 2026-10-11).
 *
 * Demande : « je pourrais te dire modifie telle frame a telle seconde et on pourra echanger plus
 * fluidement ». Avant, la carte vidéo était un `<video controls>` nu : précis à la seconde, sans
 * numéro d'image, sans lien avec la saisie. Les contrôles natifs restent ; on ajoute le temps au
 * centième, « image N/total », ±1 image / ±1 s (boutons et flèches), et « Pointer ce moment », qui
 * insère une référence au curseur de la saisie et joint l'image affichée en PNG.
 *
 * La référence cite `source.originalPath` : le `path` d'une carte conservée est une COPIE dans
 * `.autowin-data/chat-artifacts/…`, inutile à l'agent qui doit modifier le film.
 *
 * Cas limites demandés (conv-253) :
 * - total = `images` mesuré par ffprobe s'il est là, sinon déduit de la durée du navigateur ;
 * - une seule image : les 4 boutons de déplacement et les flèches sont inactifs ;
 * - « Pointer ce moment » est inactif tant que la première image n'est pas décodée
 *   (`loadeddata`) et pendant un déplacement (`seeking` → `seeked`) : sinon le PNG joint ne serait
 *   pas l'image écrite dans la référence.
 */

type MetaImage = { mediaTime: number }

async function capturerImage(
  video: HTMLVideoElement,
  nom: string
): Promise<{ image: File | null; erreur?: string }> {
  // Message d'un geste qui vient d'échouer : écrit dans la langue du moment du clic.
  const echec = (cle: CleArtefactsEtBandeaux, erreur?: string): string =>
    traduireArtefactsEtBandeaux(
      cle,
      langueCourante(),
      erreur === undefined ? undefined : { erreur }
    )
  const largeur = video.videoWidth
  const hauteur = video.videoHeight
  if (!largeur || !hauteur) return { image: null, erreur: echec('video.nonJointe.pasChargee') }
  const canvas = document.createElement('canvas')
  canvas.width = largeur
  canvas.height = hauteur
  const contexte = canvas.getContext('2d')
  if (!contexte) return { image: null, erreur: echec('video.nonJointe.dessin') }
  try {
    contexte.drawImage(video, 0, 0, largeur, hauteur)
  } catch (error) {
    return {
      image: null,
      erreur: echec(
        'video.nonJointe.erreur',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return { image: null, erreur: echec('video.nonJointe.png') }
  return { image: new File([blob], nom, { type: 'image/png' }) }
}

export function ArtifactVideoPlayer({
  artifact,
  src
}: {
  artifact: ChatArtifact
  src: string
}): React.JSX.Element {
  const { t } = useTextesArtefactsEtBandeaux()
  const videoRef = useRef<HTMLVideoElement>(null)
  const pointer = useContext(PointerMomentVideo)
  const fpsDonne = fpsValide(artifact.fps)
  const fps = fpsDonne ?? FPS_SUPPOSE
  const fpsSuppose = fpsDonne === undefined
  // Le nombre d'images ne vaut que mesuré avec la cadence (même passage d'ffprobe).
  const imagesMesurees =
    !fpsSuppose && Number.isSafeInteger(artifact.images) && (artifact.images ?? 0) >= 1
      ? artifact.images
      : undefined
  const [temps, setTemps] = useState(0)
  const [duree, setDuree] = useState(Number.NaN)
  const [avis, setAvis] = useState<string | null>(null)
  const [imageChargee, setImageChargee] = useState(false)
  const [enDeplacement, setEnDeplacement] = useState(false)
  const total = imagesMesurees ?? nombreDImages(duree, fps)
  const immobile = total !== undefined && total <= 1
  const pret = imageChargee && !enDeplacement
  const image = imageAuTemps(temps, fps, total)
  const chemin = artifact.source.originalPath ?? artifact.path ?? artifact.name

  // L'image réellement PRÉSENTÉE (pas la position de lecture) quand le moteur la donne.
  useEffect(() => {
    const video = videoRef.current
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return
    let poignee = 0
    const surImage = (_maintenant: number, meta: MetaImage): void => {
      setTemps(meta.mediaTime)
      poignee = video.requestVideoFrameCallback(surImage)
    }
    poignee = video.requestVideoFrameCallback(surImage)
    return () => video.cancelVideoFrameCallback(poignee)
  }, [src])

  const lirePosition = (): void => {
    const video = videoRef.current
    if (video) setTemps(video.currentTime)
  }
  const lireDuree = (): void => {
    const video = videoRef.current
    if (video) setDuree(video.duration)
  }

  function allerALImage(cible: number): void {
    const video = videoRef.current
    if (!video) return
    video.pause()
    const borne = Math.max(0, total === undefined ? cible : Math.min(cible, total - 1))
    video.currentTime = tempsDeLImage(borne, fps)
    setTemps(video.currentTime)
  }

  function decaler(images: number): void {
    const video = videoRef.current
    if (!video || immobile) return
    allerALImage(imageAuTemps(video.currentTime, fps, total) + images)
  }

  async function pointerCeMoment(): Promise<void> {
    const video = videoRef.current
    if (!video || !pointer || !pret) return
    video.pause()
    setTemps(video.currentTime)
    const n = imageAuTemps(video.currentTime, fps, total)
    const capture = await capturerImage(video, nomImagePointee(artifact.name, n))
    setAvis(capture.erreur ?? null)
    pointer({
      reference: referenceVideo({ nom: artifact.name, image: n, total, fps, fpsSuppose, chemin }),
      image: capture.image
    })
  }

  const uneSeconde = Math.max(1, Math.round(fps))
  const libelleFps = fpsSuppose
    ? t('video.cadenceInconnue', { fps: FPS_SUPPOSE })
    : t('video.cadence', { cadence: libelleCadence(fps) })

  return (
    <div
      className="lecteur-video"
      data-lecteur-video=""
      tabIndex={0}
      aria-label={t('video.lecteur')}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        if (immobile) return
        event.preventDefault()
        const sens = event.key === 'ArrowRight' ? 1 : -1
        decaler(sens * (event.shiftKey ? uneSeconde : 1))
      }}
    >
      <video
        ref={videoRef}
        className="artifact-preview__video"
        controls
        // Une vidéo de plus de 16 Mo vient d'`autowin-media://`, une autre origine : sans CORS, le
        // canevas de « Pointer ce moment » serait contaminé et l'image refusée (voir le test).
        crossOrigin="anonymous"
        src={src}
        onLoadedMetadata={lireDuree}
        onDurationChange={lireDuree}
        onTimeUpdate={lirePosition}
        onLoadedData={() => setImageChargee(true)}
        onEmptied={() => setImageChargee(false)}
        onSeeking={() => setEnDeplacement(true)}
        onSeeked={() => {
          setEnDeplacement(false)
          lirePosition()
        }}
        onPause={lirePosition}
      />
      <div className="lecteur-video__barre">
        <div className="lecteur-video__pas">
          <button
            type="button"
            aria-label={t('video.reculer')}
            disabled={immobile}
            onClick={() => decaler(-uneSeconde)}
          >
            −1 s
          </button>
          <button
            type="button"
            aria-label={t('video.imagePrecedente')}
            disabled={immobile}
            onClick={() => decaler(-1)}
          >
            {t('video.moinsUneImage')}
          </button>
          <button
            type="button"
            aria-label={t('video.imageSuivante')}
            disabled={immobile}
            onClick={() => decaler(1)}
          >
            {t('video.plusUneImage')}
          </button>
          <button
            type="button"
            aria-label={t('video.avancer')}
            disabled={immobile}
            onClick={() => decaler(uneSeconde)}
          >
            +1 s
          </button>
        </div>
        <output className="lecteur-video__etat" data-lecteur-etat="">
          <strong>{formatTemps(image / fps)}</strong>
          {t('video.etat', {
            image,
            total: total === undefined ? '' : `/${total}`,
            cadence: libelleFps
          })}
        </output>
        {pointer && (
          <button
            type="button"
            className="lecteur-video__pointer"
            aria-label={t('video.pointer')}
            title={pret ? t('video.pointerAide') : t('video.imageEnChargement')}
            disabled={!pret}
            onClick={() => void pointerCeMoment()}
          >
            {t('video.pointer')}
          </button>
        )}
      </div>
      {avis && (
        <div className="lecteur-video__avis" role="status">
          {avis}
        </div>
      )}
    </div>
  )
}
