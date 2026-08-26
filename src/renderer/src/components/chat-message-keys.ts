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

/**
 * Un message UTILISATEUR suit-il ce tour d'assistant ?
 *
 * C'est le verrou DURABLE du bloc `ask` : une question a laquelle le fil a deja repondu ne se
 * repond plus. Derive, donc rien a persister — et vrai apres un remontage du bloc comme apres un
 * redemarrage, la ou l'etat local repartait a zero et laissait le spam-clic renvoyer N reponses.
 */
export function aUneReponseApres(messages: Msg[], index: number): boolean {
  for (let i = index + 1; i < messages.length; i += 1) {
    if (messages[i].role === 'user') return true
  }
  return false
}
