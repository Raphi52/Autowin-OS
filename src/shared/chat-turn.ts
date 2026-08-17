import type { ChatArtifact } from './artifacts'
import type { ChatAttachment } from './preload-contracts'

export type ChatTurnStatus = 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface PersistedChatTextPart {
  kind: 'text'
  text: string
  streamId?: string
}

export interface PersistedChatActionPart {
  kind: 'action'
  actionId?: string
  name: string
  args?: unknown
  ok?: boolean
  data?: unknown
  /**
   * Le tour s'est clos sans que le résultat de cette action arrive (fermeture de l'app, annulation,
   * erreur) : on ne saura JAMAIS son issue. Distinct de `ok: false` (échec constaté) et de
   * `ok === undefined` seul, qui signifierait « encore en cours » — et laissait l'indicateur
   * « N action en cours » collé indéfiniment.
   */
  interrupted?: boolean
}

export interface PersistedChatArtifactPart {
  kind: 'artifact'
  artifact: ChatArtifact
}

/**
 * ERREUR STRUCTURÉE d'un tour. Avant, l'échec était poussé comme une part texte `⚠️ …` :
 * indistinguable d'un contenu produit par le modèle (copié, cité, relu comme une réponse), sans
 * cause exploitable ni sémantique d'alerte. La cause dit OÙ ça a cassé, pour que la reprise
 * proposée soit la bonne.
 */
export interface PersistedChatErrorPart {
  kind: 'error'
  /** `send` : l'appel n'est jamais parti. `turn` : le tour est parti et a échoué. */
  cause: 'send' | 'turn'
  message: string
}

export type PersistedChatPart =
  | PersistedChatTextPart
  | PersistedChatActionPart
  | PersistedChatArtifactPart
  | PersistedChatErrorPart

export interface ChatTurnRuntime {
  provider: string
  model?: string
  reasoningEffort?: string
  sessionId?: string
}

export interface ChatTurnState {
  turnId: string
  status: ChatTurnStatus
  parts: PersistedChatPart[]
  runtime?: ChatTurnRuntime
  error?: string
}

export type ChatTurnEvent =
  | { kind: 'delta'; streamId: string; text: string }
  | { kind: 'stream-reset'; streamId: string }
  | { kind: 'resumed' }
  | { kind: 'command'; actionId: string; name: string; args?: unknown }
  | {
      kind: 'result'
      actionId: string
      name: string
      ok?: boolean
      data?: unknown
      /** Payload brut durable, reserve a la reprise du modele et jamais projete dans la vue. */
      attachments?: ChatAttachment[]
    }
  | { kind: 'artifact'; artifact: ChatArtifact }
  | { kind: 'done'; sessionId?: string }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled' }
  | { kind: 'interrupted' }

const SENSITIVE_KEY = /(?:password|passwd|secret|token|api[-_]?key|authorization|cookie)/i
const MAX_DEPTH = 6
const MAX_KEYS = 80
const MAX_ARRAY = 80
const MAX_STRING = 12_000

export function sanitizePersistedValue(value: unknown): unknown {
  const seen = new WeakSet<object>()

  const visit = (current: unknown, depth: number, key?: string): unknown => {
    if (key && SENSITIVE_KEY.test(key)) return '[masqué]'
    if (typeof current === 'string')
      return current.length > MAX_STRING ? `${current.slice(0, MAX_STRING)}…` : current
    if (
      current === null ||
      typeof current === 'number' ||
      typeof current === 'boolean' ||
      current === undefined
    )
      return current
    if (typeof current !== 'object') return String(current)
    if (depth >= MAX_DEPTH) return '[profondeur limitée]'
    if (seen.has(current)) return '[référence circulaire]'
    seen.add(current)
    if (Array.isArray(current))
      return current.slice(0, MAX_ARRAY).map((item) => visit(item, depth + 1))

    const output: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(current).slice(0, MAX_KEYS))
      output[entryKey] = visit(entryValue, depth + 1, entryKey)
    return output
  }

  return visit(value, 0)
}

