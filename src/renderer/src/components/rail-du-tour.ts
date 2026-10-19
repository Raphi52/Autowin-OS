/**
 * RAIL DU TOUR (conv-338, 2026-10-19, « Implémenter 1 + 5 » du /draft « mêler le texte du chat et
 * mes blocs »). Chaque élément d'un tour assistant — le cadre Raisonnement / Actions / Étapes, une
 * phrase, un groupe d'actions, une image, le verdict des juges, la réponse — devient un POINT d'un
 * rail vertical tracé à gauche du message :
 *   - de la 1 « Rail net » : une colonne d'HEURES (temps écoulé depuis le début du tour), un point
 *     plein pour un bloc, un point discret pour le texte ;
 *   - de la 5 « Réponse au bout du rail » : le rail va jusqu'au bout — le verdict des juges est
 *     l'avant-dernier point, la réponse le dernier, en bleu (d'abord en or, changé à sa demande).
 * Ce module ne fait que les CALCULS (nature d'un bloc, son heure, où est la réponse) ; le rendu est
 * dans ChatMessageRow.tsx, le dessin dans ChatView.css (« RAIL DU TOUR »).
 */
import type { ChatRenderBlock } from './chat-view-model'

/** Ce que porte un point du rail : il en prend la forme et la couleur (ChatView.css). */
export type NatureDuNoeud = 'tour' | 'texte' | 'reponse' | 'actions' | 'image' | 'juge' | 'autre'

const instantValide = (valeur: unknown): number | undefined =>
  typeof valeur === 'number' && Number.isFinite(valeur) && valeur > 0 ? valeur : undefined

/**
 * Heure d'apparition d'un bloc : celle de sa première part (texte, première action du groupe,
 * première image de la pile). Absente sur les tours enregistrés avant le rail : rien n'est inventé.
 */
export function instantDuBloc(bloc: ChatRenderBlock): number | undefined {
  switch (bloc.kind) {
    case 'text':
      return instantValide(bloc.at)
    case 'activity':
      return instantValide(bloc.actions[0]?.at)
    case 'artifact':
      return instantValide(bloc.artifact.createdAt)
    case 'artifact-pile':
      return instantValide(bloc.artifacts[0]?.createdAt)
    default:
      return undefined
  }
}

export function natureDuBloc(bloc: ChatRenderBlock): NatureDuNoeud {
  switch (bloc.kind) {
    case 'text':
      return 'texte'
    case 'activity':
      return 'actions'
    case 'artifact':
    case 'artifact-pile':
      return 'image'
    default:
      return 'autre'
  }
}

/**
 * Temps écoulé depuis le début du tour, en « m:ss » (« h:mm:ss » au-delà d'une heure). Sans début
 * ou sans instant : aucune heure. Un instant antérieur au début (horloges voisines) vaut 0:00.
 */
export function heureSurLeRail(
  instant: number | undefined,
  debut: number | undefined
): string | undefined {
  if (instant === undefined || debut === undefined) return undefined
  const secondes = Math.max(0, Math.floor((instant - debut) / 1000))
  const heures = Math.floor(secondes / 3600)
  const minutes = Math.floor((secondes % 3600) / 60)
  const reste = String(secondes % 60).padStart(2, '0')
  return heures > 0
    ? `${heures}:${String(minutes).padStart(2, '0')}:${reste}`
    : `${minutes}:${reste}`
}

/**
 * Où est la RÉPONSE : le dernier bloc de texte d'un tour TERMINÉ (le bloc de clôture y est déjà
 * rangé en dernier, `clotureEnDernier`). Rend [rang de l'élément du fil, rang du bloc], ou rien
 * pendant le tour — la dernière phrase écrite n'est pas encore la réponse.
 */
export function placeDeLaReponse(
  blocsParElement: readonly (readonly ChatRenderBlock[])[],
  tourFini: boolean
): [number, number] | undefined {
  if (!tourFini) return undefined
  for (let element = blocsParElement.length - 1; element >= 0; element -= 1) {
    const blocs = blocsParElement[element]
    for (let rang = blocs.length - 1; rang >= 0; rang -= 1)
      if (blocs[rang].kind === 'text') return [element, rang]
  }
  return undefined
}
