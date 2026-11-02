import React, { useLayoutEffect, useRef } from 'react'
import type { UsageDeSkill } from './chat-home-suggestions'

/**
 * Une phrase sur le film d'accueil (conv-1401, 2026-10-31) : « les phrases doivent etre des lettres
 * invoquées du cercle qui s'assemblent ». Chaque lettre part du centre du cercle de runes, monte dans
 * la colonne de lumière, puis vient se poser à sa place ; à la fin, elles se dispersent.
 *
 * Chaque phrase est un sort : le nom de la skill en or, son usage dessous. Les lettres sont dans le
 * fil, pas dans la vidéo : le clic pose la vraie commande dans la saisie.
 */

/** L'écart entre deux lettres qui partent, en ms. Plafonné : une longue phrase ne traîne pas. */
const CADENCE_MS = 24
const RETARD_MAX_MS = 1100

/** Toujours le même tirage pour une lettre : rien ne saute si la phrase se redessine. */
function tirage(rang: number): number {
  const s = Math.sin(rang * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

/** Par points de code, pour ne jamais couper un emoji en deux. */
function enMots(phrase: string): { mot: string[]; depart: number }[] {
  let depart = 0
  return phrase.split(' ').map((mot) => {
    const lettres = Array.from(mot)
    const piece = { mot: lettres, depart }
    depart += lettres.length
    return piece
  })
}

/** Les lettres d'un texte, mot par mot. `rang` : la première lettre, pour la cadence. */
function Lettres({ texte, rang }: { texte: string; rang: number }): React.JSX.Element {
  return (
    <>
      {enMots(texte).map(({ mot, depart }, i) => (
        <React.Fragment key={depart}>
          {i > 0 && ' '}
          <span className="at-mot">
            {mot.map((lettre, k) => {
              const ici = rang + depart + k
              const style = {
                '--retard': `${Math.min(ici * CADENCE_MS, RETARD_MAX_MS)}ms`,
                '--ecart': `${Math.round((tirage(ici) - 0.5) * 380)}px`,
                '--tour': `${Math.round((tirage(ici + 50) - 0.5) * 300)}deg`
              } as React.CSSProperties
              return (
                <span key={k} className="at-lettre" style={style}>
                  {lettre}
                </span>
              )
            })}
          </span>
        </React.Fragment>
      ))}
    </>
  )
}

export function PhraseInvoquee({
  usage,
  sortante,
  ecartAuCercle,
  onChoisir,
  onTenir
}: {
  usage: UsageDeSkill
  sortante: boolean
  /** Du haut de la phrase au centre du cercle de runes, en px. */
  ecartAuCercle: number
  onChoisir: (phrase: string) => void
  /** Le pointeur ou le clavier la vise : elle ne doit plus partir. */
  onTenir: (tenue: boolean) => void
}): React.JSX.Element {
  const bouton = useRef<HTMLButtonElement>(null)
  const phrase = `${usage.nom} ${usage.usage}`

  // Avant la première peinture : chaque lettre connaît le chemin depuis le cercle, retour à la ligne
  // compris. `offsetLeft` et non `getBoundingClientRect` : l'animation a déjà déplacé la lettre.
  useLayoutEffect(() => {
    const element = bouton.current
    const zone = element?.parentElement
    if (!element || !zone) return
    const centre = zone.clientWidth / 2
    element.querySelectorAll<HTMLElement>('.at-lettre').forEach((lettre) => {
      const x = centre - (lettre.offsetLeft + lettre.offsetWidth / 2)
      const y = -ecartAuCercle - lettre.offsetTop
      lettre.style.setProperty('--de-x', `${Math.round(x)}px`)
      lettre.style.setProperty('--de-y', `${Math.round(y)}px`)
    })
  }, [phrase, ecartAuCercle])

  return (
    <button
      ref={bouton}
      type="button"
      className={`aa-phrase at-phrase${sortante ? ' at-sort' : ''}`}
      aria-label={phrase}
      title={phrase}
      onClick={() => onChoisir(phrase)}
      onPointerEnter={() => onTenir(true)}
      onPointerLeave={() => onTenir(false)}
      onFocus={() => onTenir(true)}
      onBlur={() => onTenir(false)}
    >
      <span aria-hidden="true">
        <span className="at-nom">
          <Lettres texte={usage.nom} rang={0} />
        </span>
        <span className="at-usage">
          <Lettres texte={usage.usage} rang={Array.from(usage.nom).length} />
        </span>
      </span>
    </button>
  )
}
