import { ModuleHeader } from './ModuleHeader'
// Importée ICI, et non « héritée » d'une autre vue. `.domain-tabs` n'est stylé que dans cette feuille,
// et TaskManagerView ne l'importait pas : sa barre n'était correcte que parce qu'Agent Studio,
// Settings ou Knowledge avait déjà chargé le CSS (dans un bundle, une feuille importée est globale).
// Une vue dont l'apparence dépend de l'ordre de chargement des AUTRES vues est une bombe à retardement.
import './DomainShell.css'
import './ViewTopBar.css'

export interface ViewTopBarTab<Id extends string = string> {
  id: Id
  label: string
  /**
   * Anomalie de la section, visible depuis l'onglet voisin. `count: 0` n'affiche RIEN : un compteur
   * nul n'est pas une alerte, et un badge « 0 » inquiète sans rien signaler.
   */
  anomaly?: { count: number; title: string; testId?: string }
  /**
   * Alerte BINAIRE, distincte du compteur : Settings signale « un prérequis est en échec » par un `!`,
   * pas par un nombre. Les deux formes coexistent parce qu'elles ne disent pas la même chose —
   * uniformiser de force aurait remplacé « quelque chose ne va pas » par un « 1 » qui compte quoi ?
   */
  alert?: { active: boolean; mark: string; title: string; testId?: string }
}

/**
 * LA barre du haut, une seule fois, pour toutes les vues.
 *
 * Deux arrangements coexistaient pour la même intention : Task Manager posait un en-tête de module
 * (surtitre + titre + description) PUIS ses pastilles de sections, tandis qu'Agent Studio, Settings et
 * Knowledge ouvraient directement sur les pastilles, sans en-tête. Même CSS, formes différentes : la
 * vue changeait d'allure selon l'onglet, sans raison. L'arrangement de Task Manager fait désormais
 * référence (choix utilisateur), et il vit ICI plutôt que recopié dans cinq fichiers — deux copies
 * d'une même intention finissent toujours par divergter, et on ne s'en aperçoit qu'à l'usage.
 */
export function ViewTopBar<Id extends string = string>({
  eyebrow,
  title,
  description,
  detail,
  tabs,
  active,
  onSelect,
  ariaLabel,
  actions
}: {
  eyebrow: string
  title: string
  /** Une phrase qui dit à quoi sert la vue. Omise, elle n'occupe aucune place. */
  description?: string
  /** Information contextuelle existante conservée sous la phrase (ex. chemin du dépôt). */
  detail?: React.ReactNode
  /**
   * OPTIONNELS : Worktrees n'a pas de sections, mais doit porter le même en-tête que les autres vues.
   * Sans cette option, elle aurait gardé son en-tête maison — c'est-à-dire exactement la divergence
   * qu'on est en train de supprimer.
   */
  tabs?: readonly ViewTopBarTab<Id>[]
  active?: Id
  onSelect?: (id: Id) => void
  ariaLabel?: string
  /** Boutons alignés à droite (ex. « + Nouvelle tâche »). */
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="view-topbar">
      <div className="view-topbar-identity">
        <ModuleHeader eyebrow={eyebrow} title={title} description={description} detail={detail} />
      </div>
      {tabs && tabs.length > 0 && (
        <nav className="domain-tabs" aria-label={ariaLabel ?? `Sections ${title}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === active ? 'is-active' : ''}
              aria-pressed={tab.id === active}
              onClick={() => onSelect?.(tab.id)}
            >
              {tab.label}
              {tab.anomaly && tab.anomaly.count > 0 && (
                <span
                  className="domain-tab-anomaly"
                  // Conservé : des tests existants ciblent ces identifiants (`studio-anomaly-*`).
                  // Les perdre en factorisant la barre aurait cassé leur ancrage sans rien améliorer.
                  data-testid={tab.anomaly.testId}
                  title={tab.anomaly.title}
                  aria-label={tab.anomaly.title}
                >
                  {tab.anomaly.count}
                </span>
              )}
              {tab.alert?.active && (
                <span
                  className="domain-badge-alert"
                  data-testid={tab.alert.testId}
                  title={tab.alert.title}
                  aria-label={tab.alert.title}
                >
                  {tab.alert.mark}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
      {actions && <div className="view-topbar-actions">{actions}</div>}
    </header>
  )
}
