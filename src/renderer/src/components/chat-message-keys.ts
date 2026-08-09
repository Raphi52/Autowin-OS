/**
 * Deux helpers PURS de la ligne de message, sortis de `ChatMessageRow.tsx` : un fichier de composant
 * ne doit exporter que des composants (règle react-refresh). Déplacement à l'identique.
 */
import type { Msg } from './chat-view-types'

export function messageKey(message: Msg, index: number): string {
  return `${message.role}:${index}`
}

export function lastUserPromptBefore(messages: Msg[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i]
    if (candidate.role === 'user') return candidate.content || undefined
  }
  return undefined
}
