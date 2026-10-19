import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { flattenChatParts, type ChatTurnEvent } from '../../shared/chat-turn'
import {
  applyTurnEventToMessages,
  ConversationStore,
  deterministicMessageId,
  pointDeCoupure
} from './conversations'
import type { Conversation, ConversationChange, Msg } from './conversations'
import { ensureAutowinAppData } from '../app-data'
import type { FinishedRunOutcome } from '../runs/run-interruption'

/**
 * Persistance disque des conversations (sinon TOUT disparaît au restart).
 * Même pattern que role-store : le store reste PUR, le load/save vit ici.
 * Écriture atomique (tmp + rename) pour ne jamais corrompre le fichier
 * si l'app meurt en pleine écriture. Fichier : %APPDATA%\autowin-os\conversations.json.
 */
export function conversationsPath(): string {
  return join(ensureAutowinAppData(), 'conversations.json')
}

export class ConversationPersistenceError extends Error {
  constructor(
    message: string,
    readonly path: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ConversationPersistenceError'
  }
}

/**
 * LE TEXTE D'UN MESSAGE À PARTIES N'EST ÉCRIT QU'UNE FOIS.
 *
 * `content` d'un message qui porte des `parts` en est DÉRIVÉ à chaque événement de tour
 * (`message.content = flattenChatParts(next.parts)`, `conversations.ts`). Mesuré le 2026-10-14 sur
 * `conversations.json` (75,7 Mo, 828 conversations) : 4 852 messages à parties, et pour TOUS
 * `content === flattenChatParts(parts)` — 18,9 Mo de texte recopié, relu, revalidé et réécrit à
 * chaque démarrage et à chaque rotation du journal.
 *
 * Sur le disque, un tel `content` est donc écrit VIDE, puis recalculé à la lecture. Seul un
 * `content` strictement égal à sa dérivation est vidé : un texte qui en diffère (aucun aujourd'hui)
 * reste écrit tel quel, donc rien ne se perd.
 *
 * Pourquoi `''` et pas l'absence du champ : la version précédente du binaire EXIGE un `content`
 * texte (`isConversationMessage`) et déclarerait le fichier entier illisible sans lui — le piège
 * décrit plus bas, à `backupBeforeFirstMigratedWrite`. Avec `''`, un retour arrière relit encore ses
 * conversations ; seul le texte à plat de ces messages lui manquerait, leurs `parts` restant entières.
 *
 * Conséquence assumée : le texte à plat suit la version COURANTE de `flattenChatParts`, comme il le
 * fait déjà pour tout message que le tour suivant touche.
 */
function messagePourLeDisque(message: Msg): Msg {
  if (!Array.isArray(message.parts) || !message.content) return message
  return message.content === flattenChatParts(message.parts) ? { ...message, content: '' } : message
}

function conversationPourLeDisque(conversation: Conversation): Conversation {
  let change = false
  const messages = conversation.messages.map((message) => {
    const disque = messagePourLeDisque(message)
    if (disque !== message) change = true
    return disque
  })
  return change ? { ...conversation, messages } : conversation
}

/** Inverse de `messagePourLeDisque`, appliqué EN PLACE sur ce qui vient d'être relu du disque. */
function restaurerContenuDuMessage(message: Msg): Msg {
  if (message.content === '' && Array.isArray(message.parts) && message.parts.length > 0) {
    message.content = flattenChatParts(message.parts)
  }
  return message
}

function restaurerContenus(conversation: Conversation): Conversation {
  for (const message of conversation.messages) restaurerContenuDuMessage(message)
  return conversation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

const ARTIFACT_KINDS = new Set([
  'image',
  'vector',
  'markdown',
  'text',
  'code',
  'diff',
  'structured-data',
  'table',
  'diagram',
  'pdf',
  'document',
  'presentation',
  'spreadsheet',
  'notebook',
  'audio',
  'video',
  'web',
  'archive',
  'model3d',
  'font',
  'executable',
  'binary'
])

function isChatArtifact(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.source)) return false
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' ||
    typeof value.kind !== 'string' ||
    !ARTIFACT_KINDS.has(value.kind) ||
    !Number.isFinite(value.size) ||
    !Number.isFinite(value.createdAt) ||
    typeof value.source.provider !== 'string'
  ) {
    return false
  }
  if (
    !isOptionalString(value.encoding) ||
    (value.encoding !== undefined && value.encoding !== 'utf8' && value.encoding !== 'base64') ||
    !isOptionalString(value.content) ||
    !isOptionalString(value.path) ||
    !isOptionalString(value.url)
  ) {
    return false
  }
  return (
    isOptionalString(value.source.model) &&
    isOptionalString(value.source.tool) &&
    isOptionalString(value.source.originalPath) &&
    isOptionalString(value.source.url)
  )
}

function isPersistedChatPart(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind === 'text')
    return typeof value.text === 'string' && isOptionalString(value.streamId)
  if (value.kind === 'action')
    return (
      typeof value.name === 'string' &&
      isOptionalString(value.actionId) &&
      isOptionalBoolean(value.ok) &&
      isOptionalBoolean(value.interrupted)
    )
  if (value.kind === 'artifact') return isChatArtifact(value.artifact)
  return false
}

function isAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' ||
    !Number.isFinite(value.size) ||
    !isOptionalString(value.thumbnail) ||
    !isOptionalString(value.turnId) ||
    !isOptionalBoolean(value.originalUnavailable)
  ) {
    return false
  }
  return value.artifact === undefined || isChatArtifact(value.artifact)
}

function isChatTurnRuntime(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.provider === 'string' &&
    isOptionalString(value.model) &&
    isOptionalString(value.reasoningEffort) &&
    isOptionalString(value.sessionId)
  )
}

function isForkOrigin(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    value.conversationId.length > 0 &&
    typeof value.messageId === 'string' &&
    value.messageId.length > 0
  )
}

function isAutoKaizenLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.incidentId === 'string' &&
    value.incidentId.length > 0 &&
    typeof value.sourceConversationId === 'string' &&
    value.sourceConversationId.length > 0 &&
    (value.role === 'analysis' || value.role === 'fix') &&
    typeof value.rootIncidentId === 'string' &&
    value.rootIncidentId.length > 0 &&
    isOptionalString(value.parentIncidentId) &&
    typeof value.depth === 'number' &&
    Number.isInteger(value.depth) &&
    value.depth >= 0
  )
}

function hasUniqueMessageIds(conversationId: string, messages: unknown[]): boolean {
  const seen = new Set<string>()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] as Record<string, unknown>
    const messageId =
      typeof message.messageId === 'string'
        ? message.messageId
        : deterministicMessageId(conversationId, index)
    if (!messageId || seen.has(messageId)) return false
    seen.add(messageId)
  }
  return true
}

function isConversationMessage(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.role !== 'user' && value.role !== 'assistant') return false
  if (typeof value.content !== 'string' || !Number.isFinite(value.ts)) return false
  if (!isOptionalString(value.messageId) || !isOptionalString(value.parentMessageId)) return false
  if (!isOptionalString(value.turnId) || !isOptionalString(value.turnConversationId)) return false
  if (
    value.status !== undefined &&
    value.status !== 'streaming' &&
    value.status !== 'completed' &&
    value.status !== 'failed' &&
    value.status !== 'cancelled' &&
    value.status !== 'interrupted'
  ) {
    return false
  }
  if (!isOptionalString(value.error) || !isOptionalString(value.reasoning)) return false
  if (
    value.actionsLog !== undefined &&
    (!Array.isArray(value.actionsLog) ||
      !value.actionsLog.every((ligne) => typeof ligne === 'string'))
  ) {
    return false
  }
  if (
    value.reasoningMs !== undefined &&
    (typeof value.reasoningMs !== 'number' ||
      !Number.isFinite(value.reasoningMs) ||
      value.reasoningMs < 0)
  ) {
    return false
  }
  if (value.runtime !== undefined && !isChatTurnRuntime(value.runtime)) return false
  if (
    value.parts !== undefined &&
    (!Array.isArray(value.parts) || !value.parts.every(isPersistedChatPart))
  ) {
    return false
  }
  if (
    value.attachments !== undefined &&
    (!Array.isArray(value.attachments) || !value.attachments.every(isAttachment))
  ) {
    return false
  }
  return true
}

