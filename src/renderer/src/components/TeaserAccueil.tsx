import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import afficheUrl from '../assets/teaser/affiche.jpg'
import boucleUrl from '../assets/teaser/boucle.mp4'
import introUrl from '../assets/teaser/intro.mp4'
import { attenteDuCran } from '../animations-par-crans'
import { etatDeLaPhrase, teaserVu, VITESSE_AU_TRAVAIL } from './teaser-accueil-calcul'
import type { EtatDePhrase } from './teaser-accueil-calcul'

/**
 * Le décor d'un fil vide (conv-1401, 2026-10-31) : « une video ca serait moin gourmand et plus
 * efficace, faudrait comme un teaser de jeu video magicien du temps obscur ». Il remplace la salle
 * en 3D, jugée « vraiment cheap ». Le film est précalculé : un temple du temps, un magicien géant
 * au chapeau recourbé devant une horloge, et le cercle de runes sous lequel se pose la phrase.
 *
 * DEUX FICHIERS : l'intro (14 s, jouée une fois par lancement de l'app) finit, sur un éclair, là où
 * la boucle commence. La boucle attend sous l'intro, déjà chargée. Muettes toutes les deux. Le film
 * se refait avec `scripts/teaser-accueil/`.
 *
 * « faut que ca soit tout le temps waouh » : la boucle (40 s) monte en quatre temps, de la frappe au
 * tunnel du temps, en passant par l'astrolabe et l'éclipse. Chaque temps ouvre sur le plan large où
 * le cercle invoque un sort. Les phrases sont calées sur le temps réel du film, pas sur une
 * minuterie : quand il accélère, elles le suivent.
 */

function lire(video: HTMLVideoElement): void {
  // `play` rejette quand une pause l'interrompt : c'est le fonctionnement normal, pas une panne.
  video.play()?.catch((erreur: unknown) => {
    if (!(erreur instanceof DOMException && erreur.name === 'AbortError')) {
      console.warn('[accueil] vidéo non lancée —', String(erreur))
    }
  })
}

/** Fenêtre réduite ou cachée : la vidéo s'arrête, personne ne la regarde. */
function useFenetreVisible(): boolean {
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden')
  useEffect(() => {
    const changer = (): void => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', changer)
    return () => document.removeEventListener('visibilitychange', changer)
  }, [])
  return visible
}

function TeaserAccueilBrut({
  libelle,
  lecture,
  acceleree,
  enIntro,
  onTaille,
  onPhrase,
  onFinIntro,
  onAbsente
}: {
  /** Nom lu par un lecteur d'écran (l'ancien titre). */
  libelle: string
  /** Faux : l'image reste, plus rien n'est décodé. */
  lecture: boolean
  acceleree: boolean
  enIntro: boolean
  /** La taille du fil, en px : la phrase en déduit sa place sur le cercle de runes. */
  onTaille: (largeur: number, hauteur: number) => void
  /** Où en est la phrase dans le film, relu à chaque cran. */
  onPhrase: (etat: EtatDePhrase) => void
  onFinIntro: () => void
  /** La vidéo ne se lit pas : l'accueil revient à sa mise en page sans décor. */
  onAbsente: () => void
}): React.JSX.Element {
  const hote = useRef<HTMLDivElement>(null)
  const boucle = useRef<HTMLVideoElement>(null)
  const intro = useRef<HTMLVideoElement>(null)
  const visible = useFenetreVisible()
  const joue = lecture && visible

  // Avant la première peinture : la phrase est déjà à sa place quand le fil s'affiche.
  useLayoutEffect(() => {
    const element = hote.current
    if (!element) return
    const mesurer = (): void => onTaille(element.clientWidth, element.clientHeight)
    mesurer()
    if (typeof ResizeObserver === 'undefined') return
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(element)
    return () => observateur.disconnect()
  }, [onTaille])

  useEffect(() => {
    const video = (enIntro ? intro : boucle).current
    if (!video) return
    if (joue) {
      teaserVu.intro = true
      lire(video)
    } else {
      video.pause()
    }
  }, [enIntro, joue])

  useEffect(() => {
    if (enIntro || !joue) return
    let minuteur: ReturnType<typeof setTimeout>
    const relire = (): void => {
      if (boucle.current) onPhrase(etatDeLaPhrase(boucle.current.currentTime))
      minuteur = setTimeout(relire, attenteDuCran())
    }
    relire()
    return () => clearTimeout(minuteur)
  }, [enIntro, joue, onPhrase])

  useEffect(() => {
    if (boucle.current) boucle.current.playbackRate = acceleree ? VITESSE_AU_TRAVAIL : 1
  }, [acceleree])

  return (
    <div ref={hote} className="at-decor" role="img" aria-label={libelle}>
      <video
        ref={boucle}
        className="at-video"
        src={boucleUrl}
        poster={afficheUrl}
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
        onError={onAbsente}
      />
      {enIntro && (
        <video
          ref={intro}
          className="at-video at-intro"
          src={introUrl}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
          onEnded={onFinIntro}
          onError={onFinIntro}
        />
      )}
    </div>
  )
}

export const TeaserAccueil = memo(TeaserAccueilBrut)
