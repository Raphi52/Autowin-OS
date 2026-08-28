/**
 * Deux helpers PURS de la ligne de message, sortis de `ChatMessageRow.tsx` : un fichier de composant
 * ne doit exporter que des composants (règle react-refresh). Déplacement à l'identique.
 */
import type { Msg } from './chat-view-types'
import { groupAssistantActivity, type ChatPart } from './chat-view-model'

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

/**
 * Une question `ask` attend-elle encore sa reponse au bout du fil ?
 *
 * Meme verrou que `aUneReponseApres`, vu depuis le COMPOSER : taper la reponse a la main emprunte
 * le transport d'orientation, et le reçu affichait « ✓ Orienté » alors que l'utilisateur REPONDAIT
 * a une question — seul le clic sur un bouton etait reconnu comme reponse.
 *
 * `ask-decision` n'est PAS un genre de `part` (`PersistedChatPart` = text|action|artifact|error) :
 * c'est un BLOC de rendu produit par `groupAssistantActivity`. Tester `part.kind` rendait donc
 * cette fonction TOUJOURS fausse. La detection passe par le groupement, seule autorite sur
 * « ce fil affiche-t-il une question ». Greffe du travail run-0be31590f330-1 (2026-08-28).
 */
export function askEnAttente(messages: Msg[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role === 'user') return false
    const blocs = groupAssistantActivity((message as { parts?: ChatPart[] }).parts ?? [])
    if (blocs.some((bloc) => bloc.kind === 'ask-decision')) return true
  }
  return false
}
