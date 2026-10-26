import { useCallback, useEffect, useState } from 'react'
import type { BrainReglageState } from '../../../shared/preload-contracts'
import { langueCourante } from '../langue'
import { riche, traduire, useTextes } from '../textes'

/**
 * Renseigner le BRAIN : un chemin et/ou un dépôt git (demande utilisateur du 2026-10-13, conv-923).
 *
 * Au travail, un simple dossier sur un partage réseau : chemin seul, et Autowin n'y lance aucune
 * commande git. À la maison, un dépôt : Autowin le clone s'il manque, et la clôture des runs y commite
 * leurs notes. Le serveur Brain et la vue du graphe gardent leur dossier jusqu'au redémarrage :
 * l'écran le DIT, comme celui du dossier de travail.
 */
export function BrainSettings(): React.JSX.Element {
  // Textes dans la langue de Settings · Interface (conv-1146, réparation 3). `state.erreur` vient du
  // moteur : il reste tel quel, les messages du cœur de l'app ne sont pas encore traduits.
  const { t } = useTextes()
  const [state, setState] = useState<BrainReglageState | null>(null)
  const [chemin, setChemin] = useState('')
  const [depot, setDepot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const appliquer = useCallback((suivant: BrainReglageState) => {
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
          appliquer(await window.api.brainReglage())
        } catch {
          setError(traduire('brain.erreurLecture', langueCourante()))
        }
      })()
    })
  }, [appliquer])

  const run = useCallback(
    async (action: () => Promise<BrainReglageState>) => {
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
    <section className="settings-execution-workspace surface-panel" aria-label="Brain" data-testid="brain-reglage">
      <header>
        <div>
          <span className="domain-eyebrow">{t('settings.preflight.eyebrow')}</span>
          <h2>Brain</h2>
        </div>
      </header>
      <p>{riche(t('brain.description'), 'b')}</p>
      {state && (
        <p data-testid="brain-reglage-actif">
          {t('diagnostic.actif')} <code>{state.actif}</code> —{' '}
          {state.estUnDepot ? t('brain.actifDepot') : t('brain.actifDossier')}
        </p>
      )}
      <label>
        {t('brain.dossier')}
        <span style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={chemin}
            placeholder={t('brain.dossier.placeholder')}
            data-testid="brain-reglage-chemin"
            onChange={(event) => setChemin(event.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void choisirDossier()}>
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
          data-testid="brain-reglage-depot"
          onChange={(event) => setDepot(event.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <p>
        <button
          type="button"
          className="btn"
          disabled={busy}
          data-testid="brain-reglage-enregistrer"
          onClick={() =>
            void run(() =>
              window.api.enregistrerBrainReglage({
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
            data-testid="brain-reglage-reset"
            onClick={() => void run(() => window.api.resetBrainReglage())}
          >
            {t('diagnostic.revenirAuto')}
          </button>
        )}
      </p>
      {error && (
        <p className="domain-warning" role="alert" data-testid="brain-reglage-erreur">
          {error}
        </p>
      )}
      {state?.redemarrageNecessaire && (
        <p className="domain-warning" role="status" data-testid="brain-reglage-redemarrage">
          {t('brain.redemarrer.avant')} <code>{state.effectif}</code> {t('brain.redemarrer.apres')}
        </p>
      )}
      {state?.serveurSurUnAutreDossier && (
        <p className="domain-warning" role="status" data-testid="brain-reglage-serveur">
          {t('brain.serveur.avant')} <code>{state.serveurRacine}</code> {t('brain.serveur.apres')}
        </p>
      )}
    </section>
  )
}
