import { splitFinalSummary } from './Markdown'

/**
 * LE BLOC DE CLOTURE SE LIT EN DERNIER.
 *
 * Demande de l'utilisateur du 2026-09-12, capture a l'appui : le modele avait ecrit sa cloture,
 * PUIS depose une lecon (carte d'action), PUIS ajoute une phrase. L'affichage suivant l'ordre
 * d'emission, le cadre dore — le resume qu'on lit d'un coup d'oeil — se retrouvait enterre au
 * milieu du message.
 *
 * On DEPLACE, on ne masque rien : le morceau qui porte le bloc de cloture passe en fin de message,
 * l'ordre relatif de tout le reste est conserve. Si le message porte plusieurs blocs (une reprise
 * apres relance), seul le DERNIER est deplace — c'est celui qui clot vraiment le tour.
 */
export function clotureEnDernier<T extends { kind: string }>(parts: readonly T[]): T[] {
  let index = -1
  for (let position = parts.length - 1; position >= 0; position -= 1) {
    const part = parts[position]
    if (part.kind !== 'text') continue
    const texte = (part as unknown as { text?: string }).text
    if (typeof texte === 'string' && splitFinalSummary(texte)) {
      index = position
      break
    }
  }
  // Absent, ou deja en dernier : on rend le tableau d'origine, donc aucun re-rendu inutile.
  if (index < 0 || index === parts.length - 1) return parts as T[]
  const reordonne = parts.slice()
  const [cloture] = reordonne.splice(index, 1)
  reordonne.push(cloture)
  return reordonne
}
