import { randomUUID } from 'node:crypto'
import {
  createChatTurn,
  flattenChatParts,
  reduceChatTurn,
  type ChatTurnEvent,
  type ChatTurnRuntime,
  type ChatTurnStatus,
  type PersistedChatPart
} from '../../shared/chat-turn'
import { hasInterruptionNotice, interruptionNotice } from '../runs/run-interruption'
import type { ChatArtifact } from '../../shared/artifacts'
import type { AutoKaizenConversationLink } from '../../shared/auto-kaizen-link'
import { canonicalProjectPath } from '../../shared/project-path'

// Store en mémoire des conversations : un PROVIDER qui répond, un DOSSIER qui range.
// Interface pensée pour être remplacée plus tard par un backend sqlite sans changer l'appelant.

export interface AttachmentMeta {
  name: string
  mimeType: string
  size: number
  /** Miniature downscalée (data URL) d'une image — persistée pour l'aperçu dans le fil. */
  thumbnail?: string
  artifact?: ChatArtifact
  turnId?: string
  /** L’original n’a pas pu être conservé ; ne pas présenter la miniature comme sa source. */
  originalUnavailable?: boolean
}

/** Un message échangé dans une conversation. */
export interface Msg {
  messageId?: string
  parentMessageId?: string
  role: 'user' | 'assistant'
  content: string
  ts: number
  attachments?: AttachmentMeta[]
  turnId?: string
  /**
   * Conversation qui POSSÈDE le journal de ce tour, quand ce n'est pas celle qui porte le message
   * (message copié par un fork). Absent = le tour appartient à la conversation courante.
   */
  turnConversationId?: string
  status?: ChatTurnStatus
  parts?: PersistedChatPart[]
  runtime?: ChatTurnRuntime
  error?: string
}

/** D'où vient une conversation créée par un fork — trace d'origine, sans lien vivant. */
export interface ForkOrigin {
  conversationId: string
  messageId: string
}

/** Titre d'un fork : lisible dans la liste, et jamais empilé à l'infini sur des forks de forks. */
export function forkTitle(sourceTitle: string): string {
  const base = sourceTitle.replace(/\s*\(fork(?: \d+)?\)\s*$/i, '').trim()
  return `${base || 'Conversation'} (fork)`
}

/** Une conversation, rattachée à un provider et rangée dans un dossier de travail. */
export interface Conversation {
  schemaVersion?: 2 | 3
  id: string
  title: string
  /**
   * Le moteur qui répond (`'claude' | 'codex' | ...`).
   *
   * Portait AUSSI le nom `category` jusqu'à ce remake : deux champs persistés toujours égaux, dont
   * un seul décidait quoi que ce soit. Un ancien `conversations.json` peut encore porter
   * `category` — l'hydratation le lit en repli (`category ?? provider`) et ne le réécrit plus.
   */
  provider: string
  messages: Msg[]
  /** Renseigné si la conversation est née d'un fork. Purement informatif. */
  forkedFrom?: ForkOrigin
  /** Filiation durable d'une analyse/correction Auto-Kaizen avec la conversation source. */
  autoKaizen?: AutoKaizenConversationLink
  /**
   * Le dossier de travail auquel cette conversation appartient — ce qui la GROUPE dans la liste.
   *
   * Distinct de `provider`, qui porte le MOTEUR (`'claude' | 'codex' | ...`) : le détourner pour
   * y ranger un dossier casserait l'affichage et les recopies sans erreur visible.
   *
   * OPTIONNEL, et il le reste : un `conversations.json` écrit par une version antérieure doit
   * continuer à se relire. Absent → la conversation vit dans « Divers ».
   */
  projectPath?: string
  /** RUN.md externes (Claude Code) attachés à cette conversation. */
  runPaths?: string[]
  createdAt: number
  updatedAt: number
}

