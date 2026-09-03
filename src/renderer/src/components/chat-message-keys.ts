/**
 * Deux helpers PURS de la ligne de message, sortis de `ChatMessageRow.tsx` : un fichier de composant
 * ne doit exporter que des composants (règle react-refresh). Déplacement à l'identique.
 */
import type { Msg } from './chat-view-types'
import { groupAssistantActivity, type ChatPart } from './chat-view-model'
import { promptDeLOption, type AskDecision } from './ask-choices'

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
 * Le texte d'un message utilisateur REPOND-il a CETTE question ?
 *
 * Comparaison au texte que le bloc ENVOIE (`envoi` sinon le libelle) : c'est exactement ce qui part
 * au clic, donc l'egalite est la seule preuve sure qu'un message est la reponse. Une reponse
 * multiple part en puces (`- <reponse>` par ligne) : chaque ligne doit alors etre une option.
 *
 * Greffe du travail run-f81767873c01-1 (2026-09-01), garde parce que sa regle est plus JUSTE que
 * celle du drapeau seul : un message ORDINAIRE mais hors sujet ne doit pas fermer la question non
 * plus, et aucun drapeau ne peut le savoir.
 */
function estUneReponseAuBloc(texte: string, decision: AskDecision): boolean {
  const propre = texte.trim()
  if (!propre) return false
  const attendus = decision.options.map((option) => promptDeLOption(option).trim())
  if (attendus.includes(propre)) return true
  const lignes = propre
    .split(String.fromCharCode(10))
    .map((ligne) => ligne.trim())
    .filter(Boolean)
  if (lignes.length < 2) return false
  return lignes.every((ligne) => ligne.startsWith('- ') && attendus.includes(ligne.slice(2).trim()))
}

/**
 * La question `ask` de ce tour a-t-elle DEJA sa reponse dans le fil ?
 *
 * VECU le 2026-09-01 (conv-50) : le verrou se fermait sur N'IMPORTE QUEL message utilisateur
 * posterieur — orientation tapee pendant le tour, ou simple remarque hors sujet. La question
 * passait « Répondu » sans reponse, et le clic suivant etait AVALE EN SILENCE.
 *
 * Le verrou anti-double-envoi reste entier : une VRAIE reponse ferme la porte, y compris apres un
 * message hors sujet, apres un remontage du bloc et apres un redemarrage.
 */
export function askDejaRepondu(messages: Msg[], index: number): boolean {
  const parts = (messages[index] as { parts?: ChatPart[] }).parts ?? []
  const decisions = groupAssistantActivity(parts).flatMap((bloc) =>
    bloc.kind === 'ask-decision' ? [bloc.decision] : []
  )
  if (!decisions.length) return false
  for (let i = index + 1; i < messages.length; i += 1) {
    const message = messages[i]
    if (message.role !== 'user') continue
    if (decisions.some((decision) => estUneReponseAuBloc(message.content ?? '', decision)))
      return true
  }
  return false
}

/**
 * Ce message utilisateur REPOND-il ? Une orientation écrite pendant le tour, non : elle précise,
 * elle ne choisit pas. Depuis conv-38 (2026-09-01) ces orientations sont de vrais messages du fil,
 * et les compter comme des réponses fermait les questions encore ouvertes (conv-50).
 */
function estUneReponse(message: Msg): boolean {
  return message.role === 'user' && (message as { orientation?: boolean }).orientation !== true
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
    if (estUneReponse(message)) return false
    if (message.role === 'user') continue
    const blocs = groupAssistantActivity((message as { parts?: ChatPart[] }).parts ?? [])
    if (blocs.some((bloc) => bloc.kind === 'ask-decision')) return true
  }
  return false
}
