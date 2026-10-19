/**
 * LE TITRE D'UNE CONVERSATION SUIT LE DERNIER MESSAGE DE L'UTILISATEUR — tant qu'il ne l'a pas
 * nommée lui-même.
 *
 * Demande du 2026-10-16 (conv-999) : « j'aimerais que le nom de la conv devienne basé sur mon
 * dernier message de la conv et pas le premier si je lui ai jamais donné de nom moi même ».
 * Avant, le titre était FIGÉ sur le premier message (création depuis le champ de saisie, ou
 * renommage du provisoire « Nouvelle conversation » au premier envoi, dans `ChatView.tsx`) : un
 * fil qui changeait de sujet gardait le nom de sa première question.
 *
 * Trois règles, et leur pourquoi :
 *  - un nom donné À LA MAIN (barre latérale, outil `rename_conversation`) n'est JAMAIS réécrit :
 *    `origineTitre: 'utilisateur'`, posé par `ConversationStore.rename`.
 *  - une RELANCE SANS OBJET (« go », « ok », « reprend ») ne nomme rien : le titre reste celui du
 *    dernier message qui disait de quoi on parle (`estRelanceSansObjet`).
 *  - un fil ANTÉRIEUR à cette règle ne porte pas `origineTitre`. Seul son titre dit encore s'il a
 *    été renommé : provisoire, ou repris de son PREMIER message → automatique ; sinon il a été
 *    choisi, et on le laisse. Se tromper dans ce sens coûte un titre qui ne suit pas ; dans
 *    l'autre, on écraserait un nom donné par l'utilisateur.
 */
import { replierComplet } from './mots'
import { estRelanceSansObjet } from './relance-sans-objet'
import { avecMarqueurDeMoment, empreinte } from './titre-sans-homonyme'

/** Le titre posé sur un fil créé d'avance (fenêtre mosaïque, ouverture directe), avant tout message. */
export const TITRE_PROVISOIRE = 'Nouvelle conversation'

/**
 * Longueur max d'un titre repris d'un message. Avant : coupe brute à 42 caractères (« liste moi
 * 100 inconvénients de autowin O… »), trop court pour distinguer deux fils.
 */
export const TITRE_CONVERSATION_MAX = 80

/** D'où vient le titre : posé par l'app d'après un message, ou donné par l'utilisateur. */
export type OrigineTitre = 'auto' | 'utilisateur'

const compacter = (texte: string): string => texte.replace(/\s+/g, ' ').trim()

/** Le titre repris d'un message : 80 caractères, coupé au dernier espace pour ne pas trancher un mot. */
export function titreDepuisMessage(source: string): string {
  const propre = compacter(source)
  if (propre.length <= TITRE_CONVERSATION_MAX) return propre
  const coupe = propre.slice(0, TITRE_CONVERSATION_MAX)
  const dernierEspace = coupe.lastIndexOf(' ')
  const base = dernierEspace >= TITRE_CONVERSATION_MAX / 2 ? coupe.slice(0, dernierEspace) : coupe
  return `${base.trimEnd()}…`
}

/** Le texte qui nomme un message : son contenu, ou à défaut sa première pièce jointe (comme à la création). */
export function texteQuiNomme(message: {
  content?: unknown
  attachments?: ReadonlyArray<{ name?: unknown }>
}): string {
  const contenu = typeof message.content === 'string' ? compacter(message.content) : ''
  if (contenu) return contenu
  const piece = message.attachments?.[0]?.name
  return typeof piece === 'string' ? compacter(piece) : ''
}

/** Le « · 12/09 09:41 » qu'ajoute `avecMarqueurDeMoment` pour distinguer deux homonymes. */
const MARQUEUR_DE_MOMENT_FINAL = / · \d{2}\/\d{2} \d{2}:\d{2}$/

const plier = (texte: string): string => replierComplet(compacter(texte))

/**
 * Vrai si `titre` est repris de `message` par l'une des règles qui ont existé : coupe à 42 ou à 80,
 * au mot ou non, avec ou sans marqueur de moment. C'est un PRÉFIXE du message, une fois retirés
 * l'ellipse et le marqueur.
 */
export function titreReprisDuMessage(titre: string, message: string): boolean {
  const base = plier(titre.replace(MARQUEUR_DE_MOMENT_FINAL, '').replace(/…$/, ''))
  return base.length > 0 && plier(message).startsWith(base)
}

/** Le titre de ce fil a-t-il été posé par l'app (donc libre de suivre les messages) ? */
export function titreEstAutomatique(p: {
  titre: string
  origine?: unknown
  /** Texte qui nomme le PREMIER message de l'utilisateur, s'il y en a un. */
  premierMessage?: string
}): boolean {
  if (p.origine === 'utilisateur') return false
  if (p.origine === 'auto') return true
  if (!p.titre.trim() || p.titre === TITRE_PROVISOIRE) return true
  return p.premierMessage !== undefined && titreReprisDuMessage(p.titre, p.premierMessage)
}

/**
 * Le titre à poser après un nouveau message de l'utilisateur, ou `undefined` s'il ne faut RIEN
 * changer (nom choisi à la main, relance sans objet, titre identique).
 *
 * `autresTitres` : les titres des AUTRES conversations. Un homonyme reçoit le moment en suffixe,
 * comme au premier message depuis le 2026-09-12 (« /salvage » ×14 dans la barre latérale).
 */
export function titreApresMessage(p: {
  titre: string
  origine?: unknown
  premierMessage?: string
  message: string
  autresTitres: readonly string[]
  quand: Date
}): string | undefined {
  if (!titreEstAutomatique(p)) return undefined
  const source = compacter(p.message)
  if (!source || estRelanceSansObjet(source)) return undefined
  const propose = titreDepuisMessage(source)
  const pris = new Set(p.autresTitres.map(empreinte))
  const titre = pris.has(empreinte(propose)) ? avecMarqueurDeMoment(source, p.quand) : propose
  return titre === p.titre ? undefined : titre
}