export type ConversationSummary = Omit<Conversation, 'messages'> & {
  messageCount: number
  lastMessageRole?: Msg['role']
  lastAssistantStatus?: ChatTurnStatus
  /**
   * Date du dernier message de l'UTILISATEUR. Distincte d'`updatedAt`, que bougent aussi des
   * écritures qui ne sont pas de lui : un delta de streaming (`applyTurnEvent`), l'attache ou le
   * détachement d'un RUN.md, un fork. « La dernière conversation que j'ai utilisée » se lit ICI ;
   * `updatedAt` répond à « la dernière touchée », ce qui n'est pas la même question.
   */
  lastUserMessageAt?: number
}

/** Date du dernier tour de l'utilisateur, ou `undefined` s'il n'a encore rien écrit. */
/** Un passage d'une conversation qui porte le terme cherche, avec de quoi le situer. */
export interface ConversationExtrait {
  role: string
  ts: number
  extrait: string
}

/** Une conversation qui porte le terme, et les passages qui le portent. */
export interface ConversationRecherche {
  id: string
  title: string
  provider: string
  updatedAt: number
  messageCount: number
  extraits: ConversationExtrait[]
}

/**
 * Replie un texte sur sa forme comparable : minuscules, accents retires.
 *
 * `NFD` separe la lettre de son accent, la plage `U+0300-U+036F` supprime les accents ainsi
 * isoles. « À jour » et « a jour » deviennent la meme chaine -- celui qui tape vite cherche la
 * meme chose que celui qui tape juste.
 */
function replier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * La FENETRE autour du terme trouve, prise sur le texte d'ORIGINE (accents et casse intacts).
 *
 * Rendre le message entier noierait le terme dans des milliers de caracteres ; n'en rendre que le
 * terme ne dirait pas dans quelle phrase il se trouve. Les bords coupes sont marques : une
 * troncature muette se lit comme un texte complet.
 */
function fenetre(origine: string, position: number, longueur: number): string {
  const MARGE = 120
  const debut = Math.max(0, position - MARGE)
  const fin = Math.min(origine.length, position + longueur + MARGE)
  const coeur = origine.slice(debut, fin).replace(/\s+/g, ' ').trim()
  return (debut > 0 ? '...' : '') + coeur + (fin < origine.length ? '...' : '')
}

export function lastUserMessageAt(messages: readonly Msg[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user' && typeof message.ts === 'number') return message.ts
  }
  return undefined
}

export interface ConversationChange {
  id: string
  conversation?: Conversation
  urgency: 'immediate' | 'checkpoint'
  journal?:
    | { op: 'append-messages'; messages: Msg[]; updatedAt: number }
    | { op: 'turn-event'; turnId: string; event: ChatTurnEvent; updatedAt: number }
}

/**
 * L'identifiant déterministe d'un message qui n'en porte pas sur disque.
 *
 * UNE seule définition : `hydrate` l'alloue, et `hasUniqueMessageIds` (validateur disque) doit
 * dériver exactement le même id, sinon des conversations valides sont déclarées invalides.
 * `index` est l'index 0-based dans le tableau ; l'id est 1-based. Ne change pas d'un caractère.
 */
export function deterministicMessageId(conversationId: string, index: number): string {
  return `message-${conversationId}-${index + 1}`
}

// Definition UNIQUE dans `shared/project-path` : le renderer en a besoin pour la meme cle.
export { canonicalProjectPath } from '../../shared/project-path'

/**
 * Applique un événement au tour `turnId` — LA définition unique du réducteur de tour.
 *
 * Appelée par `ConversationStore.applyTurnEvent` (le direct) ET par le rejeu du journal
 * (`conversations-disk`). Les deux copies avaient déjà divergé : le direct visait le DERNIER
 * message du tour, le rejeu le PREMIER, si bien qu'une conversation portant deux messages
 * assistant sous le même `turnId` ne se rechargeait pas telle qu'elle avait été vécue.
 *
 * La règle retenue est celle du DIRECT — le dernier — parce que c'est ce que l'utilisateur a vu
 * pendant la session, et que le rejeu doit reproduire la session, pas l'inverse. Hors de ce cas
 * (un seul candidat), les deux règles coïncident.
 *
 * Mute le message en place et le retourne ; `undefined` si aucun message du tour n'existe —
 * l'appelant décide quoi en faire.
 */
