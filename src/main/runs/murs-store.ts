import { ensureAutowinAppData } from '../app-data'
import { creerIndexStore } from './json-index-store'

/**
 * REGISTRE PERSISTANT DES MURS — pour qu'un echec du tour 1 soit encore connu au tour 5.
 *
 * L'auto-kaizen en cours de tour (`chat-turn-messages.ts`, `signatureDEchec`) sait deja reconnaitre
 * qu'un mur se rejoue et escalader la consigne. Mais son registre vivait dans le TOUR : deux tours
 * de suite, l'agent pouvait remanger exactement le meme mur en croyant chaque fois le decouvrir —
 * la premiere consigne, celle qui dit simplement « corrige et poursuis », se rejouait a l'infini.
 * C'est le meme angle mort que l'index de sessions avant `chat-session-store` : une donnee qu'on
 * possedait deja, jetee a chaque frontiere.
 *
 * La mecanique de l'index (lecture fail-open, ecriture atomique, oubli) vit dans
 * `json-index-store.ts`, partagee avec le store de sessions : elle etait dupliquee ligne pour ligne
 * entre les deux, signale par l'audit du 2026-08-21. Ne reste ici que la specialite des murs — le
 * type, son validateur, et le plafond par conversation.
 */

export type MursIndex = Record<string, string[]>

/**
 * Le registre est BORNE par conversation. Sans cap, une conversation longue et bruyante ferait
 * grossir le fichier sans fin pour un gain nul : au-dela de quelques dizaines de murs distincts, ce
 * n'est plus un indice, c'est un journal. Les plus RECENTS survivent — un mur rencontre a l'instant
 * pese plus qu'un mur d'il y a deux heures.
 */
export const CAP_MURS_PAR_CONVERSATION = 40

const estListeDeMurs = (valeur: unknown): valeur is string[] =>
  Array.isArray(valeur) && valeur.every((m) => typeof m === 'string' && !!m)

const store = creerIndexStore<string[]>('murs-rencontres.json', estListeDeMurs)

export function mursStorePath(base = ensureAutowinAppData()): string {
  return store.chemin(base)
}

/** Les murs deja rencontres dans CETTE conversation. Une conversation inconnue n'en a aucun. */
export function chargerMurs(conversationId: string, base = ensureAutowinAppData()): string[] {
  if (!conversationId) return []
  return store.lire(base)[conversationId] ?? []
}

/** Enregistre un mur. Idempotent : le meme mur deux fois reste une seule entree. */
export function enregistrerMur(
  conversationId: string,
  signature: string,
  base = ensureAutowinAppData()
): void {
  if (!conversationId || !signature) return
  const index = store.lire(base)
  const connus = index[conversationId] ?? []
  if (connus.includes(signature)) return
  index[conversationId] = [...connus, signature].slice(-CAP_MURS_PAR_CONVERSATION)
  store.ecrire(index, base)
}

/** Oublie les murs d'une conversation. Sans effet si elle est inconnue. */
export function oublierMurs(conversationId: string, base = ensureAutowinAppData()): void {
  store.oublier(conversationId, base)
}