export function createChatTurn(turnId: string, runtime?: ChatTurnRuntime): ChatTurnState {
  return { turnId, status: 'streaming', parts: [], ...(runtime ? { runtime } : {}) }
}

/**
 * JAMAIS DE BULLE VIDE — y compris sur un tour ANNULE ou INTERROMPU.
 *
 * Constate dans `conv-1267` (message 5) : l'utilisateur commence une phrase, se corrige, le tour est
 * annule — et il ne reste RIEN a lire. La regle « jamais de bulle vide » existait deja, mais seulement
 * sur les chemins ou le modele avait parle ; une annulation precoce y echappait.
 *
 * Un tour clos sans un mot est indistinguable d'une panne : l'utilisateur ne sait pas s'il a interrompu
 * quelque chose, ni si du travail a ete perdu. Le mot est ajoute UNIQUEMENT si rien d'autre n'existe —
 * un tour qui a deja parle garde sa reponse intacte.
 */
const MOT_ANNULE = 'Tour annulé avant toute réponse — rien n’a été exécuté.'
const MOT_INTERROMPU =
  'Tour interrompu avant sa conclusion — le travail lancé a pu ne pas rendre son résultat.'

function avecMotSiVide(parts: PersistedChatPart[], mot: string): PersistedChatPart[] {
  return parts.length > 0 ? parts : [{ kind: 'text', text: mot }]
}

export function reduceChatTurn(state: ChatTurnState, event: ChatTurnEvent): ChatTurnState {
  if (event.kind === 'resumed') return { ...state, status: 'streaming', error: undefined }

  if (event.kind === 'delta') {
    if (!event.text) return state
    const parts = state.parts.slice()
    const previous = parts.at(-1)
    if (previous?.kind === 'text' && previous.streamId === event.streamId)
      parts[parts.length - 1] = { ...previous, text: previous.text + event.text }
    else parts.push({ kind: 'text', streamId: event.streamId, text: event.text })
    return { ...state, status: 'streaming', parts }
  }

  if (event.kind === 'stream-reset')
    return {
      ...state,
      parts: state.parts.filter(
        (part) => !(part.kind === 'text' && part.streamId === event.streamId)
      )
    }

  if (event.kind === 'command')
    return {
      ...state,
      parts: [
        ...state.parts,
        {
          kind: 'action',
          actionId: event.actionId,
          name: event.name,
          ...(event.args === undefined ? {} : { args: sanitizePersistedValue(event.args) })
        }
      ]
    }

  if (event.kind === 'result') {
    const parts = state.parts.slice()
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index]
      if (part.kind !== 'action' || part.actionId !== event.actionId) continue
      parts[index] = {
        ...part,
        ok: event.ok,
        ...(event.data === undefined ? {} : { data: sanitizePersistedValue(event.data) })
      }
      break
    }
    return { ...state, parts }
  }

  if (event.kind === 'artifact') {
    const existing = state.parts.findIndex(
      (part) => part.kind === 'artifact' && part.artifact.id === event.artifact.id
    )
    if (existing < 0)
      return {
        ...state,
        parts: [...state.parts, { kind: 'artifact', artifact: event.artifact }]
      }
    const parts = state.parts.slice()
    parts[existing] = { kind: 'artifact', artifact: event.artifact }
    return { ...state, parts }
  }

  if (event.kind === 'done')
    return {
      ...state,
      status: 'completed',
      ...(event.sessionId
        ? {
            runtime: {
              provider: state.runtime?.provider ?? 'unknown',
              ...state.runtime,
              sessionId: event.sessionId
            }
          }
        : {})
    }
  if (event.kind === 'failed')
    return {
      ...state,
      status: 'failed',
      error: event.error,
      parts: state.parts.map((part) =>
        part.kind === 'action' && part.ok === undefined ? { ...part, ok: false } : part
      )
    }
  if (event.kind === 'cancelled')
    return { ...state, status: 'cancelled', parts: avecMotSiVide(state.parts, MOT_ANNULE) }
  // INTERROMPU : le tour est clos sans que les actions en vol puissent aboutir. Les laisser en
  // `ok === undefined` les ferait lire « encore en cours » par toutes les surfaces (fil, graphe) —
  // c'est exactement l'état zombie d'un run tué par la fermeture de l'app. `interrupted` dit la
  // vérité : l'issue ne viendra jamais, sans la maquiller en échec constaté (`ok: false`).
  return {
    ...state,
    status: 'interrupted',
    parts: avecMotSiVide(state.parts, MOT_INTERROMPU).map((part) =>
      part.kind === 'action' && part.ok === undefined && !part.interrupted
        ? { ...part, interrupted: true }
        : part
    )
  }
}

