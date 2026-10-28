/**
 * LE TITRE D'UNE CONVERSATION EST CELUI DE SON PREMIER MESSAGE — il ne bouge plus ensuite.
 *
 * Historique : du 2026-10-16 (conv-999) au 2026-10-28, le titre suivait le DERNIER message de
 * l'utilisateur. Annulé à sa demande le 2026-10-28 (conv-1203) : « annule le changement de name
 * des convs qui devient celui de mon dernier message ». Un fil garde donc le nom de son sujet de
 * départ, comme avant conv-999.
 *
 * Ce qui reste, et pourquoi :
 *  - un fil créé d'avance porte le titre PROVISOIRE « Nouvelle conversation » : son premier
 *    message utile le nomme (sans quoi il resterait anonyme dans la barre latérale).
 *  - une RELANCE SANS OBJET (« go », « ok », « reprend ») ne nomme rien : le fil reste provisoire
 *    jusqu'au premier message qui dit de quoi on parle (`estRelanceSansObjet`).
 *  - un nom donné À LA MAIN (barre latérale, outil `rename_conversation`) n'est JAMAIS réécrit :
 *    `origineTitre: 'utilisateur'`, posé par `ConversationStore.rename`.
 */
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

/** Le fil porte-t-il encore son titre provisoire (aucun message ne l'a nommé) ? */
export function titreEstProvisoire(titre: string): boolean {
  return !titre.trim() || titre === TITRE_PROVISOIRE
}

/**
 * Le titre à poser après un nouveau message de l'utilisateur, ou `undefined` s'il ne faut RIEN
 * changer — c'est-à-dire dès que le fil a déjà un nom (repris d'un message ou donné à la main),
 * ou que le message est une relance sans objet.
 *
 * `autresTitres` : les titres des AUTRES conversations. Un homonyme reçoit le moment en suffixe,
 * comme au premier message depuis le 2026-09-12 (« /salvage » ×14 dans la barre latérale).
 */
export function titreApresMessage(p: {
  titre: string
  origine?: unknown
  message: string
  autresTitres: readonly string[]
  quand: Date
}): string | undefined {
  if (p.origine === 'utilisateur' || !titreEstProvisoire(p.titre)) return undefined
  const source = compacter(p.message)
  if (!source || estRelanceSansObjet(source)) return undefined
  const propose = titreDepuisMessage(source)
  const pris = new Set(p.autresTitres.map(empreinte))
  return pris.has(empreinte(propose)) ? avecMarqueurDeMoment(source, p.quand) : propose
}
