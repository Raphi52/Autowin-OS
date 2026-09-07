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
            L’apparence de l’application : <strong>huit thèmes</strong>, quatre sombres et quatre
            clairs. <strong>Sombre</strong> reste le réglage par défaut : qui n’y touche pas ne voit
            rien changer. Le choix est mémorisé sur ce poste et s’applique aussitôt, sans
            redémarrage.
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
        <strong>Ce qui ne suit pas encore.</strong> Le thème choisi s’applique à presque tout
        l’écran : le menu, les panneaux, les textes, les champs, et les pages <strong>Chat</strong>,{' '}
        <strong>Accueil</strong>, <strong>Observatory</strong> et <strong>Agent Studio</strong>.
        Trois endroits gardent leurs couleurs sombres quel que soit le thème, parce qu’ils les
        peignent en dur : la <strong>toile du graphe Memory</strong> (ses étiquettes et son bandeau
        d’avertissement), le bandeau <strong>Runtime actuel</strong> au bas de l’Agent Studio, et le{' '}
        <strong>décor animé du fond</strong>. Constaté à l’écran le 7 septembre 2026 sous un thème
        clair.
      </p>
    </section>
  )
}
