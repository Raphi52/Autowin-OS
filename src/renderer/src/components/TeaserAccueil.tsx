import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import afficheUrl from '../assets/teaser/affiche.jpg'
import boucleUrl from '../assets/teaser/boucle.mp4'
import introUrl from '../assets/teaser/intro.mp4'
import { attenteDuCran } from '../animations-par-crans'
import { momentDuFilm, teaserVu, VITESSE_AU_TRAVAIL } from './teaser-accueil-calcul'
import type { MomentDuFilm } from './teaser-accueil-calcul'

/**
 * Le décor d'un fil vide (conv-1401, 2026-10-31) : « une video ca serait moin gourmand et plus
 * efficace ». Le film est précalculé, muet, et la phrase cliquable se pose dessus.
 *
 * LES FONCTIONNALITÉS À LA PLACE DU MAGICIEN (conv-1535, 2026-11-04) : « une video comme ca [le film
 * de présentation en motion design] pour l'écran nouveau fil, qui montre des features de autowin a
 * la place du magicien », puis « présenter les skills avec des représentations de leur bloc associé
 * dans le chat, agent studio, workflows, task planner, knowledge et board [...] 2 secondes par
 * scene », puis « 2 secondes c trop rapide [...] fais des anim de 5 secondes et met plus d'effort
 * pour que les vues soient reconnaissables ». Dix scènes de 5 s, une skill puis une vue, les vues
 * redessinées sur leurs captures : /draft, Agent Studio, /scout, Workflows,
 * /grill, Board, /judge, Task Manager, /arena, Knowledge. Chacune est une carte de verre qui porte
 * son nom en or et joue son animation (le carrousel de /draft, les candidats de /scout…). Sous
 * chaque skill, la phrase cliquable donne son exemple (`momentDuFilm`) et s'y tape lettre à
 * lettre (`PhraseTapee`). Le bas de l'image reste sombre pour elle.
 *
 * DEUX FICHIERS : l'intro (3,5 s, jouée une fois par lancement de l'app) finit exactement sur la
 * première image de la boucle (50 s). La boucle attend sous l'intro, déjà
 * chargée. Le film se refait depuis le projet du film de présentation :
 * `%LOCALAPPDATA%/autowin-video/film/teaser-fil/` (scène et rendu, voir son
 * `scene.js`). L'ancien film du magicien se refait toujours avec `scripts/teaser-accueil/`.
 *
 * Les phrases sont calées sur le temps réel du film, pas sur une minuterie : quand il accélère,
 * elles le suivent.
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
  /** La taille du fil, en px : la phrase en déduit sa place dans le bas du film. */
  onTaille: (largeur: number, hauteur: number) => void
  /** Où en est la phrase dans le film, et quelle skill est à l'écran, relu à chaque cran. */
  onPhrase: (moment: MomentDuFilm) => void
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
      if (boucle.current) onPhrase(momentDuFilm(boucle.current.currentTime))
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