function isConversation(value: unknown): value is Conversation {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.title !== 'string' ||
    // `category` n'est PLUS exige : les fichiers ecrits apres ce remake ne le portent plus, et
    // exiger un champ qu'on n'ecrit plus ferait declarer le store entier corrompu au demarrage.
    typeof value.provider !== 'string' ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isConversationMessage) ||
    !Number.isFinite(value.createdAt) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return false
  }
  if (!hasUniqueMessageIds(value.id, value.messages)) return false
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2 && value.schemaVersion !== 3) {
    return false
  }
  if (value.forkedFrom !== undefined && !isForkOrigin(value.forkedFrom)) return false
  if (value.autoKaizen !== undefined && !isAutoKaizenLink(value.autoKaizen)) return false
  if (!isOptionalString(value.projectPath)) return false
  // Le libellé de classement, séparé du dossier de travail depuis conv-81 (2026-09-16). Optionnel :
  // un fichier écrit avant la séparation n'en porte pas, et doit continuer à se relire.
  if (!isOptionalString(value.categorie)) return false
  // fix-ok: conv-81 — même cause : le libellé de catégorie sort de projectPath, la relecture doit donc accepter le champ categorie, sinon toute conversation classée par libellé serait rejetée au chargement.
  if (
    value.runPaths !== undefined &&
    (!Array.isArray(value.runPaths) || value.runPaths.some((entry) => typeof entry !== 'string'))
  ) {
    return false
  }
  // Compatibilite de lecture uniquement : ConversationStore retire `authorityMode` a
  // l'hydratation. Ces valeurs ne constituent plus des modes pris en charge au runtime.
  return (
    value.authorityMode === undefined ||
    value.authorityMode === 'plan' ||
    value.authorityMode === 'ask' ||
    value.authorityMode === 'auto'
  )
}

function parseConversationArray(path: string): Conversation[] {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(data)) {
    throw new Error('Conversation store must be an array of valid conversations.')
  }
  const ids = new Set<string>()
  for (const conversation of data) {
    if (!isConversation(conversation) || ids.has(conversation.id)) {
      throw new Error('Conversation store must be an array of valid conversations.')
    }
    ids.add(conversation.id)
  }
  return data
}

function loadConversationSnapshot(path: string): Conversation[] {
  if (!existsSync(path)) return []
  try {
    return parseConversationArray(path)
  } catch (primaryError) {
    const temporaryPath = `${path}.tmp`
    if (existsSync(temporaryPath)) {
      try {
        const recovered = parseConversationArray(temporaryPath)
        copyFileSync(path, `${path}.corrupt`)
        writeConversationSnapshot(recovered, path)
        return recovered
      } catch (recoveryError) {
        throw new ConversationPersistenceError(
          `Store conversations corrompu et récupération temporaire impossible: ${path}`,
          path,
          { cause: recoveryError }
        )
      }
    }
    throw new ConversationPersistenceError(`Store conversations corrompu: ${path}`, path, {
      cause: primaryError
    })
  }
}

/**
 * Le PLANCHER d'identifiants, dans un fichier voisin.
 *
 * Pourquoi un fichier a part plutot qu'un champ dans `conversations.json` : ce fichier est un
 * TABLEAU, et y ajouter un champ aurait change le format persiste -- exactement le mur rencontre le
 * meme jour sur `baseSha`, ou une correction evidente a du etre annulee pour cette raison. Un voisin
 * est additif : son absence retombe simplement sur l'ancien comportement.
 *
 * Il ne descend JAMAIS. Un identifiant supprime ne doit pas etre reattribue, parce que des runs
 * continuent de le referencer longtemps apres la mort de leur conversation.
 */
function conversationIdFloorPath(path = conversationsPath()): string {
  return `${path}.next-id`
}

/** Le plancher persiste, ou 0 si le fichier est absent/illisible : jamais une erreur bloquante. */
export function readConversationIdFloor(path = conversationsPath()): number {
  try {
    const brut = readFileSync(conversationIdFloorPath(path), 'utf8').trim()
    const valeur = Number.parseInt(brut, 10)
    return Number.isSafeInteger(valeur) && valeur > 0 ? valeur : 0
  } catch {
    // Absent au premier demarrage, ou illisible : on retombe sur le calcul depuis les vivantes.
    return 0
  }
}

/**
 * Le dernier plancher REELLEMENT ecrit, par chemin.
 *
 * Sans ce cache, chaque vidage de journal payait une LECTURE puis une ECRITURE disque, meme quand
 * rien n'avait bouge. Mesure le 2026-08-24 : cette agitation supplementaire dans l'appdata des tests
 * a rendu instable un test sensible au timing (1 echec sur 5, contre 0 sur 5 sans mon changement).
 * Un correctif ne doit pas acheter sa garantie avec de la flakiness ailleurs.
 */
const plancherEcrit = new Map<string, number>()

/** Ecrit le plancher, sans jamais le faire descendre. Un echec disque ne casse pas la conversation. */
export function writeConversationIdFloor(valeur: number, path = conversationsPath()): void {
  if (!Number.isSafeInteger(valeur)) return
  // Chemin CHAUD : rien n'a monte depuis la derniere ecriture, donc aucun acces disque.
  const connu = plancherEcrit.get(path)
  if (connu !== undefined && valeur <= connu) return
  if (valeur <= readConversationIdFloor(path)) {
    plancherEcrit.set(path, valeur)
    return
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(conversationIdFloorPath(path), String(valeur), 'utf8')
    plancherEcrit.set(path, valeur)
  } catch {
    // Perdre le plancher degrade (des ids pourront etre reattribues) mais ne doit JAMAIS empecher
    // d'ecrire une conversation. On se tait plutot que de faire echouer la mutation.
  }
}

/** Même geste que `writeConversationIdFloor` — MÊMES gardes —, sans bloquer le fil principal. */
async function writeConversationIdFloorAsync(valeur: number, path: string): Promise<void> {
  if (!Number.isSafeInteger(valeur)) return
  // Chemin CHAUD : rien n'a monte depuis la derniere ecriture, donc aucun acces disque.
  const connu = plancherEcrit.get(path)
  if (connu !== undefined && valeur <= connu) return
  if (valeur <= readConversationIdFloor(path)) {
    plancherEcrit.set(path, valeur)
    return
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    await writeFile(conversationIdFloorPath(path), String(valeur), 'utf8')
    plancherEcrit.set(path, valeur)
  } catch {
    // Voir `writeConversationIdFloor` : perdre le plancher degrade, mais ne doit jamais faire
    // echouer l'ecriture d'une conversation.
  }
}

export function conversationJournalPath(path = conversationsPath()): string {
  return `${path}.journal.jsonl`
}

