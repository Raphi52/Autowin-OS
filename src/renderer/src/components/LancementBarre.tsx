import { useEffect, useState } from 'react'
import { CONFIG_AUTOWIN, type EtatLancement } from '../../../shared/scripts-copie'
import { useTextesChatDecisions } from '../textes-ecrans/chat-decisions'

/**
 * LE BOUTON « LANCER » DU PANNEAU FICHIERS (2026-09-28, veille concurrentielle : le « Run » de
 * Conductor). Il lance la commande déclarée pour le dossier de la conversation — jamais une ligne
 * choisie ici : le principal lit la déclaration et choisit le dossier (`ipc/lancement.ts`).
 *
 * Ce que l'écran montre, sans rien déplier : la commande exacte AVANT le clic et d'où elle vient,
 * puis l'état, le port réservé, l'adresse locale dès que le serveur l'annonce (cliquable), et la
 * fin de la sortie. Un échec dit son code et sa dernière ligne.
 */
// Deux sources sont des chemins de fichier, qui ne se traduisent pas ; la troisième est une phrase.
const SOURCES: Record<
  NonNullable<EtatLancement['source']>,
  { chemin: string } | { cle: 'lancement.source.packageJson' }
> = {
  autowin: { chemin: CONFIG_AUTOWIN },
  conductor: { chemin: '.conductor/settings.toml' },
  'package.json': { cle: 'lancement.source.packageJson' }
}

export function LancementBarre({ conversationId }: { conversationId: string }): React.JSX.Element {
  const { t } = useTextesChatDecisions()
  const [etat, setEtat] = useState<EtatLancement | null>(null)
  const [occupe, setOccupe] = useState(false)
  /** L'appel qui a échoué, mis en mots au rendu (la phrase suit la langue). */
  const [erreurAppel, setErreurAppel] = useState<
    'lancement.lectureIndisponible' | 'lancement.arretImpossible' | 'lancement.lancementImpossible'
  >()

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
        if (vivant) setErreurAppel('lancement.lectureIndisponible')
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
      setErreurAppel(enCours ? 'lancement.arretImpossible' : 'lancement.lancementImpossible')
    } finally {
      setOccupe(false)
    }
  }
  const sansCommande = etat !== null && !etat.commande && !enCours
  const libelleDeLaSource = (source: (typeof SOURCES)[keyof typeof SOURCES]): string =>
    'chemin' in source ? source.chemin : t(source.cle)
  const fin =
    etat?.statut === 'termine'
      ? t('lancement.termine', { code: etat.code ?? 0 })
      : etat?.statut === 'echec' && etat.commande
        ? (etat.code !== undefined && etat.code !== null
            ? t('lancement.echecCode', { code: etat.code })
            : t('lancement.echec')) +
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
              ? t('lancement.arreterTitre')
              : etat?.commande
                ? t('lancement.lancerTitre', { commande: etat.commande })
                : t('lancement.declarerTitre', { fichier: CONFIG_AUTOWIN })
          }
          onClick={() => void agir()}
        >
          {enCours ? t('lancement.arreter') : t('lancement.lancer')}
        </button>
        {etat?.commande ? (
          <code className="sc-lancement-commande" data-testid="sc-lancement-commande">
            {etat.commande}
          </code>
        ) : null}
        {etat?.source && etat.commande ? (
          <span className="sc-lancement-source">{libelleDeLaSource(SOURCES[etat.source])}</span>
        ) : null}
      </div>
      {sansCommande && !etat?.erreur ? (
        <div className="sc-lancement-info" data-testid="sc-lancement-vide">
          {/* « lancement » est la clé que le principal lit dans le fichier : elle se garde telle quelle. */}
          {t('lancement.aucun')} <code>&quot;lancement&quot;</code> {t('lancement.aucun.dans')}{' '}
          <code>{CONFIG_AUTOWIN}</code>.
        </div>
      ) : null}
      {enCours ? (
        <div className="sc-lancement-info" data-testid="sc-lancement-etat">
          <span className="sc-lancement-point" aria-hidden="true" /> {t('lancement.enCours')}
          {/* « port » se dit pareil en anglais. */}
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
          {etat?.erreur ?? (erreurAppel ? t(erreurAppel) : undefined)}
        </div>
      ) : null}
      {etat && etat.lignes.length > 0 ? (
        <details className="sc-lancement-sortie">
          <summary>{t('lancement.sortie', { n: etat.lignes.length })}</summary>
          <pre data-testid="sc-lancement-sortie">{etat.lignes.join('\n')}</pre>
        </details>
      ) : null}
    </div>
  )
}
