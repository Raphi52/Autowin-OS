import React, { useEffect, useRef, useState } from 'react'
import type { CandidatAffiche } from './veille-candidats-message'
import {
  emojiType,
  redigerPromptWorkflowSelection,
  selectionAutoDepuisScout
} from './veille-candidats-message'
import './CandidatsPickPanel.css'

/** Une pastille muette ne dit rien : chaque couleur porte son libelle en infobulle et en aria. */
const LIBELLE_BANDE: Record<'g' | 'y' | 'r', string> = {
  g: 'fort',
  y: 'moyen',
  r: 'faible'
}

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
  texteScout,
  autoLancer,
  onPick
}: {
  candidats: CandidatAffiche[]
  /** Le texte du scout : s'il déclare `CIBLE:`/`CIBLES:`, ce choix pré-coche les cases. */
  texteScout?: string
  /**
   * LE CLIC AUTOMATIQUE. Vrai = le panneau appuie lui-meme sur le bouton avec la selection decidee
   * par le scout (mode auto). Ne part JAMAIS sans declaration ecrite : sans `CIBLE:` ni section
   * `## Cible`, ou sur une declaration vide, rien n'est envoye et le bouton attend un clic humain.
   */
  autoLancer?: boolean
  onPick?: (prompt: string) => void
}): React.JSX.Element {
  /*
   * QUI COCHE ? L'agent quand il a DÉCLARÉ son choix, l'habitude sinon.
   *
   * Le scout qui écrit `CIBLES: 1, 3` a désigné ses candidats : les cases suivent sa décision, et le
   * bandeau au-dessus dit lesquels sont gardés — un choix invisible serait le même défaut qu'une
   * rubrique lue comme un ordre. Sans déclaration : tout coché, comme avant (le geste courant est
   * « enchaîne sur tout », décocher est l'exception). Le bouton, lui, reste toujours à cliquer.
   */
  const auto = selectionAutoDepuisScout(candidats, texteScout)
  const [coches, setCoches] = useState<ReadonlySet<number>>(
    auto ?? new Set(candidats.map((_, i) => i))
  )
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
  /*
   * L'AGENT APPUIE SUR LE BOUTON. Une seule fois par panneau (`lanceRef`) : un re-rendu ne renvoie
   * rien. Condition stricte — le mode auto est allume ET le scout a ecrit son choix ET ce choix
   * retient au moins une ligne. Un workflow complet jusqu'au commit ne part pas d'un defaut.
   */
  const lanceRef = useRef(false)
  useEffect(() => {
    if (!autoLancer || lanceRef.current) return
    if (auto === null || auto.size === 0) return
    lanceRef.current = true
    onPick?.(redigerPromptWorkflowSelection(candidats.filter((_, index) => auto.has(index))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLancer])
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
        {auto !== null && (
          <span className="cpick-auto" data-testid="cpick-auto">
            {auto.size === 0
              ? 'Le scout n’a retenu aucun candidat — rien n’est coché.'
              : `Choix du scout : ${auto.size} candidat${auto.size > 1 ? 's' : ''} sur ${candidats.length} — ${autoLancer ? 'lancé automatiquement.' : 'à toi de lancer.'}`}
          </span>
        )}
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
            {/* La valeur de la ligne : une note quand le scout en donne une, sinon les deux
                pastilles Impact/Effort — un scout au format Impact/Effort n'a AUCUN nombre. */}
            {candidat.pertinence !== undefined && (
              <span className="cpick-score">{candidat.pertinence}</span>
            )}
            {candidat.pertinence === undefined && (candidat.impact || candidat.effort) && (
              <span className="cpick-pastilles" data-testid="cpick-pastilles">
                {candidat.impact && (
                  <span
                    className={`cpick-dot cpick-dot-${candidat.impact}`}
                    title={`Impact ${LIBELLE_BANDE[candidat.impact]}`}
                    aria-label={`Impact ${LIBELLE_BANDE[candidat.impact]}`}
                  />
                )}
                {candidat.effort && (
                  <span
                    className={`cpick-dot cpick-dot-${candidat.effort}`}
                    title={`Effort ${LIBELLE_BANDE[candidat.effort]}`}
                    aria-label={`Effort ${LIBELLE_BANDE[candidat.effort]}`}
                  />
                )}
              </span>
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
                    (candidat.url ? `Partir de l'ancrage ${candidat.url}.` : 'Non précisé.')}
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
        onClick={() => onPick?.(redigerPromptWorkflowSelection(selection))}
        title="Envoie les candidats cochés dans le workflow COMPLET (cadrage → terrain → build → nettoyage → jugement) jusqu'au commit publié"
      >
        Lancer le workflow complet sur la sélection
      </button>
    </div>
  )
}
