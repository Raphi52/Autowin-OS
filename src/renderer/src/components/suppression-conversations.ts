/**
 * Ce que la carte de suppression des fils affiche (conv-1078, 2026-10-22, « Implémenter la 2 ·
 * En-tête en ligne ») : les fils nommés, leurs messages, et le reste regroupé au-delà de trois.
 * À part du composant (SuppressionConversationsCarte.tsx) : un fichier de composant n'exporte que
 * des composants (rafraîchissement à chaud, règle `react-refresh/only-export-components`).
 */

/** Ce que la carte doit savoir d'une conversation. Structurel : `Conv` y entre tel quel. */
export interface FilASupprimer {
  id: string
  title: string
  messageCount?: number
  messages?: ReadonlyArray<unknown>
}

/** Nombre de fils listés en entier ; au-delà, deux fils puis une ligne « + N autres ». */
export const FILS_LISTES_EN_ENTIER = 3

export interface ResumeSuppression {
  /** Fils montrés ligne à ligne. */
  lignes: Array<{ id: string; titre: string; messages: number }>
  /** Le reste, regroupé en une ligne ; absent quand tout est listé. */
  autres: { nombre: number; messages: number } | null
  /** Messages de tous les fils connus. */
  messages: number
}

function messagesDe(fil: FilASupprimer): number {
  return fil.messageCount ?? fil.messages?.length ?? 0
}

/**
 * `total` est le nombre de conversations VISÉES (la sélection) : un fil introuvable dans la liste
 * chargée compte quand même dans « + N autres », pour que la carte ne promette pas moins que ce
 * qui sera supprimé.
 */
export function resumerSuppression(
  fils: readonly FilASupprimer[],
  total: number
): ResumeSuppression {
  const tous = fils.map((fil) => ({ id: fil.id, titre: fil.title, messages: messagesDe(fil) }))
  const messages = tous.reduce((somme, fil) => somme + fil.messages, 0)
  const nombre = Math.max(total, tous.length)
  if (nombre <= FILS_LISTES_EN_ENTIER) return { lignes: tous, autres: null, messages }
  const lignes = tous.slice(0, FILS_LISTES_EN_ENTIER - 1)
  const reste = tous.slice(lignes.length)
  return {
    lignes,
    autres: {
      nombre: nombre - lignes.length,
      messages: reste.reduce((somme, fil) => somme + fil.messages, 0)
    },
    messages
  }
}
