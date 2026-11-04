import React from 'react'
import type { UsageDeSkill } from './chat-home-suggestions'
import { retardsDeFrappe } from './teaser-accueil-calcul'

/**
 * Une phrase sur le film d'accueil : le nom de la skill en or, son usage dessous. Les lettres sont
 * dans le fil, pas dans la vidéo : le clic pose la vraie commande dans la saisie.
 *
 * ELLE SE TAPE (conv-1535, 2026-11-04). Avant, ses lettres sortaient du cercle de runes du magicien
 * (conv-1401, « des lettres invoquées du cercle qui s'assemblent »). Le magicien parti, l'utilisateur :
 * « l'invocation des phrases ça a plus de sens sans le sorcier, fais-les s'écrire comme un humain qui
 * tape au clavier, lettre par lettre ». Chaque lettre paraît à son instant (`retardsDeFrappe`), et le
 * curseur doré de l'accueil (`.aa-barre`) la suit : chaque lettre le porte de son arrivée à celle de la
 * suivante, la dernière le fait clignoter. Tout en CSS : aucun rendu React par touche.
 */

/** Par points de code, pour ne jamais couper un emoji en deux. */
function enMots(texte: string): { mot: string[]; depart: number }[] {
  let depart = 0
  return texte.split(' ').map((mot) => {
    const lettres = Array.from(mot)
    const piece = { mot: lettres, depart }
    depart += lettres.length
    return piece
  })
}

/**
 * Les lettres d'un texte, mot par mot. `instants` : l'instant de chaque lettre ; `suivantes` : celui
 * de la lettre d'après (le curseur la quitte alors), `null` pour la dernière de la phrase.
 */
function Lettres({
  texte,
  instants,
  suivantes,
  premiere
}: {
  texte: string
  instants: number[]
  suivantes: (number | null)[]
  premiere: boolean
}): React.JSX.Element {
  return (
    <>
      {enMots(texte).map(({ mot, depart }, i) => (
        <React.Fragment key={depart}>
          {i > 0 && ' '}
          <span className="at-mot">
            {mot.map((lettre, k) => {
              const ici = depart + k
              const suivante = suivantes[ici]
              const style = {
                '--retard': `${instants[ici]}ms`,
                ...(suivante !== null && { '--suivante': `${suivante}ms` })
              } as React.CSSProperties
              const classes = [
                'at-lettre',
                premiere && ici === 0 ? 'at-premiere' : '',
                suivante === null ? 'at-derniere' : ''
              ]
              return (
                <span key={k} className={classes.filter(Boolean).join(' ')} style={style}>
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

export function PhraseTapee({
  usage,
  sortante,
  onChoisir,
  onTenir
}: {
  usage: UsageDeSkill
  sortante: boolean
  onChoisir: (phrase: string) => void
  /** Le pointeur ou le clavier la vise : elle ne doit plus partir. */
  onTenir: (tenue: boolean) => void
}): React.JSX.Element {
  const phrase = `${usage.nom} ${usage.usage}`
  const frappe = retardsDeFrappe(usage.nom, usage.usage)
  const tout = [...frappe.nom, ...frappe.usage]
  const apres = (rang: number): number | null => tout[rang + 1] ?? null
  const suivantesDuNom = frappe.nom.map((_, i) => apres(i))
  const suivantesDeLUsage = frappe.usage.map((_, i) => apres(frappe.nom.length + i))

  return (
    <button
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
          <Lettres texte={usage.nom} instants={frappe.nom} suivantes={suivantesDuNom} premiere />
        </span>
        <span className="at-usage">
          <Lettres
            texte={usage.usage}
            instants={frappe.usage}
            suivantes={suivantesDeLUsage}
            premiere={false}
          />
        </span>
      </span>
    </button>
  )
}
