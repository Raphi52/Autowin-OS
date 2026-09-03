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
  /**
   * SIGNE DE VIE d'une action encore en cours — remplace a chaque battement, efface par le verdict.
   *
   * DEFAUT VECU le 2026-08-25 (conv-1400) : `verify` a rejoue la suite unitaire pendant dix minutes
   * et le fil n'a affiche que « 1 action en cours », sans une ligne de plus jusqu'au plafond. Rien
   * ne distinguait, a l'oeil, une suite qui TRAVAILLE d'une suite BLOQUEE ou d'une app plantee.
   *
   * Transitoire par nature : il ne survit jamais au resultat, sinon le fil garderait un compteur
   * mort sous un verdict deja rendu.
   */
  progress?: string
  /**
   * SKILLS ET AGENTS CHOISIS pour cette tache, dans l'ordre ou le pipeline les engage — la phase
   * (ou skill) jouee et le modele qui la joue. TRANSITOIRE comme `progress` : rempli par la vue a
   * partir des evenements `orchestrate-phase` du run, jamais ecrit par le journal du tour.
   *
   * DEMANDE du 2026-09-02 : « le bloc orchestration doit pouvoir etre deplie et afficher les
   * skill/agents choisis pour la task ». Tant que le run tourne, l'action n'a aucun `data` : le fil
   * ne pouvait donc RIEN deplier et ne nommait ni la phase en cours ni l'agent qui la joue.
   */
  pipeline?: PipelineChoice[]
}

/**
 * PROMPT REELLEMENT ENVOYE a une phase du pipeline — meme enveloppe que celle deja affichee dans le
 * fil des sous-agents (`OrchStep.prompt`), remontee jusqu'a la ligne de phase du bloc orchestration.
 *
 * DEMANDE (2026-09-03) : « voir les prompts envoyes a chaque skill ». Le deplie nommait la phase et
 * le modele, mais rien ne disait ce qui leur avait ete transmis — l'information existait pourtant
 * deja, un cran plus loin, dans le panneau des sous-agents.
 *
 * Un SEUL type pour les deux endroits, volontairement : deux declarations du meme prompt finiraient
 * par divenger, et le fil afficherait alors une verite de plus que celle envoyee.
 */
export interface PipelinePrompt {
  provider: string
  model?: string
  transport: string
  system?: string
  messages: Array<{ role: string; content: string }>
  options: Record<string, unknown>
  limitation: string
}

/** Un maillon du pipeline reellement engage : la phase/skill jouee et l'agent qui la joue. */
export interface PipelineChoice {
  /** Phase du pipeline (scout/frame/build/...) ou identifiant de skill, tel que le run l'annonce. */
  phase?: string
  role?: string
  provider?: string
  model?: string
  /**
   * Ce qui a ete ENVOYE a ce maillon. Absent tant que l'appel n'est pas parti : la phase est
   * annoncee AVANT que son prompt soit compile, donc une ligne sans prompt est un etat normal, pas
   * un trou a combler.
   */
  prompt?: PipelinePrompt
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
  /**
   * Raisonnement du modèle, CONSERVÉ avec le tour — sans lui, le bloc « Réflexion » du fil est
   * vide dès qu'on recharge la conversation : la pensée n'existait que le temps du stream.
   * Borné à la FIN (c'est la partie qui conclut) pour ne pas gonfler `conversations.json`.
   */
  reasoning?: string
}

/** Plafond du raisonnement conservé par tour — aligné sur ce que le fil affiche en direct. */
export const REASONING_MAX = 4_000

