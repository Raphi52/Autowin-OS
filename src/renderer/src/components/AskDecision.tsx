import { useState } from 'react'
import './AskDecision.css'
import { promptDeLOption, promptDesOptions, type AskDecision, type AskOption } from './ask-choices'

/*
 * SPEC GELEE — bloc de decision `ask` (20/08, apres trois tours de convergence visuelle).
 *
 * STRUCTURE   Une ligne par reponse, EMPILEE. Jamais cote a cote, a aucune largeur : l'ancien bloc
 *             rendait une rangee de pilules dimensionnees par la longueur du texte, illisible et
 *             cassee des que le panneau Workflows reduisait la place.
 * LIGNE       [ triangle ] [ libelle court + consequence d'une ligne ] [ touche ]
 * DEPLIABLE   Meme grammaire que le panneau de candidats du scout (triangle, aria-expanded), mais
 *             le triplet est celui d'une DECISION : ce que ca fait · ce que ca touche · ce que ca
 *             ne regle PAS. Le residu est nomme, jamais tu.
 * ETATS       repos : aucune surface. survol : liseré or qui pousse du haut (scaleY 0→1, 160 ms)
 *             + lavis blanc 3 % + touche qui passe en or. focus clavier : idem + filet or interne.
 *             recommandee : liseré permanent a pleine opacite, donc distincte d'un simple survol.
 * TOKENS      or #d4a94f → #e3ba55 · texte #dde3ee · secondaire #a9b2c4 · separateur blanc 7 %
 * GARDE-FOUS  aucun panneau, aucun halo, aucune ombre decorative ; le seul ornement est le filet
 *             or et il est fonctionnel. Moins de deux reponses = pas de bloc (un bouton unique
 *             ressemblerait a une validation) — garde anterieure, conservee dans le parseur.
 *
 * Ce qui repart au clic : `envoi` s'il est fourni, sinon le libelle — comme un prompt ordinaire,
 * donc l'action reelle emprunte le chemin normal et ses autorisations.
 */

function Detail({ detail }: { detail: NonNullable<AskOption['detail']> }): React.JSX.Element {
  return (
    <div className="askd-detail">
      {detail.fait && (
        <div className="askd-q">
          <b>Ce que ça fait</b>
          <p>{detail.fait}</p>
        </div>
      )}
      {detail.touche && (
        <div className="askd-q">
          <b>Ce que ça touche</b>
          <p>{detail.touche}</p>
        </div>
      )}
      {detail.neReglePas && (
        <div className="askd-q est-residuel">
          <b>Ne règle pas</b>
          <p>{detail.neReglePas}</p>
        </div>
      )}
    </div>
  )
}

export function AskDecisionBlock({
  decision,
  onPick
}: {
  decision: AskDecision
  onPick?: (prompt: string) => void
}): React.JSX.Element {
  // La recommandee s'ouvre d'office : c'est celle dont la justification compte le plus.
  const [ouvertes, setOuvertes] = useState<ReadonlySet<number>>(() => {
    const index = decision.options.findIndex((option) => option.recommande && option.detail)
    return new Set(index >= 0 ? [index] : [])
  })
  const basculer = (index: number): void =>
    setOuvertes((precedent) => {
      const suivant = new Set(precedent)
      if (!suivant.delete(index)) suivant.add(index)
      return suivant
    })

  const auMoinsUnDetail = decision.options.some((option) => option.detail)
  /*
   * CHOIX MULTIPLE. Certaines questions ne sont pas exclusives (« lesquels de ces correctifs ? ») :
   * les cocher une par une et envoyer d'un coup evite autant de tours que de reponses. Le drapeau
   * est DECLARE par le modele — deviner a partir des libelles ferait basculer « Les deux » et
   * « Seulement A » du mauvais cote.
   */
  const [cochees, setCochees] = useState<ReadonlySet<number>>(() => new Set())
  const cocher = (index: number): void =>
    setCochees((precedent) => {
      const suivant = new Set(precedent)
      if (!suivant.delete(index)) suivant.add(index)
      return suivant
    })
  const selection = decision.options.filter((_, index) => cochees.has(index))
  const envoyerLaSelection = (): void => {
    if (!selection.length) return
    onPick?.(promptDesOptions(selection))
  }

  return (
    <div className="askd" data-testid="ask-decision">
      <div className="askd-tete">
        <span className="askd-badge">ask</span>
        <span className="askd-question">{decision.question}</span>
      </div>
      <div className="askd-liste">
        {decision.options.map((option, index) => {
          const deplie = ouvertes.has(index)
          return (
            <div
              key={index}
              className={`askd-item${option.recommande ? ' est-reco' : ''}`}
              data-testid="ask-decision-option"
            >
              <div className="askd-ligne">
                {option.detail ? (
                  <button
                    type="button"
                    className="askd-tri"
                    aria-expanded={deplie}
                    aria-label={deplie ? 'Replier le détail' : 'Déplier le détail'}
                    onClick={() => basculer(index)}
                  >
                    {deplie ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="askd-tri" aria-hidden="true">
                    ▸
                  </span>
                )}
                {decision.choixMultiple ? (
                  <label className="askd-choix askd-coche">
                    <input
                      type="checkbox"
                      checked={cochees.has(index)}
                      onChange={() => cocher(index)}
                    />
                    <span>
                      <span className="askd-libelle">
                        {option.libelle}
                        {option.recommande && <span className="askd-tag">recommandé</span>}
                      </span>
                      {option.consequence && (
                        <span className="askd-consequence">{option.consequence}</span>
                      )}
                    </span>
                  </label>
                ) : (
                  <button
                    type="button"
                    className="askd-choix"
                    onClick={() => onPick?.(promptDeLOption(option))}
                  >
                    <span className="askd-libelle">
                      {option.libelle}
                      {option.recommande && <span className="askd-tag">recommandé</span>}
                    </span>
                    {option.consequence && (
                      <span className="askd-consequence">{option.consequence}</span>
                    )}
                  </button>
                )}
                <div className="askd-droite">
                  {/*
                   * Le mot plutot que le glyphe ⏎ : la police du rendu ne le porte pas partout et
                   * il sortait en tofu (rectangle vide) sur la capture du 20/08.
                   */}
                  {!decision.choixMultiple && <span className="askd-entree">Entrée</span>}
                  <span className="askd-touche">{index + 1}</span>
                </div>
              </div>
              {deplie && option.detail && <Detail detail={option.detail} />}
            </div>
          )
        })}
      </div>
      <div className="askd-pied">
        {decision.choixMultiple ? (
          <>
            <button
              type="button"
              className="askd-envoyer"
              onClick={envoyerLaSelection}
              disabled={selection.length === 0}
              data-testid="ask-decision-envoyer"
            >
              Envoyer {selection.length > 0 ? `(${selection.length})` : ''}
            </button>
            <span>plusieurs réponses possibles — cochez celles qui conviennent</span>
          </>
        ) : (
          <span>
            <span className="askd-k">Entrée</span> sur une ligne pour répondre
          </span>
        )}
        {auMoinsUnDetail && (
          <span>
            <span className="askd-k">▸</span> pour déplier le détail
          </span>
        )}
        <span>ou écrivez autre chose dans le composer</span>
      </div>
    </div>
  )
}
