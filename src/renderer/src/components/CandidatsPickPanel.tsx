import React, { useState } from 'react'
import type { CandidatAffiche } from './veille-candidats-message'
import { emojiType, redigerPromptFrameSelection } from './veille-candidats-message'
import './CandidatsPickPanel.css'

/**
 * Le panneau de SÉLECTION sous un message de scout : une case par candidat, une ligne DÉPLIABLE
 * (tous les détails : preuve, ancrage, date, type…), et un bouton qui envoie le prompt /frame
 * parfait sur les lignes cochées (demandes utilisateur du 14/08).
 *
 * Contrôles NATIFS de l'app — jamais dans le HTML du modèle : le sanitizeur refuse input/button
 * par conception (anti-hameçonnage). Style « transparence totale » : aucun fond, filets fins.
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
  const [deplies, setDeplies] = useState<ReadonlySet<number>>(new Set())
  const basculer = (index: number): void => {
    setCoches((courant) => {
      const suivant = new Set(courant)
      if (suivant.has(index)) suivant.delete(index)
      else suivant.add(index)
      return suivant
    })
  }
  const deplier = (index: number): void => {
    setDeplies((courant) => {
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
        <div
          key={`${candidat.url ?? candidat.titre}-${index}`}
          className="cpick-item"
          data-testid="cpick-ligne"
        >
          <div className="cpick-ligne">
            <input type="checkbox" checked={coches.has(index)} onChange={() => basculer(index)} />
            <button
              type="button"
              className="cpick-deplier"
              data-testid="cpick-deplier"
              onClick={() => deplier(index)}
              aria-expanded={deplies.has(index)}
              title={deplies.has(index) ? 'Replier les détails' : 'Déplier tous les détails'}
            >
              {deplies.has(index) ? '▾' : '▸'}
            </button>
            <span className="cpick-type" title={candidat.type ?? 'nature inconnue'}>
              {emojiType(candidat.type)}
            </span>
            <span className="cpick-titre" onClick={() => deplier(index)}>
              {candidat.titre}
            </span>
            {candidat.pertinence !== undefined && (
              <span className="cpick-score">{candidat.pertinence}</span>
            )}
          </div>
          {deplies.has(index) && (
            <div className="cpick-details" data-testid="cpick-details">
              {/* Trois blocs, un par QUESTION — c'est tout (demande du 14/08). Les anciens
                  candidats sans what/why/how retombent sur ce que leur charge portait. */}
              <div className="cpick-q">
                <b>Quoi ?</b>
                <p>{candidat.what ?? candidat.titre}</p>
              </div>
              <div className="cpick-q">
                <b>Pourquoi ?</b>
                <p>
                  {candidat.why ??
                    (candidat.citation ? `Preuve lue : « ${candidat.citation} »` : '—')}
                </p>
              </div>
              <div className="cpick-q">
                <b>Comment ?</b>
                <p>
                  {candidat.how ??
                    (candidat.url
                      ? `Partir de l'ancrage ${candidat.url}.`
                      : 'Premier pas non précisé.')}
                </p>
              </div>
            </div>
          )}
        </div>
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
