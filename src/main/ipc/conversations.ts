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
import { readSessionForImport, resolveListedSessionAsync } from '../activity/transcripts'
import { LOT_SUPPRESSION_MAX } from '../store/conversations'
import { removeConversationTurnJournals } from '../runs/turn-journal'
import { removeConvActivity } from '../activity/conv-activity'
import { deletePromptCalls } from '../activity/prompt-observability'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import { estCheminDeDossier } from '../../shared/project-path'
import { removeConversationArtifacts } from '../store/chat-artifact-store'
import { oublierFaitRetenu, rememberedFacts } from '../session-memory-echo'
import { ouvrirCopiesDEssai, revenirAuCodeDuTour } from '../photo-du-code'
import { bilanDeLaFacon, ecartDeLEssai, garderLEssai, type EcartDeLEssai } from '../garder-un-essai'
import { ressemblanceDesEcarts } from '../ressemblance-des-facons'
import { nomDeCopieDEssai } from '../../shared/essai-trois-facons'
import type { AutowinOS } from '../os'
import type { ActiveChatTurns } from '../active-chat-turns'
import { arreterLesTravauxDuFil } from '../arret-avant-suppression'
import type { TraceStore } from '../activity/trace-store'
import type { AppEvent } from '../commands'

/** Ce que les canaux de conversations prenaient dans `index.ts` — désormais passé explicitement. */
export type ConversationsIpcDeps = {
  os: AutowinOS
  activeChatTurns: ActiveChatTurns
  causalTrace: TraceStore
  turnJournalRoot: string
  isolatedTestInstance: boolean
  broadcast: (e: AppEvent) => void
  /** Ouvre le sélecteur de dossier natif : une fenêtre, pas un chemin fourni par le renderer. */
  pickDirectory: (sender: Electron.WebContents) => Promise<string | null>
  /** Fait avancer le compteur de lectures lu par `app:test:conversation-read-count`. */
  compterLectureIsolee: () => void
  /** Le dossier ou travaillent les tours de ce fil (le sien, ou celui de l'application). */
  dossierDuFil: (conversationId: string) => string
  /** Ou s'ouvrent les copies « revenir a ce tour » : hors du dossier partage, jamais dedans. */
  dossierDesRetours: () => string
  /**
   * Coupe le run de developpement d'un fil (`bus.abortOrchestration`) : supprimer un fil l'arrete
   * comme le bouton Stop, au lieu d'attendre sa fin (conv-1060, `arret-avant-suppression.ts`).
   */
  couperLeRun: (conversationId: string, motif: string) => boolean
}

