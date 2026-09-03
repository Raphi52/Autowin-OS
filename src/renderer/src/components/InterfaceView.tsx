import { useEffect, useState } from 'react'
import { ecrireThemeMode, lireThemeMode, type ThemeMode } from '../theme-mode'
import './InterfaceView.css'

/**
 * Settings · Interface — l'apparence de l'application, et rien d'autre.
 *
 * L'interrupteur choisit entre sombre (par défaut, l'existant) et clair. Le changement est
 * IMMÉDIAT et mémorisé : aucun redémarrage. Toute la bascule tient dans `theme-mode.ts` +
 * `assets/theme-modes.css` ; ce composant ne peint rien lui-même.
 */
export function InterfaceView(): React.JSX.Element {
  const [mode, setMode] = useState<ThemeMode>(() => lireThemeMode())

  // Le mode mémorisé est appliqué à l'ouverture aussi : si une autre fenêtre l'a changé,
  // l'écran affiché reste d'accord avec l'interrupteur.
  useEffect(() => {
    ecrireThemeMode(mode)
  }, [mode])

  const clair = mode === 'clair'

  return (
    <section className="interface-view surface-panel" aria-label="Interface">
      <header>
        <div>
          <span className="domain-eyebrow">Apparence</span>
          <h2>Interface</h2>
        </div>
      </header>
      <div className="interface-row">
        <div className="interface-row-text">
          <strong>Mode clair</strong>
          <p>
            Fonds clairs et texte sombre. Désactivé, l’application garde son mode nuit, qui reste
            le réglage par défaut. Le choix est mémorisé sur ce poste.
          </p>
        </div>
        <label className="interface-switch">
          <input
            type="checkbox"
            role="switch"
            checked={clair}
            aria-label="Mode clair"
            data-testid="interface-mode-clair"
            onChange={(e) => setMode(e.target.checked ? 'clair' : 'sombre')}
          />
          <span className="interface-switch-track" aria-hidden="true">
            <span className="interface-switch-knob" />
          </span>
          <span className="interface-switch-etat">{clair ? 'Clair' : 'Sombre'}</span>
        </label>
      </div>
      <p className="interface-reserve">
        Les écrans qui peignent leurs couleurs en dur — le graphe Memory, la topologie des agents,
        les aperçus HTML générés — restent sombres : ils ne lisent pas les couleurs du thème.
      </p>
    </section>
  )
}
