import { commandeNonInjectable } from '../skills/skill-routing'
import { MOTIF_STOP_DU_CHAT } from '../../shared/arret-par-stop'
import { ipcMain } from 'electron'
import { enregistrerDirectiveDansLeFil } from '../chat/directive-dans-le-fil'
import { responseDisplayedTrace } from '../activity/response-displayed-trace'
import { assertTrustedRendererSender } from './ipc-senders'
import { materializeClaudeAttachments } from '../providers/claude'
import { guardString, guardAttachments } from './ipc-guards'
import { journaliserSaisie } from '../store/journal-saisie'
import { deposerOrientationDuFil } from '../conversations/orientations-en-cours-app'
import { ultrathinkEnPleinTour, declarerUltrathinkTape } from '../chat/ultrathink-du-tour'
import type { ContexteIpcChat } from '../index'

/**
 * UN TOUR EN COURS : l’arrêter, savoir s’il tourne, lui envoyer une directive, ultrathink tapé,
 * journal des saisies.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** IPC : arrêt, état et orientation d’un tour en cours. */
export function registerTourEnCoursIpc(ctx: ContexteIpcChat): void {
  const { activeChatTurns, broadcast, bus, causalTrace, os, pendingDirectives } = ctx
  ipcMain.handle('os:pilotChat:cancel', (event, rawConversationId: string) => {
    assertTrustedRendererSender(event, 'Pilot chat cancel')
    const conversationId = guardString(rawConversationId, 'conversationId')
    // Stoppe le tour pilote ET le sous-agent en vol rattaché à cette conversation.
    // Motif partagé avec le graphe, qui y reconnaît un arrêt voulu et non une panne.
    const orchestrationAborted = bus.abortOrchestration(conversationId, MOTIF_STOP_DU_CHAT)
    const pilotAborted = activeChatTurns.abort(conversationId, 'user')
    return { ok: pilotAborted || orchestrationAborted }
  })
  /**
   * Un tour est-il REELLEMENT en vol pour cette conversation ?
   *
   * Le main est la seule autorite sur cette question, et le renderer n'avait aucun moyen de la poser.
   * Sans elle, un message persiste en `streaming` — l'app tuee en plein tour — se relisait au
   * demarrage comme un tour vivant : indicateur « N action en cours » colle, composer qui met les
   * messages EN FILE au lieu de les envoyer, et rien pour en sortir puisque l'annulation n'a aucun
   * tour a couper. Vecu par l'utilisateur le 20/08.
   *
   * Limite assumee : la sonde regarde le tour PILOTE. Une orchestration ne vit jamais hors d'un tour
   * pilote, mais si cela changeait, cette reponse deviendrait incomplete.
   */
  ipcMain.handle('os:pilotChat:active', (event, rawConversationId: string) => {
    assertTrustedRendererSender(event, 'Pilot chat active probe')
    const conversationId = guardString(rawConversationId, 'conversationId')
    return { active: activeChatTurns.isInFlight(conversationId) }
  })
  ipcMain.handle('os:orchestrate:cancel', (event, rawConversationId: string) => {
    assertTrustedRendererSender(event, 'Orchestration cancel')
    const conversationId = guardString(rawConversationId, 'conversationId')
    // Ce chemin ne coupe QUE l'orchestration, donc ne passe pas par `activeChatTurns.abort` : sans ce
    // marquage explicite, la moitié des arrêts resterait indiscernable d'une panne.
    activeChatTurns.markDeliberateStop(conversationId)
    return {
      ok: bus.abortOrchestration(
        conversationId,
        "arret demande par l'utilisateur (Stop de l'orchestration)"
      )
    }
  })
  // Injection LIVE : une directive envoyée pendant un tour atteint la boucle pilote
  // au prochain point d'itération (pilotage continu, sans attendre la fin du tour).
  ipcMain.handle(
    'os:pilotChat:inject',
    async (event, rawConversationId: string, rawDirective: string, rawAttachments?: unknown) => {
      assertTrustedRendererSender(event, 'Pilot chat directive')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const directive = guardString(rawDirective, 'directive').trim()
      const jointes = guardAttachments(rawAttachments)
      if (!directive && jointes.length === 0) return { ok: false, motif: 'vide' as const }
      // UNE COMMANDE DE SKILL NE S'INJECTE PAS EN TEXTE (turn 6d0e352f-0624-4c9a-b2f5-c6aabf57d310,
      // saisie ts 1790275118313) : « /judge mon watchdog » envoye pendant un tour a ete colle dans le
      // fil comme simple phrase ; la skill judge n'a jamais ete chargee et le modele a juge lui-meme.
      // Refus -> le renderer met le texte en FILE, il repart en message normal, donc route par
      // `routeSkillRequest` comme n'importe quel `/judge`.
      // Le refus porte son MOTIF : sans lui, l'ecran affichait « ⚠ Échec » sur un refus voulu.
      const commande = jointes.length === 0 ? commandeNonInjectable(directive) : undefined
      if (commande) return { ok: false, motif: 'commande' as const, commande }
      // Le renderer passe busy avant que l'IPC `pilotChat` ait fini d'enregistrer son controleur.
      // Une attente courte absorbe cette course de demarrage sans accepter de directive hors tour.
      if (!(await activeChatTurns.waitForActive(conversationId, 500)))
        return { ok: false, motif: 'hors-tour' as const }
      // PIECES JOINTES EN COURS DE TOUR (2026-09-23) : elles attendaient la fin du tour, parfois
      // plusieurs minutes (« j'ai envoye un message avec une image et ca n'a rien envoye »). Elles
      // sont ecrites sur disque comme pour un message normal, et leurs chemins suivent le texte.
      // Pas de nettoyage ici : le tour doit pouvoir les lire ; les temporaires orphelins sont
      // balayes par `temporaires-orphelins.ts`.
      const suffixe = jointes.length > 0 ? materializeClaudeAttachments(jointes).promptSuffix : ''
      const queued = pendingDirectives.get(conversationId) ?? []
      queued.push((directive || '(image envoyée sans texte)') + suffixe)
      pendingDirectives.set(conversationId, queued)
      // REMISE EN PLEIN APPEL : la boucle pilote ne relit la file qu'ENTRE deux appels ;
      // un appel du CLI Claude peut durer 16 minutes (tour 2e218711 : saisie ts
      // 1793225455947 absente du premier appel, lue au second). Doublée sur disque, le contrôle
      // avant chaque outil la remet.
      // « ultrathink » TAPÉ dans ce message : le reste du tour monte en réflexion. Le niveau se
      // fixe au lancement du CLI : le contrôle coupe donc l'appel en cours après son outil
      // (`coupe`), et la boucle pilote le relance plus haut avec ce message.
      const coupe = ultrathinkEnPleinTour(conversationId, directive)
      deposerOrientationDuFil(conversationId, queued[queued.length - 1], { coupe })
      broadcast({ type: 'refresh', scope: 'directives' })
      // La directive est acceptee -> elle devient un VRAI message du fil. Sans cette ecriture, le
      // seul temoin etait un recu vivant dans la memoire de l'ecran : un rechargement l'effacait et
      // l'utilisateur devait recliquer (2026-09-01). L'echec de l'ecriture ne remonte
      // jamais : la directive est deja empilee, une trace manquee n'annule pas un envoi reussi.
      const messageId = enregistrerDirectiveDansLeFil({
        conversations: os.conversations,
        conversationId,
        texte: directive,
        attachments: jointes,
        broadcast: (event) => broadcast(event),
        onError: (error) => console.error('[inject] message non ecrit dans le fil', error)
      })
      if (messageId) return { ok: true, messageId }
      return { ok: true }
    }
  )

  // Le champ de saisie déclare, juste avant l'envoi, qu'une personne y a TAPÉ « ultrathink » : sans
  // cette déclaration, le mot ne monte la réflexion d'aucun tour (`chat/ultrathink-du-tour.ts`).
  ipcMain.handle('os:ultrathink:tape', (event, rawTexte: string) => {
    assertTrustedRendererSender(event, 'Ultrathink typed statement')
    return { ok: declarerUltrathinkTape(guardString(rawTexte, 'texte')) }
  })

  /**
   * FILET DE SÉCURITÉ DU TEXTE UTILISATEUR — appelé AVANT tout envoi, quelle que soit la suite.
   *
   * Le renderer vide son composer dès qu'un texte part, et ce texte ne vit ensuite que dans des refs
   * volatiles tant qu'aucun tour n'est créé (mesure du 2026-09-01, : deux messages disparus
   * sans trace). Cette écriture précède donc l'envoi, et son échec ne remonte jamais : elle rend
   * `{ ok: false }` plutôt que de lever, pour ne pas transformer une trace manquée en envoi manqué.
   */
  ipcMain.handle(
    'os:saisie:journaliser',
    (event, rawConversationId: string, rawTexte: string, rawVoie: string, rawOrigine?: unknown) => {
      assertTrustedRendererSender(event, 'User input journal')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const texte = guardString(rawTexte, 'texte')
      const voie = guardString(rawVoie, 'voie')
      if (voie !== 'message' && voie !== 'orientation') {
        return { ok: false }
      }
      // Un envoi du mode auto doit se distinguer d'un texte tapé (seule valeur admise).
      const origine = rawOrigine === 'mode-auto' ? ('mode-auto' as const) : undefined
      return {
        ok: journaliserSaisie({ conversationId, texte, voie, ...(origine ? { origine } : {}) })
      }
    }
  )

  ipcMain.handle(
    'os:causalTrace:displayed',
    (event, rawConversationId: string, rawContent: string) => {
      assertTrustedRendererSender(event, 'Displayed response trace')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const content = guardString(rawContent, 'content')
      const existing = causalTrace.readConversation(conversationId)
      const parentId = existing.at(-1)?.id
      const sequence = causalTrace.nextSequence(conversationId)
      const displayedEvent = responseDisplayedTrace({
        conversationId,
        turnId: existing.at(-1)?.turnId ?? `${conversationId}:displayed`,
        parentId,
        sequence,
        content,
        timestamp: new Date().toISOString()
      })
      causalTrace.append(displayedEvent)
      return { ok: true, eventId: displayedEvent.id }
    }
  )
}
