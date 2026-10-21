/**
 * « MODIFIER ET RELANCER » — d'où repartir (conv-1038, 2026-10-21).
 *
 * `fork()` (`src/main/store/conversations.ts`) copie le fil jusqu'au message choisi INCLUS. Pour
 * reprendre un message en le corrigeant, la copie doit donc s'arrêter JUSTE AVANT lui : elle s'ancre
 * sur le dernier message identifié qui le précède. Avant le premier message, il n'y a rien à
 * copier : on repart d'un fil neuf. L'état des FICHIERS n'est pas restauré : seule la conversation
 * revient en arrière (décision « branches-rewind » du 2026-07-20, étape 1).
 */

export type DepartDeLaReprise = { kind: 'copie'; ancre: string } | { kind: 'fil-neuf' }

export function departPourModifier(
  messages: ReadonlyArray<{ messageId?: string }>,
  messageId: string
): DepartDeLaReprise | null {
  const rang = messages.findIndex((message) => message.messageId === messageId)
  if (rang < 0) return null
  for (let index = rang - 1; index >= 0; index -= 1) {
    const ancre = messages[index].messageId
    if (ancre) return { kind: 'copie', ancre }
  }
  return { kind: 'fil-neuf' }
}
