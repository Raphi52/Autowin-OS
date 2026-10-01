import { useEffect, useState } from 'react'
import { CONFIG_AUTOWIN, type EtatLancement } from '../../../shared/scripts-copie'

/**
 * LE BOUTON « LANCER » DU PANNEAU FICHIERS (2026-09-28, veille concurrentielle : le « Run » de
 * Conductor). Il lance la commande déclarée pour le dossier de la conversation — jamais une ligne
 * choisie ici : le principal lit la déclaration et choisit le dossier (`ipc/lancement.ts`).
 *
 * Ce que l'écran montre, sans rien déplier : la commande exacte AVANT le clic et d'où elle vient,
 * puis l'état, le port réservé, l'adresse locale dès que le serveur l'annonce (cliquable), et la
 * fin de la sortie. Un échec dit son code et sa dernière ligne.
 */
const SOURCES: Record<NonNullable<EtatLancement['source']>, string> = {
  autowin: CONFIG_AUTOWIN,
  conductor: '.conductor/settings.toml',
  'package.json': 'détecté dans package.json'
}

export function LancementBarre({ conversationId }: { conversationId: string }): React.JSX.Element {
  const [etat, setEtat] = useState<EtatLancement | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreurAppel, setErreurAppel] = useState<string>()

  // Pas de remise à zéro ici : le parent monte la barre avec `key={conversationId}`, donc un
  // changement de conversation repart d'un composant neuf (état vide) au lieu d'effacer celui-ci.
  useEffect(() => {
    let vivant = true
    void window.api
      .lancementEtat?.(conversationId)
      .then((e) => {
        if (vivant) setEtat(e)
      })
      .catch(() => {
        if (vivant) setErreurAppel('Lecture du lancement indisponible.')
      })
    const off = window.api.onLancement?.((maj) => {
      if (maj.conversationId === conversationId) setEtat(maj.etat)
    })
    return () => {
      vivant = false
      off?.()
    }
  }, [conversationId])

  if (!window.api.lancementEtat) return <></>
  const enCours = etat?.statut === 'en-cours'
  const agir = async (): Promise<void> => {
    setOccupe(true)
    setErreurAppel(undefined)
    try {
      const suivant = enCours
        ? await window.api.lancementArreter(conversationId)
        : await window.api.lancementDemarrer(conversationId)
      setEtat(suivant)
    } catch {
      setErreurAppel(enCours ? 'Arrêt impossible.' : 'Lancement impossible.')
    } finally {
      setOccupe(false)
    }
  }
  const sansCommande = etat !== null && !etat.commande && !enCours
  const fin =
    etat?.statut === 'termine'
      ? `Terminé (code ${etat.code ?? 0})`
      : etat?.statut === 'echec' && etat.commande
        ? `Échec${etat.code !== undefined && etat.code !== null ? ` (code ${etat.code})` : ''}` +
          (etat.lignes.length ? ` — ${etat.lignes[etat.lignes.length - 1]}` : '')
        : undefined

  return (
    <div
      className="sc-lancement"
      data-testid="sc-lancement"
      data-statut={etat?.statut ?? 'lecture'}
    >
      <div className="sc-lancement-ligne">
        <button
          className={`sc-btn sc-lancement-bouton${enCours ? ' is-on' : ''}`}
          data-testid="sc-lancement-bouton"
          disabled={occupe || etat === null || sansCommande}
          title={
            enCours
              ? 'Arrête la commande et tous les processus qu’elle a lancés'
              : etat?.commande
                ? `Lance « ${etat.commande} » dans le dossier de cette conversation`
                : `Déclare « lancement » dans ${CONFIG_AUTOWIN}`
          }
          onClick={() => void agir()}
        >
          {enCours ? '■ Arrêter' : '▶ Lancer'}
        </button>
        {etat?.commande ? (
          <code className="sc-lancement-commande" data-testid="sc-lancement-commande">
            {etat.commande}
          </code>
        ) : null}
        {etat?.source && etat.commande ? (
          <span className="sc-lancement-source">{SOURCES[etat.source]}</span>
        ) : null}
      </div>
      {sansCommande && !etat?.erreur ? (
        <div className="sc-lancement-info" data-testid="sc-lancement-vide">
          Aucun lancement déclaré : ajoute <code>&quot;lancement&quot;</code> dans{' '}
          <code>{CONFIG_AUTOWIN}</code>.
        </div>
      ) : null}
      {enCours ? (
        <div className="sc-lancement-info" data-testid="sc-lancement-etat">
          <span className="sc-lancement-point" aria-hidden="true" /> En cours
          {etat?.port ? ` · port ${etat.port}` : ''}
          {etat?.adresse ? (
            <>
              {' · '}
              <a
                href={etat.adresse}
                target="_blank"
                rel="noreferrer"
                data-testid="sc-lancement-adresse"
              >
                {etat.adresse}
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {fin ? (
        <div
          className={`sc-lancement-info${etat?.statut === 'echec' ? ' is-echec' : ''}`}
          data-testid="sc-lancement-fin"
        >
          {fin}
        </div>
      ) : null}
      {etat?.erreur || erreurAppel ? (
        <div className="sc-lancement-info is-echec" data-testid="sc-lancement-erreur" role="alert">
          {etat?.erreur ?? erreurAppel}
        </div>
      ) : null}
      {etat && etat.lignes.length > 0 ? (
        <details className="sc-lancement-sortie">
          <summary>Sortie · {etat.lignes.length} dernière(s) ligne(s)</summary>
          <pre data-testid="sc-lancement-sortie">{etat.lignes.join('\n')}</pre>
        </details>
      ) : null}
    </div>
  )
}
