import { useCallback, useEffect, useRef, useState } from 'react'
import './ProdPassphraseGate.css'

/*
 * L'ÉCRAN DE LA PHRASE DE PASSE DE PRODUCTION.
 *
 * CE QU'IL EST : le SEUL endroit où la phrase existe en clair, et elle n'y vit que le temps de la
 * frappe. Elle part vers le processus principal par `prodPassphraseAutoriser`, et ce qui revient est
 * un jeton opaque — jamais la phrase. Elle n'entre donc à aucun moment dans une conversation, donc
 * jamais dans le contexte du modèle.
 *
 * DEUX MODES, décidés par l'état lu au montage :
 *   - AUCUNE PHRASE DÉFINIE → on propose de la définir. Tant qu'elle ne l'est pas, aucun geste de
 *     production n'est possible : l'absence de réglage ferme la porte, elle ne l'ouvre pas.
 *   - PHRASE DÉFINIE → on demande de la saisir pour la cible et l'opération affichées.
 *
 * LA CIBLE ET L'OPÉRATION SONT AFFICHÉES EN TOUTES LETTRES, et c'est le point le plus important de
 * cet écran. Autoriser à l'aveugle, ce n'est pas autoriser : l'utilisateur doit lire ce qu'il ouvre
 * AVANT de taper. Le jeton rendu ne vaudra que pour ce couple exact.
 *
 * LE CHAMP EST VIDÉ dans tous les cas de sortie — succès, échec, fermeture. Un champ de mot de passe
 * qui garde sa valeur après un refus est une fuite en attente.
 *
 * DIRECTION VISUELLE : aucune carte, aucun panneau opaque, filets or dégradés, accents sobres. Même
 * grammaire que le bloc de décision `ask`.
 */

export interface DemandeProd {
  cible: string
  operation: string
  /**
   * CE QUE LA FENÊTRE DEMANDE. `confirmation` (le défaut) : un simple « voulez-vous continuer ? ».
   * `phrase` : la phrase de passe. La fenêtre ne CHOISIT pas — le point de passage l'impose, et
   * afficher un champ de mot de passe là où une confirmation suffit ferait croire à une protection
   * plus forte qu'elle n'est.
   */
  niveau?: 'confirmation' | 'phrase'
  /** Ce que le classifieur a répondu — affiché tel quel, c'est la justification du blocage. */
  raison?: string
}

export interface ProdPassphraseGateProps {
  demande: DemandeProd
  /** Appelé avec le jeton obtenu (niveau `phrase`). Le composant ne fait rien du geste lui-même. */
  onAutorise: (jeton: string) => void
  /** Appelé quand l'utilisateur clique « Continuer » (niveau `confirmation`). */
  onConfirme?: () => void
  onAnnule: () => void
}

interface EtatPhrase {
  definie: boolean
  longueurMinimale: number
}

export function ProdPassphraseGate({
  demande,
  onAutorise,
  onConfirme,
  onAnnule
}: ProdPassphraseGateProps): React.JSX.Element {
  const [etat, setEtat] = useState<EtatPhrase | null>(null)
  const [phrase, setPhrase] = useState('')
  const [message, setMessage] = useState('')
  const [enCours, setEnCours] = useState(false)
  const champ = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let vivant = true
    void Promise.resolve(window.api.prodPassphraseEtat())
      .then((lu) => {
        if (vivant) setEtat({ definie: lu.definie, longueurMinimale: lu.longueurMinimale })
      })
      .catch(() => {
        // Un état illisible ne doit pas laisser un écran vide qui semblerait « ouvert » : on retombe
        // sur le mode le plus fermé, celui qui demande la phrase.
        if (vivant) setEtat({ definie: true, longueurMinimale: 12 })
      })
    return () => {
      vivant = false
    }
  }, [])

  useEffect(() => {
    champ.current?.focus()
  }, [etat])

  /** Vide la phrase de la mémoire du composant. Appelé sur CHAQUE sortie, y compris les refus. */
  const oublier = useCallback(() => setPhrase(''), [])

  const valider = useCallback(async () => {
    if (enCours || phrase.length === 0) return
    setEnCours(true)
    setMessage('')
    try {
      if (etat && !etat.definie) {
        const reponse = await window.api.prodPassphraseDefinir(phrase)
        oublier()
        if (!reponse.ok) {
          setMessage(reponse.erreur)
          return
        }
        setEtat({ ...etat, definie: true })
        setMessage('Phrase enregistrée. Saisis-la maintenant pour autoriser ce geste.')
        return
      }
      const reponse = await window.api.prodPassphraseAutoriser(phrase, {
        cible: demande.cible,
        operation: demande.operation
      })
      oublier()
      if (!reponse.accorde) {
        setMessage(reponse.motif)
        return
      }
      onAutorise(reponse.jeton)
    } catch {
      oublier()
      setMessage("L'autorisation n'a pas pu être demandée.")
    } finally {
      setEnCours(false)
    }
  }, [demande, enCours, etat, oublier, onAutorise, phrase])

  const annuler = useCallback(() => {
    oublier()
    onAnnule()
  }, [oublier, onAnnule])

  if (demande.niveau === 'confirmation') {
    return (
      <div className="ppg" role="dialog" aria-label="Confirmation de production">
        <div className="ppg-kicker">Production</div>
        <p className="ppg-cible">
          <b>{demande.operation}</b> sur <span className="ppg-chip">{demande.cible}</span>
        </p>
        {demande.raison && <p className="ppg-raison">{demande.raison}</p>}
        <p className="ppg-question">Voulez-vous continuer ?</p>
        <div className="ppg-actions">
          <button type="button" className="ppg-annuler" onClick={onAnnule}>
            Annuler
          </button>
          <button
            type="button"
            className="ppg-valider"
            data-testid="ppg-continuer"
            onClick={() => onConfirme?.()}
          >
            Continuer
          </button>
        </div>
        <p className="ppg-note">
          Ce geste part sur une base de production. Rien n’est encore exécuté.
        </p>
      </div>
    )
  }

  if (!etat) return <div className="ppg" aria-busy="true" />

  const definition = !etat.definie
  return (
    <div className="ppg" role="dialog" aria-label="Autorisation de production">
      <div className="ppg-kicker">Production</div>
      <p className="ppg-cible">
        <b>{demande.operation}</b> sur <span className="ppg-chip">{demande.cible}</span>
      </p>
      {demande.raison && <p className="ppg-raison">{demande.raison}</p>}

      <label className="ppg-label" htmlFor="ppg-champ">
        {definition
          ? `Définis la phrase de passe (${etat.longueurMinimale} caractères minimum)`
          : 'Phrase de passe'}
      </label>
      <input
        id="ppg-champ"
        ref={champ}
        className="ppg-champ"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={phrase}
        disabled={enCours}
        onChange={(evenement) => setPhrase(evenement.target.value)}
        onKeyDown={(evenement) => {
          if (evenement.key === 'Enter') void valider()
          if (evenement.key === 'Escape') annuler()
        }}
      />
      {message && (
        <p className="ppg-message" role="alert">
          {message}
        </p>
      )}
      <div className="ppg-actions">
        <button type="button" className="ppg-annuler" onClick={annuler}>
          Annuler
        </button>
        <button
          type="button"
          className="ppg-valider"
          disabled={enCours || phrase.length === 0}
          onClick={() => void valider()}
        >
          {definition ? 'Enregistrer' : 'Autoriser'}
        </button>
      </div>
      <p className="ppg-note">
        L’autorisation ne vaut que pour ce geste, cinq minutes, une seule fois.
      </p>
    </div>
  )
}