/**
 * ARCHIVE DES CONVERSATIONS INACTIVES — un fichier par conversation, hors du snapshot.
 *
 * Mesuré le 2026-10-14 : 779 conversations sur 828 n'avaient pas bougé depuis plus de 14 jours et
 * pesaient 65,4 Mo des 76,8 Mo que le démarrage relit, revalide message par message et RÉÉCRIT
 * (le snapshot est recompacté à chaque démarrage qui trouve un journal, et à chaque rotation).
 * Le jalon « stores conversations et taches charges » prenait 1,3 à 1,8 s du corps du module.
 *
 * La règle qui rend l'archive sûre tient en une phrase : la copie ACTIVE (snapshot ou journal)
 * GAGNE TOUJOURS. Une archive n'est lue que pour un fil absent des deux. Donc :
 * - le démarrage ne lit que le snapshot et le journal ; les archives sont relues JUSTE APRÈS, hors
 *   du chemin critique (`archivesChargees`), puis ajoutées au store sans être réécrites ;
 * - un fil archivé qu'on touche est réécrit EN ENTIER dans le journal (et redevient actif) ;
 * - un fil archivé supprimé perd aussi son fichier, sinon il ressusciterait au démarrage suivant ;
 * - la bascule (`archiver`) écrit d'abord les archives, puis seulement retire ces fils du
 *   snapshot ; un arrêt entre les deux laisse un fil en double, et la copie active gagne.
 *
 * Un fichier par fil, et pas une archive unique : supprimer ou raviver un fil ne réécrit alors
 * qu'un seul petit fichier, jamais 65 Mo.
 */
export function conversationArchiveDir(path = conversationsPath()): string {
  return `${path}.archive`
}

/** Au-delà de ce délai sans activité, un fil quitte le snapshot pour l'archive. */
export const SEUIL_ARCHIVE_MS = 14 * 24 * 60 * 60 * 1000

/** Un id de conversation est un NOM DE FICHIER d'archive : rien qui puisse sortir du dossier. */
const ID_ARCHIVABLE = /^[A-Za-z0-9._-]{1,120}$/

function cheminArchive(path: string, id: string): string {
  return join(conversationArchiveDir(path), `${id}.json`)
}

/**
 * PIERRE TOMBALE d'une archive qu'on n'a pas pu retirer (fichier tenu par un antivirus, un
 * indexeur) : `<id>.supprime`. Sans elle, l'enregistrement `delete` du journal disparaît à la
 * prochaine compaction et le fil supprimé revient au démarrage suivant.
 */
const SUFFIXE_SUPPRIME = '.supprime'

/** Les ids archivés, lus dans le NOM des fichiers : aucun fichier n'est ouvert. */
function idsArchives(path: string): string[] {
  const dossier = conversationArchiveDir(path)
  if (!existsSync(dossier)) return []
  try {
    const noms = readdirSync(dossier)
    const supprimes = new Set(
      noms
        .filter((nom) => nom.endsWith(SUFFIXE_SUPPRIME))
        .map((nom) => nom.slice(0, -SUFFIXE_SUPPRIME.length))
    )
    return noms
      .filter((nom) => nom.endsWith('.json'))
      .map((nom) => nom.slice(0, -'.json'.length))
      .filter((id) => ID_ARCHIVABLE.test(id) && !supprimes.has(id))
  } catch {
    return []
  }
}

/** Ids marqués supprimés dont l'archive n'a pas encore pu être retirée. */
function idsSupprimesEnAttente(path: string): string[] {
  const dossier = conversationArchiveDir(path)
  if (!existsSync(dossier)) return []
  try {
    return readdirSync(dossier)
      .filter((nom) => nom.endsWith(SUFFIXE_SUPPRIME))
      .map((nom) => nom.slice(0, -SUFFIXE_SUPPRIME.length))
  } catch {
    return []
  }
}

/** Une archive illisible ou d'un autre fil rend `undefined` : on ne devine jamais son contenu. */
function conversationDArchive(texte: string, id: string): Conversation | undefined {
  try {
    const data: unknown = JSON.parse(texte)
    return isConversation(data) && data.id === id ? restaurerContenus(data) : undefined
  } catch {
    return undefined
  }
}

function lireArchive(path: string, id: string): Conversation | undefined {
  if (!ID_ARCHIVABLE.test(id)) return undefined
  try {
    return conversationDArchive(readFileSync(cheminArchive(path, id), 'utf8'), id)
  } catch {
    return undefined
  }
}

async function lireArchiveAsync(path: string, id: string): Promise<Conversation | undefined> {
  try {
    return conversationDArchive(await readFile(cheminArchive(path, id), 'utf8'), id)
  } catch {
    return undefined
  }
}

function supprimerArchive(path: string, id: string): void {
  if (!ID_ARCHIVABLE.test(id)) return
  try {
    rmSync(cheminArchive(path, id), { force: true })
  } catch (erreur) {
    // Une archive qui reste ferait revenir un fil que l'utilisateur a supprimé : une pierre
    // tombale durable la fait ignorer, et son retrait est retenté au démarrage suivant.
    try {
      writeFileSync(join(conversationArchiveDir(path), `${id}${SUFFIXE_SUPPRIME}`), '', 'utf8')
    } catch {
      /* rien de plus à tenter ici : le message ci-dessous nomme le fichier à retirer */
    }
    console.warn(`[conversations] archive de ${id} non supprimée`, erreur)
  }
}

type ConversationJournalRecord =
  | { schema: 'autowin.conversation-change/v1'; op: 'upsert'; conversation: Conversation }
  | { schema: 'autowin.conversation-change/v1'; op: 'delete'; id: string }
  | {
      schema: 'autowin.conversation-change/v1'
      op: 'append-messages'
      id: string
      messages: Msg[]
      updatedAt: number
      /** Titre repris du message (conv-999). Absent des journaux antérieurs : titre inchangé. */
      title?: string
      origineTitre?: 'auto' | 'utilisateur'
    }
  | {
      schema: 'autowin.conversation-change/v1'
      op: 'turn-event'
      id: string
      turnId: string
      event: ChatTurnEvent
      updatedAt: number
    }

const JOURNAL_MAX_BYTES = 16 * 1024 * 1024

