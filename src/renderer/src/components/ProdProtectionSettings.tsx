import { useCallback, useEffect, useState } from 'react'
import type {
  EtatPorteProd,
  NiveauProtectionProd,
  PropositionAutoriteProd
} from '../../../shared/prod-protection'
import './ProdProtectionSettings.css'

/**
 * RÉGLAGE DE LA PROTECTION DE PRODUCTION — définir ou changer la phrase de passe, et voir EN CLAIR
 * si la protection tourne ou si elle dort.
 *
 * POURQUOI CET ÉCRAN EXISTE. Jusqu'ici la phrase ne pouvait se définir qu'au moment d'un refus : il
 * fallait déclencher un geste bloqué pour installer la protection. Pire, rien ne disait qu'elle
 * n'était PAS active — et une protection qu'on croit active alors qu'elle dort est plus dangereuse
 * que pas de protection du tout.
 *
 * CE QUI EST AFFICHÉ SANS DÉTOUR :
 *   - la porte tourne, ou elle dort (et pourquoi) ;
 *   - combien de cibles sont déclarées — ZÉRO signifie que TOUT sera traité comme de la production
 *     dès que la phrase existera, maquettes comprises ;
 *   - le fichier de déclaration et les lignes qu'il a fallu écarter.
 *
 * CE QUI N'EST JAMAIS AFFICHÉ : la phrase, sa longueur, son empreinte. Les champs sont masqués et
 * vidés à chaque sortie — un champ de mot de passe qui garde sa valeur est une fuite en attente.
 *
 * CHANGER EXIGE LA PHRASE EN COURS. Le processus principal le vérifie (c'est lui l'autorité) ;
 * l'écran se contente de demander le champ correspondant.
 */
