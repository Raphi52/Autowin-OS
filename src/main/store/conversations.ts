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
import { motsDe, replier } from '../../shared/mots'
import { parseAskDecision } from '../../renderer/src/components/ask-choices'
import { memeFamille } from './synonymes'
import { construireVoisinage, type IndexVoisinage } from './voisinage'
import { creerIndexInverse, type IndexInverse } from './index-inverse'

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
  /**
   * Le DERNIER tour est une question à choix restée sans réponse : la conversation attend
   * l'utilisateur, pas le modèle. Absent tant que ce n'est pas le cas — un `false` partout
   * ferait grossir chaque résumé IPC sans rien dire de plus.
   */
  lastAssistantAsksUser?: true
}

/**
 * Vrai quand le DERNIER message est un tour assistant portant une question à choix encore
 * ouverte. Un message utilisateur postérieur ferme la question : elle a été répondue. La
 * reconnaissance d'une vraie question est déléguée à `parseAskDecision` — même règle que le
 * rendu du bloc de décision (deux options minimum), pour qu'aucune pastille n'apparaisse sur
 * une question que la vue n'affiche pas comme telle.
 */
export function attendUneDecision(messages: readonly Msg[]): boolean {
  const dernier = messages.at(-1)
  if (!dernier || dernier.role !== 'assistant') return false
  const parts = (dernier as { parts?: PersistedChatPart[] }).parts
  if (!Array.isArray(parts)) return false
  return parts.some((part) => parseAskDecision(part as Parameters<typeof parseAskDecision>[0]) !== null)
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
  /**
   * Dossier de travail, quand la conversation en a un.
   *
   * Expose parce qu'un appelant doit pouvoir refuser de franchir cette frontiere : sans lui, le
   * rappel injecte pouvait porter un extrait du projet A dans le prompt du projet B.
   */
  projectPath?: string
  updatedAt: number
  messageCount: number
  extraits: ConversationExtrait[]
}


/**
 * Les mots CHERCHABLES d'une demande.
 *
 * La recherche prenait la demande comme UNE chaine : « remake les pastilles de couleurs » ne
 * trouvait rien, alors que « code couleur de la pastille » disait exactement ce qu'il fallait. Une
 * demande n'est presque jamais formulee comme la reponse -- exiger la phrase entiere revenait a
 * exiger que l'utilisateur se cite lui-meme.
 *
 * Les mots de moins de trois lettres sont ecartes : « de », « la », « et » sont dans tout, donc ne
 * discriminent rien, et un mot present partout ferait remonter tout le corpus.
 */
/** Les mots de la demande, et ceux qu'on y ajoute pour rattraper une autre formulation. */
interface MotsDeRecherche {
  /** Ce que l'utilisateur a REELLEMENT ecrit. */
  demandes: string[]
  /** Ce qu'on ajoute : familles connues et voisinage appris. Moins sur, donc moins lourd. */
  elargis: string[]
}

/**
 * DEUX POIDS, PAS UN.
 *
 * Mesure sur le corpus reel (1190 conversations) : en melangeant les mots demandes et les mots
 * ajoutes, la requete montait a quarante termes -- et les conversations FOURRE-TOUT, dont un seul
 * message fait des milliers de caracteres, en contenaient forcement quatre ou cinq. Un scout de
 * veille sortait avant la conversation qui parlait justement de pastilles.
 *
 * Un mot AJOUTE est une hypothese ; un mot DEMANDE est une donnee. Les compter pareil laissait
 * l'hypothese decider.
 */
function motsCherchables(terme: string, voisinage: IndexVoisinage): MotsDeRecherche {
  // Les mots ENTIERS d'abord : le lexique des familles et l'index de voisinage sont indexes sur des
  // mots, pas sur des racines. Raciner avant de les consulter faisait chercher « worktr » dans une
  // table qui contient « worktree » -- l'expansion rendait alors silencieusement zero.
  const entiers = motsDe(terme).slice(0, 12)
  const demandes = [...new Set(entiers.map(racine))]
  const vus = new Set(demandes)
  const elargis: string[] = []
  for (const mot of entiers) {
    // Deux voisins par mot, pas trois : au-dela l'elargissement pese plus que la demande.
    // Chaque table avec SA cle : le lexique est indexe sur des mots entiers, l'index de voisinage sur
    // des racines (il est construit a partir des memes racines que la recherche). Les interroger avec
    // la mauvaise cle rend zero, sans erreur -- une expansion muette qui n'elargit rien.
    for (const proche of [...memeFamille(mot), ...voisinage.voisins(racine(mot)).slice(0, 2)]) {
      const rac = racine(proche)
      if (vus.has(rac)) continue
      vus.add(rac)
      elargis.push(rac)
    }
  }
  return { demandes, elargis: elargis.slice(0, 12) }
}

