import { useEffect, useRef, useState } from 'react'
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
 * TOKENS      or --gold-doux → --gold-clair · texte #dde3ee · secondaire #a9b2c4 · separateur blanc 7 %
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
  dejaRepondu,
  onPick
}: {
  decision: AskDecision
  /**
   * La question a DEJA sa reponse dans le fil (un message utilisateur suit ce tour). Source
   * DURABLE, calculee depuis les messages : elle survit a un remontage, a un changement de
   * conversation et a un redemarrage, contrairement a l'etat local qui, lui, repartait a zero.
   */
  dejaRepondu?: boolean
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

  /*
   * UNE QUESTION NE SE REPOND QU'UNE FOIS -- verrou a DEUX etages.
   *
   * VECU le 2026-08-25 puis le 2026-08-26 : le premier verrou etait un `useState` local. Deux
   * fuites, et le spam-clic passait par les deux. (1) `setState` est ASYNCHRONE : deux clics dans
   * le meme lot de rendu lisaient tous les deux `repondu === undefined` et deux envois partaient.
   * (2) le bloc etait monte sous une cle d'INDEX ; la moindre part ajoutee au flux le remontait et
   * l'etat local disparaissait avec lui -- le bloc redevenait vierge alors que la reponse etait
   * deja partie.
   *
   * Etage 1 : un `ref`, ecrit SYNCHRONEMENT au premier clic -- il ferme la porte avant meme que
   * React ait re-rendu, donc le second clic du double-clic ne trouve plus rien d'ouvert.
   * Etage 2 : `dejaRepondu`, derive du FIL (un message utilisateur apres ce tour). C'est la source
   * durable : rien a persister, et elle est vraie apres un remontage comme apres un redemarrage.
   */
  const [repondu, setRepondu] = useState<string | undefined>(undefined)
  const verrou = useRef(false)
  const hote = useRef<HTMLDivElement>(null)
  // Lu au RENDU : l'etat et le fil seulement. Le `ref` ne sert qu'au clic (garde synchrone) —
  // le lire ici serait une lecture de ref pendant le rendu, que React interdit.
  const verrouille = repondu !== undefined || dejaRepondu === true
  const repondre = (prompt: string): void => {
    if (verrou.current || repondu !== undefined || dejaRepondu === true) return
    verrou.current = true
    setRepondu(prompt)
    onPick?.(prompt)
  }

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
    if (!selection.length || verrouille) return
    // Meme verrou que le choix simple : `repondre` refuse un second envoi.
    repondre(promptDesOptions(selection))
  }

  /*
   * LES TOUCHES 1..N REPONDENT VRAIMENT.
   *
   * Le bloc AFFICHAIT deja `1`, `2`, `3` a droite de chaque ligne — sans aucun gestionnaire
   * derriere. Une etiquette qui ment : l'utilisateur tape `2`, rien ne se passe, et il retourne a
   * la souris. Parite claude.exe, qui repond au chiffre. Le raccourci ne mord PAS quand la frappe
   * appartient a un champ (composer, recherche) ni quand un modificateur est enfonce, et il meurt
   * avec le verrou — un bloc repondu n'ecoute plus rien.
   */
  useEffect(() => {
    if (verrouille) return
    const auClavier = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const cible = event.target as HTMLElement | null
      if (cible?.isContentEditable) return
      const balise = cible?.tagName
      if (balise === 'INPUT' || balise === 'TEXTAREA' || balise === 'SELECT') return
      /*
       * UNE SEULE question ecoute : la DERNIERE encore ouverte. Deux blocs `ask` dans le fil
       * auraient sinon repondu tous les deux au meme chiffre, envoyant deux messages pour une
       * frappe. Le fil place deja la decision courante en dernier ; on s'aligne dessus.
       */
      const ouverts = document.querySelectorAll('[data-testid="ask-decision"]:not([data-repondu])')
      if (ouverts.length && ouverts[ouverts.length - 1] !== hote.current) return
      const rang = Number(event.key)
      if (!Number.isInteger(rang) || rang < 1 || rang > decision.options.length) return
      event.preventDefault()
      const option = decision.options[rang - 1]
      // Choix multiple : le chiffre COCHE, il n'envoie pas — l'envoi reste un geste explicite.
      if (decision.choixMultiple) cocher(rang - 1)
      else repondre(promptDeLOption(option))
    }
    document.addEventListener('keydown', auClavier)
    return () => document.removeEventListener('keydown', auClavier)
  })


  return (
    <div
      ref={hote}
      className={`askd${verrouille ? ' est-repondu' : ''}`}
      data-testid="ask-decision"
      data-repondu={verrouille ? 'oui' : undefined}
      aria-disabled={verrouille}
    >
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
                      disabled={verrouille}
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
                    disabled={verrouille}
                    aria-disabled={verrouille}
                    data-choisi={repondu === promptDeLOption(option) ? 'oui' : undefined}
                    onClick={() => repondre(promptDeLOption(option))}
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
        {verrouille ? (
          /* Ce que claude.exe fait aussi : la question reste LISIBLE, mais elle est close. Le bloc
             ne redevient jamais cliquable -- la suite de la conversation est la reponse. */
          <span data-testid="ask-decision-close">Répondu — écrivez la suite dans le composer</span>
        ) : decision.choixMultiple ? (
          <>
            <button
              type="button"
              className="askd-envoyer"
              onClick={envoyerLaSelection}
              disabled={selection.length === 0 || verrouille}
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
