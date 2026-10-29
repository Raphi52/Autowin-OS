import { useCallback, useEffect, useState } from 'react'
import type { BrainPersoState } from '../../../shared/preload-contracts'
import { langueCourante } from '../langue'
import { riche, traduire, useTextes } from '../textes'

/**
 * Renseigner le BRAIN PERSO (demande utilisateur du 2026-10-28, conv-1233 : « avoir à la fois un
 * brain d'équipe et un brain personnel »).
 *
 * Même formulaire que celui de l'équipe (`BrainSettings.tsx`) : un chemin et/ou un dépôt git. Pas de
 * redémarrage : son serveur démarre dès l'enregistrement, sur un autre port que celui de l'équipe.
 * Retirer le réglage ne supprime rien : le dossier et ses notes restent sur le disque.
 */
export function BrainPersoSettings(): React.JSX.Element {
  const { t } = useTextes()
  const [state, setState] = useState<BrainPersoState | null>(null)
  const [chemin, setChemin] = useState('')
  const [depot, setDepot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const appliquer = useCallback((suivant: BrainPersoState) => {
    setState(suivant)
    setError(suivant.erreur ?? null)
    if (!suivant.erreur) {
      setChemin(suivant.choisi?.chemin ?? '')
      setDepot(suivant.choisi?.depot ?? '')
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void (async () => {
        try {
          appliquer(await window.api.brainPerso())
        } catch {
          setError(traduire('brain.erreurLecture', langueCourante()))
        }
      })()
    })
  }, [appliquer])

  const run = useCallback(
    async (action: () => Promise<BrainPersoState>) => {
      setBusy(true)
      try {
        appliquer(await action())
      } catch {
        setError(traduire('brain.erreurChangement', langueCourante()))
      } finally {
        setBusy(false)
      }
    },
    [appliquer]
  )

  const choisirDossier = async (): Promise<void> => {
    const dossier = await window.api.choisirDossierBrain()
    if (dossier) setChemin(dossier)
  }

  return (
    <section
      className="settings-execution-workspace surface-panel"
      aria-label={t('brainPerso.titre')}
      data-testid="brain-perso"
    >
      <header>
        <div>
          <span className="domain-eyebrow">{t('settings.preflight.eyebrow')}</span>
          <h2>{t('brainPerso.titre')}</h2>
        </div>
      </header>
      <p>{riche(t('brainPerso.description'), 'b')}</p>
      {state && (
        <p data-testid="brain-perso-etat">
          {state.racine ? (
            <>
              {t('brainPerso.actif')} <code>{state.racine}</code> —{' '}
              {state.serveurJoignable ? t('brainPerso.serveurOk') : t('brainPerso.serveurAttente')}
            </>
          ) : (
            t('brainPerso.aucun')
          )}
        </p>
      )}
      <label>
        {t('brain.dossier')}
        <span style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={chemin}
            placeholder={t('brainPerso.dossier.placeholder')}
            data-testid="brain-perso-chemin"
            onChange={(event) => setChemin(event.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void choisirDossier()}
          >
            {t('brain.choisir')}
          </button>
        </span>
      </label>
      <label>
        {t('brain.depot')}
        <input
          type="text"
          value={depot}
          placeholder={t('brain.depot.placeholder')}
          data-testid="brain-perso-depot"
          onChange={(event) => setDepot(event.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <p>
        <button
          type="button"
          className="btn"
          disabled={busy || (!chemin.trim() && !depot.trim())}
          data-testid="brain-perso-enregistrer"
          onClick={() =>
            void run(() =>
              window.api.enregistrerBrainPerso({
                ...(chemin.trim() ? { chemin: chemin.trim() } : {}),
                ...(depot.trim() ? { depot: depot.trim() } : {})
              })
            )
          }
        >
          {busy ? t('diagnostic.enregistrement') : t('diagnostic.enregistrer')}
        </button>{' '}
        {state?.choisi && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            data-testid="brain-perso-retirer"
            title={t('brainPerso.retirer.note')}
            onClick={() => void run(() => window.api.resetBrainPerso())}
          >
            {t('brainPerso.retirer')}
          </button>
        )}
      </p>
      {error && (
        <p className="domain-warning" role="alert" data-testid="brain-perso-erreur">
          {error}
        </p>
      )}
      {state?.serveurSurUnAutreDossier && (
        <p className="domain-warning" role="status" data-testid="brain-perso-serveur">
          {t('brain.serveur.avant')} <code>{state.serveurRacine}</code> {t('brain.serveur.apres')}
        </p>
      )}
    </section>
  )
}