function applyConversationJournal(
  base: Conversation[],
  path: string,
  /** Rempli des fils que le journal SUPPRIME : leur archive éventuelle doit partir avec eux. */
  supprimees?: Set<string>
): Conversation[] {
  const journal = conversationJournalPath(path)
  if (!existsSync(journal)) return base
  const byId = new Map(base.map((conversation) => [conversation.id, conversation]))
  // Un delta qui vise un fil absent du snapshot peut viser un fil ARCHIVÉ (ravivé par un upsert
  // perdu) : son archive est relue, plutôt que d'écarter le delta.
  const depuisArchive = (id: string): Conversation | undefined => {
    const archivee = lireArchive(path, id)
    if (archivee) byId.set(id, archivee)
    return archivee
  }
  const lines = readFileSync(journal, 'utf8').split(/\r?\n/)
  const lastContentIndex = lines.reduce((last, line, index) => (line ? index : last), -1)
  const ecartees: string[] = []
  for (const [index, line] of lines.entries()) {
    if (!line) continue
    try {
      const record = JSON.parse(line) as Partial<ConversationJournalRecord>
      if (record.schema !== 'autowin.conversation-change/v1') throw new Error('schema invalide')
      if (record.op === 'upsert' && isConversation(record.conversation)) {
        byId.set(record.conversation.id, restaurerContenus(record.conversation))
        supprimees?.delete(record.conversation.id)
      } else if (record.op === 'delete' && typeof record.id === 'string') {
        byId.delete(record.id)
        supprimees?.add(record.id)
      } else if (
        record.op === 'append-messages' &&
        typeof record.id === 'string' &&
        Array.isArray(record.messages) &&
        record.messages.every(isConversationMessage) &&
        typeof record.updatedAt === 'number'
      ) {
        const conversation = byId.get(record.id) ?? depuisArchive(record.id)
        if (!conversation) throw new Error('conversation du delta introuvable')
        // Historique antérieur au marqueur : l'ordre du journal dit encore où la consigne est
        // arrivée dans la réponse en cours. On le retrouve ici, en mémoire, sans réécrire le disque.
        for (const message of record.messages) {
          if (message.orientation && message.coupeLaReponse === undefined) {
            const coupure = pointDeCoupure(conversation.messages.at(-1))
            if (coupure !== undefined) message.coupeLaReponse = coupure
          }
          conversation.messages.push(restaurerContenuDuMessage(message))
        }
        conversation.updatedAt = record.updatedAt
        // Le titre retenu au moment du message, tel quel : le recalculer ici dépendrait des titres
        // des AUTRES fils au moment du rejeu (marqueur d'homonyme), donc pourrait différer.
        if (typeof record.title === 'string' && record.title) conversation.title = record.title
        if (record.origineTitre === 'auto' || record.origineTitre === 'utilisateur')
          conversation.origineTitre = record.origineTitre
      } else if (
        record.op === 'turn-event' &&
        typeof record.id === 'string' &&
        typeof record.turnId === 'string' &&
        isRecord(record.event) &&
        typeof record.event.kind === 'string' &&
        typeof record.updatedAt === 'number'
      ) {
        const conversation = byId.get(record.id) ?? depuisArchive(record.id)
        const message = conversation
          ? applyTurnEventToMessages(
              conversation.messages,
              record.turnId,
              record.event as ChatTurnEvent
            )
          : undefined
        if (!conversation || !message) throw new Error('tour du delta introuvable')
        conversation.updatedAt = record.updatedAt
      } else {
        throw new Error('opération de journal invalide')
      }
    } catch (error) {
      if (index === lastContentIndex && error instanceof SyntaxError) break
      /*
       * UNE LIGNE FAUTIVE NE VAUT PAS LE DEMARRAGE ENTIER.
       *
       * VECU le 2026-08-24 sur les donnees reelles de l'utilisateur : un enregistrement sans
       * `title` ni `provider` a rendu l'application DEFINITIVEMENT inbootable -- fenetre « Error »,
       * 1175 conversations inaccessibles, et il a fallu retirer la ligne a la main. Ce fichier
       * portait DEJA, quelques lignes plus bas, le recit du meme piege : `category` etait exige
       * alors qu'il n'etait plus ecrit, et « un seul champ manquant faisait declarer le store ENTIER
       * corrompu ». La lecon avait ete ecrite, pas appliquee.
       *
       * LA COUPURE, et elle n'est pas un desserrage : un JSON ILLISIBLE reste fatal, parce qu'il
       * signale un fichier abime au niveau de l'ecriture -- on n'a aucune idee de ce qu'on perd. Un
       * rejet de FORME, lui, dit seulement que l'ecrivain et le lecteur n'appliquent pas le meme
       * contrat : la ligne est mise en quarantaine, nommee dans les traces, et le reste est charge.
       *
       * Perdre une conversation vaut infiniment mieux que perdre l'acces a mille cent
       * soixante-quinze.
       */
      if (error instanceof SyntaxError) {
        throw new ConversationPersistenceError(
          `Journal conversations corrompu ligne ${index + 1}: ${journal}`,
          journal,
          { cause: error }
        )
      }
      ecartees.push(`ligne ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (ecartees.length) {
    // BRUYANT a dessein : une donnee ecartee en silence est une donnee perdue sans temoin.
    console.warn(
      `[conversations] ${ecartees.length} ligne(s) de journal ecartee(s) dans ${journal} — ` +
        `le reste est charge. ${ecartees.slice(0, 5).join(' | ')}`
    )
  }
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

/** Les fils ACTIFS (snapshot + journal) — les archives ne sont pas lues ici. */
export function loadConversations(path = conversationsPath()): Conversation[] {
  return chargerConversationsEtJournal(path).conversations
}

function chargerConversationsEtJournal(path: string): {
  conversations: Conversation[]
  supprimees: Set<string>
} {
  const supprimees = new Set<string>()
  const conversations = applyConversationJournal(
    loadConversationSnapshot(path).map(restaurerContenus),
    path,
    supprimees
  )
  return { conversations, supprimees }
}

/**
 * Copie de sauvegarde UNIQUE prise avant la toute premiere ecriture de ce build.
 *
 * Ce build a cesse d'ecrire `category` et `workspaceId`, que la version PRECEDENTE du binaire
 * EXIGEAIT (`isConversation` etait tout-ou-rien : un seul champ manquant faisait declarer le store
 * ENTIER corrompu). Le rollback du CODE est donc en un geste, mais il rendrait l'utilisateur a un
 * binaire incapable de relire ses propres donnees migrees. Le repli `.tmp` ne couvre pas ce cas :
 * il rattrape une ecriture INTERROMPUE, pas un snapshot valide-mais-plus-recent.
 *
 * Restauration : `copy conversations.json.pre-remake conversations.json` (et supprimer
 * `conversations.json.journal.jsonl`).
 *
 * Prise UNE SEULE FOIS : si la copie existe deja, on ne l'ecrase pas — sinon elle serait remplacee
 * par un snapshot deja migre, c'est-a-dire par exactement ce dont elle protege.
 */
function backupBeforeFirstMigratedWrite(path: string): void {
  const backup = `${path}.pre-remake`
  if (!existsSync(path) || existsSync(backup)) return
  try {
    copyFileSync(path, backup)
  } catch {
    // Une sauvegarde impossible ne doit pas empecher l'application d'ecrire ses conversations :
    // perdre le filet est moins grave que perdre le tour en cours.
  }
}

function writeConversationSnapshot(all: Conversation[], path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    backupBeforeFirstMigratedWrite(path)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(all.map(conversationPourLeDisque), null, 1), 'utf8')
    renameSync(tmp, path)
  } catch (error) {
    /*
      Le message porte la CAUSE, pas seulement le chemin.
      Constaté le 2026-08-13 : l'application est morte au démarrage sur « Écriture du store
      conversations impossible: <chemin> », et ce message ne disait pas POURQUOI. Il a fallu trois
      sondes pour découvrir que le chemin d'écriture fonctionnait parfaitement en isolation — l'échec
      était un accès concurrent (un second processus tenant le fichier, donc un renommage refusé).
      Un `cause` rangé dans l'objet mais absent du message ne sert qu'à celui qui lit le code.
    */
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    throw new ConversationPersistenceError(
      `Écriture du store conversations impossible: ${path} — ${cause}`,
      path,
      { cause: error }
    )
  }
}

/**
 * MÊME écriture atomique que `writeConversationSnapshot`, mais HORS du fil principal.
 *
 * Pourquoi elle existe (mesure du 2026-09-12, `gels.jsonl`) : supprimer ou créer une conversation
 * figeait l'app **2,1 s**. La cause n'était pas l'ajout au journal (quelques octets) mais la
 * ROTATION : au-delà de 16 Mo de journal, on réécrit le fichier ENTIER — **35 Mo** — et cette
 * réécriture restait `writeFileSync`, y compris dans le chemin censé être asynchrone. Une seule
 * ligne synchrone suffisait à annuler tout le bénéfice du travail de 2026-09-09.
 */
async function writeConversationSnapshotAsync(all: Conversation[], path: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    backupBeforeFirstMigratedWrite(path)
    const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(all.map(conversationPourLeDisque), null, 1), 'utf8')
    await rename(tmp, path)
  } catch (error) {
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    throw new ConversationPersistenceError(
      `Écriture du store conversations impossible: ${path} — ${cause}`,
      path,
      { cause: error }
    )
  }
}

/** Pendant asynchrone de `saveConversations` : snapshot posé, puis journal périmé effacé. */
async function saveConversationsAsync(all: Conversation[], path: string): Promise<void> {
  await writeConversationSnapshotAsync(all, path)
  await rm(conversationJournalPath(path), { force: true })
}

export function saveConversations(all: Conversation[], path = conversationsPath()): void {
  writeConversationSnapshot(all, path)
  // Un snapshot explicite devient la nouvelle base canonique ; rejouer l'ancien journal par-dessus
  // ressusciterait des mutations déjà compactées.
  rmSync(conversationJournalPath(path), { force: true })
}

function journalRecords(changes: readonly ConversationChange[]): ConversationJournalRecord[] {
  return changes.map(({ id, conversation, journal }) => {
    if (journal?.op === 'append-messages') {
      return {
        schema: 'autowin.conversation-change/v1',
        id,
        ...journal,
        messages: journal.messages.map(messagePourLeDisque)
      }
    }
    if (journal?.op === 'turn-event') {
      return { schema: 'autowin.conversation-change/v1', id, ...journal }
    }
    return conversation
      ? {
          schema: 'autowin.conversation-change/v1',
          op: 'upsert',
          conversation: conversationPourLeDisque(conversation)
        }
      : { schema: 'autowin.conversation-change/v1', op: 'delete', id }
  })
}

/** Corps commun aux deux écritures du journal : les octets à poser, ou la rotation à faire. */
function prepareJournalWrite(
  changes: readonly ConversationChange[],
  path: string
): { journal: string; payload: string; rotation: boolean } {
  const journal = conversationJournalPath(path)
  const payload = `${journalRecords(changes)
    .map((record) => JSON.stringify(record))
    .join('\n')}\n`
  const projected = (existsSync(journal) ? statSync(journal).size : 0) + Buffer.byteLength(payload)
  return { journal, payload, rotation: projected > JOURNAL_MAX_BYTES }
}

/** La prochaine écriture du journal déclencherait-elle une rotation (= réécriture du snapshot) ? */
function rotationRequise(changes: readonly ConversationChange[], path: string): boolean {
  try {
    return prepareJournalWrite(changes, path).rotation
  } catch {
    return false // illisible : on laisse le chemin normal lever l'erreur réelle
  }
}

function appendConversationChanges(
  changes: readonly ConversationChange[],
  all: readonly Conversation[],
  path: string
): void {
  if (!changes.length) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    const { journal, payload, rotation } = prepareJournalWrite(changes, path)
    if (rotation) saveConversations([...all], path)
    else appendFileSync(journal, payload, 'utf8')
  } catch (error) {
    throw new ConversationPersistenceError(
      `Écriture du journal conversations impossible: ${conversationJournalPath(path)}`,
      conversationJournalPath(path),
      { cause: error }
    )
  }
}

/**
 * HORS DU FIL PRINCIPAL — pourquoi l'écriture des deltas est ASYNCHRONE.
 *
 * Mesure du 2026-09-09 (`gels.jsonl`, 15:38:48) : un `writeFileSync` + un `appendFileSync` sur
 * `conversations.json.journal.jsonl` ont bloqué 10 004 ms sur quelques Ko. Le disque a calé, et
 * comme l'écriture vivait sur le fil qui dessine l'interface, l'app est restée figée. Les deltas de
 * streaming (`urgency: 'checkpoint'`, un par token) partent donc sur le pool d'I/O de Node.
 *
 * Ce qui reste SYNCHRONE : `urgency: 'immediate'` — la clôture d'un tour, une création, une
 * suppression — et le vidage forcé de `before-quit`, qui est synchrone par nature.
 *
 * ORDRE AVANT SYNCHRONICITÉ : le journal se REJOUE au démarrage, donc deux enregistrements inversés
 * changeraient l'état reconstruit. Les écritures d'un MÊME fichier passent donc par une file et,
 * si une écriture y est déjà en vol quand un flush synchrone est demandé, ce lot est mis en QUEUE
 * plutôt qu'écrit tout de suite : perdre la synchronicité sur une fenêtre de quelques ms est sans
 * conséquence, écrire dans le désordre ne l'est pas.
 *
 * PAR FICHIER, jamais global : une file unique ferait attendre un store derrière un autre, et un
 * disque bloqué sur un chemin gèlerait les écritures de tous les autres — exactement le défaut
 * qu'on corrige. (Constaté en test : un état partagé faisait aussi fuiter le mode « en vol » d'un
 * fichier sur le suivant, qui basculait alors en asynchrone sans raison.)
 *
 * Le prix assumé : une mort BRUTALE du process pendant un vol peut perdre les derniers deltas du
 * tour en cours. Le journal de TOUR, lui, garde sa clôture synchrone — la fin d'un tour reste donc
 * toujours reconstituable.
 */
const chainesJournal = new Map<string, Promise<void>>()
const volsJournal = new Map<string, number>()

/** Une écriture de CE journal est-elle en vol ? (un flush synchrone ne doit pas la doubler) */
function journalEnVol(path: string): boolean {
  return (volsJournal.get(path) ?? 0) > 0
}

async function appendConversationChangesAsync(
  changes: readonly ConversationChange[],
  all: readonly Conversation[],
  path: string
): Promise<void> {
  if (!changes.length) return
  mkdirSync(dirname(path), { recursive: true })
  const { journal, payload, rotation } = prepareJournalWrite(changes, path)
  // La rotation réécrit le snapshot ENTIER (35 Mo mesurés) : c'est la plus lourde écriture de
  // l'app, donc surtout pas celle qu'on laisse sur le fil principal. Elle passe désormais par le
  // pendant asynchrone — c'était la dernière ligne synchrone de ce chemin.
  if (rotation) await saveConversationsAsync([...all], path)
  else await appendFile(journal, payload, 'utf8')
}

/**
 * Attend que les écritures du journal en vol soient posées sur le disque.
 * Sert aux TESTS et à tout appelant qui doit constater le fichier — pas au chemin de production,
 * dont tout l'intérêt est justement de ne pas attendre.
 */
export async function attendreEcrituresConversations(): Promise<void> {
  while (chainesJournal.size > 0) await Promise.all([...chainesJournal.values()])
}

/** Branche un store sur le disque : recharge l'existant + sauve à chaque mutation. */
export function persistConversations(
  store: ConversationStore,
  path = conversationsPath(),
  /**
   * Tours dont le run VA reprendre au démarrage (checkpoint encore sur disque). Eux seuls échappent
   * à l'avis d'interruption : les annoncer interrompus alors qu'ils redémarrent serait faux.
   */
  options?: {
    resumableTurnIds?: ReadonlySet<string>
    /** Appel de chat reprenable, demandé tour par tour — voir `ConversationStore.hydrate`. */
    appelChatReprenable?: (conversationId: string, turnId: string) => boolean
    /** Issue d'un run déjà terminé — voir `ConversationStore.hydrate`. */
    finishedRunOutcome?: (turnId: string) => FinishedRunOutcome | undefined
    /** Appelé quand les fils archivés ont été relus et ajoutés au store (nombre ajouté). */
    onArchivesChargees?: (ajoutees: number) => void
    /**
     * Passe d'archivage AUTOMATIQUE : `apresMs` après le démarrage, puis toutes les `intervalleMs`.
     * Absente (tests) : aucune minuterie, la passe ne part que sur appel explicite d'`archiver`.
     */
    archivage?: { apresMs: number; intervalleMs: number; seuilMs?: number }
    /**
     * La compaction de démarrage (snapshot réécrit, journal effacé) n'est DÉPOSÉE qu'à la résolution
     * de cette promesse — en production, l'affichage de la fenêtre. Absente (tests) : déposée tout
     * de suite, et `attendreEcrituresConversations` l'attend.
     */
    compactionApres?: PromiseLike<unknown>
  }
): PersistanceConversations {
  const journalPresentAtStartup = existsSync(conversationJournalPath(path))
  const { conversations: chargees, supprimees } = chargerConversationsEtJournal(path)
  // Un fil SUPPRIMÉ alors qu'il était archivé : son fichier part aussi, sinon il ressusciterait.
  for (const id of supprimees) supprimerArchive(path, id)
  const actifsAuDemarrage = new Set(chargees.map((conversation) => conversation.id))
  /** Fils dont la SEULE copie est l'archive. Jamais écrits dans le snapshot. */
  const archivees = new Set(
    idsArchives(path).filter((id) => !actifsAuDemarrage.has(id) && !supprimees.has(id))
  )
  const migrated = store.hydrate(chargees, options)
  // Le plancher persiste est releve APRES l'hydratation : hydrate calcule le sien depuis les
  // conversations vivantes, et c'est le PLUS HAUT des deux qui doit gagner. Les fils archivés, pas
  // encore relus, comptent aussi : leur id ne doit jamais être réattribué.
  store.raiseIdFloor(readConversationIdFloor(path))
  for (const id of archivees) {
    const numero = Number(id.replace(/^conv-/, ''))
    if (Number.isSafeInteger(numero)) store.raiseIdFloor(numero + 1)
  }
  writeConversationIdFloor(store.idFloor(), path)
  /** Ce que le snapshot contient : tout le store, MOINS les fils dont l'archive est la copie. */
  const actives = (): Conversation[] =>
    archivees.size > 0
      ? store.list().filter((conversation) => !archivees.has(conversation.id))
      : store.list()
  /** Compteur de changements par fil : la bascule n'archive qu'un fil que rien n'a touché depuis. */
  const versions = new Map<string, number>()
  const pending: ConversationChange[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Snapshots posés par la fermeture ; ils gagnent sur une réécriture d'archivage encore en vol. */
  let snapshotsDeFermeture = 0
  /**
   * Réécritures d'archivage DÉPOSÉES et pas encore jouées. Leur corps contient l'effet de tout lot
   * déposé avant elles : un tel lot qui échoue leur est donc CONFIÉ (voir `enfiler`), au lieu de
   * revenir dans le journal derrière elles, où il serait compté deux fois.
   */
  let depotsDeReecriture = 0
  const reecrituresEnAttente: Array<{
    numero: number
    lot: ConversationChange[]
    confies: number
  }> = []

  const armerDelai = (): void => {
    if (timer) return
    timer = setTimeout(() => flushAsync(), 120)
    ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
  }

  /** Met le lot en QUEUE derrière ce qui est déjà en vol — l'ordre du journal est intouchable. */
  const enfiler = (changes: ConversationChange[]): void => {
    const reecrituresAuDepot = depotsDeReecriture
    volsJournal.set(path, (volsJournal.get(path) ?? 0) + 1)
    const suite: Promise<void> = (chainesJournal.get(path) ?? Promise.resolve())
      .then(() => appendConversationChangesAsync(changes, actives(), path))
      .then(
        async () => {
          // Une creation a pu faire monter le plancher : on le fige tout de suite, sinon un arret
          // brutal le perdrait et l'identifiant redeviendrait attribuable.
          await writeConversationIdFloorAsync(store.idFloor(), path)
        },
        () => {
          // Une réécriture déposée APRÈS ce lot le contient déjà : elle décide de son sort — absorbé
          // si son snapshot est posé, rendu au journal À SA PLACE sinon. Le confier dans l'ordre
          // d'échec garde l'ordre chronologique des lots.
          const reecriture = reecrituresEnAttente.find((r) => r.numero > reecrituresAuDepot)
          if (reecriture) {
            reecriture.lot.splice(reecriture.confies, 0, ...changes)
            reecriture.confies += changes.length
            return
          }
          // Erreur disque transitoire : le lot RETOURNE en tête de file et sera rejoué au prochain
          // vidage — comme avant, on n'efface qu'après succès. Il repasse devant les changements
          // arrivés depuis, puisqu'il les précédait.
          pending.unshift(...changes)
          armerDelai()
        }
      )
      .finally(() => {
        volsJournal.set(path, (volsJournal.get(path) ?? 1) - 1)
        if ((volsJournal.get(path) ?? 0) <= 0) volsJournal.delete(path)
        if (chainesJournal.get(path) === suite) chainesJournal.delete(path)
      })
    chainesJournal.set(path, suite)
  }

  /** Vidage COURANT (deltas de streaming) : ne bloque jamais le fil principal. */
  const flushAsync = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!pending.length) return
    enfiler(pending.splice(0, pending.length))
  }

  /**
   * Vidage FORCÉ (clôture de tour, création, `before-quit`) : synchrone, sauf si une écriture est
   * déjà en vol — auquel cas on enfile, car doubler ou devancer cette écriture casserait l'ordre.
   */
  const flush = (options?: { differable?: boolean }): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const differable = options?.differable !== false
    /*
      FERMETURE AVEC UNE ÉCRITURE EN VOL. On ne peut ni l'attendre (on est synchrone) ni la
      devancer (l'ordre du journal serait cassé). On pose donc un SNAPSHOT COMPLET de l'état
      vivant : il contient déjà tout ce qui est en vol, et il rend le journal inutile — c'est ce
      qui garantit qu'un dernier tour, une création ou une suppression ne meurt pas avec le
      process. Coût assumé : une écriture lourde, mais à la fermeture, plus personne n'attend
      l'interface.
    */
    if (!differable && (journalEnVol(path) || pending.length > 0)) {
      const lot = pending.splice(0, pending.length)
      try {
        saveConversations(actives(), path)
        // Posé APRÈS tout ce qui est en vol : une réécriture d'archivage encore en file ne doit plus
        // le recouvrir avec un état plus ancien (`reecrireSnapshot`).
        snapshotsDeFermeture += 1
        writeConversationIdFloor(store.idFloor(), path)
      } catch (erreurSnapshot) {
        /*
          FICHIER VERROUILLÉ À LA FERMETURE (conv-717, point 4). Le snapshot réécrit
          conversations.json : un autre processus qui le tient fait échouer le renommage. Laisser
          l'erreur remonter perdait le lot ET cassait la suite de `before-quit` (tâches, journaux).
          Repli : le JOURNAL, un fichier distinct, rejoué au prochain démarrage. Seulement si aucune
          écriture n'est en vol — sinon l'ajout synchrone la devancerait et casserait l'ordre.
        */
        const cause = erreurSnapshot instanceof Error ? erreurSnapshot.message : String(erreurSnapshot)
        if (lot.length && !journalEnVol(path)) {
          try {
            appendConversationChanges(lot, actives(), path)
            console.error(`[conversations] fermeture : snapshot refusé (${cause}), lot sauvé dans le journal.`)
            return
          } catch (erreurJournal) {
            const causeJournal = erreurJournal instanceof Error ? erreurJournal.message : String(erreurJournal)
            pending.unshift(...lot)
            console.error(`[conversations] fermeture : ÉCHEC d'écriture, ${lot.length} changement(s) perdu(s). Snapshot : ${cause}. Journal : ${causeJournal}.`)
            return
          }
        }
        pending.unshift(...lot)
        console.error(`[conversations] fermeture : ÉCHEC d'écriture du snapshot (${cause}).`)
      }
      return
    }
    if (!pending.length) return
    const changes = pending.splice(0, pending.length)
    /*
      LA ROTATION NE PASSE PLUS PAR ICI. Mesure du 2026-09-12 : une suppression de conversation a
      figé l'app 2,1 s — un `urgency: 'immediate'` tombé pile sur une rotation, donc une réécriture
      synchrone des 35 Mo du fichier. L'ajout au journal (quelques octets) reste synchrone, parce
      que c'est lui qui rend la création/suppression immédiatement reconstituable ; la réécriture
      complète, elle, part dans la file. L'ordre est préservé : la file est la MÊME.

      Le vidage de `before-quit` passe `differable: false` — là, l'app se ferme et plus personne
      n'attend l'interface : perdre le lot serait pire que bloquer 2 s.
    */
    if (journalEnVol(path) || rotationRequise(changes, path)) {
      enfiler(changes)
      return
    }
    try {
      appendConversationChanges(changes, actives(), path)
      writeConversationIdFloor(store.idFloor(), path)
    } catch (error) {
      // Effacement APRES succes uniquement : une erreur disque transitoire reste rejouable.
      pending.unshift(...changes)
      throw error
    }
  }

  store.onChange = (recu) => {
    let change = recu
    versions.set(change.id, (versions.get(change.id) ?? 0) + 1)
    if (!change.conversation) {
      // SUPPRIMÉ : son archive part avec lui, qu'il soit archivé ou non — une archive périmée
      // restée sur le disque (son retrait a échoué) le ferait ressusciter une fois le journal
      // compacté. Retirer un fichier absent ne coûte rien.
      archivees.delete(change.id)
      supprimerArchive(path, change.id)
    } else if (archivees.has(change.id)) {
      // RAVIVÉ : le snapshot ne contient pas ce fil, donc un delta seul (`append-messages`,
      // `turn-event`) n'aurait rien sur quoi se rejouer. Le journal porte le fil ENTIER, et il
      // redevient actif. Son archive, désormais périmée, part au prochain démarrage.
      archivees.delete(change.id)
      change = { id: change.id, conversation: change.conversation, urgency: 'immediate' }
    }
    pending.push(change)
    if (change.urgency === 'immediate') {
      flush()
      return
    }
    armerDelai()
  }

  /**
   * RELECTURE DES ARCHIVES, juste après le démarrage et hors de son chemin critique. Une archive
   * illisible est GARDÉE et nommée : son fil manque à la liste, il n'est pas perdu.
   */
  const chargerArchives = async (): Promise<number> => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    const lues: Conversation[] = []
    const illisibles: string[] = []
    for (const id of [...archivees]) {
      const conversation = await lireArchiveAsync(path, id)
      if (conversation) lues.push(conversation)
      else illisibles.push(id)
    }
    if (illisibles.length) {
      console.warn(
        `[conversations] ${illisibles.length} archive(s) illisible(s), gardée(s) sur le disque : ` +
          illisibles.slice(0, 5).join(', ')
      )
    }
    // MÊME normalisation que le démarrage (`hydrate`) : une migration ajoutée là s'applique aussi
    // aux fils archivés, au lieu de les laisser dans le format de l'année de leur archivage.
    const normalisees = new ConversationStore()
    normalisees.hydrate(lues.filter((c) => archivees.has(c.id)))
    const ajoutees = store.integrerArchives(normalisees.list())
    // Tout est dans le store : plus aucune lecture à la demande.
    store.chargeurDArchive = undefined
    try {
      options?.onArchivesChargees?.(ajoutees)
    } catch {
      /* un observateur ne casse jamais la relecture */
    }
    return ajoutees
  }
  /** Résolue quand les archives sont dans le store ; posée en fin de démarrage, jamais avant. */
  let archivesChargees: Promise<number> = Promise.resolve(0)

  /**
   * Archives PÉRIMÉES : un fil actif au démarrage a sa copie durable dans le snapshot ou le journal,
   * et elle gagne toujours. Son ancienne archive ne ferait que tromper un lecteur externe.
   */
  const retirerArchivesPerimees = async (): Promise<void> => {
    const perimees = idsArchives(path).filter((id) => actifsAuDemarrage.has(id))
    const tombes = idsSupprimesEnAttente(path)
    if (perimees.length === 0 && tombes.length === 0) return
    await new Promise<void>((resolve) => setImmediate(resolve))
    for (const id of perimees) {
      await rm(cheminArchive(path, id), { force: true }).catch(() => undefined)
    }
    // Pierre tombale : l'archive d'abord, la tombe seulement une fois l'archive vraiment partie.
    for (const id of tombes) {
      if (!ID_ARCHIVABLE.test(id)) continue
      const parti = await rm(cheminArchive(path, id), { force: true }).then(
        () => true,
        () => false
      )
      if (parti) {
        await rm(join(conversationArchiveDir(path), `${id}${SUFFIXE_SUPPRIME}`), {
          force: true
        }).catch(() => undefined)
      }
    }
  }

  /**
   * Réécrit le snapshot SANS les fils archivés, dans la file du journal (l'ordre est intouchable).
   *
   * SÉRIALISÉ AU DÉPÔT, pas quand son tour arrive dans la file. Tout lot déjà en file porte des
   * changements ANTÉRIEURS : il s'écrit avant, puis ce snapshot l'absorbe en effaçant le journal.
   * Tout lot déposé APRÈS porte des changements POSTÉRIEURS : il s'écrit après, dans le journal neuf.
   * Les changements encore en attente partent avec ce snapshot, et nulle part ailleurs. Sérialiser
   * au passage dans la file aurait compté deux fois un lot déposé entre-temps : déjà dans le
   * snapshot, puis rejoué depuis le journal (texte et messages doublés au démarrage suivant).
   */
  const reecrireSnapshot = (): Promise<void> => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const depot = {
      numero: ++depotsDeReecriture,
      lot: pending.splice(0, pending.length),
      confies: 0
    }
    reecrituresEnAttente.push(depot)
    const corps = JSON.stringify(actives().map(conversationPourLeDisque), null, 1)
    const fermeturesAuDepot = snapshotsDeFermeture
    volsJournal.set(path, (volsJournal.get(path) ?? 0) + 1)
    const suite: Promise<void> = (chainesJournal.get(path) ?? Promise.resolve())
      .then(async () => {
        const tmp = `${path}.archivage.tmp`
        try {
          await mkdir(dirname(path), { recursive: true })
          backupBeforeFirstMigratedWrite(path)
          await writeFile(tmp, corps, 'utf8')
          // Une fermeture a posé entre-temps un snapshot COMPLET et plus récent : il gagne.
          if (snapshotsDeFermeture !== fermeturesAuDepot) {
            await rm(tmp, { force: true }).catch(() => undefined)
            return
          }
          // Renommage SYNCHRONE : entre ce contrôle et lui, aucun autre code ne peut écrire.
          renameSync(tmp, path)
        } catch (erreur) {
          await rm(tmp, { force: true }).catch(() => undefined)
          // Rien n'est posé : le lot retiré (et ceux qui lui ont été confiés) rejoint le journal À SA
          // PLACE, avant les lots suivants.
          const lot = depot.lot
          if (lot.length) {
            try {
              await appendFile(
                conversationJournalPath(path),
                `${journalRecords(lot)
                  .map((record) => JSON.stringify(record))
                  .join('\n')}\n`,
                'utf8'
              )
            } catch {
              pending.unshift(...lot)
              armerDelai()
            }
          }
          throw erreur
        }
        // Le snapshot est posé et contient le lot : quoi qu'il arrive ensuite, il ne repart jamais
        // dans le journal. Un journal impossible à effacer est au moins vidé.
        try {
          await rm(conversationJournalPath(path), { force: true })
        } catch {
          await writeFile(conversationJournalPath(path), '', 'utf8').catch((erreur: unknown) =>
            console.warn('[conversations] journal compacté impossible à vider', erreur)
          )
        }
        await writeConversationIdFloorAsync(store.idFloor(), path)
      })
      .finally(() => {
        const rang = reecrituresEnAttente.indexOf(depot)
        if (rang >= 0) reecrituresEnAttente.splice(rang, 1)
        volsJournal.set(path, (volsJournal.get(path) ?? 1) - 1)
        if ((volsJournal.get(path) ?? 0) <= 0) volsJournal.delete(path)
        if (chainesJournal.get(path) === suite) chainesJournal.delete(path)
      })
    chainesJournal.set(path, suite)
    return suite
  }

  let archivageEnCours: Promise<number> | undefined
  /**
   * BASCULE vers l'archive des fils inactifs depuis `seuilMs`. Ordre, et c'est lui qui la rend sûre :
   * 1. chaque archive est écrite (fichier temporaire puis renommage) ;
   * 2. seuls les fils que RIEN n'a touchés depuis leur sérialisation basculent ;
   * 3. le snapshot est réécrit sans eux, dans la file du journal.
   * Un arrêt entre 1 et 3 laisse un fil en double : la copie active gagne, rien n'est perdu.
   */
  const archiver = (maintenant = Date.now(), seuilMs = SEUIL_ARCHIVE_MS): Promise<number> => {
    archivageEnCours ??= (async () => {
      await archivesChargees
      const candidats = store
        .list()
        .filter(
          (conversation) =>
            !archivees.has(conversation.id) &&
            ID_ARCHIVABLE.test(conversation.id) &&
            maintenant - conversation.updatedAt > seuilMs &&
            !conversation.messages.some((message) => message.status === 'streaming')
        )
      if (candidats.length === 0) return 0
      await mkdir(conversationArchiveDir(path), { recursive: true })
      const ecrites: Array<{ conversation: Conversation; version: number }> = []
      for (const conversation of candidats) {
        const version = versions.get(conversation.id) ?? 0
        if (store.get(conversation.id) !== conversation) continue
        const cible = cheminArchive(path, conversation.id)
        const corps = JSON.stringify(conversationPourLeDisque(conversation))
        try {
          await writeFile(`${cible}.tmp`, corps, 'utf8')
          await rename(`${cible}.tmp`, cible)
          ecrites.push({ conversation, version })
        } catch (erreur) {
          console.warn(`[conversations] archivage de ${conversation.id} impossible`, erreur)
        }
      }
      const basculees: string[] = []
      for (const { conversation, version } of ecrites) {
        if (
          (versions.get(conversation.id) ?? 0) === version &&
          store.get(conversation.id) === conversation
        ) {
          basculees.push(conversation.id)
        } else {
          // Touché pendant la passe : son archive est déjà périmée, la copie active fait foi.
          await rm(cheminArchive(path, conversation.id), { force: true }).catch(() => undefined)
        }
      }
      if (basculees.length === 0) return 0
      for (const id of basculees) archivees.add(id)
      await reecrireSnapshot()
      return basculees.length
    })().finally(() => {
      archivageEnCours = undefined
    })
    return archivageEnCours
  }

  const programmerArchivage = (): void => {
    if (!options?.archivage) return
    const { apresMs, intervalleMs, seuilMs } = options.archivage
    const lancer = (): void => {
      void archiver(Date.now(), seuilMs).then(
        (n) => {
          if (n) console.log(`[conversations] ${n} conversation(s) inactive(s) archivée(s)`)
        },
        (erreur: unknown) => console.warn('[conversations] passe d’archivage en échec', erreur)
      )
    }
    const premier = setTimeout(() => {
      lancer()
      const suivant = setInterval(lancer, intervalleMs)
      ;(suivant as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.()
    }, apresMs)
    ;(premier as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
  }

  // Le replay est amorti sur le démarrage : une fois hydraté, le journal devient un snapshot
  // canonique puis repart vide. Il ne grossit donc pas à travers les sessions et chaque delta de la
  // session courante reste limité à la seule conversation touchée.
  //
  // HORS DU FIL PRINCIPAL, et APRÈS l'affichage quand l'appelant le demande (`compactionApres`).
  // Mesure du 2026-10-19 (conv-359, 23,7 Mo, 232 fils) : cette réécriture synchrone figeait le
  // démarrage 432 ms en médiane, jusqu'à 923 ms — 120 ms de sérialisation, le reste en écriture
  // sur le disque D: mécanique. Elle passe par la MÊME file que le journal (`reecrireSnapshot`) :
  // un lot écrit avant elle est absorbé, un lot écrit après rejoint le journal neuf. Son échec ne
  // perd rien : le journal n'est effacé qu'APRÈS un snapshot posé, il reste donc la référence et
  // le prochain démarrage recompacte. Et il ne met plus l'historique de côté : la version
  // synchrone levait, et `index.ts` ouvrait alors l'app sur un historique VIDE pour un simple
  // fichier tenu (cas vécu : `.tmp` resté en dossier, conv-914).
  if (migrated || journalPresentAtStartup) {
    const compacter = (): void => {
      void reecrireSnapshot().catch((erreur: unknown) =>
        console.warn(
          '[conversations] compaction de démarrage en échec — le journal reste la référence, ' +
            'nouvel essai au prochain démarrage',
          erreur
        )
      )
    }
    if (options?.compactionApres)
      void Promise.resolve(options.compactionApres).then(compacter, compacter)
    else compacter()
  } else if (!existsSync(path)) writeConversationSnapshot([], path)

  // RIEN ne part en arrière-plan avant que le démarrage SYNCHRONE ait réussi (lecture, premier
  // snapshot vide). S'il lève, l'appelant met ce store de côté et rebranche une persistance neuve
  // (`index.ts`) : des tâches laissées par celle-ci écriraient alors le même fichier en parallèle
  // de la nouvelle, ou retireraient des archives dont la seule autre copie vient d'être mise de
  // côté. La compaction, elle, ne lève plus ici : en échec, le journal garde tout.
  if (archivees.size > 0) {
    // FENÊTRE DE RELECTURE : jusqu'à ce que les archives soient dans le store, un fil archivé
    // demandé par son id (tâche planifiée liée à un vieux fil, `chat_send` d'un agent) est lu À LA
    // DEMANDE — son seul petit fichier — au lieu d'être déclaré inexistant. Sinon le répartiteur de
    // tâches créerait un fil neuf et y rebrancherait la tâche (`task-manager/chat-dispatch.ts`).
    store.chargeurDArchive = (id) => {
      if (!archivees.has(id)) return undefined
      const lue = lireArchive(path, id)
      if (!lue) return undefined
      const normalisee = new ConversationStore()
      normalisee.hydrate([lue])
      return normalisee.get(id)
    }
    archivesChargees = chargerArchives()
  }
  void retirerArchivesPerimees()
  programmerArchivage()

  // Exposé pour un flush forcé (ex. before-quit) : évite de perdre le dernier
  // fragment de streaming resté dans la fenêtre de debounce de 120 ms. `differable: false` :
  // à la fermeture, une rotation doit s'écrire ICI, tout de suite — aucune file ne sera drainée.
  return Object.assign(() => flush({ differable: false }), { archiver, archivesChargees })
}

/**
 * Ce que rend `persistConversations` : le vidage forcé (appelable tel quel, comme avant), plus la
 * passe d'archivage et la promesse de relecture des archives.
 */
export type PersistanceConversations = (() => void) & {
  archiver: (maintenant?: number, seuilMs?: number) => Promise<number>
  archivesChargees: Promise<number>
}

/**
 * MET DE COTE un store illisible, pour que l'application puisse quand meme s'ouvrir.
 *
 * DEFAUT VECU (2026-09-06) : un seul message portant un `status` hors contrat rendait le fichier
 * ENTIER illisible, et l'application refusait de demarrer. L'utilisateur se retrouvait devant une
 * application qui ne s'ouvre plus, sans autre issue que d'aller reparer un JSON a la main.
 *
 * Le fichier n'est JAMAIS supprime : il est RENOMME avec un horodatage, a cote de sa place
 * habituelle. Son journal d'ecritures part avec lui — le laisser serait pire que tout, il serait
 * rejoue sur un store vide et ressusciterait une moitie des donnees dans un etat incoherent.
 *
 * Rend les chemins reellement ecartes, pour que l'appelant puisse les NOMMER a l'utilisateur : un
 * demarrage qui repart a vide sans dire ou sont passees les conversations serait une perte de
 * donnees percue, meme quand rien n'est perdu.
 */
export function ecarterStoreIllisible(
  path = conversationsPath(),
  horodatage = new Date()
): string[] {
  const suffixe = horodatage.toISOString().replace(/[:.]/g, '-')
  const ecartes: string[] = []
  for (const source of [path, conversationJournalPath(path)]) {
    if (!existsSync(source)) continue
    const destination = `${source}.illisible-${suffixe}`
    try {
      renameSync(source, destination)
      ecartes.push(destination)
    } catch {
      // Un renommage impossible (fichier verrouille) ne doit pas empecher la tentative suivante :
      // ecarter le journal seul vaut mieux que ne rien ecarter du tout.
    }
  }
  return ecartes
}