export function ProdProtectionSettings(): React.JSX.Element {
  const [porte, setPorte] = useState<EtatPorteProd | null>(null)
  const [definie, setDefinie] = useState<boolean | null>(null)
  const [longueurMinimale, setLongueurMinimale] = useState(12)
  const [actuelle, setActuelle] = useState('')
  const [nouvelle, setNouvelle] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [proposition, setProposition] = useState<PropositionAutoriteProd | null>(null)
  const [calcul, setCalcul] = useState(false)
  const [copie, setCopie] = useState<'copie' | 'echec' | null>(null)

  /**
   * LA LISTE PROPOSÉE DEPUIS LE CATALOGUE SQL. Le catalogue n'est interrogé qu'au clic, et rien
   * n'est écrit : l'utilisateur recopie lui-même le contenu dans son fichier de déclaration.
   */
  const proposer = useCallback(async () => {
    setCalcul(true)
    setCopie(null)
    try {
      setProposition(await window.api.prodAutoriteProposition())
    } catch {
      setProposition({ ok: false, erreur: "La proposition n'a pas pu être calculée." })
    } finally {
      setCalcul(false)
    }
  }, [])

  const copier = useCallback(async (contenu: string) => {
    try {
      await navigator.clipboard.writeText(contenu)
      setCopie('copie')
    } catch {
      setCopie('echec')
    }
  }, [])

  const relire = useCallback(async () => {
    try {
      const [etatPorte, etatPhrase] = await Promise.all([
        window.api.prodPorteEtat(),
        window.api.prodPassphraseEtat()
      ])
      setPorte(etatPorte)
      setDefinie(etatPhrase.definie)
      setLongueurMinimale(etatPhrase.longueurMinimale)
    } catch {
      // Un état illisible ne doit pas laisser croire que la protection tourne : on affiche le mode
      // le plus prudent, « inconnu », plutôt qu'un écran vide qui aurait l'air normal.
      setPorte(null)
      setDefinie(null)
    }
  }, [])

  const changerNiveau = useCallback(
    async (niveau: NiveauProtectionProd) => {
      setMessage(null)
      try {
        const reponse = await window.api.prodPorteNiveau(niveau)
        if (!reponse.ok) {
          setMessage({ ton: 'erreur', texte: reponse.erreur ?? 'Niveau refusé.' })
          return
        }
        await relire()
      } catch {
        setMessage({ ton: 'erreur', texte: "Le niveau n'a pas pu être changé." })
      }
    },
    // `relire` est stable ; la dépendance est déclarée pour que le lien reste visible.
    [relire]
  )

  useEffect(() => {
    queueMicrotask(() => void relire())
  }, [relire])

  /** Vide les trois champs. Appelé sur CHAQUE sortie, réussie ou non. */
  const oublier = useCallback(() => {
    setActuelle('')
    setNouvelle('')
    setConfirmation('')
  }, [])

  const enregistrer = useCallback(async () => {
    if (occupe) return
    if (nouvelle !== confirmation) {
      setMessage({ ton: 'erreur', texte: 'Les deux saisies ne correspondent pas.' })
      return
    }
    setOccupe(true)
    setMessage(null)
    try {
      const reponse = await window.api.prodPassphraseDefinir(
        nouvelle,
        definie ? actuelle : undefined
      )
      oublier()
      if (!reponse.ok) {
        setMessage({ ton: 'erreur', texte: reponse.erreur })
        return
      }
      setMessage({
        ton: 'ok',
        texte: definie
          ? 'Phrase changée. Les autorisations en cours sont annulées.'
          : 'Protection activée. Tout geste de production demandera désormais cette phrase.'
      })
      await relire()
    } catch {
      oublier()
      setMessage({ ton: 'erreur', texte: "Le réglage n'a pas pu être enregistré." })
    } finally {
      setOccupe(false)
    }
  }, [actuelle, confirmation, definie, nouvelle, occupe, oublier, relire])

  const etatLisible =
    porte === null
      ? { mot: 'Inconnu', detail: "L'état de la protection n'a pas pu être lu." }
      : porte.niveau === 'aucun'
        ? { mot: 'Inactive', detail: porte.raison }
        : { mot: 'Active', detail: porte.raison }

  return (
    <section
      className="settings-prod-protection surface-panel"
      aria-label="Rule Production"
      data-testid="prod-protection"
    >
      <header>
        <div>
          {/* Règle d'Autowin OS, affichée dans l'onglet Rules de Settings (voir RulesView). */}
          <span className="domain-eyebrow">Rule · Autowin OS</span>
          <h2>Production</h2>
        </div>
        <span
          className={`prod-etat prod-etat-${porte === null ? 'inconnu' : porte.niveau === 'aucun' ? 'inactive' : 'active'}`}
          data-testid="prod-protection-etat"
        >
          {etatLisible.mot}
        </span>
      </header>
      <p className="prod-detail">{etatLisible.detail}</p>

      {porte && (
        <ul className="prod-faits">
          <li data-testid="prod-protection-declarees">
            <b>{porte.declarees}</b> cible{porte.declarees > 1 ? 's' : ''} déclarée
            {porte.declarees > 1 ? 's' : ''}
            {porte.declarees === 0 && (
              <>
                {' '}
                — <b>tout</b> sera traité comme de la production, maquettes comprises, dès que la
                phrase existera.
              </>
            )}
          </li>
          <li>
            Fichier de déclaration : <code>{porte.chemin}</code>
          </li>
          {porte.anomalies.length > 0 && (
            <li data-testid="prod-protection-anomalies">
              <b>{porte.anomalies.length}</b> ligne(s) écartée(s) : {porte.anomalies.join(' · ')}
            </li>
          )}
        </ul>
      )}

      <div className="prod-catalogue" data-testid="prod-catalogue">
        <button
          type="button"
          className="btn"
          data-testid="prod-catalogue-proposer"
          disabled={calcul}
          onClick={() => void proposer()}
        >
          {calcul ? 'Lecture du catalogue…' : 'Proposer la liste depuis le catalogue SQL'}
        </button>
        {proposition && !proposition.ok && (
          <p className="prod-message prod-message-erreur" role="alert">
            {proposition.erreur}
          </p>
        )}
        {proposition?.ok && (
          <>
            <p data-testid="prod-catalogue-resume">
              Le catalogue déclare <b>{proposition.exploitees}</b> base(s) exploitée(s).{' '}
              <b>{proposition.ajoutees.length}</b> base(s) à ajouter (
              <b>{proposition.ajoutees.filter((a) => a.classe === 'prod').length}</b> en production,{' '}
              <b>{proposition.ajoutees.filter((a) => a.classe === 'non-prod').length}</b> hors
              production) · <b>{proposition.passeesEnProd.length}</b> passée(s) en production ·{' '}
              <b>{proposition.conservees}</b> entrée(s) actuelle(s) reprise(s).
            </p>
            {proposition.passeesEnProd.length > 0 && (
              <p data-testid="prod-catalogue-prod">
                Déclarées hors production mais exploitées selon le catalogue, donc passées en
                production : <b>{proposition.passeesEnProd.join(', ')}</b>
              </p>
            )}
            {proposition.anomalies.length > 0 && (
              <p>Non repris de ton fichier actuel : {proposition.anomalies.join(' · ')}</p>
            )}
            {proposition.ajoutees.length === 0 && proposition.passeesEnProd.length === 0 ? (
              <p>
                Ta déclaration <b>couvre déjà tout le catalogue</b> : rien à changer.
              </p>
            ) : (
              <>
                <textarea
                  className="prod-catalogue-contenu"
                  data-testid="prod-catalogue-contenu"
                  readOnly
                  rows={8}
                  value={proposition.contenu}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void copier(proposition.contenu)}
                >
                  {copie === 'copie' ? 'Copié' : 'Copier'}
                </button>
                {copie === 'echec' && (
                  <p className="prod-message prod-message-erreur" role="alert">
                    La copie a échoué : sélectionne le texte ci-dessus à la main.
                  </p>
                )}
              </>
            )}
            <p className="prod-note">
              Autowin n’écrit jamais ce fichier : colle ce contenu dans le fichier de déclaration
              indiqué plus haut, puis rouvre cet écran pour vérifier le nombre de cibles déclarées.
            </p>
          </>
        )}
      </div>

      <fieldset className="prod-niveaux" data-testid="prod-protection-niveaux">
        <legend>Ce qu’Autowin demande avant d’agir sur une base de production</legend>
        {(
          [
            ['confirmation', 'Une fenêtre « voulez-vous continuer ? »', 'Recommandé'],
            ['phrase', 'La phrase de passe', 'Postes partagés'],
            ['aucun', 'Rien du tout', 'Protection désactivée']
          ] as [NiveauProtectionProd, string, string][]
        ).map(([valeur, libelle, note]) => (
          <label key={valeur} className="prod-niveau" htmlFor={`prod-niveau-${valeur}`}>
            <input
              id={`prod-niveau-${valeur}`}
              type="radio"
              name="prod-niveau"
              value={valeur}
              checked={porte?.niveau === valeur}
              onChange={() => void changerNiveau(valeur)}
            />
            <span>
              <b>{libelle}</b> <span className="prod-niveau-note">{note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="prod-formulaire" hidden={porte?.niveau !== 'phrase'}>
        {definie && (
          <label className="prod-label" htmlFor="prod-actuelle">
            Phrase de passe actuelle
            <input
              id="prod-actuelle"
              type="password"
              autoComplete="off"
              value={actuelle}
              disabled={occupe}
              onChange={(evenement) => setActuelle(evenement.target.value)}
            />
          </label>
        )}
        <label className="prod-label" htmlFor="prod-nouvelle">
          {definie ? 'Nouvelle phrase' : 'Phrase de passe'} ({longueurMinimale} caractères minimum)
          <input
            id="prod-nouvelle"
            type="password"
            autoComplete="off"
            value={nouvelle}
            disabled={occupe}
            onChange={(evenement) => setNouvelle(evenement.target.value)}
          />
        </label>
        <label className="prod-label" htmlFor="prod-confirmation">
          Confirmation
          <input
            id="prod-confirmation"
            type="password"
            autoComplete="off"
            value={confirmation}
            disabled={occupe}
            onChange={(evenement) => setConfirmation(evenement.target.value)}
          />
        </label>
        <button
          type="button"
          className="prod-valider btn btn-accent"
          data-testid="prod-protection-valider"
          disabled={occupe || nouvelle.length === 0 || confirmation.length === 0}
          onClick={() => void enregistrer()}
        >
          {definie ? 'Changer la phrase' : 'Activer la protection'}
        </button>
      </div>

      {message && (
        <p className={`prod-message prod-message-${message.ton}`} role="alert">
          {message.texte}
        </p>
      )}
      <p className="prod-note">
        La phrase n’est jamais enregistrée en clair, ni envoyée à un modèle. Changer la phrase
        annule les autorisations déjà accordées.
      </p>
    </section>
  )
}
