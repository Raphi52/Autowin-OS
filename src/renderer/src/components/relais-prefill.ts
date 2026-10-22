/**
 * RELAIS du pré-remplissage de conversation (`autowin:prefill-conversation`).
 *
 * Défaut MESURÉ le 2026-10-22 (conv-1101, instance cachée, code de dev) : un bouton qui crée une
 * conversation, ouvre le chat PUIS émet l'événement le perdait quand le chat n'avait encore jamais
 * été affiché depuis le démarrage — l'écouteur de `ChatView` n'existait pas encore (sonde : chat
 * jamais monté → `recu: false` ; chat déjà monté → `recu: true`). L'utilisateur se retrouvait devant
 * une conversation VIDE, sans la skill qu'il venait de lancer. Touchait tous les émetteurs : « Trier
 * avec /curate », « Réparer la mise à jour », Tickets, la veille, et les boutons de Maintenance.
 *
 * L'événement reste le chemin normal (chat déjà monté). Ce relais, installé par `App` (toujours
 * monté), GARDE l'événement quand personne ne l'écoute encore ; `ChatView` le RÉCLAME au moment
 * précis où il pose son écouteur. Le drapeau et l'écouteur sont posés dans le même bloc synchrone :
 * aucun événement ne peut être à la fois traité et gardé, donc aucun envoi rejoué deux fois.
 *
 * Même forme que `pending-conversation-open.ts` : à usage unique, une demande consommée ne revient
 * jamais.
 */

export const EVENEMENT_PREFILL = 'autowin:prefill-conversation'

export interface DetailPrefill {
  conversationId?: string
  prompt?: string
  send?: boolean
}

let ecouteurPret = false
let enAttente: DetailPrefill | null = null

/** Installé une fois par `App` : garde l'événement tant que le chat ne l'écoute pas. */
export function installerRelaisPrefill(cible: Window = window): () => void {
  const garder = (event: Event): void => {
    if (ecouteurPret) return
    const detail = (event as CustomEvent<DetailPrefill | undefined>).detail
    if (detail && (detail.prompt || detail.conversationId)) enAttente = { ...detail }
  }
  cible.addEventListener(EVENEMENT_PREFILL, garder)
  return () => cible.removeEventListener(EVENEMENT_PREFILL, garder)
}

/**
 * Appelé par `ChatView` JUSTE APRÈS avoir posé son écouteur : marque l'écouteur présent et rend la
 * demande gardée (consommée), `null` si aucune.
 */
export function ouvrirEcouteurPrefill(): DetailPrefill | null {
  ecouteurPret = true
  const demande = enAttente
  enAttente = null
  return demande
}

/** Appelé par `ChatView` quand il retire son écouteur (démontage). */
export function fermerEcouteurPrefill(): void {
  ecouteurPret = false
}
