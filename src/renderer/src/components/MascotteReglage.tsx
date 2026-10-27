import { useEffect, useState } from 'react'
import './MascotteReglage.css'

/**
 * Settings · Interface — « Mascotte du bureau » (conv-1145, 2026-10-25).
 *
 * La bille au-dessus de l'horloge (`src/main/mascotte.ts`) vit HORS de la fenêtre : c'est le
 * moteur qui garde le choix (`mascotte-reglage.ts`), pas le stockage de la page. L'interrupteur
 * affiche donc ce que le moteur RÉPOND, jamais ce qu'il a supposé : un enregistrement refusé ne
 * laisse pas un interrupteur dans la mauvaise position.
 */
export function MascotteReglage(): React.JSX.Element {
  /** `null` tant que le moteur n'a pas répondu : l'interrupteur reste inerte. */
  const [affichee, setAffichee] = useState<boolean | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

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
          if (vivant) setErreur('Le réglage de la mascotte n’a pas pu être lu.')
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
      setErreur('Le choix n’a pas pu être enregistré : la mascotte reste comme avant.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="interface-row" data-testid="interface-mascotte">
      <div className="interface-row-text">
        <strong>Mascotte du bureau</strong>
        <p>
          La <strong>bille</strong> aux couleurs du logo, juste au-dessus de l’horloge, quand
          Autowin est réduit ou derrière une autre fenêtre. Son halo dit si un agent{' '}
          <strong>travaille</strong>, si un fil <strong>t’attend</strong> ou si un tour a{' '}
          <strong>échoué</strong> ; un clic ouvre le fil. Au survol, sa <strong>poignée</strong> (en
          haut à gauche) la déplace et sa <strong>croix</strong> la ferme : elle ne revient alors
          que par cet interrupteur. Tant qu’elle est affichée, les cartes de fin de tour portent un{' '}
          <strong>liseré arc-en-ciel</strong>. Masquée, elle disparaît aussitôt et les cartes
          reprennent leur bord habituel.
        </p>
        {erreur && <p className="mascotte-reglage-erreur">{erreur}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={affichee === true}
        aria-label="Afficher la mascotte du bureau"
        className={`mascotte-switch${affichee ? ' is-on' : ''}`}
        disabled={affichee === null || occupe}
        data-testid="interface-mascotte-switch"
        onClick={() => void basculer()}
      >
        <i />
        <span>{affichee === null ? '…' : affichee ? 'Affichée' : 'Masquée'}</span>
      </button>
    </div>
  )
}
