/**
 * LES CANAUX DES CONVERSATIONS (le fil lui-même), sortis de `src/main/index.ts`.
 *
 * Dix canaux : lister, chercher par contenu, lire un fil, créer, router un message, renommer,
 * ranger dans un dossier, dupliquer, supprimer — à l'unité et en lot.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, gardes d'expéditeur inchangés, et
 * surtout les deux protections que ces canaux portent et qui ont chacune une histoire — la
 * validation AVANT écriture de `create` (le 2026-08-24, un appel mal formé a rendu l'application
 * définitivement non démarrable) et le plafond de `removeMany`.
 *
 * Ce qui reste dans `index.ts`, faute d'appartenir à cette famille : les lectures d'autres magasins
 * qui se trouvent seulement PORTER un identifiant de conversation (`os:conversationFileTraces`,
 * `os:conversationRuns`, `os:conversationRuns:delete`, `os:conversationActivity`), et les canaux
 * `os:chatArtifact:*` qui étaient intercalés ici. Les déplacer serait mélanger des domaines.
 *
 * Deux points de forme, aucun changement de comportement :
 *  - le compteur de lectures en instance de test reste dans `index.ts` (un autre canal le lit et le
 *    remet à zéro) ; ce module le fait avancer par `compterLectureIsolee()`.
 *  - le sélecteur de dossier natif est reçu comme fonction : il ouvre une fenêtre, il n'a rien à
 *    faire ici.
 */
import { ipcMain } from 'electron'
import { LOT_SUPPRESSION_MAX } from '../store/conversations'
import { removeConversationTurnJournals } from '../runs/turn-journal'
import { removeConvActivity } from '../activity/conv-activity'
import { appendConvActivity } from '../activity/conv-activity'
import { deletePromptCalls } from '../activity/prompt-observability'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import { removeConversationArtifacts } from '../store/chat-artifact-store'
import type { AutowinOS } from '../os'
import type { ActiveChatTurns } from '../active-chat-turns'
import type { TraceStore } from '../activity/trace-store'
import type { TraceLedger } from '../activity/ledger'
import type { ConversationRouteCoordinator } from '../conversation-router'
import type { AppEvent } from '../commands'

/** Ce que les canaux de conversations prenaient dans `index.ts` — désormais passé explicitement. */
export type ConversationsIpcDeps = {
  os: AutowinOS
  activeChatTurns: ActiveChatTurns
  causalTrace: TraceStore
  ledger: TraceLedger
  conversationRouteCoordinator: ConversationRouteCoordinator
  turnJournalRoot: string
  isolatedTestInstance: boolean
  broadcast: (e: AppEvent) => void
  /** Ouvre le sélecteur de dossier natif : une fenêtre, pas un chemin fourni par le renderer. */
  pickDirectory: (sender: Electron.WebContents) => Promise<string | null>
  /** Fait avancer le compteur de lectures lu par `app:test:conversation-read-count`. */
  compterLectureIsolee: () => void
}

