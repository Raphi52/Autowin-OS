import React, { useState } from 'react'
import type { CandidatAffiche } from './veille-candidats-message'
import { redigerPromptFrameSelection } from './veille-candidats-message'
import './CandidatsPickPanel.css'

/**
 * Le panneau de SÉLECTION sous un message de scout : une case par candidat, et un bouton qui
 * envoie le prompt /frame parfait sur les lignes cochées (demande utilisateur du 14/08).
 *
 * Contrôles NATIFS de l'app — jamais dans le HTML du modèle : le sanitizeur refuse input/button
 * par conception (anti-hameçonnage), et c'est ici que vit l'interaction.
 */
export function CandidatsPickPanel({
  candidats,
  onPick
}: {
  candidats: CandidatAffiche[]
  onPick?: (prompt: string) => void
}): React.JSX.Element {
  // Tout coché par défaut : le geste courant est « enchaîne sur tout », décocher est l'exception.
  const [coches, setCoches] = useState<ReadonlySet<number>>(new Set(candidats.map((_, i) => i)))
  const basculer = (index: number): void => {
    setCoches((courant) => {
      const suivant = new Set(courant)
      if (suivant.has(index)) suivant.delete(index)
      else suivant.add(index)
      return suivant
    })
  }
  const tous = coches.size === candidats.length
  const selection = candidats.filter((_, index) => coches.has(index))
  return (
    <div className="cpick" data-testid="candidats-pick">
      <div className="cpick-tete">
        <label className="cpick-tout">
          <input
            type="checkbox"
            checked={tous}
            onChange={() =>
              setCoches(tous ? new Set() : new Set(candidats.map((_, index) => index)))
            }
          />
          tout
        </label>
        <span className="cpick-compte">
          {coches.size}/{candidats.length} sélectionné{coches.size > 1 ? 's' : ''}
        </span>
      </div>
      {candidats.map((candidat, index) => (
        <label key={`${candidat.url}-${index}`} className="cpick-ligne" data-testid="cpick-ligne">
          <input
            type="checkbox"
            checked={coches.has(index)}
            onChange={() => basculer(index)}
          />
          <span className="cpick-titre">{candidat.titre}</span>
          <span className="cpick-ancrage">{candidat.url}</span>
          {candidat.pertinence !== undefined && (
            <span className="cpick-score">{candidat.pertinence}</span>
          )}
        </label>
      ))}
      <button
        type="button"
        className="btn-accent btn cpick-lancer"
        data-testid="cpick-lancer"
        disabled={selection.length === 0}
        onClick={() => onPick?.(redigerPromptFrameSelection(selection))}
        title="Envoie le prompt /frame sur les candidats cochés et enchaîne le workflow jusqu'au commit publié"
      >
        Enchaîner (frame) sur la sélection
      </button>
    </div>
  )
}
