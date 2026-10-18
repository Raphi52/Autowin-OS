/**
 * Deux helpers PURS de la ligne de message, sortis de `ChatMessageRow.tsx` : un fichier de composant
 * ne doit exporter que des composants (règle react-refresh). Déplacement à l'identique.
 */
import type { Msg } from './chat-view-types'
import { groupAssistantActivity, type ChatPart } from './chat-view-model'
import { optionsRepondues, parseAskDecision, type AskDecision } from './ask-choices'
import { normaliserPrompt, promptsDesBoutons } from './bouton-prompt-html'

export function messageKey(message: Msg, index: number): string {
  return `${message.role}:${index}`
}

/**
 * Le tour LANCÉ par le message utilisateur `index` tourne-t-il encore ? (conv-178, 2026-10-10)
 *
 * Sa réponse est le message agent qui le suit : en cours tant qu'elle n'est pas `done`. Pas encore
 * de réponse : le tour démarre si la conversation est occupée. Suivi d'un AUTRE message de
 * l'utilisateur : ce n'est pas lui que l'agent est en train de traiter.
 * Sert à allumer la capsule « Image envoyée » exactement quand l'image lue du même tour l'est.
 */
export function tourDuMessageEnCours(messages: Msg[], index: number, occupe: boolean): boolean {
  const suivant = messages[index + 1]
  if (!suivant) return occupe
  return suivant.role === 'assistant' && suivant.done !== true
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
 * La regle vit dans `optionsRepondues`, que le bloc relit pour savoir QUELLE ligne mettre en
 * evidence : la question fermee et la reponse retenue ne peuvent pas diverger.
 *
 * Intégration du travail run-f81767873c01-1 (2026-09-01), garde parce que sa regle est plus JUSTE que
 * celle du drapeau seul : un message ORDINAIRE mais hors sujet ne doit pas fermer la question non
 * plus, et aucun drapeau ne peut le savoir.
 */
function estUneReponseAuBloc(texte: string, decision: AskDecision): boolean {
  return optionsRepondues(decision.options, texte).size > 0
}

/**
 * Le message du fil qui REPOND a la question `ask` de ce tour — son texte, `undefined` s'il n'y en a
 * pas encore. Le bloc s'en sert deux fois : il se ferme, et il met en evidence la reponse choisie.
 *
 * VECU le 2026-09-01 (conv-50) : le verrou se fermait sur N'IMPORTE QUEL message utilisateur
 * posterieur — orientation tapee pendant le tour, ou simple remarque hors sujet. La question
 * passait « Répondu » sans reponse, et le clic suivant etait AVALE EN SILENCE.
 * VECU le 2026-10-11 (conv-240, « apres avoir repondu ca doit me highlight celui qui a ete choisi
 * par un cadre ») : on ne transmettait qu'un booleen. Remonte a froid (autre conversation,
 * redemarrage), le bloc disait « Répondu » sans montrer QUELLE reponse : seul son etat local le
 * savait, et il ne survit pas au remontage.
 *
 * Le verrou anti-double-envoi reste entier : une VRAIE reponse ferme la porte, y compris apres un
 * message hors sujet, apres un remontage du bloc et apres un redemarrage.
 */
export function askReponseDuFil(messages: Msg[], index: number): string | undefined {
  const parts = (messages[index] as { parts?: ChatPart[] }).parts ?? []
  // fix-ok: passer par `groupAssistantActivity` analysait TOUT le Markdown du message, pour chaque
  // message assistant, a chaque delta de flux (gel `renderer:vue-chat`, heal du 2026-09-18). Un bloc
  // `ask-decision` ne nait QUE d'une partie non-texte, transmise telle quelle par la coalescence :
  // `parseAskDecision` sur ces parties rend exactement les memes decisions, sans analyse Markdown.
  const decisions = parts.flatMap((part) => {
    if (part.kind === 'text') return []
    const decision = parseAskDecision(part)
    return decision ? [decision] : []
  })
  // Les boutons « prompter » d'un bloc html-render (conv-302, bouton-prompt-html.ts) sont une autre
  // forme de la même question : leur libellé envoyé ferme le tour, comme une option `ask`.
  const boutons = parts.flatMap((part) =>
    part.kind === 'text' ? promptsDesBoutons(part.text) : []
  )
  if (!decisions.length && !boutons.length) return undefined
  for (let i = index + 1; i < messages.length; i += 1) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const texte = message.content ?? ''
    if (decisions.some((decision) => estUneReponseAuBloc(texte, decision))) return texte.trim()
    if (boutons.includes(normaliserPrompt(texte))) return texte.trim()
  }
  return undefined
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
 * « ce fil affiche-t-il une question ». Intégration du travail run-0be31590f330-1 (2026-08-28).
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