export function registerConversationsIpc({
  os,
  activeChatTurns,
  causalTrace,
  ledger,
  conversationRouteCoordinator,
  turnJournalRoot,
  isolatedTestInstance,
  broadcast,
  pickDirectory,
  compterLectureIsolee
}: ConversationsIpcDeps): void {
  // --- Conversations catégorisées ---
  ipcMain.handle('os:conversations', (event) => {
    assertTrustedRendererSender(event, 'Conversations')
    return os.conversations.listSummaries()
  })
  // Recherche par CONTENU pour la barre laterale : la liste envoyee au renderer n'a pas les
  // messages, seul le processus principal peut dire quelles conversations portent le terme.
  ipcMain.handle('os:conversations:searchContent', (event, rawTerme: unknown) => {
    assertTrustedRendererSender(event, 'Conversations content search')
    const terme = typeof rawTerme === 'string' ? rawTerme : ''
    if (terme.trim().length === 0) return []
    return os.conversations.rechercherParContenu(terme)
  })
  ipcMain.handle('os:conversation', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Conversation detail')
    if (isolatedTestInstance) compterLectureIsolee()
    return os.conversations.get(guardString(rawId, 'conversationId')) ?? null
  })
  ipcMain.handle(
    'os:conversations:create',
    (
      event,
      p: {
        title: string
        /** Contrat renderer INCHANGE : encore accepte, mais plus persiste — `provider` fait foi. */
        category?: string
        provider: string
      }
    ) => {
      assertTrustedRendererSender(event, 'Conversation create')
      /*
       * VALIDER AVANT D'ECRIRE, comme le voisin `routeMessage` le fait deja.
       *
       * VECU le 2026-08-24 : un appel passant une CHAINE au lieu de l'objet attendu a cree une
       * conversation sans `title` ni `provider`, persistee dans le journal — que `isConversation`
       * refuse ensuite. L'application est devenue DEFINITIVEMENT inbootable, 1175 conversations
       * inaccessibles, jusqu'a retrait manuel de la ligne.
       *
       * Un ecrivain et un lecteur qui n'appliquent pas le meme contrat sur le meme fichier, c'est
       * une bombe a retardement. `guardString` etait deja la, dix lignes plus bas.
       */
      const title = guardString((p as { title?: unknown } | undefined)?.title, 'title')
      const provider = guardString((p as { provider?: unknown } | undefined)?.provider, 'provider')
      const conversation = os.conversations.create({ title, provider })
      broadcast({ type: 'refresh', scope: 'conversations' })
      return conversation
    }
  )
  ipcMain.handle(
    'os:conversations:routeMessage',
    async (event, rawConversationId: unknown, rawMessage: unknown, rawAttachmentNames: unknown) => {
      assertTrustedRendererSender(event, 'Conversation route')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const message = guardString(rawMessage, 'message')
      if (!Array.isArray(rawAttachmentNames) || rawAttachmentNames.length > 8) {
        throw new Error('attachmentNames: tableau borné attendu')
      }
      const attachmentNames = rawAttachmentNames.map((name, index) =>
        guardString(name, `attachmentNames[${index}]`)
      )
      const result = await conversationRouteCoordinator.route(
        conversationId,
        message,
        attachmentNames
      )
      const decision = result.decision
      appendConvActivity(conversationId, {
        kind: 'conversation-route',
        label: result.routed ? 'Nouveau contexte détecté' : 'Contexte courant conservé',
        provider: decision.provider,
        model: decision.model,
        reasoningEffort: decision.reasoningEffort,
        inputTokens: decision.usage?.inputTokens,
        outputTokens: decision.usage?.outputTokens,
        costUsd: decision.usage?.costUsd,
        text: JSON.stringify({
          route: decision.route,
          confidence: decision.confidence,
          reason: decision.reason,
          sourceConversationId: result.sourceConversationId,
          conversationId: result.conversationId
        })
      })
      ledger.append({
        source: 'pilot',
        name: 'conversation_route',
        detail: `${decision.route}:${decision.confidence.toFixed(2)}:${decision.reason}`,
        ok: true
      })
      if (result.routed) broadcast({ type: 'refresh', scope: 'conversations' })
      return result
    }
  )
  ipcMain.handle('os:conversations:rename', (event, id: string, title: string) => {
    assertTrustedRendererSender(event, 'Conversation rename')
    return os.conversations.rename(id, guardString(title, 'title'))
  })
  /**
   * Ranger une conversation dans un dossier de travail. `null` la remet dans « Divers ».
   *
   * Le sélecteur natif est ouvert ICI et non côté renderer : le renderer n'a pas accès au disque, et
   * lui laisser passer un chemin arbitraire ferait de ce canal une écriture non contrôlée. Il envoie
   * soit un chemin déjà connu (glisser-déposer vers un groupe existant), soit `undefined` pour
   * demander l'ouverture du sélecteur.
   */
  ipcMain.handle(
    'os:conversations:setProject',
    async (event, rawId: string, rawPath?: string | null) => {
      assertTrustedRendererSender(event, 'Conversations')
      const id = guardString(rawId, 'id')
      let chemin: string | null
      if (rawPath === undefined) {
        chemin = await pickDirectory(event.sender)
        if (chemin === null) return null
      } else {
        chemin = rawPath === null ? null : guardString(rawPath, 'projectPath')
      }
      const updated = os.conversations.rangerDansDossier(id, chemin)
      if (updated) broadcast({ type: 'refresh', scope: 'conversations' })
      return updated?.projectPath ?? null
    }
  )
  ipcMain.handle('os:conversations:fork', (event, rawId: string, rawMessageId: string) => {
    assertTrustedRendererSender(event, 'Conversation fork')
    return os.conversations.fork(guardString(rawId, 'id'), guardString(rawMessageId, 'messageId'))
  })
  ipcMain.handle('os:conversations:remove', async (event, rawId: string) => {
    assertTrustedRendererSender(event, 'Conversations')
    const id = guardString(rawId, 'id')
    await activeChatTurns.abortAndWait(id, 'conversation-deleted')
    const removed = os.conversations.remove(id)
    if (removed) {
      removeConversationArtifacts(id)
      causalTrace.deleteConversation(id)
      deletePromptCalls(id)
      removeConversationTurnJournals(turnJournalRoot, id)
      removeConvActivity(id)
      broadcast({ type: 'refresh', scope: 'conversations' })
    }
    return removed
  })
  /**
   * Purge en LOT. Même travail que `os:conversations:remove` par conversation (abandon du tour en
   * vol, artefacts, trace causale, appels de prompt), mais UN SEUL broadcast à la fin : à 200 ids,
   * un rafraîchissement par suppression écroulerait la liste latérale.
   */
  ipcMain.handle('os:conversations:removeMany', async (event, rawIds: unknown) => {
    assertTrustedRendererSender(event, 'Conversations')
    if (!Array.isArray(rawIds)) throw new Error('ids: tableau attendu')
    const ids = rawIds.map((id, index) => guardString(id, `ids[${index}]`))
    if (ids.length > LOT_SUPPRESSION_MAX) {
      throw new Error(`lot de suppression trop grand : ${ids.length} > ${LOT_SUPPRESSION_MAX}`)
    }
    for (const id of ids) await activeChatTurns.abortAndWait(id, 'conversation-deleted')
    const removed = os.conversations.removeMany(ids)
    for (const id of removed) {
      removeConversationArtifacts(id)
      causalTrace.deleteConversation(id)
      deletePromptCalls(id)
      removeConversationTurnJournals(turnJournalRoot, id)
      removeConvActivity(id)
    }
    if (removed.length > 0) broadcast({ type: 'refresh', scope: 'conversations' })
    return removed
  })
}