export type ChatTurnEvent =
  | { kind: 'delta'; streamId: string; text: string }
  /** Raisonnement du modèle : s'accumule dans le tour, n'entre JAMAIS dans la réponse (`parts`). */
  | { kind: 'reasoning'; text: string }
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
  /** Battement d'avancement d'une action en cours : ne resout rien, ne cree rien. */
  | { kind: 'progress'; actionId: string; text: string }
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

  if (event.kind === 'reasoning') {
    if (!event.text) return state
    // Le statut est INCHANGÉ : penser n'est ni parler ni terminer. Un tour déjà clos qui reçoit son
    // raisonnement (émis à la clôture) doit rester clos.
    return { ...state, reasoning: `${state.reasoning ?? ''}${event.text}`.slice(-REASONING_MAX) }
  }

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

  if (event.kind === 'progress') {
    const parts = state.parts.slice()
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index]
      if (part.kind !== 'action' || part.actionId !== event.actionId) continue
      // Une action DEJA close ne redevient pas vivante parce qu'un battement arrive en retard :
      // la course est reelle (le tampon est vide par intervalle, le verdict par la fin du process).
      if (part.ok !== undefined || part.interrupted) break
      parts[index] = { ...part, progress: event.text }
      break
    }
    return { ...state, parts }
  }

  if (event.kind === 'result') {
    const parts = state.parts.slice()
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index]
      if (part.kind !== 'action' || part.actionId !== event.actionId) continue
      // `progress` est retire explicitement : le verdict REMPLACE le signe de vie, il ne cohabite
      // pas avec lui.
      const { progress: _vivant, ...sansSigneDeVie } = part
      parts[index] = {
        ...sansSigneDeVie,
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

function retirerAnnonceEnTete(texte: string): string {
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
/** Plafond par resultat d'action dans l'historique du modele. */
const CAP_RESULTAT_MODELE = 1200

/**
 * L'HISTORIQUE AMNESIQUE — ce que le MODELE doit voir de ses propres actions.
 *
 * DEFAUT MESURE le 2026-08-26 : `flattenChatParts` reduit une action REUSSIE a l'etiquette
 * `[a execute verify]` et JETTE son resultat. Au tour suivant, le modele ne voit ni code de sortie,
 * ni resume, ni preuve de ce qu'il a lui-meme fait — alors il relance l'action pour rien. Seuls les
 * echecs gardaient une trace, et encore : juste `(echec)`.
 *
 * POURQUOI UNE FONCTION SEPAREE plutot qu'un correctif de `flattenChatParts` : cette derniere
 * alimente aussi le rendu (`message.content`). Y verser le resultat brut ferait deborder la sortie
 * verbeuse dans l'interface. L'affichage veut une etiquette courte, le modele veut la PREUVE : deux
 * besoins opposes, deux fonctions. Un test verrouille que l'affichage reste inchange.
 *
 * BORNE PAR RESULTAT, pas par total : rejouer 50 000 caracteres a chaque tour couterait plus cher
 * que la relance qu'on evite. Ce qui est coupe est DIT (« … ») — une troncature muette ferait lire
 * un extrait comme s'il etait le tout.
 */
export function flattenChatPartsForModel(parts: PersistedChatPart[]): string {
  const lignes: string[] = []
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.text) lignes.push(part.text)
      continue
    }
    if (part.kind === 'artifact') {
      lignes.push(`[artefact ${part.artifact.name}]`)
      continue
    }
    if (part.kind === 'error') {
      lignes.push(`⚠️ ${part.message}`)
      continue
    }
    // Une action dont l'issue n'arrivera JAMAIS ne doit pas passer pour un succes muet.
    if (part.interrupted) {
      lignes.push(`[${part.name} : interrompu, issue inconnue]`)
      continue
    }
    const issue = part.ok === false ? 'échec' : 'ok'
    const resultat = resumerResultat(part.data)
    lignes.push(resultat ? `[${part.name} : ${issue}] ${resultat}` : `[${part.name} : ${issue}]`)
  }
  return lignes.filter(Boolean).join('\n')
}

/** Le resultat d'une action, rendu lisible et BORNE. Rend '' quand il n'y a rien a dire. */
function resumerResultat(data: unknown): string {
  if (data === undefined || data === null) return ''
  const texte = typeof data === 'string' ? data : safeStringify(data)
  if (!texte) return ''
  return texte.length > CAP_RESULTAT_MODELE ? `${texte.slice(0, CAP_RESULTAT_MODELE)}…` : texte
}

/** `JSON.stringify` ne doit jamais faire echouer un tour : un cycle rend une chaine vide. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

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
