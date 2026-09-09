import { useEffect, useState } from 'react'
import {
  THEMES,
  ecrireThemeMode,
  lireApercusDesThemes,
  lireThemeMode,
  type ThemeBase,
  type ThemeId
} from '../theme-mode'
import './InterfaceView.css'

/**
 * DEUX FAMILLES, PAS UNE LISTE A PLAT. Les huit themes vont par paires (Ardoise repond a Obsidian
 * Nebula, Parchemin a Black Versailles...) et la seule question qu'on se pose vraiment en ouvrant
 * ce reglage est « clair ou sombre ». La base est deja declaree dans le registre : on s'en sert.
 */
const GROUPES: readonly { base: ThemeBase; titre: string }[] = [
  { base: 'sombre', titre: 'Sombres' },
  { base: 'clair', titre: 'Clairs' }
]

/**
 * Settings · Interface — l'apparence de l'application, et rien d'autre.
 *
 * UNE LISTE, PAS UN INTERRUPTEUR, et c'est le point de ce composant. Un interrupteur ne sait dire
 * que oui ou non : il plafonnait le réglage à DEUX apparences. La liste lit `THEMES`
 * (`theme-mode.ts`), donc ajouter un thème ne demande AUCUNE modification ici.
 *
 * LA RÉSERVE affichée en bas nomme les endroits qui ne suivent pas le thème, et elle est DATÉE
 * parce qu'elle VIEILLIT : chaque écran rattaché aux jetons doit la faire rétrécir. Mesure du
 * 2026-09-07 : elle annonçait encore le Chat, l'Accueil et l'Observatory comme sombres alors que
 * les trois suivaient déjà le thème. Ne jamais la recopier de mémoire — la vérifier à l'écran.
 *
 * Le changement est IMMÉDIAT et mémorisé : aucun redémarrage. Le thème choisi est écrit sur la
 * racine du document par `theme-mode.ts`, et les feuilles de style font le reste
 * (`assets/theme-modes.css`) ; ce composant ne peint rien lui-même.
 */
export function InterfaceView(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeId>(() => lireThemeMode())
  // Mesure UNE FOIS a l'ouverture : les couleurs d'un theme ne bougent pas pendant la session, et
  // relire a chaque rendu ferait clignoter l'application a chaque frappe.
  const [apercus] = useState(() => lireApercusDesThemes())

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
      </div>
      {GROUPES.map((groupe) => (
        <fieldset key={groupe.base} className="interface-theme-groupe">
          <legend>{groupe.titre}</legend>
          {THEMES.filter((t) => t.base === groupe.base).map((t) => {
            const apercu = apercus.find((a) => a.id === t.id)
            return (
              <label
                key={t.id}
                className="interface-theme-bande"
                data-choisi={t.id === theme ? 'oui' : undefined}
              >
                <input
                  type="radio"
                  name="interface-theme"
                  value={t.id}
                  checked={t.id === theme}
                  data-testid={`interface-theme-${t.id}`}
                  onChange={() => setTheme(t.id)}
                />
                <span className="interface-theme-nom">{t.libelle}</span>
                {apercu ? (
                  <span className="interface-theme-aplats" aria-hidden="true">
                    <i style={{ background: apercu.fond }} />
                    <i style={{ background: apercu.texte }} />
                    <i style={{ background: apercu.or }} />
                    <i style={{ background: apercu.rose }} />
                    <i style={{ background: apercu.filet }} />
                  </span>
                ) : null}
              </label>
            )
          })}
        </fieldset>
      ))}
      <p className="interface-reserve">
        <strong>Ce qui ne suit pas encore.</strong> Le thème choisi s’applique à presque tout
        l’écran : le menu, les panneaux, les textes, les champs, et les pages <strong>Chat</strong>,{' '}
        <strong>Accueil</strong>, <strong>Observatory</strong> et <strong>Agent Studio</strong>.
        Quatre endroits gardent leurs couleurs sombres quel que soit le thème, parce qu’ils les
        peignent en dur : la <strong>toile du graphe Memory</strong> (ses étiquettes et son bandeau
        d’avertissement), la vue <strong>topologie</strong> des agents, le bandeau{' '}
        <strong>Runtime actuel</strong> au bas de l’Agent Studio, et le{' '}
        <strong>décor animé du fond</strong>. Constaté à l’écran le 7 septembre 2026 sous un thème
        clair.
      </p>
    </section>
  )
}
