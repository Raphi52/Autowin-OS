import { useState } from 'react'
import { useTextesSettings } from '../textes-ecrans/settings'
import { ModuleHeader } from './ModuleHeader'
import { CLE_SEUILS_CHAINE_AUTO, SEUILS_CHAINE_DEFAUT, lireSeuilsChaine } from './chat-auto-mode'
import './OrchestrationBudgetSettings.css'

/**
 * SEUILS DU GARDE-FOU DE LA CHAÎNE ∞ (demande du 2026-10-02, conv-38). Stockés dans l'interface,
 * comme la liste des fils armés (`CLE_MODE_AUTO_CONVS`) : le chat les relit à CHAQUE décision
 * d'envoi automatique, donc un changement vaut dès le tour suivant, sans redémarrage.
 */
export function ModeAutoSeuilsSettings(): React.JSX.Element {
  const { t } = useTextesSettings()
  const initial = lireSeuilsChaine(window.localStorage.getItem(CLE_SEUILS_CHAINE_AUTO))
  const [quota, setQuota] = useState(String(initial.quotaHebdoPct))
  const [tours, setTours] = useState(String(initial.toursAutoMax))
  const [message, setMessage] = useState('')

  const enregistrer = (): void => {
    const quotaHebdoPct = Number(quota)
    const toursAutoMax = Number(tours)
    if (!Number.isInteger(quotaHebdoPct) || quotaHebdoPct < 1 || quotaHebdoPct > 100) {
      setMessage(t('modeAuto.quotaInvalide'))
      return
    }
    // fix-ok: cause mesurée — le panneau acceptait 5000 tours alors que lireSeuilsChaine borne à 1000 : réglage ignoré en silence (test « refuse plus de 1000 tours » rouge→vert).
    if (!Number.isInteger(toursAutoMax) || toursAutoMax < 1 || toursAutoMax > 1000) {
      setMessage(t('modeAuto.toursInvalides'))
      return
    }
    window.localStorage.setItem(
      CLE_SEUILS_CHAINE_AUTO,
      JSON.stringify({ quotaHebdoPct, toursAutoMax })
    )
    setMessage(t('modeAuto.enregistres'))
  }

  return (
    <section
      className="orchestration-budget surface-panel"
      aria-label={t('modeAuto.aria')}
      data-testid="mode-auto-seuils"
    >
      <ModuleHeader eyebrow={t('modeAuto.eyebrow')} title={t('modeAuto.titre')} />
      <p>
        {t('modeAuto.description', {
          quota: SEUILS_CHAINE_DEFAUT.quotaHebdoPct,
          tours: SEUILS_CHAINE_DEFAUT.toursAutoMax
        })}
      </p>
      <label>
        <span>{t('modeAuto.quota')}</span>
        <div className="orchestration-budget-input">
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            data-testid="mode-auto-seuil-quota"
            value={quota}
            onChange={(event) => setQuota(event.target.value)}
          />
        </div>
      </label>
      <label>
        <span>{t('modeAuto.tours')}</span>
        <div className="orchestration-budget-input">
          <input
            type="number"
            min="1"
            max="1000"
            step="1"
            data-testid="mode-auto-seuil-tours"
            value={tours}
            onChange={(event) => setTours(event.target.value)}
          />
        </div>
      </label>
      <button
        type="button"
        className="btn btn-accent"
        data-testid="mode-auto-seuils-enregistrer"
        onClick={enregistrer}
      >
        {t('modeAuto.enregistrer')}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
