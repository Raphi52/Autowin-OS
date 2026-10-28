import { useCallback, useEffect, useState } from 'react'
import { Spinner } from './Spinner'
import { langueCourante } from '../langue'
import { riche } from '../textes'
import { traduireSettings, useTextesSettings, type CleSettings } from '../textes-ecrans/settings'
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
  // Textes dans la langue de Settings · Interface (conv-1170). Les messages posés par un rappel le
  // sont dans la langue du moment (`dire`) ; ce qui vient du processus principal (`porte.raison`,
  // `reponse.erreur`, `proposition.erreur`) reste tel quel : les messages du cœur ne sont pas traduits.
  const { t } = useTextesSettings()
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
  const dire = (cle: CleSettings): string => traduireSettings(cle, langueCourante())

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
      setProposition({ ok: false, erreur: dire('prod.propositionEchec') })
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
          setMessage({ ton: 'erreur', texte: reponse.erreur ?? dire('prod.niveauRefuse') })
          return
        }
        await relire()
      } catch {
        setMessage({ ton: 'erreur', texte: dire('prod.niveauEchec') })
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
      setMessage({ ton: 'erreur', texte: dire('prod.saisiesDifferentes') })
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
        texte: definie ? dire('prod.phraseChangee') : dire('prod.protectionActivee')
      })
      await relire()
    } catch {
      oublier()
      setMessage({ ton: 'erreur', texte: dire('prod.reglageEchec') })
    } finally {
      setOccupe(false)
    }
  }, [actuelle, confirmation, definie, nouvelle, occupe, oublier, relire])

  const etatLisible =
    porte === null
      ? { mot: t('prod.inconnu'), detail: t('prod.etatIllisible') }
      : // « Inactive » / « Active » : même mot dans les deux langues.
        porte.niveau === 'aucun'
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
            <b>{porte.declarees}</b>{' '}
            {porte.declarees > 1 ? t('prod.ciblesDeclarees') : t('prod.cibleDeclaree')}
            {porte.declarees === 0 && <> {riche(t('prod.toutEnProd'), 'b')}</>}
          </li>
          <li>
            {t('prod.fichierDeclaration')} <code>{porte.chemin}</code>
          </li>
          {porte.anomalies.length > 0 && (
            <li data-testid="prod-protection-anomalies">
              <b>{porte.anomalies.length}</b>{' '}
              {t('prod.lignesEcartees', { liste: porte.anomalies.join(' · ') })}
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
          {calcul ? (
            <>
              <Spinner size={12} /> {t('prod.lectureCatalogue')}
            </>
          ) : (
            t('prod.proposer')
          )}
        </button>
        {proposition && !proposition.ok && (
          <p className="prod-message prod-message-erreur" role="alert">
            {proposition.erreur}
          </p>
        )}
        {proposition?.ok && (
          <>
            <p data-testid="prod-catalogue-resume">
              {riche(
                t('prod.resume', {
                  exploitees: proposition.exploitees,
                  ajoutees: proposition.ajoutees.length,
                  enProd: proposition.ajoutees.filter((a) => a.classe === 'prod').length,
                  horsProd: proposition.ajoutees.filter((a) => a.classe === 'non-prod').length,
                  passees: proposition.passeesEnProd.length,
                  conservees: proposition.conservees
                }),
                'b'
              )}
            </p>
            {proposition.passeesEnProd.length > 0 && (
              <p data-testid="prod-catalogue-prod">
                {riche(
                  t('prod.passeesEnProd', { liste: proposition.passeesEnProd.join(', ') }),
                  'b'
                )}
              </p>
            )}
            {proposition.anomalies.length > 0 && (
              <p>{t('prod.nonRepris', { liste: proposition.anomalies.join(' · ') })}</p>
            )}
            {proposition.ajoutees.length === 0 && proposition.passeesEnProd.length === 0 ? (
              <p>{riche(t('prod.couvreDeja'), 'b')}</p>
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
                  {copie === 'copie' ? t('prod.copie') : t('prod.copier')}
                </button>
                {copie === 'echec' && (
                  <p className="prod-message prod-message-erreur" role="alert">
                    {t('prod.copieEchec')}
                  </p>
                )}
              </>
            )}
            <p className="prod-note">{t('prod.noteCatalogue')}</p>
          </>
        )}
      </div>

      <fieldset className="prod-niveaux" data-testid="prod-protection-niveaux">
        <legend>{t('prod.niveaux')}</legend>
        {(
          [
            ['confirmation', 'prod.niveau.confirmation', 'prod.niveau.confirmation.note'],
            ['phrase', 'prod.niveau.phrase', 'prod.niveau.phrase.note'],
            ['aucun', 'prod.niveau.aucun', 'prod.niveau.aucun.note']
          ] as [NiveauProtectionProd, CleSettings, CleSettings][]
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
              <b>{t(libelle)}</b> <span className="prod-niveau-note">{t(note)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="prod-formulaire" hidden={porte?.niveau !== 'phrase'}>
        {definie && (
          <label className="prod-label" htmlFor="prod-actuelle">
            {t('prod.phraseActuelle')}
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
          {t(definie ? 'prod.nouvellePhrase' : 'prod.phraseDePasse', { n: longueurMinimale })}
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
          {definie ? t('prod.changerPhrase') : t('prod.activer')}
        </button>
      </div>

      {message && (
        <p className={`prod-message prod-message-${message.ton}`} role="alert">
          {message.texte}
        </p>
      )}
      <p className="prod-note">{t('prod.notePhrase')}</p>
    </section>
  )
}