/**
 * Longueur de la racine.
 *
 * SIX lettres, et il faut dire pourquoi : neuf avaient ete essayees pour separer « conversation » de
 * « conversion », et elles cassaient `couleur`/`couleurs` et `pastille`/`pastilles` -- les deux
 * exemples qui justifient l'existence de ce mecanisme. Aucun seuil ne satisfait les deux bords :
 * « conversation » et « conversion » partagent SEPT lettres, « notification » et « notifier » SIX.
 *
 * La collision subsiste donc a ce niveau, et elle est rattrapee AILLEURS : la ponderation porte sur
 * la rarete du mot RENCONTRE (voir `motCorrespondant`), et « conversations » est omnipresent dans ce
 * corpus tandis que « notifier » est rare. C'est ce qui separe les deux cas, pas le seuil.
 *
 * Ce commentaire annonçait « neuf lettres » alors que le code en appliquait six -- un audit l'a
 * releve. Un commentaire qui decrit une valeur que le code ne porte pas est pire qu'un code nu : il
 * fait renoncer le lecteur a verifier.
 */
const SEUIL_RACINE = 6

/**
 * La RACINE d'un mot : ses premieres lettres.
 *
 * « pastilles » ne trouvait pas « pastille », ni « couleurs » « couleur » : une demande est
 * rarement au meme nombre que la reponse. Tronquer garde le discriminant tout en absorbant les
 * pluriels et les accords -- et c'est un simple `indexOf`, donc instantane sur un corpus de 28 Mo
 * parcouru a chaque tour.
 *
 * Ce n'est PAS de la recherche semantique : « badges » ne trouvera jamais « pastilles ». Pour un
 * vrai synonyme, le Brain reste l'outil.
 */
function racine(mot: string): string {
  return mot.length > SEUIL_RACINE ? mot.slice(0, SEUIL_RACINE) : mot
}

/**
 * Les mots qui annoncent que ce qui precede n'est PLUS vrai.
 *
 * Un extrait coupe juste avant l'un d'eux fait passer un choix abandonne pour le choix actuel. Ce
 * n'est pas une imprecision, c'est un contresens : le lecteur agit sur une consigne revoquee.
 */
const REVIREMENTS =
  /\b(mais|cependant|toutefois|neanmoins|finalement|en fait|plutot|abandonn\w*|remplac\w*|annul\w*|revenu|desormais|depuis)\b/i

/**
 * Le mot du MESSAGE qui correspond a une racine cherchee, ou rien.
 *
 * Un `indexOf` de la racine dans le texte suffisait a savoir SI ca matche, jamais QUOI. Or c'est le
 * mot rencontre qui dit la valeur du match : « conversion » retrouve « conversations » par leurs
 * sept premieres lettres, mais « conversations » est le mot le plus frequent de ce corpus -- ce
 * match n'apprend rien. « notification » retrouve « notifier » par six lettres, et « notifier » est
 * rare : ce match, lui, vaut quelque chose.
 *
 * Ponderer la racine ne pouvait pas les distinguer : les deux partagent la MEME racine, donc la
 * meme rarete. Il faut le mot entier. C'est ce qui permet de tenir les deux bords que l'audit a
 * montres inconciliables avec un simple seuil -- separer « conversion » de « conversation » SANS
 * casser « notification » -> « notifier ».
 */
function motCorrespondant(motsDuMessage: readonly string[], racineCherchee: string): string | undefined {
  return motsDuMessage.find((mot) => mot.startsWith(racineCherchee))
}

/**
 * La FENETRE autour du terme trouve, prise sur le texte d'ORIGINE (accents et casse intacts).
 *
 * Rendre le message entier noierait le terme dans des milliers de caracteres ; n'en rendre que le
 * terme ne dirait pas dans quelle phrase il se trouve. Les bords coupes sont marques : une
 * troncature muette se lit comme un texte complet.
 *
 * ET SURTOUT : si la suite du message REVIENT sur ce qui vient d'etre dit, la fenetre s'etend pour
 * l'inclure. Sans cela « on utilisait l'ambre [...] mais on a ABANDONNE cette convention » se
 * lisait comme une affirmation encore valide -- le mode d'echec meme que ce rappel doit eviter, et
 * qu'un simple « ... » ne signalait pas (il ne distingue pas « coupe sans consequence » de « coupe
 * au point d'inverser le sens »).
 */
