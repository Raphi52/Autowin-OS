/**
 * Titre d'une nouvelle conversation, tire de son premier message.
 * Avant : coupe brute a 42 caracteres (« liste moi 100 inconvénients de autowin O… »),
 * trop court pour distinguer deux fils. Maintenant : 80 caracteres, coupe au dernier
 * espace pour ne pas trancher un mot, espaces multiples/retours ramenes a un seul.
 */
export const TITRE_CONVERSATION_MAX = 80

export function titreDepuisPremierMessage(source: string): string {
  const propre = source.replace(/\s+/g, ' ').trim()
  if (propre.length <= TITRE_CONVERSATION_MAX) return propre
  const coupe = propre.slice(0, TITRE_CONVERSATION_MAX)
  const dernierEspace = coupe.lastIndexOf(' ')
  const base = dernierEspace >= TITRE_CONVERSATION_MAX / 2 ? coupe.slice(0, dernierEspace) : coupe
  return `${base.trimEnd()}…`
}