export function registerConversationsIpc({
  os,
  activeChatTurns,
  causalTrace,
  turnJournalRoot,
  isolatedTestInstance,
  broadcast,
  pickDirectory,
  compterLectureIsolee,
  dossierDuFil,
  dossierDesRetours,
  couperLeRun
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
        /**
         * Dossier de travail dès la création : le fil neuf de « revenir au premier tour » naît dans
         * sa copie séparée (conv-1038). Un rangement après coup pouvait échouer sans être lu.
         */
        projectPath?: string
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
      const brut = (p as { projectPath?: unknown } | undefined)?.projectPath
      const projectPath = brut === undefined ? undefined : guardString(brut, 'projectPath')
      // Le store IGNORE un non-chemin ; demandé explicitement, il refuse ici le fil entier — sinon le
      // fil naîtrait sans dossier, donc dans le dossier partagé, alors que l'appelant l'isolait.
      // fix-ok: cause mesurée (conv-1038, rejeu du 2026-10-21) — create passait un non-chemin au store, qui l'ignore sans rien dire, et fork n'avait pas d'options. Entrées qui font rougir une version fausse (conversations.dossier-branche.test.ts) : projectPath « Factures » ou « retours/relatif » sans ce refus (2 rouges), dossier ignoré par fork (3 rouges).
      if (projectPath !== undefined && !estCheminDeDossier(projectPath))
        throw new Error(`IPC projectPath: chemin absolu attendu (${projectPath})`)
      const conversation = os.conversations.create({
        title,
        provider,
        ...(projectPath ? { projectPath } : {})
      })
      broadcast({ type: 'refresh', scope: 'conversations' })
      return conversation
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
  /**
   * Poser ou retirer le repère visuel d'une conversation. Rend l'état retenu (`true`/`false`),
   * jamais `undefined` : le renderer n'a pas à distinguer « id inconnu » de « non surligné ».
   */
  ipcMain.handle('os:conversations:setHighlight', (event, rawId: string, rawOn: unknown) => {
    assertTrustedRendererSender(event, 'Conversations')
    const id = guardString(rawId, 'id')
    const updated = os.conversations.surligner(id, rawOn === true)
    if (updated) broadcast({ type: 'refresh', scope: 'conversations' })
    return updated?.surlignee === true
  })
  /** Statut manuel active/inactive d'une conversation. Rend l'état retenu (`true` = inactive). */
  ipcMain.handle('os:conversations:setInactive', (event, rawId: string, rawOn: unknown) => {
    assertTrustedRendererSender(event, 'Conversations')
    const id = guardString(rawId, 'id')
    const updated = os.conversations.marquerInactive(id, rawOn === true)
    if (updated) broadcast({ type: 'refresh', scope: 'conversations' })
    return updated?.inactive === true
  })
  /**
   * Choisir le compte Claude d'UNE conversation. Rend l'id retenu, ou null si aucun choix propre
   * (id inconnu, ou retour au compte de l'application) : le renderer n'a pas a distinguer les deux.
   */
  ipcMain.handle(
    'os:conversations:setClaudeAccount',
    (event, rawId: string, rawAccount: unknown) => {
      assertTrustedRendererSender(event, 'Conversations')
      const id = guardString(rawId, 'id')
      const accountId = rawAccount === null ? null : guardString(rawAccount, 'accountId')
      const updated = os.conversations.choisirCompteClaude(id, accountId)
      if (updated) broadcast({ type: 'refresh', scope: 'conversations' })
      return updated?.claudeAccountId ?? null
    }
  )
  /**
   * IMPORTE une session Claude (`~/.claude/projects/<projet>/<session>.jsonl`) en conversation.
   *
   * Même autorisation que les canaux d'activité : la référence doit être RECONNUE par l'inventaire
   * (`resolveListedSessionAsync`) — aucun chemin fourni par la fenêtre n'est ouvert tel quel.
   * La lecture est plein texte et streaming côté main (`readSessionForImport`) ; le retour est un
   * RÉSUMÉ, jamais la conversation entière : renvoyer des mégaoctets de messages sur ce canal
   * gèlerait le renderer pour rien — il rechargera le fil par `os:conversation` s'il l'ouvre.
   */
  ipcMain.handle('os:conversations:importSession', async (event, ref: unknown) => {
    assertTrustedRendererSender(event, 'Conversation import')
    if (!ref || typeof ref !== 'object') throw new Error('Référence de session invalide')
    const raw = ref as Record<string, unknown>
    const session = await resolveListedSessionAsync({
      id: guardString(raw.id, 'session.id'),
      project: guardString(raw.project, 'session.project')
    })
    if (!session) throw new Error('Session non autorisée ou hors inventaire')
    const transcript = await readSessionForImport(session.path)
    if (transcript.messages.length === 0) throw new Error('Session sans message importable')
    const conversation = os.conversations.importerTranscript({
      title: transcript.title ?? `Import ${session.id}`,
      provider: 'claude',
      ...(transcript.cwd ? { projectPath: transcript.cwd } : {}),
      messages: transcript.messages
    })
    broadcast({ type: 'refresh', scope: 'conversations' })
    return {
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation.messages.length,
      ...(conversation.projectPath ? { projectPath: conversation.projectPath } : {})
    }
  })
  ipcMain.handle(
    'os:conversations:fork',
    (event, rawId: string, rawMessageId: string, rawOptions?: unknown) => {
      assertTrustedRendererSender(event, 'Conversation fork')
      // `dossier` : la copie séparée où la branche travaille DÈS sa création (conv-1038) — le store
      // refuse un non-chemin avant de créer quoi que ce soit.
      const dossier = (rawOptions as { dossier?: unknown } | undefined)?.dossier
      return os.conversations.fork(
        guardString(rawId, 'id'),
        guardString(rawMessageId, 'messageId'),
        dossier === undefined ? {} : { dossier: guardString(dossier, 'dossier') }
      )
    }
  )
  /*
   * LA MEMOIRE DU FIL, VUE ET CORRIGEE PAR L'UTILISATEUR (conv-1038, 2026-10-21 — carnet du fil).
   * L'echo (`session-memory-echo.ts`) n'etait relu que par l'agent : invisible, donc incorrigeable.
   * Lecture : titre, corps et sort du depot, rien d'autre. Oubli : le fait barre sort de l'echo et
   * l'agent ne le relit plus au tour suivant.
   */
  ipcMain.handle('os:conversations:memoire', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Conversation memory')
    return rememberedFacts(guardString(rawId, 'id')).map(({ title, body, state }) => ({
      title,
      body,
      ...(state ? { state } : {})
    }))
  })
  ipcMain.handle('os:conversations:oublierFait', (event, rawId: unknown, rawTitle: unknown) => {
    assertTrustedRendererSender(event, 'Conversation memory forget')
    return oublierFaitRetenu(guardString(rawId, 'id'), guardString(rawTitle, 'title'))
  })
  /*
   * « REVENIR A CE TOUR » (conv-1038, 2026-10-21) : la photo du code prise au debut du tour d'un
   * message, rouverte dans une COPIE SEPAREE (decision « branches-rewind », etape 2). Le dossier
   * partage n'est jamais touche. La branche du fil qui y travaille est creee par l'interface.
   */
  ipcMain.handle(
    'os:conversations:revenirAuTour',
    async (event, rawId: unknown, rawMessageId: unknown) => {
      assertTrustedRendererSender(event, 'Conversation rewind')
      const id = guardString(rawId, 'id')
      const conversation = os.conversations.get(id)
      if (!conversation) return { ok: false, raison: 'Conversation inconnue.' }
      return revenirAuCodeDuTour({
        conversationId: id,
        messages: conversation.messages,
        messageId: guardString(rawMessageId, 'messageId'),
        dossier: dossierDuFil(id),
        dossierDesRetours: dossierDesRetours()
      }).catch((erreur: unknown) => ({
        ok: false as const,
        raison: erreur instanceof Error ? erreur.message : String(erreur)
      }))
    }
  )
  /*
   * « ESSAIE 3 FAÇONS » (conv-1038, 2026-10-21) : une photo du code maintenant, et une copie
   * séparée par branche. Deux ou trois, jamais plus : chaque façon est un tour payé.
   */
  ipcMain.handle(
    'os:conversations:essaisEnParallele',
    async (event, rawId: unknown, rawNombre: unknown) => {
      assertTrustedRendererSender(event, 'Conversation parallel trials')
      const id = guardString(rawId, 'id')
      if (!os.conversations.get(id)) return { ok: false, raison: 'Conversation inconnue.' }
      const nombre =
        typeof rawNombre === 'number' && Number.isInteger(rawNombre)
          ? Math.min(3, Math.max(2, rawNombre))
          : 3
      return ouvrirCopiesDEssai({
        dossier: dossierDuFil(id),
        conversationId: id,
        dossierDesRetours: dossierDesRetours(),
        nombre
      }).catch((erreur: unknown) => ({
        ok: false as const,
        raison: erreur instanceof Error ? erreur.message : String(erreur)
      }))
    }
  )
  /*
   * « ESSAIE 3 FAÇONS » : LA CARTE DE COMPARAISON ET « GARDER CELLE-CI » (conv-1038, 2026-10-21 —
   * idée 6). Comparer : pour chaque branche, l'écart de SA copie depuis la photo de l'essai, et le
   * bilan de son tour (`garder-un-essai.ts`). Garder : cet écart publié par le chemin des copies
   * (`os.worktrees`, le même que les commandes), avec sa garde des fichiers non commités du dossier
   * partagé, son attente et son repêchage. Rien n'est écrit dans le dossier partagé d'ici.
   * check: garder-un-essai.test.ts (11 cas sur de vrais dépôts) et garder-un-essai.bilan.test.ts.
   */
  ipcMain.handle('os:conversations:comparerLesFacons', async (event, rawIds: unknown) => {
    assertTrustedRendererSender(event, 'Conversation trials compare')
    if (!Array.isArray(rawIds)) throw new Error('IPC ids: tableau attendu')
    const raisonDe = (erreur: unknown): string =>
      erreur instanceof Error ? erreur.message : String(erreur)
    const mesures = await Promise.all(
      rawIds.slice(0, 6).map(async (brut) => {
        const id = guardString(brut, 'id')
        const conversation = os.conversations.get(id)
        if (!conversation) return { id, connue: false as const }
        const bilan = bilanDeLaFacon(conversation.messages)
        const copie = conversation.projectPath ?? ''
        const ecart: EcartDeLEssai = !copie
          ? { ok: false, raison: 'Ce fil ne travaille pas dans une copie d’essai.' }
          : await ecartDeLEssai({ copie, dossierDesRetours: dossierDesRetours() }).catch(
              (erreur: unknown) => ({ ok: false as const, raison: raisonDe(erreur) })
            )
        return { id, connue: true as const, bilan, copie, ecart }
      })
    )
    // Le contrôle de ressemblance (conv-1057, 2026-10-22) : chaque façon contre ses voisines de la
    // même photo — rien ne disait que deux façons avaient rendu le même code.
    const ressemblances = await ressemblanceDesEcarts(
      mesures.flatMap((mesure) => (mesure.connue ? [mesure] : []))
    )
    return mesures.map((mesure) => {
      if (!mesure.connue)
        return { id: mesure.id, ok: false as const, raison: 'Conversation inconnue.' }
      const { id, bilan, ecart } = mesure
      return {
        id,
        ok: true as const,
        bilan,
        // La photo et l'arbre restent ici : l'interface n'a besoin que des fichiers et des lignes.
        ecart: ecart.ok
          ? {
              ok: true as const,
              fichiers: ecart.fichiers,
              ajouts: ecart.ajouts,
              retraits: ecart.retraits
            }
          : ecart,
        ressemblance: ressemblances.get(id) ?? {
          etat: 'sans-objet' as const,
          raison: 'non mesurée'
        }
      }
    })
  })
  ipcMain.handle('os:conversations:garderEssai', async (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Conversation trial keep')
    const id = guardString(rawId, 'id')
    const conversation = os.conversations.get(id)
    if (!conversation?.projectPath)
      return { ok: false as const, raison: 'Ce fil ne travaille pas dans une copie d’essai.' }
    const worktrees = os.worktrees
    if (!worktrees)
      return {
        ok: false as const,
        raison: 'La publication par copie n’est pas disponible dans cette instance.'
      }
    const nom = nomDeCopieDEssai(conversation.projectPath)
    const tache = `feat(essai): garder la façon ${nom?.rang ?? '?'} — ${conversation.title} (${nom?.fil ?? id})`
    return garderLEssai({
      copie: conversation.projectPath,
      dossierDesRetours: dossierDesRetours(),
      publication: {
        ouvrir: (runId) =>
          worktrees.beginAsync(runId, 'Garder une façon', true, {
            task: tache,
            role: 'command',
            conversationId: id
          }),
        fermer: (runId, publier) => worktrees.endAsync(runId, { merge: publier })
      }
    }).catch((erreur: unknown) => ({
      ok: false as const,
      raison: erreur instanceof Error ? erreur.message : String(erreur)
    }))
  })
  ipcMain.handle('os:conversations:remove', async (event, rawId: string) => {
    assertTrustedRendererSender(event, 'Conversations')
    const id = guardString(rawId, 'id')
    await arreterLesTravauxDuFil(id, { couperLeRun, tours: activeChatTurns })
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
    for (const id of ids) await arreterLesTravauxDuFil(id, { couperLeRun, tours: activeChatTurns })
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
