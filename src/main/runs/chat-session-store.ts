import { ensureAutowinAppData } from '../app-data'
import { creerIndexStore } from './json-index-store'

/**
 * INDEX PERSISTANT des sessions CLI du chat — le maillon manquant du levier de coût déjà en place.
 *
 * La reprise de session existe (`--resume` du CLI Claude, `providers/claude.ts:665`) et son gain est
 * chiffré dans le code lui-meme (`agent-pilot.ts:299-307`, mesure du 2026-07-28) : sans elle, ~79 k
 * tokens de contexte re-payes PAR TOUR et 1,85 M de tokens de `cache_write` par HEURE. Mais l'index
 * qui relie une conversation a sa session vit dans une `Map` MEMOIRE (`agent-pilot.ts:255`) : au
 * moindre redemarrage de l'app, il disparait et le tour suivant re-paie l'historique entier.
 *
 * Ce module ne change ni le prompt, ni l'ordre des blocs, ni le protocole. Il cesse simplement de
 * PERDRE un identifiant qu'on possedait deja. C'est le seul endroit de ce chantier ou le gain est
 * mecaniquement certain, et non deduit : un tour qui reprend n'envoie pas l'historique, point.
 *
 * FAIL-OPEN ASSUME, et c'est l'inverse du choix fait sur le gateway d'outils : ici la donnee est un
 * CACHE. Perdre une session coute un renvoi d'historique — cher, jamais faux. Un fichier corrompu,
 * illisible ou de forme inattendue vaut donc « aucune session connue », et surtout PAS une exception
 * qui casserait le tour de l'utilisateur pour un cache. Sur une autorite on ferme ; sur un cache on
 * ouvre. Confondre les deux est la faute classique.
 *
 * La mecanique de l'index (lecture fail-open, ecriture atomique, oubli) a ete extraite dans
 * `json-index-store.ts` le 2026-08-21 : elle etait dupliquee ligne pour ligne avec `murs-store.ts`.
 * Le comportement decrit ci-dessus est INCHANGE — c'est le contrat que les tests de ce fichier
 * verifient, et la seule preuve valable pour un refactor qui ne doit rien modifier.
 */

export interface ChatSessionRecord {
  /** Binding `provider:model` — une session ouverte sous un autre binding n'est pas reprenable. */
  key: string
  sessionId: string
}

export type ChatSessionIndex = Record<string, ChatSessionRecord>

function estRecord(valeur: unknown): valeur is ChatSessionRecord {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false
  const r = valeur as Record<string, unknown>
  return typeof r.key === 'string' && !!r.key && typeof r.sessionId === 'string' && !!r.sessionId
}

const store = creerIndexStore<ChatSessionRecord>('chat-sessions.json', estRecord)

export function chatSessionStorePath(base = ensureAutowinAppData()): string {
  return store.chemin(base)
}

/**
 * Relit l'index. Toute anomalie rend `{}` : fichier absent, JSON invalide, racine qui n'est pas un
 * objet, ou UNE SEULE entree mal formee. Ce dernier point est volontairement strict — un index a
 * moitie valide inviterait a reprendre une session sur une donnee douteuse, alors que le repli
 * (renvoyer l'historique) est toujours correct.
 */
export function loadChatSessions(base = ensureAutowinAppData()): ChatSessionIndex {
  return store.lire(base)
}

/**
 * Enregistre la session d'une conversation. REFUSE une entree incomplete : mieux vaut aucune session
 * qu'une session fausse, qui ferait elider l'historique en affirmant au modele qu'il le connait —
 * exactement la panne « resume fantome » deja vecue avec codex (`agent-pilot.ts:404-410` : 0 appel
 * reellement repris, 31 prompts amputes).
 */
export function saveChatSession(
  conversationId: string,
  key: string,
  sessionId: string,
  base = ensureAutowinAppData()
): void {
  if (!conversationId) throw new Error('conversation manquante')
  if (!key) throw new Error('binding (key) manquant')
  if (!sessionId) throw new Error('sessionId manquant')
  const index = store.lire(base)
  index[conversationId] = { key, sessionId }
  store.ecrire(index, base)
}

/** Oublie une conversation. Sans effet si elle est inconnue — oublier deux fois n'est pas une erreur. */
export function forgetChatSession(conversationId: string, base = ensureAutowinAppData()): void {
  store.oublier(conversationId, base)
}
