import { useEffect, useState } from 'react'
import { riche } from '../textes'
import { useTextesReglagesEtDecor } from '../textes-ecrans/reglages-et-decor'
import './MascotteReglage.css'

/** L'erreur est gardée par sa CLÉ, pour qu'un changement de langue la retraduise (conv-1170). */
type ErreurMascotte = 'mascotte.erreurLecture' | 'mascotte.erreurEnregistrement'

/** Les deux styles (conv-1249) ; le moteur refuse tout autre texte. */
type StyleMascotte = 'magicien' | 'basique'
const STYLES: readonly StyleMascotte[] = ['magicien', 'basique']

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
  /** Même règle que l'interrupteur : `null` tant que le moteur n'a pas répondu, liste inerte. */
  const [style, setStyle] = useState<StyleMascotte | null>(null)
  const [occupeStyle, setOccupeStyle] = useState(false)

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
    // Le style se lit une fois : seul cet écran le change (conv-1249).
    const lireStyle = pont?.styleMascotte
    if (lireStyle)
      void lireStyle()
        .then((lu) => {
          if (vivant) setStyle(lu)
        })
        .catch(() => {
          if (vivant) setErreur('mascotte.erreurLecture')
        })
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

  const choisirStyle = async (choisi: StyleMascotte): Promise<void> => {
    if (style === null || occupeStyle || choisi === style) return
    setOccupeStyle(true)
    setErreur(null)
    try {
      setStyle(await window.api.choisirStyleMascotte(choisi))
    } catch {
      setErreur('mascotte.erreurEnregistrement')
    } finally {
      setOccupeStyle(false)
    }
  }

  return (
    <>
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
      {/* MAGICIEN OU BASIQUE (conv-1249, « dans settings interface met choix de mascotte soit
        magicien soit basique ») : une liste, comme le thème et la langue juste au-dessus. La
        liste montre ce que le moteur a GARDÉ, jamais ce qu'elle a demandé. */}
      <div className="interface-row" data-testid="interface-mascotte-style-ligne">
        <div className="interface-row-text">
          <strong>{t('mascotte.style.titre')}</strong>
          <p>{riche(t('mascotte.style.description'))}</p>
        </div>
        <label className="interface-theme-choix">
          <span className="interface-theme-label">{t('mascotte.style.titre')}</span>
          <select
            className="interface-theme-select select"
            value={style ?? ''}
            aria-label={t('mascotte.style.titre')}
            data-testid="interface-mascotte-style"
            disabled={style === null || occupeStyle}
            onChange={(e) => void choisirStyle(e.target.value as StyleMascotte)}
          >
            {style === null && <option value="">…</option>}
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`mascotte.style.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  )
}