function fenetre(origine: string, position: number, longueur: number): string {
  const MARGE = 120
  /** Jusqu'ou chercher un revirement au-dela de la marge : une phrase ou deux, pas le message. */
  const PORTEE_REVIREMENT = 400
  const debut = Math.max(0, position - MARGE)
  let fin = Math.min(origine.length, position + longueur + MARGE)

  // La suite immediate revient-elle sur ce qui precede ? Si oui, on l'inclut jusqu'a la fin de sa
  // phrase -- mieux vaut un extrait plus long qu'un extrait qui dit le contraire du message.
  const suite = origine.slice(fin, Math.min(origine.length, fin + PORTEE_REVIREMENT))
  // Cherche sur la forme REPLIEE : la liste est en ASCII, la suite garde ses accents. « plutôt » et
  // « néanmoins » -- les formes normales en francais -- ne matchaient pas, donc le correctif etait
  // MUET sur les connecteurs les plus courants. Les positions se correspondent : `replier` ne change
  // ni la longueur ni l'ordre des caracteres (NFD puis suppression des seuls diacritiques isoles).
  const contraste = replier(suite).match(REVIREMENTS)
  if (contraste?.index !== undefined) {
    const finDePhrase = suite.indexOf('.', contraste.index)
    const jusqua = finDePhrase >= 0 ? finDePhrase + 1 : suite.length
    fin = Math.min(origine.length, fin + jusqua)
  }

  const coeur = origine.slice(debut, fin).replace(/\s+/g, ' ').trim()
  /*
   * QUAND L'EXTRAIT S'ARRETE AVANT LA FIN, IL LE DIT — en mots, pas par trois points.
   *
   * Un « ... » ne distingue pas « coupe sans consequence » de « coupe au point d'inverser le sens ».
   * Or aucune liste de connecteurs ne captera tous les revirements : « le violet a pris sa place »
   * n'en contient aucun. Plutot que d'empiler des motifs en esperant couvrir la langue, l'extrait
   * AVOUE qu'il est partiel. Une incertitude declaree se verifie ; une affirmation tronquee, non.
   */
  const debutCoupe = debut > 0 ? '...' : ''
  const finCoupee = fin < origine.length ? ` […suite du message non montree — ouvre la conversation avant de t'y fier]` : ''
  return debutCoupe + coeur + finCoupee
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
    this.voisinageCache = undefined
    // Le corpus entier change de forme : la pre-selection ne peut pas etre rattrapee
    // par une mise a jour, elle est jetee.
    this.indexInverseCache = undefined
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
    // Le voisinage n'est plus JETE ici : `indexerMessage` l'ALIMENTE message par message.
    // Le jeter coutait ~90 ms de reconstruction par tour, synchrones dans le processus
    // principal -- le poste dominant du gel de l'interface.
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
    // Le voisinage n'est plus JETE ici : `indexerMessage` l'ALIMENTE message par message.
    // Le jeter coutait ~90 ms de reconstruction par tour, synchrones dans le processus
    // principal -- le poste dominant du gel de l'interface.
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
    this.indexerMessage(conversation.id, message.content)
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
    // Le chemin REEL des messages passe ICI, pas par `append` : l'index doit suivre celui-la
    // en premier. Corrige apres audit -- j'avais invalide les chemins que mes tests exercaient.
    // Le voisinage n'est plus JETE ici : `indexerMessage` l'ALIMENTE message par message.
    // Le jeter coutait ~90 ms de reconstruction par tour, synchrones dans le processus
    // principal -- le poste dominant du gel de l'interface.
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
    this.indexerMessage(conversation.id, userMessage.content)
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
    this.indexerMessage(conversation.id, assistantMessage.content)
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
    // Le chemin REEL des messages passe ICI, pas par `append` : l'index doit suivre celui-la
    // en premier. Corrige apres audit -- j'avais invalide les chemins que mes tests exercaient.
    // Le voisinage n'est plus JETE ici : `indexerMessage` l'ALIMENTE message par message.
    // Le jeter coutait ~90 ms de reconstruction par tour, synchrones dans le processus
    // principal -- le poste dominant du gel de l'interface.
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
    this.indexerMessage(conversation.id, assistantMessage.content)
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
    // Le voisinage n'est plus JETE ici : `indexerMessage` l'ALIMENTE message par message.
    // Le jeter coutait ~90 ms de reconstruction par tour, synchrones dans le processus
    // principal -- le poste dominant du gel de l'interface.
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error(`Conversation inconnue: ${id}`)
    const message = applyTurnEventToMessages(conversation.messages, turnId, event)
    /*
     * LE CONTENU MUTE ICI, il n'est pas pousse : `indexerMessage` doit donc etre appele DEPUIS ce
     * chemin, et pas seulement la ou un message est ajoute.
     *
     * J'avais retire l'invalidation de l'index de cette methode en ecrivant que `indexerMessage`
     * l'alimenterait -- sans le brancher ici. Le texte reellement produit par l'assistant, la plus
     * grande part du corpus, n'entrait donc JAMAIS dans les index une fois construits : la recherche
     * ratait silencieusement l'essentiel de son propre corpus. Aucun des 6060 tests ne le voyait, et
     * le commentaire affirmait le contraire de ce que le code faisait.
     */
    this.indexerMessage(id, message?.content)
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

  /**
   * Tokenisation MEMOISEE par message.
   *
   * Mesure d'un juge performance sur le corpus reel (1193 conversations, 28,8 Mo) : `search` coutait
   * ~150 ms par appel contre 40 ms avant ce chantier, parce qu'elle re-tokenisait CHAQUE message de
   * CHAQUE conversation a CHAQUE appel -- un `normalize('NFD')`, deux regex et un `Set` par message,
   * jamais mis en cache. Le commentaire de l'index de voisinage laissait croire que ce cout etait
   * couvert ; il ne l'etait pas.
   *
   * La clef est le contenu lui-meme, pas le `messageId` : un message edite change de contenu et
   * obtient donc naturellement une autre entree, sans qu'aucune invalidation soit a ecrire. Le
   * corpus est deja entierement en memoire ; ce cache ajoute les mots, pas les textes.
   */
  private readonly motsParMessage = new Map<string, string[]>()

  /**
   * Pre-selection des conversations candidates.
   *
   * Repond « ces trois-la » au lieu de faire relire les 1197. Construit une fois, puis mis a jour a
   * l'AJOUT d'un message -- jamais jete. C'est ce qui supprime le parcours du corpus a chaque tour,
   * au lieu de le deporter ailleurs.
   */
  private indexInverseCache?: IndexInverse

  private indexInverse(): IndexInverse {
    if (!this.indexInverseCache) {
      const index = creerIndexInverse()
      for (const conversation of this.conversations.values()) {
        for (const message of conversation.messages) {
          if (typeof message.content !== 'string') continue
          index.ajouter(conversation.id, this.motsMemoises(message.content).map(racine))
        }
      }
      this.indexInverseCache = index
    }
    return this.indexInverseCache
  }

  /** Enregistre un message dans l'index sans rien reconstruire. Sans effet si l'index n'existe pas. */
  private indexerMessage(conversationId: string, contenu: unknown): void {
    if (typeof contenu !== 'string') return
    // Le voisinage ABSORBE le message au lieu d'etre jete : c'etait le poste dominant du gel
    // (~90 ms par tour a reconstruire tout le corpus, contre O(mots du message) ici).
    this.voisinageCache?.ajouter(contenu)
    if (!this.indexInverseCache) return
    this.indexInverseCache.ajouter(conversationId, this.motsMemoises(contenu).map(racine))
  }

  private motsMemoises(contenu: string): string[] {
    const connu = this.motsParMessage.get(contenu)
    if (connu) return connu
    const mots = motsDe(contenu)
    // Borne de securite : un corpus qui grossit ne doit pas faire grossir ce cache sans fin.
    if (this.motsParMessage.size > 40_000) this.motsParMessage.clear()
    this.motsParMessage.set(contenu, mots)
    return mots
  }

  /**
   * Index de voisinage, construit a la PREMIERE recherche puis garde.
   *
   * Invalide des qu'un message arrive : un index perime rapprocherait selon un corpus qui n'existe
   * plus, et c'est exactement le genre d'oracle en retard qui fait conclure faux avec assurance.
   */
  private voisinageCache?: IndexVoisinage

  private voisinage(): IndexVoisinage {
    if (!this.voisinageCache) {
      const textes: string[] = []
      for (const conversation of this.conversations.values()) {
        for (const message of conversation.messages) {
          if (typeof message.content === 'string') textes.push(message.content)
        }
      }
      // Les mots ENTIERS au decoupage, la racine fournie a part : l'index compte alors la presence
      // des deux, ce dont la ponderation par le mot rencontre a besoin pour discriminer.
      this.voisinageCache = construireVoisinage(
        textes,
        (texte) => this.motsMemoises(texte),
        racine
      )
    }
    return this.voisinageCache
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
    options?: {
      limite?: number
      extraitsParConversation?: number
      /**
       * Temps maximum accorde au parcours. Absent = pas de limite.
       *
       * Le cout croit avec le corpus : ~35 ms sur 1197 conversations aujourd'hui, le triple sur un
       * corpus triple. Une garantie qui depend d'une taille de donnees est un sursis, pas une
       * garantie. Sous budget, la recherche rend ce qu'elle a TROUVE au lieu de finir a tout prix.
       *
       * Compromis assume et nomme : le resultat peut etre INCOMPLET. Pour un rappel -- un confort,
       * jamais une autorite -- un resultat partiel rendu a temps vaut mieux qu'une interface qui se
       * figeait. C'est pourquoi ce budget est un PARAMETRE et non une valeur en dur : il serait
       * inacceptable pour `conversation_search`, que l'agent appelle en attendant une reponse
       * complete.
       */
      budgetMs?: number
    }
  ): ConversationRecherche[] {
    const { demandes, elargis } = motsCherchables(terme, this.voisinage())
    // Un terme vide rendrait TOUT le corpus : ce n'est pas une recherche, c'est un dump.
    if (demandes.length === 0) return []
    // Un mot demande vaut trois mots ajoutes : l'hypothese aide, elle ne decide pas.
    const POIDS_DEMANDE = 3
    const index = this.voisinage()
    const limite = Math.max(1, Math.min(50, Math.floor(options?.limite ?? 10) || 10))
    const parConversation = Math.max(
      1,
      Math.min(20, Math.floor(options?.extraitsParConversation ?? 3) || 3)
    )
    const trouvees: Array<ConversationRecherche & { score: number }> = []
    // La pre-selection porte sur les mots DEMANDES et AJOUTES : une conversation absente de l'index
    // pour tous ces mots ne peut pas correspondre, il est inutile de la relire.
    const candidates = this.indexInverse().candidates([...demandes, ...elargis])
    const budget = options?.budgetMs
    // Un budget de zero ou negatif veut dire « ne cherche pas » : l'echeance est deja passee. Sans
    // ce cas explicite, `now + 0` valait `now` et le premier controle ne declenchait pas -- un
    // budget nul aurait cherche partout, ce qui est l'inverse de ce qu'il demande.
    const echeance = budget === undefined ? undefined : budget <= 0 ? 0 : Date.now() + budget
    /*
     * Le compteur porte sur les MESSAGES parcourus, pas sur les conversations.
     *
     * Compter les conversations ne garantissait l'independance qu'au NOMBRE de conversations, pas a
     * leur taille : trente-et-une conversations de plusieurs milliers de messages pouvaient etre
     * parcourues entierement entre deux consultations de l'horloge, et faire deborder le budget d'un
     * facteur non borne. Un audit l'a releve -- mon commentaire promettait « independant de la taille
     * des donnees », le code ne tenait que la moitie de cette promesse.
     *
     * Le message est l'unite de COUT reelle : c'est lui qu'on tokenise et qu'on lit.
     */
    let messagesParcourus = 0
    const budgetEpuise = (): boolean => {
      // L'horloge n'est consultee qu'un message sur 256 : l'appeler a chaque message couterait plus
      // cher que ce qu'on economise, et 256 messages se parcourent en bien moins d'une milliseconde.
      if (echeance === undefined) return false
      if ((messagesParcourus & 255) !== 0) return false
      return Date.now() > echeance
    }
    for (const conversation of this.list()) {
      if (candidates && !candidates.has(conversation.id)) continue
      if (budgetEpuise()) break
      const extraits: ConversationExtrait[] = []
      /** Rangs des messages retenus : sert a chercher un revirement APRES le dernier extrait. */
      const derniersRangs: number[] = []
      /*
       * Le score est le meilleur score d'UN SEUL message, pas le cumul de la conversation.
       *
       * Mesure sur le corpus REEL (1191 conversations) : cumule, le score favorisait les
       * conversations les plus LONGUES -- elles finissent par contenir tous les mots, disperses sur
       * des centaines de messages sans rapport entre eux. « badges » remontait un scout de veille
       * avant la conversation qui expliquait justement le code couleur. Les mots comptent quand ils
       * sont ENSEMBLE : c'est la proximite qui fait le sens, pas la presence.
       */
      let meilleurScore = 0
      for (const [rang, message] of conversation.messages.entries()) {
        if (typeof message.content !== 'string') continue
        messagesParcourus += 1
        // Coupe AUSSI a l'interieur d'une conversation tres longue : sans cela, une seule
        // conversation de dix mille messages ignorait le budget a elle seule.
        if (budgetEpuise()) break
        const replie = replier(message.content)
        const motsDuMessage = this.motsMemoises(message.content)
        let premierePosition = -1
        let motsIci = 0
        /*
         * La ponderation porte sur le mot RENCONTRE, pas sur la racine cherchee.
         *
         * L'audit a montre que deux exigences tiraient en sens inverse : separer « conversion » de
         * « conversation » (sept lettres communes) sans casser « notification » -> « notifier »
         * (six lettres communes). Aucun seuil de racine ne peut les satisfaire toutes deux. Mais
         * « conversations » est omnipresent ici et « notifier » est rare : c'est la rarete du mot
         * TROUVE qui les separe, et elle ne dependait pas du seuil.
         */
        const peser = (racineCherchee: string, poids: number): void => {
          const trouve = motCorrespondant(motsDuMessage, racineCherchee)
          if (!trouve) return
          const position = replie.indexOf(racineCherchee)
          motsIci += poids * index.rarete(racine(trouve)) * index.rarete(trouve)
          if (position >= 0 && (premierePosition < 0 || position < premierePosition)) {
            premierePosition = position
          }
        }
        for (const mot of demandes) peser(mot, POIDS_DEMANDE)
        for (const mot of elargis) peser(mot, 1)
        if (premierePosition < 0) continue
        /*
         * NORMALISE PAR LA LONGUEUR.
         *
         * Un message de 50 000 caracteres contient forcement « pastille », « badge » et « puce » --
         * sans parler de pastilles pour autant. Une phrase de dix mots qui en contient deux, si.
         * C'est la DENSITE qui dit la pertinence, pas le compte brut.
         *
         * J'avais ecrit puis ANNULE ce critere plus tot dans ce chantier, faute d'oracle : je le
         * reglais sur un `conversations.json` en retard sur la memoire vive, qui ne contenait meme
         * pas la cible. Il revient ici mesure sur un corpus A JOUR de 1190 conversations, ou
         * l'absence de normalisation faisait sortir un scout de veille avant la conversation qui
         * parlait justement de pastilles.
         *
         * Racine carree et non division directe : penaliser proportionnellement ecraserait tout
         * message long, y compris celui qui repond vraiment.
         * BORNEE EN HAUT, et c’est aussi important que la normalisation elle-meme.
         *
         * Mesure du 2026-08-26 sur le corpus reel : sans plafond, la penalite de longueur ANEANTIT
         * le terme rare. Un oracle de 10 requetes, dont les cibles sont etablies par comptage de
         * tokens et non par intuition, donnait un rappel@8 de 7/10 sur le mot seul mais 2/10 des
         * que le mot etait pose dans une phrase -- et la phrase ramenait les MEMES quatre
         * conversations quel que soit le terme distinctif, preuve que ce terme ne pesait rien. Les
         * messages qui portaient le terme rare faisaient 1677 a 7886 caracteres (diviseur 41 a 89) ;
         * les quatre gagnantes constantes avaient une mediane de 93 a 609 (diviseur 8 a 25). Un
         * facteur onze en faveur de la brievete, quel que soit le contenu.
         *
         * Le plafond est le 3e QUARTILE mesure du corpus (564 caracteres ; q50=120, q90=1476,
         * max=160291). Au-dela de ce quartile, la longueur ne dit plus rien de la pertinence : c’est
         * la forme normale d’un message qui porte du code ou une explication. Continuer a punir
         * revient a preferer la brievete a la precision. En dessous, le comportement est INCHANGE.
         */
        const PLAFOND_LONGUEUR = 564
        const densite =
          motsIci / Math.sqrt(Math.max(60, Math.min(message.content.length, PLAFOND_LONGUEUR)))
        if (densite > meilleurScore) meilleurScore = densite
        if (extraits.length < parConversation) {
          extraits.push({
            role: message.role,
            ts: message.ts,
            extrait: fenetre(message.content, premierePosition, 0)
          })
          derniersRangs.push(rang)
          // La REPONSE qui suit la question porte le sens que la question demandait. « le code
          // couleur de la pastille » retrouve la conversation ; « ambre = en cours » est ce dont le
          // lecteur a besoin. Rendre la question sans la reponse obligerait a un second aller-retour
          // pour la moitie utile de l'echange.
          const suivant = conversation.messages[rang + 1]
          if (
            message.role === 'user' &&
            suivant?.role === 'assistant' &&
            typeof suivant.content === 'string' &&
            suivant.content.trim() &&
            extraits.length < parConversation
          ) {
            extraits.push({
              role: suivant.role,
              ts: suivant.ts,
              extrait: fenetre(suivant.content, 0, 0)
            })
          }
        }
      }
      if (meilleurScore === 0) continue
      /*
       * UN REVIREMENT PEUT VIVRE DANS UN AUTRE MESSAGE.
       *
       * La fenetre ne regarde qu'un message ; or le message qui revient sur une decision ne reprend
       * presque jamais les mots de la demande -- « finalement le violet a pris la place » ne contient
       * ni « ambre » ni « pastille », donc il n'est meme pas candidat. L'audit l'a montre : le
       * rappel citait la decision initiale seule, sans rien signaler.
       *
       * On regarde donc les messages qui SUIVENT le dernier extrait retenu, et on annexe le premier
       * qui porte un connecteur de contraste. Mieux vaut un extrait de plus qu'un rappel qui affirme
       * un choix revoque.
       */
      const dernierRang = derniersRangs.at(-1)
      if (extraits.length > 0 && dernierRang !== undefined) {
        for (const suivant of conversation.messages.slice(dernierRang + 1)) {
          if (typeof suivant.content !== 'string') continue
          if (!REVIREMENTS.test(replier(suivant.content))) continue
          extraits.push({
            role: suivant.role,
            ts: suivant.ts,
            extrait: `[la suite revient sur ce qui precede] ${fenetre(suivant.content, 0, 0)}`
          })
          break
        }
      }
      trouvees.push({
        id: conversation.id,
        title: conversation.title,
        provider: conversation.provider,
        ...(conversation.projectPath ? { projectPath: conversation.projectPath } : {}),
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        extraits,
        score: meilleurScore
      })
    }
    // Classe par NOMBRE DE MOTS retrouves avant la recence : une conversation qui porte trois mots
    // de la demande l'eclaire mieux qu'une plus recente qui n'en porte qu'un.
    trouvees.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    /*
     * RE-CLASSEMENT PAR LE MOT PORTEUR -- le tri, non le score.
     *
     * Defaut mesure le 2026-08-26 sur le corpus reel (1201 conversations, oracle de 40 cas dont les
     * cibles sont etablies par comptage de tokens). Le rappel injecte a chaque tour demande TROIS
     * conversations ; sur une demande en langage naturel, la bonne a un rang MEDIAN de 12. Il
     * regardait donc trois places pour une reponse en douzieme, et ratait 38 fois sur 40.
     *
     * La cible n’est jamais EXCLUE : a profondeur 50 la phrase retrouve presque aussi bien que le
     * mot-cle seul (33/40 contre 37/40). C’est le CLASSEMENT qui echoue, pas la recherche. Trois
     * tentatives de mieux SCORER l’ont confirme en echouant : durcir la rarete degrade (4/10 -> 3/10),
     * relever le plancher de longueur gagne deux cas sur quarante en touchant 63 % des messages, et
     * filtrer les mots non porteurs avant le score ne change rien (12/40) voire degrade (7/40).
     *
     * Ce qui marche est ailleurs : le score est un sac de mots ou le mot porteur se NOIE parmi les
     * mots d’adresse (« rappelle moi ce qu’on a dit a propos de X »), mais sa PRESENCE, elle, ne se
     * noie pas. On reprend donc les candidats plausibles et on fait passer devant ceux qui portent
     * vraiment le mot le plus rare de la demande. Mesure : 2/40 -> 25/40 sur le top-3.
     *
     * Le tri est STABLE, donc le score reste le second critere : ce re-classement ne remplace pas
     * le classement, il le corrige la ou un seul mot decide du sens.
     */
    const PROFONDEUR_RECLASSEMENT = 50
    // Le mot ENTIER, jamais sa racine :  tronque a six caracteres, donc « updatebanner »
    // devenait « update » -- present partout, et le re-classement ne discriminait plus rien (2/40,
    // soit aucun gain, alors que le mot entier donne 25/40). La rarete est indexee sur les deux.
    const entiers = motsDe(terme)
    // A rarete EGALE, le plus LONG. Ce depart n’est pas cosmetique :  n’indexe pas les
    // messages trop longs, or c’est justement la que vivent les termes distinctifs -- ils sont donc
    // « inconnus » de l’index, et  rend 1 pour chacun. Sans ce depart, tous les mots de la
    // demande etaient a egalite a 1 et le porteur retenu etait le PREMIER, c’est-a-dire un mot
    // d’adresse : mesure 1/40, soit pire que de ne rien faire.
    // LE PLUS LONG mot de la demande. Ce critere est un fait de LANGUE, non une propriete de
    // l’index : dans « rappelle moi ce qu’on a dit a propos de X », les mots d’adresse sont courts et
    // grammaticaux, le terme qui porte le sujet est long. Il ne depend donc pas du corpus.
    //
    // La rarete a ete essayee d’abord, et MESUREE moins bonne : 21/40 contre 25/40. Elle ne separe
    // pas -- « rappelle » vit dans 4 messages du corpus, « mutantes » et « habillage » dans 3,
    // « updatebanner » dans 1. Un mot d’adresse y est aussi rare qu’un terme technique. Pire, la
    // variante par rarete ne marchait que parce que les termes rares sont ABSENTS de l’index (voir
    // LONGUEUR_UTILE dans voisinage.ts) et recevaient donc la valeur « inconnu » : une propriete
    // accidentelle, pas un critere. Un critere explicite vaut mieux qu’un accident favorable.
    //
    // LIMITE ASSUMEE : une demande dont le sujet est un mot COURT (« le bug X ») n’en profite pas.
    // La LONGUEUR d'abord, la RARETE pour departager. Les deux comptent, et dans cet ordre :
    //   - la longueur seule echoue sur « statut zephyr », deux mots de six lettres : `reduce` garde
    //     alors le premier, qui se trouve etre le mot omnipresent. C'est `rarete-isole.test.ts`,
    //     ecrit le matin meme, qui l'a attrape -- avant publication ;
    //   - la rarete seule echoue sur une phrase d'adresse : « rappelle » vit dans 4 messages du
    //     corpus, « habillage » dans 3, « updatebanner » dans 1. Elle ne separe pas les mots
    //     d'adresse des termes techniques (21/40 contre 25/40 pour la longueur).
    const porteur = entiers.reduce((meilleur, mot) => {
      if (mot.length !== meilleur.length) return mot.length > meilleur.length ? mot : meilleur
      // A egalite PARFAITE (meme longueur, meme rarete -- typiquement deux mots absents de l'index),
      // le plus TARDIF gagne : la formule d'adresse ouvre la phrase, le sujet suit la preposition.
      // Un fait de structure, non une liste de mots a entretenir. Mesure : 25/40 -> 28/40.
      if (index.rarete(mot) === index.rarete(meilleur)) return mot
      return index.rarete(mot) > index.rarete(meilleur) ? mot : meilleur
    }, entiers[0] ?? demandes[0])
    const candidats = trouvees.slice(0, Math.max(limite, PROFONDEUR_RECLASSEMENT))
    // Le contenu ENTIER, pas l’extrait : un premier essai lisait les extraits, qui sont des fenetres
    // tronquees, et le mot porteur pouvait se trouver juste apres la coupe -- 4/40 au lieu de 25/40.
    const porte = (id: string): boolean => {
      const conversation = this.conversations.get(id)
      if (!conversation) return false
      for (const message of conversation.messages) {
        if (typeof message.content !== 'string') continue
        if (replier(message.content).includes(porteur)) return true
      }
      return false
    }
    const marques = candidats.map((c) => ({ c, porte: porte(c.id) }))
    marques.sort((a, b) => Number(b.porte) - Number(a.porte))
    return marques.slice(0, limite).map(({ c: { score: _score, ...reste } }) => reste)
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
        : {}),
      ...(attendUneDecision(messages) ? { lastAssistantAsksUser: true as const } : {})
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
    this.voisinageCache = undefined
    // Le corpus entier change de forme : la pre-selection ne peut pas etre rattrapee
    // par une mise a jour, elle est jetee.
    // Une conversation part : l'index inverse sait la DESINSCRIRE en temps proportionnel a ses
    // mots, il n'y a pas besoin de jeter le corpus entier. `retirer` existait, teste, et n'etait
    // appele nulle part en production -- une capacite branchee pour rien, relevee par l'audit.
    this.indexInverseCache?.retirer(id)
    // Le cache de tokenisation garde une entree par CONTENU vu, et les etats intermediaires du
    // streaming en laissent beaucoup. Il n'etait purge nulle part : une conversation qui part est
    // le bon moment pour le remettre a plat.
    this.motsParMessage.clear()
    const existed = this.conversations.delete(id)
    if (existed) this.changed(id)
    return existed
  }
}
