import { LANGUES } from '../../../shared/langue'
import { ecrireLangue, transmettreLangueAuMoteur, useEchecEnvoiLangue } from '../langue'
import { nomDeTheme, riche, useTextes } from '../textes'
import { useEffect, useState } from 'react'
import { THEMES, ecrireThemeMode, lireThemeMode, type ThemeId } from '../theme-mode'
import { basculerTheme } from '../transition-de-vue'
import { MascotteReglage } from './MascotteReglage'
import { NomSurLeBoardReglage } from './NomSurLeBoardReglage'
import './InterfaceView.css'

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
/**
 * LES COMPTES DU TEXTE VIENNENT DU REGISTRE (conv-244). La phrase disait « dix thèmes, cinq sombres
 * et cinq clairs » en dur : six thèmes en ont été retirés le 2026-10-11 (conv-231) et l'écran
 * annonçait encore dix. Comme la liste, la phrase lit `THEMES`.
 */
const NB_THEMES = THEMES.length
const NB_SOMBRES = THEMES.filter((t) => t.base === 'sombre').length
const NB_CLAIRS = NB_THEMES - NB_SOMBRES
const NB_MALVOYANT = THEMES.filter((t) => t.id.startsWith('malvoyant')).length

export function InterfaceView(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeId>(() => lireThemeMode())
  // Les textes suivent la langue choisie juste au-dessus, sans redémarrage (conv-1146).
  const { langue, t } = useTextes()
  // L'envoi au moteur qui a échoué se DIT ici, au lieu d'être avalé (conv-1146, contrôle final).
  const echecLangue = useEchecEnvoiLangue()

  // Le thème mémorisé est appliqué à l'ouverture aussi : si une autre fenêtre l'a changé,
  // l'écran affiché reste d'accord avec la liste.
  useEffect(() => {
    ecrireThemeMode(theme)
  }, [theme])

  return (
    <section className="interface-view surface-panel" aria-label={t('interface.titre')}>
      <header>
        <div>
          <span className="domain-eyebrow">{t('interface.eyebrow')}</span>
          <h2>{t('interface.titre')}</h2>
        </div>
      </header>
      {/* LA LANGUE (conv-1146, 2026-10-26, « basculer autowin OS en full anglais »). Le choix part du
          `change` de la liste, jamais d'un effet : rouvrir cet écran ne renvoie rien au moteur. */}
      <div className="interface-row">
        <div className="interface-row-text">
          <strong>{t('interface.langue')}</strong>
          <p>{riche(t('interface.langue.description'))}</p>
          <p data-testid="interface-langue-couverture">{riche(t('interface.langue.couverture'))}</p>
          {echecLangue && (
            <div className="domain-warning" data-testid="interface-langue-echec">
              <p role="alert">
                {riche(t('interface.langue.echec'))} <code>{echecLangue.raison}</code>
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => void transmettreLangueAuMoteur(langue)}
              >
                {t('interface.langue.reessayer')}
              </button>
            </div>
          )}
        </div>
        <label className="interface-theme-choix">
          <span className="interface-theme-label">{t('interface.langue')}</span>
          <select
            className="interface-theme-select select"
            value={langue}
            aria-label={t('interface.langue')}
            data-testid="interface-langue"
            onChange={(e) => ecrireLangue(e.target.value)}
          >
            {LANGUES.map((l) => (
              <option key={l.id} value={l.id} lang={l.id}>
                {l.libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="interface-row">
        <div className="interface-row-text">
          <strong>{t('interface.theme')}</strong>
          <p>
            {riche(
              t('interface.theme.description', {
                nbThemes: NB_THEMES,
                nbSombres: NB_SOMBRES,
                nbClairs: NB_CLAIRS,
                nbMalvoyant: NB_MALVOYANT
              })
            )}
          </p>
        </div>
        <label className="interface-theme-choix">
          <span className="interface-theme-label">{t('interface.theme')}</span>
          <select
            className="interface-theme-select select"
            value={theme}
            aria-label={t('interface.theme')}
            data-testid="interface-theme"
            onChange={(e) => {
              // LE CERCLE PART D'ICI, et seulement d'ici (conv-981, 2026-10-16) : l'effet plus haut
              // rejoue le theme a CHAQUE ouverture de l'ecran. Un `change` de liste n'a pas de
              // position de souris : le cercle part du centre de la liste. Le theme est ecrit DANS
              // la transition, avant l'image du nouvel etat ; l'effet le reecrit a l'identique.
              const choisi = e.target.value
              const boite = e.currentTarget.getBoundingClientRect()
              basculerTheme(
                document,
                choisi === theme,
                { x: boite.left + boite.width / 2, y: boite.top + boite.height / 2 },
                { largeur: window.innerWidth, hauteur: window.innerHeight },
                () => {
                  ecrireThemeMode(choisi)
                  setTheme(choisi)
                }
              )
            }}
          >
            {THEMES.map((th) => (
              <option key={th.id} value={th.id}>
                {nomDeTheme(th.id, th.libelle, langue)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <MascotteReglage />
      <NomSurLeBoardReglage />
      <p className="interface-reserve" data-testid="interface-zoom">
        {riche(t('interface.zoom'))}
      </p>
      {/* Le texte de la réserve vit dans `textes.ts` ; son test mesure le CSS et lit cette clé. */}
      <p className="interface-reserve" data-testid="interface-reserve">
        {riche(t('interface.reserve'))}
      </p>
    </section>
  )
}
