// Caches du chat entre deux tours (compte rendu non vu, sessions CLI, base de l'état), sortis des
// méthodes privées de AgentPilot (lot 1). La classe garde des méthodes minces du même nom ; ses cartes
// mémoire restent privées et sont passées en argument.
import { forgetChatSession, loadChatSessions, saveChatSession } from '../runs/chat-session-store'
import {
  deposerCompteRenduNonVu,
  lireCompteRenduNonVu,
  oublierCompteRenduNonVu,
  type CompteRenduNonVu
} from '../runs/compte-rendu-non-vu-store'
import { deposerEtatPousse, lireEtatPousse } from '../runs/etat-pousse-store'
import { bornerResultatDeCommande } from '../chat/resultat-de-commande-borne'

/**
 * AJOUTE la note a celle qui attend encore, au lieu de la remplacer : un `/scout` suivi
 * d'un `/frame` sans message entre les deux ne laissait au modele que le `/frame`. Le cumul reste
 * sous la borne de tout resultat injecte. Sa date reste celle du PLUS ANCIEN tour qui attend : c'est
 * lui qui peut avoir vieilli.
 */
export function deposerCompteRenduEnAttente(
  comptesRendusNonVus: Map<string, CompteRenduNonVu>,
  conversationId: string,
  texte: string,
  maintenant = Date.now()
): void {
  let enAttente = comptesRendusNonVus.get(conversationId)
  try {
    enAttente ??= lireCompteRenduNonVu(conversationId)
  } catch {
    /* cache illisible : la note du jour reste, seule l'ancienne serait perdue */
  }
  const note: CompteRenduNonVu = enAttente
    ? {
        texte: bornerResultatDeCommande('orchestrate', `${enAttente.texte}\n\n---\n\n${texte}`),
        at: enAttente.at
      }
    : { texte, at: maintenant }
  comptesRendusNonVus.set(conversationId, note)
  try {
    deposerCompteRenduNonVu(conversationId, note.texte, undefined, note.at)
  } catch {
    /* cache non ecrit : seul un redemarrage avant le prochain tour perdrait la note */
  }
}

const MINUTE = 60_000
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE

function ilYA(ecartMs: number): string {
  if (ecartMs >= JOUR) {
    const jours = Math.floor(ecartMs / JOUR)
    return `il y a ${jours} jour${jours > 1 ? 's' : ''}`
  }
  if (ecartMs >= HEURE) return `il y a ${Math.floor(ecartMs / HEURE)} h`
  return `il y a ${Math.max(0, Math.floor(ecartMs / MINUTE))} min`
}

/**
 * La note sort DATÉE : sa date de dépôt, à l'heure du poste, et son âge. Au-delà d'un jour, elle dit
 * aussi que l'état a pu changer : mesuré le 2026-11-13, 79 notes sur 152 avaient plus de 7 jours (la
 * plus vieille 28), et le message du tour les présente comme « un fait établi ». Le fait reste vrai —
 * le tour manque bien à la session du modèle —, c'est sa fraîcheur qui ne l'est plus.
 */
function noteDatee(note: CompteRenduNonVu, maintenant: number): string {
  const depot = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
    note.at
  )
  const ecart = maintenant - note.at
  const garde = ecart >= JOUR ? ' ; l’état a pu changer depuis, revérifie avant de t’y fier' : ''
  return `[Exécuté par l’app le ${depot}, ${ilYA(ecart)}${garde}.]\n${note.texte}`
}

/** Rend la note en attente, datée, PUIS l'oublie : elle n'est remise qu'une fois. */
export function consommerCompteRenduEnAttente(
  comptesRendusNonVus: Map<string, CompteRenduNonVu>,
  conversationId: string,
  maintenant = Date.now()
): string | undefined {
  let note = comptesRendusNonVus.get(conversationId)
  comptesRendusNonVus.delete(conversationId)
  try {
    note ??= lireCompteRenduNonVu(conversationId)
    oublierCompteRenduNonVu(conversationId)
  } catch {
    /* cache illisible = aucune note : le tour part sans, comme avant ce correctif */
  }
  return note ? noteDatee(note, maintenant) : undefined
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

/**
 * La base de comparaison de l'état, PAR FIL. La mémoire d'abord (chemin chaud de chaque tour), puis le
 * disque, une fois par fil et par processus. Même forme qu'une `Map` pour les appelants : ils n'ont pas
 * à savoir où elle vit.
 */
export interface EtatPousseParFil {
  get(conversationId: string): unknown
  set(conversationId: string, etat: unknown): void
}

export function creerEtatPousseParFil(): EtatPousseParFil {
  const memoire = new Map<string, unknown>()
  return {
    get(conversationId) {
      if (memoire.has(conversationId)) return memoire.get(conversationId)
      const surDisque = lireEtatPousse(conversationId)
      if (surDisque !== undefined) memoire.set(conversationId, surDisque)
      return surDisque
    },
    set(conversationId, etat) {
      memoire.set(conversationId, etat)
      deposerEtatPousse(conversationId, etat)
    }
  }
}
