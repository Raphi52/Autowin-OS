// Caches du chat entre deux tours (compte rendu non vu, sessions CLI), sortis des méthodes privées
// de AgentPilot (conv-1580, lot 1). La classe garde des méthodes minces du même nom ; ses cartes
// mémoire restent privées et sont passées en argument.
import { forgetChatSession, loadChatSessions, saveChatSession } from '../runs/chat-session-store'
import {
  deposerCompteRenduNonVu,
  lireCompteRenduNonVu,
  oublierCompteRenduNonVu
} from '../runs/compte-rendu-non-vu-store'
import { bornerResultatDeCommande } from '../resultat-de-commande-borne'

/**
 * AJOUTE la note a celle qui attend encore, au lieu de la remplacer (conv-989) : un `/scout` suivi
 * d'un `/frame` sans message entre les deux ne laissait au modele que le `/frame`. Le cumul reste
 * sous la borne de tout resultat injecte (conv-312).
 */
export function deposerCompteRenduEnAttente(
  comptesRendusNonVus: Map<string, string>,
  conversationId: string,
  texte: string
): void {
  let enAttente = comptesRendusNonVus.get(conversationId)
  try {
    enAttente ??= lireCompteRenduNonVu(conversationId)
  } catch {
    /* cache illisible : la note du jour reste, seule l'ancienne serait perdue */
  }
  const cumul = enAttente
    ? bornerResultatDeCommande('orchestrate', `${enAttente}\n\n---\n\n${texte}`)
    : texte
  comptesRendusNonVus.set(conversationId, cumul)
  try {
    deposerCompteRenduNonVu(conversationId, cumul)
  } catch {
    /* cache non ecrit : seul un redemarrage avant le prochain tour perdrait la note */
  }
}

/** Rend la note en attente PUIS l'oublie : elle n'est remise qu'une fois. */
export function consommerCompteRenduEnAttente(
  comptesRendusNonVus: Map<string, string>,
  conversationId: string
): string | undefined {
  let texte = comptesRendusNonVus.get(conversationId)
  comptesRendusNonVus.delete(conversationId)
  try {
    texte ??= lireCompteRenduNonVu(conversationId)
    oublierCompteRenduNonVu(conversationId)
  } catch {
    /* cache illisible = aucune note : le tour part sans, comme avant ce correctif */
  }
  return texte
}

/** Charge une fois les sessions du disque dans la carte mémoire de la classe (fail-open). */
export function hydraterSessionsDuChat(
  chatSessions: Map<string, { key: string; sessionId: string }>
): void {
  try {
    for (const [conversationId, record] of Object.entries(loadChatSessions())) {
      // Ne JAMAIS ecraser une entree memoire plus fraiche que le disque.
      if (!chatSessions.has(conversationId)) chatSessions.set(conversationId, record)
    }
  } catch {
    /* cache indisponible = aucune session connue : on renverra l'historique, c'est correct */
  }
}

export function persisterSessionDuChat(
  conversationId: string,
  key: string,
  sessionId: string
): void {
  try {
    saveChatSession(conversationId, key, sessionId)
  } catch {
    /* cache non ecrit : le prochain demarrage re-paiera l'historique, rien de faux */
  }
}

export function oublierSessionPersistee(conversationId: string): void {
  try {
    forgetChatSession(conversationId)
  } catch {
    /* best-effort : une entree perimee sur disque sera de toute facon rejetee par sa `key` */
  }
}
