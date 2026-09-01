/**
 * Quels widgets l'accueil AFFICHE, en fonctions pures.
 *
 * L'accueil imposait ses sept tuiles : on pouvait les deplacer, jamais en retirer une. Un widget
 * inutile occupait de la place ET tournait quand meme -- Jarvis tient un micro. Ce fichier porte donc
 * le seul etat qui manquait : allume ou eteint, widget par widget.
 *
 * Il ne touche PAS a la disposition. Eteindre une tuile ne doit jamais deplacer les autres, et la
 * rallumer doit la rendre exactement ou elle etait : ce sont deux etats separes, volontairement.
 */
import { HOME_WIDGET_IDS, type HomeWidgetId } from './home-layout'
import { autowinStorageKey } from '../storage-keys'

export type HomeWidgetsVisibility = Readonly<Record<HomeWidgetId, boolean>>

export const CLE_VISIBILITE_WIDGETS = autowinStorageKey('home.widgets-visibles.v1')

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Tout est allume tant que personne n'a rien eteint. */
export function visibiliteParDefaut(): HomeWidgetsVisibility {
  return Object.fromEntries(HOME_WIDGET_IDS.map((id) => [id, true])) as HomeWidgetsVisibility
}

export function basculerWidget(
  courante: HomeWidgetsVisibility,
  id: HomeWidgetId
): HomeWidgetsVisibility {
  return { ...courante, [id]: !courante[id] }
}

export function estVisible(courante: HomeWidgetsVisibility, id: HomeWidgetId): boolean {
  // Un widget inconnu de l'etat enregistre est VISIBLE : c'est ce qui permet d'ajouter un widget dans
  // une version suivante sans qu'il reste invisible chez ceux qui ont deja un reglage.
  return courante[id] !== false
}

/**
 * Relit un reglage enregistre.
 *
 * Tolerante par construction : une entree absente, inconnue ou mal formee laisse le widget ALLUME.
 * Le pire defaut possible ici serait une tuile qui disparait sans que personne ne l'ait demande.
 */
export function parseVisibilite(raw: unknown): HomeWidgetsVisibility {
  const defaut = visibiliteParDefaut()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaut
  const lu = raw as Record<string, unknown>
  const resultat: Record<string, boolean> = { ...defaut }
  for (const id of HOME_WIDGET_IDS) {
    if (lu[id] === false) resultat[id] = false
  }
  return resultat as HomeWidgetsVisibility
}

export function serializeVisibilite(courante: HomeWidgetsVisibility): string {
  return JSON.stringify(courante)
}

export function lireVisibilite(storage: StorageLike): HomeWidgetsVisibility {
  try {
    const raw = storage.getItem(CLE_VISIBILITE_WIDGETS)
    if (raw === null) return visibiliteParDefaut()
    return parseVisibilite(JSON.parse(raw))
  } catch {
    // Reglage illisible : l'accueil s'ouvre entier plutot que de ne pas s'ouvrir.
    return visibiliteParDefaut()
  }
}

export function ecrireVisibilite(storage: StorageLike, courante: HomeWidgetsVisibility): void {
  try {
    storage.setItem(CLE_VISIBILITE_WIDGETS, serializeVisibilite(courante))
  } catch {
    // Sans ecriture, le reglage vaut pour la session.
  }
}
