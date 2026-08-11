import type { SuggestionGroup } from './scout-suggestions'

/**
 * Rend cliquables les reponses d'une question posee par le modele.
 *
 * Pourquoi une commande DECLAREE plutot qu'une lecture du texte : mesure du 2026-08-10 sur les
 * 883 conversations de l'instance canary — le modele ne liste pas ses options, il termine en prose
 * (« Veux-tu que je le fasse ? », « Tu veux que je bascule sur la vue Models ? »). Une heuristique
 * sur les puces de fin de message proposait comme reponses cliquables des resultats de tests
 * (`🟢 589/589 tests verts`), des lignes d'erreur et des chemins de fichiers — sur 3 echantillons
 * sur 4. Cliquer dessus aurait renvoye ces textes comme prompt. Un choix se declare, il ne se devine
 * pas.
 *
 * Le rendu reutilise `SuggestionGrid` : le label cliquE repart comme prompt ordinaire, donc l'action
 * reelle emprunte le chemin normal et ses autorisations. Rien de neuf de ce cote.
 */

/** Ce qu'une action `ask` reussie porte dans son `data`. */
export interface AskChoicesData {
  question: string
  options: string[]
}

export function parseAskChoices(part: {
  kind: string
  name?: string
  ok?: boolean
  data?: unknown
}): SuggestionGroup[] | null {
  if (part.kind !== 'action' || part.name !== 'ask' || part.ok !== true) return null
  const data = part.data as Partial<AskChoicesData> | undefined
  if (!data || typeof data.question !== 'string' || !data.question.trim()) return null
  if (!Array.isArray(data.options)) return null

  const items = data.options
    .filter((option): option is string => typeof option === 'string' && Boolean(option.trim()))
    .map((option) => ({ label: option.trim() }))
  // Une seule reponse n'est pas un choix : mieux vaut laisser la question en texte que d'afficher
  // un bouton unique qui ressemble a une validation.
  if (items.length < 2) return null

  return [{ key: 'ask', title: data.question.trim(), items }]
}
