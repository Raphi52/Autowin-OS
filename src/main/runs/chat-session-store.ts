import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'

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
 */

export interface ChatSessionRecord {
  /** Binding `provider:model` — une session ouverte sous un autre binding n'est pas reprenable. */
  key: string
  sessionId: string
}

export type ChatSessionIndex = Record<string, ChatSessionRecord>

export function chatSessionStorePath(base = ensureAutowinAppData()): string {
  return join(base, 'chat-sessions.json')
}

function estRecord(valeur: unknown): valeur is ChatSessionRecord {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false
  const r = valeur as Record<string, unknown>
  return typeof r.key === 'string' && !!r.key && typeof r.sessionId === 'string' && !!r.sessionId
}

/**
 * Relit l'index. Toute anomalie rend `{}` : fichier absent, JSON invalide, racine qui n'est pas un
 * objet, ou UNE SEULE entree mal formee. Ce dernier point est volontairement strict — un index a
 * moitie valide inviterait a reprendre une session sur une donnee douteuse, alors que le repli
 * (renvoyer l'historique) est toujours correct.
 */
export function loadChatSessions(base = ensureAutowinAppData()): ChatSessionIndex {
  const chemin = chatSessionStorePath(base)
  if (!existsSync(chemin)) return {}
  let brut: unknown
  try {
    brut = JSON.parse(readFileSync(chemin, 'utf8'))
  } catch {
    return {}
  }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {}
  const entrees = Object.entries(brut as Record<string, unknown>)
  if (entrees.some(([, valeur]) => !estRecord(valeur))) return {}
  return Object.fromEntries(entrees) as ChatSessionIndex
}

/**
 * Ecriture ATOMIQUE (fichier temporaire puis `rename`), meme discipline que
 * `store/conversations-disk.ts:408` : une interruption ne doit jamais laisser un index tronque, qui
 * serait alors relu comme corrompu et ferait perdre TOUTES les sessions, pas seulement la derniere.
 */
function ecrire(index: ChatSessionIndex, base: string): void {
  const chemin = chatSessionStorePath(base)
  mkdirSync(base, { recursive: true })
  const temporaire = `${chemin}.tmp`
  writeFileSync(temporaire, `${JSON.stringify(index, null, 1)}\n`, 'utf8')
  renameSync(temporaire, chemin)
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
  const index = loadChatSessions(base)
  index[conversationId] = { key, sessionId }
  ecrire(index, base)
}

/** Oublie une conversation. Sans effet si elle est inconnue — oublier deux fois n'est pas une erreur. */
export function forgetChatSession(conversationId: string, base = ensureAutowinAppData()): void {
  const index = loadChatSessions(base)
  if (!(conversationId in index)) return
  delete index[conversationId]
  if (Object.keys(index).length === 0) {
    const chemin = chatSessionStorePath(base)
    try {
      if (existsSync(chemin)) unlinkSync(chemin)
    } catch {
      /* best-effort : un index vide laisse sur disque est inoffensif */
    }
    return
  }
  ecrire(index, base)
}
