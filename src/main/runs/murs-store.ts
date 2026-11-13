import { ensureAutowinAppData } from '../app/app-data'
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

/**
 * Un mur et la date ISO de sa DERNIERE occurrence. Sans date, un mur dont la cause est corrigee
 * restait compte indefiniment par ceux qui relisent le registre entre conversations (le diagnostic) :
 * rien ne distinguait un mur d'hier d'un mur d'il y a trois mois. Une chaine seule est l'ancien
 * format : relue telle quelle, jamais datee apres coup — une date inventee serait fausse.
 */
export type EntreeDeMur = string | { signature: string; derniereFois: string }

export type MursIndex = Record<string, EntreeDeMur[]>

/**
 * Le registre est BORNE par conversation. Sans cap, une conversation longue et bruyante ferait
 * grossir le fichier sans fin pour un gain nul : au-dela de quelques dizaines de murs distincts, ce
 * n'est plus un indice, c'est un journal. Les plus RECENTS survivent — un mur rencontre a l'instant
 * pese plus qu'un mur d'il y a deux heures.
 */
export const CAP_MURS_PAR_CONVERSATION = 40

const estEntreeDeMur = (valeur: unknown): valeur is EntreeDeMur => {
  if (typeof valeur === 'string') return !!valeur
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false
  const { signature, derniereFois } = valeur as Record<string, unknown>
  return (
    typeof signature === 'string' &&
    !!signature &&
    typeof derniereFois === 'string' &&
    !Number.isNaN(Date.parse(derniereFois))
  )
}

const estListeDeMurs = (valeur: unknown): valeur is EntreeDeMur[] =>
  Array.isArray(valeur) && valeur.every(estEntreeDeMur)

const signatureDe = (entree: EntreeDeMur): string =>
  typeof entree === 'string' ? entree : entree.signature

const store = creerIndexStore<EntreeDeMur[]>('murs-rencontres.json', estListeDeMurs)

export function mursStorePath(base = ensureAutowinAppData()): string {
  return store.chemin(base)
}

/** Les murs deja rencontres dans CETTE conversation. Une conversation inconnue n'en a aucun. */
export function chargerMurs(conversationId: string, base = ensureAutowinAppData()): string[] {
  if (!conversationId) return []
  return (store.lire(base)[conversationId] ?? []).map(signatureDe)
}

/**
 * Enregistre un mur, date de cette rencontre. Le meme mur deux fois reste une seule entree : sa date
 * avance et il passe en dernier, pour que le plafond garde les murs les plus recemment VUS.
 */
export function enregistrerMur(
  conversationId: string,
  signature: string,
  base = ensureAutowinAppData()
): void {
  if (!conversationId || !signature) return
  const index = store.lire(base)
  const autres = (index[conversationId] ?? []).filter((m) => signatureDe(m) !== signature)
  index[conversationId] = [...autres, { signature, derniereFois: new Date().toISOString() }].slice(
    -CAP_MURS_PAR_CONVERSATION
  )
  store.ecrire(index, base)
}

/** Oublie les murs d'une conversation. Sans effet si elle est inconnue. */
export function oublierMurs(conversationId: string, base = ensureAutowinAppData()): void {
  store.oublier(conversationId, base)
}