/**
 * Retire une ANNONCE D'INTENTION en tete, quand le resultat suit juste apres.
 *
 * Mesure le 2026-08-16 : dernier defaut refuse par le juge d'experience. L'agent ecrit « Je dois
 * d'abord lire le contenu de src/shared pour donner un nombre verifie. » PUIS donne le nombre. Une
 * fois le resultat la, cette phrase n'apporte rien — elle raconte une intention deja depassee.
 *
 * Le prompt l'interdit deja en toutes lettres (« n'annonce jamais un lancement avant son resultat »)
 * et n'a pas suffi — comme pour les cinq gardes precedentes. Une relance mecanique couterait un appel
 * modele pour un defaut purement cosmetique : on nettoie donc a l'AFFICHAGE, sans depense.
 *
 * Etroit par construction : SEULE la premiere ligne, SEULEMENT si du texte la suit, et seulement si
 * elle annonce au futur. Un refus (« je ne peux pas ») ou une explication ne sont jamais touches.
 */
const ANNONCE_EN_TETE = /^\s*je (?:dois|vais|commence par|cible|proc\u00e8de)\b[^\n]*\n/i

export function retirerAnnonceEnTete(texte: string): string {
  if (!ANNONCE_EN_TETE.test(texte)) return texte
  const reste = texte.replace(ANNONCE_EN_TETE, '').trim()
  // Si l'annonce etait TOUT le message, on la garde : mieux vaut une intention qu'une bulle vide.
  return reste ? reste : texte
}

/**
 * Le texte LU par l'utilisateur — les etiquettes d'action n'y sont qu'un DERNIER RECOURS.
 *
 * MESURE le 2026-08-15 sur 39 conversations de sonde : 36 commencaient par « [a execute ... ] », y
 * compris quand la reponse en dessous etait parfaitement redigee. Verdict de l'utilisateur : « c'est
 * pas du tout l'experience utilisateur que je veux offrir ».
 *
 * Les supprimer purement ferait revenir un defaut plus ancien et PIRE : la bulle VIDE d'un tour qui
 * n'a fait qu'agir (conv-1141). D'ou un couple de garanties indissociable — aucune etiquette quand
 * une vraie reponse existe, jamais de bulle vide quand elle n'existe pas.
 *
 * Les ERREURS et les actions ECHOUEES restent toujours visibles : un echec n'est pas du bruit
 * technique, c'est le fait le plus important du tour. Seules les actions REUSSIES s'effacent.
 */
export function flattenChatParts(parts: PersistedChatPart[]): string {
  const lisible: string[] = []
  const etiquettes: string[] = []
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.text) lisible.push(part.text)
      continue
    }
    if (part.kind === 'artifact') {
      lisible.push(`[artefact ${part.artifact.name}]`)
      continue
    }
    if (part.kind === 'error') {
      lisible.push(`⚠️ ${part.message}`)
      continue
    }
    const etiquette = `[a exécuté ${part.name}${part.ok === false ? ' (échec)' : ''}]`
    if (part.ok === false) lisible.push(etiquette)
    else etiquettes.push(etiquette)
  }
  const texte = retirerAnnonceEnTete(lisible.filter(Boolean).join('\n'))
  return texte || etiquettes.join('\n')
}
