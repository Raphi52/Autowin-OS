/**
 * Quels widgets l'accueil AFFICHE : allumé ou éteint, widget par widget.
 *
 * Sur le Quartier, un widget est allumé quand il est sorti de sa tour (`quartier-tuiles.ts`, qui
 * garde ce choix). Cet état ne touche PAS à la disposition : éteindre une tuile ne déplace jamais
 * les autres, et la rallumer la rend exactement où elle était.
 */
import type { HomeWidgetId } from './home-layout'

export type HomeWidgetsVisibility = Readonly<Record<HomeWidgetId, boolean>>

export function estVisible(courante: HomeWidgetsVisibility, id: HomeWidgetId): boolean {
  // Un widget inconnu de l'etat est VISIBLE : c'est ce qui permet d'ajouter un widget dans une
  // version suivante sans qu'il reste invisible chez ceux qui ont deja un etat.
  return courante[id] !== false
}
