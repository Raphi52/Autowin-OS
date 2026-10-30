import { Component, type ReactNode } from 'react'
import { BlocEnPanne } from './BlocEnPanne'

/**
 * UNE PANNE RESTE DANS SON BLOC (conv-1327, 2026-10-30).
 *
 * L'interface n'avait aucune barrière : à 14:14:00, `phrases.get is not a function` dans
 * `BandeauSuperConv` a fait démonter TOUT l'arbre React, et il ne restait que le fond noir du thème
 * (journal de la fenêtre, port 9224). Sans barrière, c'est le comportement normal de React.
 *
 * La barrière n'attrape que les erreurs levées pendant l'AFFICHAGE d'un composant, les seules qui
 * démontent l'arbre. Celles d'un clic ou d'une promesse n'en ont jamais eu besoin. React écrit lui-même
 * l'erreur attrapée dans la console : aucun `componentDidCatch` à ajouter, rien n'est avalé.
 *
 * Pose : `VueMesuree` (chaque écran et les gros blocs du chat), `main.tsx` (le dernier filet) et, à la
 * main, les blocs qui ne passent pas par `VueMesuree`.
 */
const ZONE_RACINE = 'racine'

interface Proprietes {
  /** Écran (id du menu), bloc (voir `nomDeZone`) ou `racine` pour le dernier filet. */
  zone: string
  /** Quand elle change, le bloc repart : une autre conversation n'hérite pas de la panne de celle-ci. */
  cle?: unknown
  /** Le geste du dernier filet. À remplacer seulement dans un test. */
  recharger?: () => void
  children: ReactNode
}

interface Etat {
  enPanne: boolean
  /** Le message de l'erreur ; vide si ce qui a été levé n'en porte aucun. */
  detail: string
}

const SAINE: Etat = { enPanne: false, detail: '' }

function detailDe(erreur: unknown): string {
  if (typeof erreur === 'string') return erreur
  if (erreur instanceof Error) return erreur.message
  return ''
}

export class BarriereErreur extends Component<Proprietes, Etat> {
  state: Etat = SAINE

  static getDerivedStateFromError(erreur: unknown): Etat {
    return { enPanne: true, detail: detailDe(erreur) }
  }

  componentDidUpdate(avant: Proprietes): void {
    if (this.state.enPanne && avant.cle !== this.props.cle) this.reessayer()
  }

  reessayer = (): void => {
    this.setState(SAINE)
  }

  render(): ReactNode {
    const { zone, recharger, children } = this.props
    if (!this.state.enPanne) return children
    const racine = zone === ZONE_RACINE
    return (
      <BlocEnPanne
        zone={zone}
        racine={racine}
        detail={this.state.detail}
        relancer={racine ? (recharger ?? (() => window.location.reload())) : this.reessayer}
      />
    )
  }
}