export function applyTurnEventToMessages(
  messages: readonly Msg[],
  turnId: string,
  event: ChatTurnEvent
): Msg | undefined {
  const message = [...messages]
    .reverse()
    .find((candidate) => candidate.role === 'assistant' && candidate.turnId === turnId)
  if (!message) return undefined
  const next = reduceChatTurn(
    {
      turnId,
      status: message.status ?? 'streaming',
      parts: message.parts ?? [],
      ...(message.runtime ? { runtime: message.runtime } : {}),
      ...(message.error ? { error: message.error } : {})
    },
    event
  )
  message.status = next.status
  message.parts = next.parts
  message.content = flattenChatParts(next.parts)
  message.runtime = next.runtime
  message.error = next.error
  return message
}

/** Store en mémoire de conversations, avec horloge et générateur d'id injectables pour les tests. */
export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>()
  private readonly now: () => number
  private nextId = 1
  /** Hook de persistance : porte uniquement la conversation mutée, jamais le corpus complet. */
  onChange?: (change: ConversationChange) => void

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /**
   * Recharge un état persisté (au démarrage). nextId repart au-delà des ids existants.
   *
   * C'est AUSSI le point où la conversation sort d'une attente sans issue : un tour laissé
   * `streaming` sur disque appartient forcément à un run mort avec l'app — le process qui aurait
   * pu le clore n'existe plus. Il est donc clos ici, ses actions en vol réglées, et l'utilisateur
   * PRÉVENU. Sans cet avis, le fil restait muet et l'attente pouvait durer indéfiniment.
   *
   * `resumableTurnIds` est le discriminant : un tour dont le checkpoint de run survit va réellement
   * reprendre au démarrage — l'annoncer interrompu serait faux. Absent = plus rien ne reprend.
   */
  hydrate(saved: Conversation[], options?: { resumableTurnIds?: ReadonlySet<string> }): boolean {
    const resumable = options?.resumableTurnIds
    this.conversations.clear()
    let max = 0
    let migrated = false
    const usedMessageIds = new Set<string>()
    for (const c of saved) {
      let previousMessageId: string | undefined
      const seenMessageIds = new Set<string>()
      const messageIdRemap = new Map<string, string>()
      const messages = c.messages.map((sourceMessage, index) => {
        let message = sourceMessage
        const persistedMessageId = message.messageId ?? deterministicMessageId(c.id, index)
        let messageId = persistedMessageId
        if (usedMessageIds.has(messageId)) {
          migrated = true
          do {
            messageId = `message-${randomUUID()}`
          } while (usedMessageIds.has(messageId))
        }
        // Les premiers forks v3 regeneraient les IDs locaux mais laissaient parfois un parent venu
        // de la conversation source. Ce parent orphelin est une forme legacy migrable, pas une raison
        // de rendre tout le store illisible : on retablit alors la chaine locale deterministe.
        const mappedParentMessageId = message.parentMessageId
          ? (messageIdRemap.get(message.parentMessageId) ?? message.parentMessageId)
          : undefined
        const parentMessageId =
          mappedParentMessageId && seenMessageIds.has(mappedParentMessageId)
            ? mappedParentMessageId
            : previousMessageId
        if (
          !message.messageId ||
          message.messageId !== messageId ||
          message.parentMessageId !== parentMessageId
        ) {
          migrated = true
          message = { ...message, messageId, parentMessageId }
          if (!parentMessageId) delete message.parentMessageId
        }
        messageIdRemap.set(persistedMessageId, messageId)
        previousMessageId = messageId
        seenMessageIds.add(messageId)
        usedMessageIds.add(messageId)
        if (message.role !== 'assistant') return message
        if (!message.parts) {
          migrated = true
          return {
            ...message,
            status: 'completed' as const,
            parts: message.content ? [{ kind: 'text' as const, text: message.content }] : []
          }
        }
        if (message.status === 'streaming') {
          migrated = true
          // Un checkpoint durable (orchestration OU appel provider direct) prouve qu'une reprise va
          // réellement prendre la main. Conserver l'état streaming intact évite deux mensonges :
          // afficher « interrompu » pendant que le CLI travaille encore, et marquer ses actions en
          // vol comme définitivement interrompues avant que leur résultat récupéré soit réinjecté.
          if (message.turnId && resumable?.has(message.turnId)) return message
          const interrupted: Msg = {
            ...message,
            status: 'interrupted' as const,
            // Une action sans résultat n'est pas « en cours » : le tour est clos, son issue ne
            // viendra jamais. C'est ce que lisent le fil ET le graphe d'exécution.
            parts: (message.parts ?? []).map((part) =>
              part.kind === 'action' && part.ok === undefined && !part.interrupted
                ? { ...part, interrupted: true }
                : part
            )
          }
          const runId = message.turnId
          if (!runId) return interrupted
          if (hasInterruptionNotice(interrupted.content, runId)) return interrupted
          const notice = interruptionNotice(runId)
          const parts: PersistedChatPart[] = [
            ...(interrupted.parts ?? []),
            { kind: 'text', text: notice }
          ]
          return { ...interrupted, parts, content: flattenChatParts(parts) }
        }
        return { ...message, status: message.status ?? ('completed' as const) }
      })
      // Les anciens champs de branche (`rootBranchId`, `activeBranchId`, `branches`, `branchId`)
      // sont ABANDONNÉS ici : forker crée désormais une conversation à part. On ne les recopie pas,
      // et une conversation ancienne qui en portait affiche simplement tous ses messages à la suite.
      const legacy = c as Conversation & Record<string, unknown>
      const hadBranches = legacy.rootBranchId !== undefined || legacy.branches !== undefined
      const rest: Record<string, unknown> = { ...legacy }
      delete rest.rootBranchId
      delete rest.activeBranchId
      delete rest.branches
      delete rest.authorityMode
      // Champ synthétique jamais lu, retiré du modèle : sans ce `delete` le spread le recopierait
      // indéfiniment depuis les vieux fichiers, et sa seule absence forcerait `migrated` à chaque
      // démarrage — donc une réécriture intégrale du snapshot à chaque lancement.
      const hadWorkspaceId = rest.workspaceId !== undefined
      delete rest.workspaceId
      // `category` n'a jamais ete qu'un DOUBLON EN ECRITURE de `provider` : le validateur disque a
      // toujours exige `provider` (`conversations-disk.ts` — `isConversation`), donc un fichier ou
      // `category` serait la seule source fait rejeter le store AVANT d'arriver ici. Aucun repli
      // `provider ?? category` n'est donc atteignable ; on se contente de cesser de le recopier.
      const legacyCategory = rest.category
      delete rest.category
      const provider = legacy.provider as string
      // Normalisation UNIQUE des chemins déjà écrits sous une forme non canonique : sans elle,
      // seules les écritures neuves seraient canoniques et l'ancien resterait dupliqué à vie.
      const canonicalPath = canonicalProjectPath(legacy.projectPath as string | undefined)
      const pathChanged = (legacy.projectPath as string | undefined) !== canonicalPath
      if (canonicalPath) rest.projectPath = canonicalPath
      else delete rest.projectPath
      const hydrated: Conversation = {
        ...(rest as unknown as Conversation),
        schemaVersion: 3 as const,
        provider,
        messages
      }
      if (
        c.schemaVersion !== 3 ||
        hadWorkspaceId ||
        legacyCategory !== undefined ||
        pathChanged ||
        legacy.authorityMode !== undefined ||
        hadBranches
      ) {
        migrated = true
      }
      this.conversations.set(c.id, hydrated)
      const n = Number(c.id.replace(/^conv-/, ''))
      if (Number.isFinite(n) && n > max) max = n
    }
    /*
     * PLANCHER MONOTONE, jamais un simple recalcul.
     *
     * `max + 1` sur les conversations VIVANTES fait RECULER le compteur des qu'on supprime la plus
     * haute. Vecu le 2026-08-24 : `conv-1393` supprimee le matin, l'identifiant redevenu libre, et
     * la conversation creee l'apres-midi l'a recupere -- avec, dans son graphe, un run de six heures
     * plus vieux portant un verdict ROUGE. L'utilisateur a legitimement lu « echec » sur un travail
     * qui n'etait pas le sien et qui, lui, tournait encore.
     *
     * La cause n'est pas la suppression : c'est qu'un identifiant reste REFERENCE par des runs
     * longtemps apres la mort de sa conversation. On ne le reattribue donc jamais.
     */
    this.nextId = Math.max(this.nextId, max + 1)
    return migrated
  }

  private changed(
    id: string,
    urgency: 'immediate' | 'checkpoint' = 'immediate',
    journal?: ConversationChange['journal']
  ): void {
    this.onChange?.({
      id,
      conversation: this.conversations.get(id),
      urgency,
      ...(journal ? { journal } : {})
    })
  }

  /** Crée une nouvelle conversation vide et la stocke. */
  create(p: {
    title: string
    provider: string
    autoKaizen?: AutoKaizenConversationLink
  }): Conversation {
    const ts = this.now()
    const id = this.nextUniqueConversationId()
    const conversation: Conversation = {
      schemaVersion: 3,
      id,
      title: p.title,
      provider: p.provider,
      messages: [],
      ...(p.autoKaizen ? { autoKaizen: p.autoKaizen } : {}),
      createdAt: ts,
      updatedAt: ts
    }
    this.conversations.set(conversation.id, conversation)
    this.changed(conversation.id)
    return conversation
  }

  /**
   * Le plus petit identifiant que ce store s'autorise encore a attribuer.
   *
   * Rendu pour que la couche disque le PERSISTE : sans ca le plancher repart de zero a chaque
   * demarrage, et un identifiant supprime redevient attribuable -- le defaut meme qu'il corrige.
   */
  idFloor(): number {
    return this.nextId
  }

  /** Releve le plancher (jamais le baisse) depuis une valeur persistee. */
  raiseIdFloor(valeur: number): void {
    if (Number.isSafeInteger(valeur) && valeur > this.nextId) this.nextId = valeur
  }

  /** Alloue un id de conversation sans collision, même après épuisement du compteur sûr. */
  private nextUniqueConversationId(): string {
    while (Number.isSafeInteger(this.nextId)) {
      const candidate = `conv-${this.nextId++}`
      if (!this.conversations.has(candidate)) return candidate
    }
    let candidate: string
    do {
      candidate = `conv-${randomUUID()}`
    } while (this.conversations.has(candidate))
    return candidate
  }

  private hasMessageId(candidate: string): boolean {
    return [...this.conversations.values()].some((conversation) =>
      conversation.messages.some(({ messageId }) => messageId === candidate)
    )
  }

  private nextUniqueMessageId(conversation: Conversation): string {
    let ordinal = conversation.messages.length + 1
    while (Number.isSafeInteger(ordinal)) {
      const deterministic = `message-${conversation.id}-${ordinal++}`
      if (!this.hasMessageId(deterministic)) return deterministic
    }
    let candidate: string
    do {
      candidate = `message-${randomUUID()}`
    } while (this.hasMessageId(candidate))
    return candidate
  }

  /** Ajoute un message à une conversation existante et met à jour updatedAt. Jette si l'id est inconnu. */
  append(
    id: string,
    m: { role: 'user' | 'assistant'; content: string; attachments?: AttachmentMeta[] }
  ): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new Error(`Conversation inconnue: ${id}`)
    }
    const ts = this.now()
    const previous = conversation.messages.at(-1)
    const message: Msg = {
      messageId: this.nextUniqueMessageId(conversation),
      ...(previous?.messageId ? { parentMessageId: previous.messageId } : {}),
      role: m.role,
      content: m.content,
      ts,
      ...(m.attachments?.length ? { attachments: m.attachments } : {})
    }
    conversation.messages.push(message)
    conversation.updatedAt = ts
    this.changed(id, 'immediate', {
      op: 'append-messages',
      messages: [structuredClone(message)],
      updatedAt: ts
    })
    return conversation
  }

  /** Persiste atomiquement le message utilisateur et le brouillon assistant avant le transport. */
  beginTurn(
    id: string,
    user: { content: string; attachments?: AttachmentMeta[] },
    assistant: { turnId: string; runtime?: ChatTurnRuntime }
  ): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error(`Conversation inconnue: ${id}`)
    const ts = this.now()
    const previous = conversation.messages.at(-1)
    const userMessageId = this.nextUniqueMessageId(conversation)
    const userMessage: Msg = {
      messageId: userMessageId,
      ...(previous?.messageId ? { parentMessageId: previous.messageId } : {}),
      role: 'user',
      content: user.content,
      ts,
      ...(user.attachments?.length ? { attachments: user.attachments } : {})
    }
    conversation.messages.push(userMessage)
    const turn = createChatTurn(assistant.turnId, assistant.runtime)
    const assistantMessage: Msg = {
      messageId: this.nextUniqueMessageId(conversation),
      parentMessageId: userMessageId,
      role: 'assistant',
      content: '',
      ts,
      turnId: turn.turnId,
      status: turn.status,
      parts: turn.parts,
      ...(turn.runtime ? { runtime: turn.runtime } : {})
    }
    conversation.messages.push(assistantMessage)
    conversation.schemaVersion = 3
    conversation.updatedAt = ts
    this.changed(id, 'immediate', {
      op: 'append-messages',
      messages: [structuredClone(userMessage), structuredClone(assistantMessage)],
      updatedAt: ts
    })
    return conversation
  }

  /** Démarre une continuation explicite sans fabriquer de nouveau message utilisateur. */
  beginContinuationTurn(
    id: string,
    assistant: { turnId: string; runtime?: ChatTurnRuntime }
  ): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error(`Conversation inconnue: ${id}`)
    const ts = this.now()
    const previous = conversation.messages.at(-1)
    const turn = createChatTurn(assistant.turnId, assistant.runtime)
    const assistantMessage: Msg = {
      messageId: this.nextUniqueMessageId(conversation),
      ...(previous?.messageId ? { parentMessageId: previous.messageId } : {}),
      role: 'assistant',
      content: '',
      ts,
      turnId: turn.turnId,
      status: turn.status,
      parts: turn.parts,
      ...(turn.runtime ? { runtime: turn.runtime } : {})
    }
    conversation.messages.push(assistantMessage)
    conversation.schemaVersion = 3
    conversation.updatedAt = ts
    this.changed(id, 'immediate', {
      op: 'append-messages',
      messages: [structuredClone(assistantMessage)],
      updatedAt: ts
    })
    return conversation
  }

  /** Applique un événement au tour structuré ; les deltas demandent un checkpoint regroupé. */
  applyTurnEvent(id: string, turnId: string, event: ChatTurnEvent): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error(`Conversation inconnue: ${id}`)
    const message = applyTurnEventToMessages(conversation.messages, turnId, event)
    if (!message) throw new Error(`Tour assistant inconnu: ${turnId}`)
    conversation.updatedAt = this.now()
    const terminal = ['done', 'failed', 'cancelled', 'interrupted'].includes(event.kind)
    this.changed(id, terminal ? 'immediate' : 'checkpoint', {
      op: 'turn-event',
      turnId,
      event: structuredClone(event),
      updatedAt: conversation.updatedAt
    })
    return conversation
  }

  /** Récupère une conversation par id, ou undefined si absente. */
  get(id: string): Conversation | undefined {
    return this.conversations.get(id)
  }

  /** Liste toutes les conversations, triées par updatedAt décroissant. */
  list(): Conversation[] {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * CHERCHER par CONTENU dans tout le corpus.
   *
   * La capacité qui manquait, et dont l'absence poussait au pire chemin. Mesuré en conv-1407 le
   * 2026-08-26 : l'orchestrateur, incapable de retrouver de quoi parlait « remake les pastilles de
   * couleurs », a fouillé le CODE SOURCE — `find_in_files` était la seule recherche par contenu de
   * son catalogue. Vingt inspections, zéro conversation lue, un run arrêté à 0,96 $.
   *
   * Littérale et non sémantique, délibérément : le corpus est déjà en mémoire, un parcours est
   * instantané et se PROUVE par un test, là où un index sémantique ajoute une latence et un état à
   * tenir à jour. Le Brain reste là pour ce que le littéral ne sait pas trouver.
   *
   * Insensible à la casse ET aux accents : celui qui tape « a jour » cherche « à jour ». Une
   * recherche qui punit la frappe rapide n'est pas utilisée deux fois.
   */
  search(
    terme: string,
    options?: { limite?: number; extraitsParConversation?: number }
  ): ConversationRecherche[] {
    const aiguille = replier(terme)
    // Un terme vide rendrait TOUT le corpus : ce n'est pas une recherche, c'est un dump.
    if (aiguille.length === 0) return []
    const limite = Math.max(1, Math.min(50, Math.floor(options?.limite ?? 10) || 10))
    const parConversation = Math.max(
      1,
      Math.min(20, Math.floor(options?.extraitsParConversation ?? 3) || 3)
    )
    const trouvees: ConversationRecherche[] = []
    for (const conversation of this.list()) {
      const extraits: ConversationExtrait[] = []
      for (const message of conversation.messages) {
        if (typeof message.content !== 'string') continue
        const position = replier(message.content).indexOf(aiguille)
        if (position < 0) continue
        extraits.push({
          role: message.role,
          ts: message.ts,
          extrait: fenetre(message.content, position, aiguille.length)
        })
        if (extraits.length >= parConversation) break
      }
      if (extraits.length === 0) continue
      trouvees.push({
        id: conversation.id,
        title: conversation.title,
        provider: conversation.provider,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        extraits
      })
      if (trouvees.length >= limite) break
    }
    return trouvees
  }

  /** Projection légère destinée aux listes IPC : les historiques se chargent séparément. */
  listSummaries(): ConversationSummary[] {
    return this.list().map(({ messages, ...summary }) => ({
      ...summary,
      messageCount: messages.length,
      lastMessageRole: messages.at(-1)?.role,
      lastAssistantStatus: [...messages].reverse().find((message) => message.role === 'assistant')
        ?.status,
      ...(lastUserMessageAt(messages) !== undefined
        ? { lastUserMessageAt: lastUserMessageAt(messages) }
        : {})
    }))
  }

  /** Renomme une conversation existante. Ne fait rien si l'id est inconnu. */
  rename(id: string, title: string): void {
    const conversation = this.conversations.get(id)
    if (conversation) {
      conversation.title = title
      this.changed(id)
    }
  }

  /**
   * Range la conversation dans un dossier de travail — c'est ce qui la groupe dans la liste.
   *
   * `null` la SORT de son groupe (retour à « Divers ») : sans ce chemin, un rangement serait
   * définitif et la seule façon d'en sortir serait de supprimer la conversation. Le champ est effacé
   * plutôt que mis à la chaîne vide, pour qu'un `conversations.json` relu n'en garde aucune trace.
   *
   * Ne touche PAS `updatedAt` : déplacer une conversation n'est pas y travailler, et la liste est
   * triée par `updatedAt` — un rangement la ferait remonter en tête comme si elle venait de servir.
   */
  rangerDansDossier(id: string, projectPath: string | null): Conversation | undefined {
    const conversation = this.conversations.get(id)
    if (!conversation) return undefined
    const propre = canonicalProjectPath(projectPath)
    if (propre) conversation.projectPath = propre
    else delete conversation.projectPath
    this.changed(id)
    return conversation
  }

  /** Attache un RUN.md externe à une conversation (idempotent). Jette si l'id est inconnu. */
  attachRun(id: string, runPath: string): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new Error(`Conversation inconnue: ${id}`)
    }
    conversation.runPaths ??= []
    if (!conversation.runPaths.includes(runPath)) {
      conversation.runPaths.push(runPath)
      conversation.updatedAt = this.now()
      this.changed(id)
    }
    return conversation
  }

  /** Détache un RUN.md externe sans supprimer le fichier qui appartient à son outil d'origine. */
  detachRun(id: string, runPath: string): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new Error(`Conversation inconnue: ${id}`)
    }
    const nextRunPaths = (conversation.runPaths ?? []).filter((path) => path !== runPath)
    if (nextRunPaths.length !== (conversation.runPaths?.length ?? 0)) {
      conversation.runPaths = nextRunPaths
      conversation.updatedAt = this.now()
      this.changed(id)
    }
    return conversation
  }

  /** Messages d'une conversation, dans l'ordre. Jette si l'id est inconnu. */
  messagesOf(id: string): Msg[] {
    const c = this.conversations.get(id)
    if (!c) throw new Error(`Conversation inconnue: ${id}`)
    return c.messages
  }

  /**
   * Forke depuis un message : crée une CONVERSATION À PART, copie de l'historique jusqu'à ce
   * message inclus. C'est le geste attendu (même comportement que Claude) — l'ancienne version
   * empilait des branches À L'INTÉRIEUR d'une conversation, ce qui obligeait à une barre d'onglets
   * pour naviguer entre des histoires invisibles depuis la liste des conversations.
   *
   * L'originale n'est pas touchée : forker n'enlève rien à ce qui existait.
   */
  fork(id: string, fromMessageId: string): Conversation {
    const source = this.conversations.get(id)
    if (!source) throw new Error(`Conversation inconnue: ${id}`)
    if (!fromMessageId) throw new Error('fromMessageId requis') // sinon matche un message legacy sans id
    const cut = source.messages.findIndex((m) => m.messageId === fromMessageId)
    if (cut < 0) throw new Error(`Message inconnu: ${fromMessageId}`)

    const forked = this.create({
      title: forkTitle(source.title),
      provider: source.provider
    })
    // Copie jusqu'au point de fork INCLUS. Les identifiants de message sont régénérés : deux
    // conversations ne doivent jamais partager un messageId (le fork suivant viserait les deux).
    const copiedMessages = source.messages.slice(0, cut + 1)
    const messageIds = new Map<string, string>()
    // UN seul balayage du corpus pour les N ids alloues, au lieu d'un par message copie : c'est le
    // seul point reellement quadratique du store. Le Set est EPHEMERE (il meurt avec l'appel) —
    // aucun invariant d'unicite n'est tenu entre deux appels, ce qui serait la vraie fuite.
    const allocatedIds = this.allMessageIds()
    const generatedIds = copiedMessages.map((message) => {
      const generatedId = this.nextUniqueForkMessageId(allocatedIds)
      allocatedIds.add(generatedId)
      if (message.messageId) messageIds.set(message.messageId, generatedId)
      return generatedId
    })
    forked.messages = copiedMessages.map((message, index) => ({
      ...message,
      messageId: generatedIds[index],
      parentMessageId: message.parentMessageId
        ? messageIds.get(message.parentMessageId)
        : undefined,
      // Le journal d'un tour est rangé PAR CONVERSATION : celui d'un message copié n'existe pas
      // sous le fork. On note donc QUI le possède, pour que la loupe aille le lire au bon endroit
      // au lieu de chercher sous le fork et de retomber sur un run étranger.
      // Un fork de fork propage le propriétaire D'ORIGINE, pas l'intermédiaire.
      ...(message.turnId ? { turnConversationId: message.turnConversationId ?? source.id } : {})
    }))
    forked.forkedFrom = { conversationId: source.id, messageId: fromMessageId }
    forked.updatedAt = this.now()
    this.changed(forked.id)
    return forked
  }

  /** Tous les messageId du corpus, en UN balayage. Jetable : ne jamais le conserver entre appels. */
  private allMessageIds(): Set<string> {
    const ids = new Set<string>()
    for (const conversation of this.conversations.values()) {
      for (const { messageId } of conversation.messages) if (messageId) ids.add(messageId)
    }
    return ids
  }

  private nextUniqueForkMessageId(allocatedIds: ReadonlySet<string>): string {
    let candidate: string
    do {
      candidate = `message-${randomUUID()}`
    } while (allocatedIds.has(candidate))
    return candidate
  }

  /** Supprime une conversation. Retourne true si elle existait. */
  remove(id: string): boolean {
    const existed = this.conversations.delete(id)
    if (existed) this.changed(id)
    return existed
  }
}
