import { useEffect, useState } from 'react'
import { THEMES, ecrireThemeMode, lireThemeMode, type ThemeId } from '../theme-mode'
import './InterfaceView.css'

/**
 * Settings · Interface — l'apparence de l'application, et rien d'autre.
 *
 * UNE LISTE, PAS UN INTERRUPTEUR, et c'est le point de ce composant. Un interrupteur ne sait dire
 * que oui ou non : il plafonnait le réglage à DEUX apparences. La liste lit `THEMES`
 * (`theme-mode.ts`), donc ajouter un thème ne demande AUCUNE modification ici.
 *
 * Le changement est IMMÉDIAT et mémorisé : aucun redémarrage. Le thème choisi est écrit sur la
 * racine du document par `theme-mode.ts`, et les feuilles de style font le reste
 * (`assets/theme-modes.css`) ; ce composant ne peint rien lui-même.
 */
export function InterfaceView(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeId>(() => lireThemeMode())

  // Le thème mémorisé est appliqué à l'ouverture aussi : si une autre fenêtre l'a changé,
  // l'écran affiché reste d'accord avec la liste.
  useEffect(() => {
    ecrireThemeMode(theme)
  }, [theme])

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
          <strong>Thème</strong>
          <p>
            L’apparence de l’application. <strong>Sombre</strong> reste le réglage par défaut : qui
            n’y touche pas ne voit rien changer. Le choix est mémorisé sur ce poste et s’applique
            aussitôt, sans redémarrage.
          </p>
        </div>
        <label className="interface-theme-choix">
          <span className="interface-theme-label">Thème</span>
          <select
            className="interface-theme-select"
            value={theme}
            aria-label="Thème"
            data-testid="interface-theme"
            onChange={(e) => setTheme(e.target.value)}
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="interface-reserve">
        <strong>Ce qui reste sombre.</strong> Le mode clair change le cadre de l’application : le
        menu, les panneaux, les textes et les champs. Les écrans qui peignent leurs couleurs en dur
        ne le suivent pas encore et resteront sombres, y compris la page <strong>Chat</strong>, l’
        <strong>Accueil</strong>, l’<strong>Observatory</strong>, le graphe <strong>Memory</strong>,
        la <strong>topologie</strong> des agents et les aperçus HTML générés. L’affichage sera donc
        mixte : clair autour, sombre à l’intérieur de ces écrans.
      </p>
    </section>
  )
}
