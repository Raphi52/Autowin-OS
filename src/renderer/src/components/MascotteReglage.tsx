import { useEffect, useState } from 'react'
import { riche } from '../textes'
import { useTextesReglagesEtDecor } from '../textes-ecrans/reglages-et-decor'
import './MascotteReglage.css'

/** L'erreur est gardée par sa CLÉ, pour qu'un changement de langue la retraduise (conv-1170). */
type ErreurMascotte = 'mascotte.erreurLecture' | 'mascotte.erreurEnregistrement'

/**
 * Settings · Interface — « Mascotte du bureau » (conv-1145, 2026-10-25).
 *
 * La bille au-dessus de l'horloge (`src/main/mascotte.ts`) vit HORS de la fenêtre : c'est le
 * moteur qui garde le choix (`mascotte-reglage.ts`), pas le stockage de la page. L'interrupteur
 * affiche donc ce que le moteur RÉPOND, jamais ce qu'il a supposé : un enregistrement refusé ne
 * laisse pas un interrupteur dans la mauvaise position.
 */
export function MascotteReglage(): React.JSX.Element {
  const { t } = useTextesReglagesEtDecor()
  /** `null` tant que le moteur n'a pas répondu : l'interrupteur reste inerte. */
  const [affichee, setAffichee] = useState<boolean | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<ErreurMascotte | null>(null)

  useEffect(() => {
    let vivant = true
    // Sans pont (écran rendu hors de l'app, tests de l'écran Interface) : l'interrupteur reste inerte.
    const pont = window.api as Partial<typeof window.api> | undefined
    const lire = pont?.mascotteAffichee
    if (!lire) return
    const relire = (): void => {
      void lire()
        .then((oui) => {
          if (vivant) setAffichee(oui)
        })
        .catch(() => {
          if (vivant) setErreur('mascotte.erreurLecture')
        })
    }
    relire()
    // La croix de la bille la ferme HORS de cette fenêtre (conv-1142) : relu au retour dans
    // Autowin, sinon l'interrupteur dirait encore « Affichée ».
    window.addEventListener('focus', relire)
    return () => {
      vivant = false
      window.removeEventListener('focus', relire)
    }
  }, [])

  const basculer = async (): Promise<void> => {
    if (affichee === null || occupe) return
    setOccupe(true)
    setErreur(null)
    try {
      setAffichee(await window.api.afficherMascotte(!affichee))
    } catch {
      setErreur('mascotte.erreurEnregistrement')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="interface-row" data-testid="interface-mascotte">
      <div className="interface-row-text">
        <strong>{t('mascotte.titre')}</strong>
        <p>{riche(t('mascotte.description'))}</p>
        {erreur && <p className="mascotte-reglage-erreur">{t(erreur)}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={affichee === true}
        aria-label={t('mascotte.interrupteur')}
        className={`mascotte-switch${affichee ? ' is-on' : ''}`}
        disabled={affichee === null || occupe}
        data-testid="interface-mascotte-switch"
        onClick={() => void basculer()}
      >
        <i />
        <span>
          {affichee === null ? '…' : affichee ? t('mascotte.affichee') : t('mascotte.masquee')}
        </span>
      </button>
    </div>
  )
}
