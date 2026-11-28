import { reclamerOuvertureConversation } from './pending-conversation-open'
import { ecouterElementsCibles, type ElementCible } from './alt-clic'
import { traceSilentFailure, newestNotice, texteFil, type AppNotice } from './chat-view-outils'
import {
  createLiveRunDeltaBatcher,
  reduceScopedLiveRuns,
  ajouterRaisonnementDePipeline,
  porteUneOrchestrationOuverte,
  noterChoixDePipeline,
  texteDuPrompt,
  reduceAssistantPilotEvent,
  completerChoixDePipeline,
  settleOrchestrationOnRunEnd,
  type OrchStep,
  type HydratedAssistantMessage,
  type ChatRuntimeIdentity,
  type ScopedLiveRun
} from './chat-view-model'
import { refreshesActiveConversation } from './chat-event-routing'
import type {
  Conv,
  AsstMsg,
  ChatAttachment,
  QueuedDirective,
  Msg,
  SendOptions
} from './chat-view-types'
import type { HypotheseDeCadrage } from '../../../shared/cadrage-confiance'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que le branchement du chat au montage lit de ChatView : les valeurs du rendu où il est appelé. */
export type MontageCtx = {
  activeRef: React.RefObject<string | null>
  busyConversationsRef: React.RefObject<Set<string>>
  convsRef: React.RefObject<Conv[]>
  enqueueMessage: (
    id: string,
    text: string,
    mode?: 'btw' | undefined,
    attachments?: ChatAttachment[] | undefined,
    origine?: Pick<QueuedDirective, 'lot'> | undefined
  ) => void
  liveMessagesRef: React.RefObject<Map<string, Msg[]>>
  loadConv: (c: Conv, filDeRepli?: readonly Msg[] | undefined) => Promise<void>
  lotsRetenusDansLeFil: (id: string) => boolean
  patchLast: (
    conversationId: string,
    fn: (m: HydratedAssistantMessage) => void,
    porte?: ((m: HydratedAssistantMessage) => boolean) | undefined
  ) => void
  queueRef: React.RefObject<Map<string, QueuedDirective[]>>
  recevoirElementCibleRef: React.RefObject<((element: ElementCible) => void) | null>
  refreshConvs: () => Promise<void>
  refreshFiches: () => Promise<void>
  refreshRuns: () => Promise<void>
  refreshRuntimeIdentity: (forceModels?: boolean) => Promise<ChatRuntimeIdentity>
  relirePlansRef: React.RefObject<() => void>
  rendreLaFileAuComposer: (id: string) => void
  repriseDemarrageRef: React.RefObject<Promise<void> | null>
  runDuCadrageRef: React.RefObject<Record<string, string>>
  send: (text?: string | undefined, options?: SendOptions | undefined) => Promise<void>
  setAppNotice: React.Dispatch<React.SetStateAction<AppNotice | null>>
  setCadrageReplie: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setComptesClaude: React.Dispatch<
    React.SetStateAction<{
      activeId: string
      accounts: {
        id: string
        displayName: string
        tier?: string | undefined
        email?: string | undefined
      }[]
    } | null>
  >
  setConversationQueue: (id: string, next: QueuedDirective[]) => void
  setDefaultWorkspace: React.Dispatch<React.SetStateAction<string | undefined>>
  setFilDuMontagePose: React.Dispatch<React.SetStateAction<boolean>>
  setHypothesesCadrage: React.Dispatch<React.SetStateAction<Record<string, HypotheseDeCadrage[]>>>
  setLiveRuns: React.Dispatch<React.SetStateAction<Record<string, ScopedLiveRun<OrchStep>>>>
  stopDemandeRef: React.RefObject<Set<string>>
  stoppedQueueDrainRef: React.RefObject<Set<string>>
  teteRetenueParLeVerrou: (id: string) => boolean
}

export function brancherLeChatAuMontage(ctx: MontageCtx): () => void {
  const {
    activeRef,
    busyConversationsRef,
    convsRef,
    enqueueMessage,
    liveMessagesRef,
    loadConv,
    lotsRetenusDansLeFil,
    patchLast,
    queueRef,
    recevoirElementCibleRef,
    refreshConvs,
    refreshFiches,
    refreshRuns,
    refreshRuntimeIdentity,
    relirePlansRef,
    rendreLaFileAuComposer,
    repriseDemarrageRef,
    runDuCadrageRef,
    send,
    setAppNotice,
    setCadrageReplie,
    setComptesClaude,
    setConversationQueue,
    setDefaultWorkspace,
    setFilDuMontagePose,
    setHypothesesCadrage,
    setLiveRuns,
    stopDemandeRef,
    stoppedQueueDrainRef,
    teteRetenueParLeVerrou
  } = ctx
  let disposed = false
  const selectionInitiale = Promise.resolve().then(async () => {
    await refreshConvs()
    // ALIGNEMENT AU MONTAGE : le main est la source de vérité de la conversation active. Le scout
    // de veille (et tout flux né hors du chat) sélectionne sa conversation PENDANT que cette vue
    // est démontée — l'événement de sélection n'a alors aucun auditeur, et la vue remontait sur
    // son ancienne sélection avec un panneau vide (mesuré le 14/08, conv-1164/1165).
    // DEMANDE EXPLICITE D'ABORD : un autre écran (la bulle d'un ticket) a pu demander une
    // conversation PENDANT que cette vue était démontée — l'événement n'avait alors aucun
    // auditeur. Cette demande déposée est PRIORITAIRE sur l'alignement ci-dessous, qui ouvrirait
    // la conversation active du main (la dernière créée) et volerait la sélection.
    const demandee = reclamerOuvertureConversation()
    let ouvertureHonoree = false
    if (!disposed && demandee) {
      const cible = convsRef.current.find((conversation) => conversation.id === demandee)
      if (cible) {
        await loadConv(cible)
        ouvertureHonoree = true
      }
    }
    try {
      const etat = ouvertureHonoree
        ? {}
        : ((await window.api.appState()) as { activeConversationId?: string })
      const cibleId = (etat as { activeConversationId?: string })?.activeConversationId
      if (!disposed && cibleId && cibleId !== activeRef.current) {
        const cible = convsRef.current.find((conversation) => conversation.id === cibleId)
        if (cible) await loadConv(cible)
      }
    } catch {
      // L'alignement est un confort : son échec ne doit pas empêcher la vue de fonctionner.
    }
    void refreshRuntimeIdentity()
    void Promise.resolve(window.api.behaviourComposition?.())
      .then((comp) => {
        if (!disposed && comp?.inspection?.workspace) {
          setDefaultWorkspace(comp.inspection.workspace)
        }
      })
      .catch(() => undefined)
  })
  // ÉLÉMENTS DÉSIGNÉS AVANT LE PREMIER AFFICHAGE DU CHAT (Alt+clic depuis une autre vue).
  // Le fil ouvert au démarrage n'est connu qu'après ces deux étapes : écouter plus tôt posait le
  // texte dans le brouillon « nouveau fil », que l'ouverture du dernier fil cachait aussitôt.
  let couperElementsCibles: (() => void) | undefined
  const ecouterLesElements = (): void => {
    if (disposed) return
    couperElementsCibles = ecouterElementsCibles((element) =>
      recevoirElementCibleRef.current?.(element)
    )
  }
  void selectionInitiale
    .then(() => repriseDemarrageRef.current)
    .catch((erreur: unknown) => traceSilentFailure('selection-initiale', erreur))
    .finally(() => {
      ecouterLesElements()
      if (!disposed) setFilDuMontagePose(true)
    })
  void Promise.resolve(window.api.workflowProfileNotice?.())
    .then((notice) => {
      if (!disposed && notice && typeof notice.text === 'string') {
        setAppNotice((current) => newestNotice(current, { text: notice.text, noticeId: notice.id }))
      }
    })
    .catch(() => undefined)
  // Les mutations faites par l'agent (bus) rafraîchissent les listes SANS toucher le fil.
  const deltaBatcher = createLiveRunDeltaBatcher<{
    convId: string
    runPath?: string
    delta: string
  }>(
    (batch) =>
      setLiveRuns((current) =>
        batch.reduce(
          (next, event) =>
            reduceScopedLiveRuns(next, {
              type: 'delta',
              convId: event.convId,
              runPath: event.runPath,
              delta: event.delta
            }),
          current
        )
      ),
    (flush) => window.setTimeout(flush, 50),
    (handle) => window.clearTimeout(handle)
  )
  /*
   * LE RAISONNEMENT DES SOUS-AGENTS, range sous sa phase dans le bloc Orchestration (
   * 2026-10-13). Il arrive par fragments de quelques mots, plusieurs par seconde : on les regroupe
   * le temps d'un court delai, puis UN seul patch par conversation, au lieu d'un re-rendu du fil
   * par fragment. Les fragments consecutifs d'une meme phase sont recolles avant d'etre ranges.
   */
  const raisonnementBatcher = createLiveRunDeltaBatcher<{
    convId: string
    phase?: string
    texte: string
  }>(
    (batch) => {
      const parConversation = new Map<string, Array<{ phase?: string; texte: string }>>()
      for (const item of batch) {
        const liste = parConversation.get(item.convId) ?? []
        const dernier = liste[liste.length - 1]
        if (dernier && dernier.phase === item.phase) dernier.texte += item.texte
        else liste.push({ phase: item.phase, texte: item.texte })
        parConversation.set(item.convId, liste)
      }
      for (const [convId, fragments] of parConversation)
        patchLast(
          convId,
          (m) => {
            let parts = m.parts
            for (const fragment of fragments)
              parts = ajouterRaisonnementDePipeline(
                parts,
                fragment.texte,
                fragment.phase
              ) as typeof m.parts
            m.parts = parts
          },
          porteUneOrchestrationOuverte
        )
    },
    (flush) => window.setTimeout(flush, 200),
    (handle) => window.clearTimeout(handle)
  )
  const offApp = window.api.onAppEvent((e) => {
    if (e.type !== 'orchestrate-delta') {
      deltaBatcher.flush()
      // Avant toute fin d'etape : le direct doit etre range AVANT que l'etape ne complete sa ligne.
      raisonnementBatcher.flush()
    }
    /*
     * LA LISTE DES RUNS SE RAFRAICHIT SEULE (demande du 2026-09-26 : « tout doit se rafraichir
     * tout seul »). Le bouton « Rafraichir » du panneau Détails a disparu ; il couvrait un trou :
     * le main n'emet `refresh/workflows` qu'en FIN de tour ou d'orchestration, alors que le RUN.md
     * naît au démarrage (`orchestrate-start`) et avance à chaque phase. On relit donc la liste à
     * ces battements, pour la seule conversation affichée. `refreshRuns` ignore d'elle-même une
     * réponse périmée : deux relectures rapprochées ne se marchent pas dessus.
     */
    if (
      (e.type === 'orchestrate-start' ||
        e.type === 'orchestrate-phase' ||
        e.type === 'orchestrate-step') &&
      e.convId &&
      e.convId === activeRef.current
    ) {
      void refreshRuns()
    }
    if (e.type === 'toast') {
      if (e.text) {
        const text = e.text
        setAppNotice((current) => newestNotice(current, { text, noticeId: e.noticeId }))
      }
    } else if (e.type === 'suite-depuis-notification') {
      /*
       * BOUTON DE SUITE DE LA NOTIFICATION DE FIN DE TOUR (2026-10-21) : la suite part
       * dans le fil DU TOUR comme un message tapé, sans changer le fil affiché ni vider son
       * brouillon. Fil encore occupé (un tour est reparti entre-temps) : elle attend en file et
       * part à la fin du tour, comme un message tapé pendant un tour.
       */
      const convId = e.convId
      const texte = typeof e.texte === 'string' ? e.texte.trim() : ''
      if (convId && texte) {
        if (busyConversationsRef.current.has(convId)) enqueueMessage(convId, texte)
        else void send(texte, { targetConversationId: convId, keepComposerDraft: true })
      }
    } else if (e.type === 'directives-orphelines') {
      /*
       * ORIENTATION ARRIVEE TROP TARD : le tour s'est termine sans jamais la lire.
       *
       * Le tour la jetait en silence (`run-pilot-chat.ts`, finally). Elle revient maintenant ici
       * et repart en FILE : le drain `busy→false` l'envoie comme un tour normal, donc elle finit
       * traitee au lieu d'etre perdue. Une mention le dit, comme le chemin `/skill` le fait deja.
       *
       * STOP RESPECTE : `enqueueMessage` leve le gel one-shot pose par un Stop (c'est voulu pour
       * un texte TAPE apres le Stop). Ici, personne n'a rien tape : reposer le gel garde la
       * promesse du bouton — Stop ne doit pas se faire relancer par une phrase deja a l'ecran.
       */
      const convId = e.convId
      const textes = (e.textes ?? []).filter((t) => typeof t === 'string' && t.trim())
      if (convId && textes.length) {
        const gele = stoppedQueueDrainRef.current.has(convId) || stopDemandeRef.current.has(convId)
        for (const texte of textes) enqueueMessage(convId, texte)
        if (gele) stoppedQueueDrainRef.current.add(convId)
        /*
         * APRES UN STOP, RENDUES AU COMPOSER — jamais gardees dans une file invisible.
         * 2026-10-02 : orientation `ts 1790960554261` pendant le tour 11229cd2, Stop,
         * puis elle revient ICI, apres que Stop a deja rendu la file au composer. Restee en file
         * (sans affichage), elle est partie seule a `ts 1790960868134` (tour b9f32631), alors que
         * l'utilisateur l'avait corrigee entre-temps (`ts 1790960608859`) : « ca a envoyé 2 fois ».
         */
        // fix-ok: le gel Stop etait consomme a la fin du tour 11229cd2, avant le retour des orientations non lues -> drain auto (tour b9f32631) ; test ChatView.orientation-orpheline-apres-stop rouge->vert
        if (gele) rendreLaFileAuComposer(convId)
        /*
         * DRAIN IMMEDIAT : l'effet de drain se declenche sur la transition `busy→false`, or cet
         * evenement arrive PRECISEMENT a la fin du tour — la transition peut etre deja passee.
         * Sans ce coup de pouce, la file resterait dormante jusqu'au prochain tour, et l'oubli
         * qu'on corrige se rejouerait sous une autre forme (message en attente que rien ne part).
         */
        // Des lots de sélection retenus par la limite de quota gardent la tête de la file : les
        // orientations attendent derrière eux, la reprise du fil les relâchera.
        const retenues = !gele && lotsRetenusDansLeFil(convId)
        // Cet événement part du `finally` du main, AVANT la réponse de `pilotChat` : le verrou
        // d'envoi est encore tenu, la tête attend donc sa levée.
        if (
          !gele &&
          !retenues &&
          convId === activeRef.current &&
          !busyConversationsRef.current.has(convId) &&
          !teteRetenueParLeVerrou(convId)
        ) {
          const enFile = queueRef.current.get(convId) ?? []
          const [tete, ...suite] = enFile
          if (tete) {
            setConversationQueue(convId, suite)
            // `targetConversationId` EXPLICITE : ce handler est monte une fois et capture un
            // `activeId` qui peut valoir null, alors que le fil vise bien cette conversation.
            void send(tete.text, {
              keepComposerDraft: true,
              automatique: true,
              targetConversationId: convId
            })
          }
        }
        // LE BANDEAU NOMME SON FIL : il est commun à la vue et survit au changement de
        // fil ; celui (Stop à 22:09:11) s'affichait au-dessus, dont le
        // tour tournait encore, et se lisait comme parlant de l'orientation.
        const titreDuFil =
          convsRef.current.find((conversation) => conversation.id === convId)?.title?.trim() ||
          convId
        const text = texteFil('orientation.apresFin', {
          titre: titreDuFil.length > 48 ? `${titreDuFil.slice(0, 47)}…` : titreDuFil,
          n: textes.length,
          suite: texteFil(
            gele
              ? 'orientation.remises'
              : retenues
                ? 'orientation.gardees'
                : 'orientation.renvoyees'
          )
        })
        setAppNotice((current) => newestNotice(current, { text }))
      }
    } else if (e.type === 'refresh') {
      if (e.scope === 'conversations') refreshConvs()
      // Un plan a changé (lot ouvert, fini, relancé) : la liste relit tous les plans en UN appel
      // Sans re-rendre la vue tant qu'aucun lien chef → lot ne change.
      if (e.scope === 'plans-de-lots') relirePlansRef.current()
      if (e.scope === 'workflows') {
        refreshRuns()
        // Écrite en fin de tour, une fiche neuve se montre sans rouvrir le fil.
        void refreshFiches()
      }
      if (e.scope === 'roles') refreshRuntimeIdentity()
      // Le compte Claude actif a change COTE MAIN (depart d'un tour, rotation sur quota epuise) :
      // la puce « compte actif » et la barre de quota parlaient encore de l'ancien.
      if (e.scope === 'claudeAccounts') {
        void window.api
          .claudeAccounts?.()
          .then((payload) => {
            if (payload && payload.accounts.length > 0) setComptesClaude(payload)
          })
          .catch((error: unknown) => traceSilentFailure('claude-accounts-refresh', error))
        window.dispatchEvent(new CustomEvent('autowin:quotas-stale'))
      }
      if (refreshesActiveConversation(e, activeRef.current)) {
        const id = activeRef.current!
        // Le fil affiché est GARDÉ comme repli : la relecture qui suit peut rendre un fil vide
        // (tour en vol non persisté) et effacerait sinon la conversation à l'écran.
        const filAffiche = liveMessagesRef.current.get(id)
        liveMessagesRef.current.delete(id)
        // `.catch` obligatoire : ce handler tourne à CHAQUE event `refresh` ; si la conversation a
        // été supprimée entre l'émission et l'appel (course normale), le rejet produisait un
        // unhandledRejection en usage courant. L'échec est ATTENDU ici (la conv n'existe plus) →
        // on l'absorbe sans message : rien à recharger, l'UI se met à jour par le refresh de liste.
        void window.api
          .conversation(id)
          .then((conversation) => {
            if (conversation && activeRef.current === id)
              void loadConv(conversation as Conv, filAffiche)
          })
          .catch(() => {})
      }
    } else if (e.type === 'orchestrate-start') {
      if (!e.convId) return
      setLiveRuns((current) =>
        reduceScopedLiveRuns(current, {
          type: 'start',
          convId: e.convId!,
          runPath: e.runPath,
          task: e.task ?? texteFil('fil.tache')
        })
      )
      // Le panneau NE s’ouvre PAS tout seul au démarrage d’une orchestration (jugé invasif) :
      // il reste à un clic, via « Détails » ou l’indicateur d’action en cours d’un message.
    } else if (e.type === 'orchestrate-phase' && e.phase && e.convId) {
      setLiveRuns((current) =>
        reduceScopedLiveRuns(current, {
          type: 'phase',
          convId: e.convId!,
          runPath: e.runPath,
          phase: e.phase as {
            step: string
            provider?: string
            role?: string
            model?: string
            reasoningEffort?: string
            phase?: string
            execution?: { groupId?: string }
          }
        })
      )
      /*
       * LE MEME SIGNAL PART DANS LE FIL — correctif du 2026-09-02.
       *
       * Ce qui precede n'alimentait que la carte du panneau Workflows : dans le chat,
       * « 1 action en cours · Orchestration » ne disait NI quelle phase tourne, NI quel modele
       * la joue, et l'etape n'offrait aucun chevron faute de resultat. On reutilise l'evenement
       * existant — en fabriquer un second ferait diverger deux verites sur le meme fait.
       */
      const choix = e.phase as {
        provider?: string
        role?: string
        model?: string
        phase?: string
        step?: string
        prompt?: OrchStep['prompt']
      }
      patchLast(
        e.convId,
        (m) => {
          m.parts = noterChoixDePipeline(m.parts, {
            phase: choix.phase ?? choix.step,
            role: choix.role,
            provider: choix.provider,
            model: choix.model,
            // Le prompt voyage AVEC le démarrage de phase : la ligne ne l'attend plus jusqu'à la fin.
            prompt: texteDuPrompt(choix.prompt)
          }) as typeof m.parts
        },
        porteUneOrchestrationOuverte
      )
    } else if (
      e.type === 'orchestrate-delta' &&
      typeof e.reasoning === 'string' &&
      e.reasoning &&
      e.convId
    ) {
      // Le raisonnement n'est NI le livrable (`delta`) NI une ligne d'etat (`note`) : il se range
      // sous sa phase, lisible en depliant le bloc Orchestration.
      raisonnementBatcher.enqueue({
        convId: e.convId,
        ...(e.reasoningPhase ? { phase: e.reasoningPhase } : {}),
        texte: e.reasoning
      })
    } else if (e.type === 'orchestrate-delta' && typeof e.note === 'string' && e.note && e.convId) {
      // NOTE d'activité : elle ne passe PAS par le batcher de deltas, qui accumule du livrable.
      // Elle remplace l'état courant, pour que la carte cesse d'être muette pendant qu'un outil
      // tourne 15 min — le défaut vécu le 2026-08-22, où l'utilisateur concluait à un blocage.
      const convId = e.convId
      const note = e.note
      setLiveRuns((current) =>
        reduceScopedLiveRuns(current, { type: 'note', convId, runPath: e.runPath, note })
      )
      /*
       * UN RUN REPRIS N'A PAS DE TOUR DE CHAT (2026-10-30). Un tour de chat pose cette
       * note dans la bulle par son battement (`action-progress`) ; une orchestration reprise par le
       * main après un redémarrage n'en envoie pas, et sa bulle restait muette 35 min (
       * spinner allumé). Fil non occupé = aucun tour de chat ne pilote cette ligne : l'écran la
       * pose lui-même sur l'orchestration encore ouverte. Fil occupé : le battement du tour suffit.
       */
      const fil = liveMessagesRef.current.get(convId) ?? []
      if (
        !busyConversationsRef.current.has(convId) &&
        fil.some((m) => m.role === 'assistant' && porteUneOrchestrationOuverte(m as AsstMsg))
      )
        patchLast(
          convId,
          (message) => {
            const ouverte = [...message.parts]
              .reverse()
              .find((part) => part.kind === 'action' && part.name === 'orchestrate')
            if (ouverte?.kind !== 'action' || !ouverte.actionId) return
            Object.assign(
              message,
              reduceAssistantPilotEvent(message, {
                kind: 'action-progress',
                actionId: ouverte.actionId,
                text: note
              })
            )
          },
          porteUneOrchestrationOuverte
        )
    } else if (e.type === 'orchestrate-delta' && typeof e.delta === 'string' && e.convId) {
      deltaBatcher.enqueue({ convId: e.convId, runPath: e.runPath, delta: e.delta })
    } else if (e.type === 'orchestrate-step' && e.step && e.convId) {
      const step = e.step as OrchStep
      setLiveRuns((current) =>
        reduceScopedLiveRuns(current, {
          type: 'step',
          convId: e.convId!,
          runPath: e.runPath,
          step
        })
      )
      /*
       * LA MEME ETAPE COMPLETE SA LIGNE DANS LE FIL (demande du 2026-09-03).
       *
       * Le battement de phase avait deja pose la ligne (« qui joue ») ; seul le step termine porte
       * le prompt envoye et, pour le controle final, la decision et son motif. On les rattache a
       * cette ligne au lieu d'ouvrir un second affichage : une seule verite, deux niveaux de zoom.
       */
      patchLast(
        e.convId,
        (m) => {
          m.parts = completerChoixDePipeline(m.parts, step) as typeof m.parts
        },
        porteUneOrchestrationOuverte
      )
    } else if (
      e.type === 'orchestrate-hypotheses' &&
      e.convId &&
      Array.isArray(e.hypotheses) &&
      e.hypotheses.length
    ) {
      const convId = e.convId
      const recues = e.hypotheses as HypotheseDeCadrage[]
      const run = typeof e.runPath === 'string' ? e.runPath : ''
      runDuCadrageRef.current[convId] = run
      setHypothesesCadrage((current) => ({ ...current, [convId]: recues }))
      setCadrageReplie((current) => {
        if (current[convId] === undefined || current[convId] === run) return current
        const suivant = { ...current }
        delete suivant[convId]
        return suivant
      })
    } else if (e.type === 'orchestrate-end' && e.convId) {
      const convId = e.convId
      const runPath = e.runPath
      /*
       * LES SUPPOSITIONS MEURENT AVEC LE RUN QUI LES PORTAIT.
       *
       * Leur pied dit « Le run continue — rien n'attend ta réponse ». Tant que rien ne les
       * effaçait, cette phrase survivait à la fin du run : le run se termine à
       * 16:31:43 (tour `24bf5294-7ab1-4104-aa0c-1c0f62009fb8`) et la capture jointe à la saisie
       * `ts` 1789233975928 (55 min plus tard) montre encore le bloc. L'utilisateur lisait donc
       * « ça continue » devant une application à l'arrêt.
       */
      setHypothesesCadrage((current) => {
        if (!current[convId]) return current
        const suivant = { ...current }
        delete suivant[convId]
        return suivant
      })
      setCadrageReplie((current) => {
        if (current[convId] === undefined) return current
        const suivant = { ...current }
        delete suivant[convId]
        return suivant
      })
      delete runDuCadrageRef.current[convId]
      setLiveRuns((current) =>
        reduceScopedLiveRuns(current, {
          type: 'end',
          convId,
          runPath,
          status: (e.status as 'green' | 'red') ?? 'green'
        })
      )
      /*
       * L'action d'orchestration recoit son issue ICI, du statut du run.
       *
       * Sans cela, le fil affichait « 1 action en cours » pendant que le panneau Sous-agents etait
       * vide : le badge lit les parts du tour, le panneau lit les runs vivants, et rien ne les
       * reconciliait. Le tour n'est PAS clos ici — le modele peut encore ecrire sa cloture apres
       * le retour de l'outil, et fermer maintenant tronquerait sa reponse.
       */
      patchLast(convId, (m) => {
        m.parts = settleOrchestrationOnRunEnd(
          m.parts,
          (e.status as 'green' | 'red') ?? 'green'
        ) as typeof m.parts
      })
      // Le run terminé RESTE dans la section Sous-agents avec son fil.
      //
      // Il y avait ici un `setTimeout(4000)` qui dispatchait `clear`, au motif que le run « rejoignait
      // la liste » : c'était faux pour le FIL, car `RunSummary` ne porte aucun step. Le fil était donc
      // détruit et rien ne le reprenait — alors qu'il est précisément la preuve de ce qui a été fait.
      // L'entrée est remplacée au prochain `start` de la même conversation : rien ne s'accumule.
    }
  })
  return () => {
    disposed = true
    couperElementsCibles?.()
    deltaBatcher.cancel()
    raisonnementBatcher.cancel()
    offApp()
  }
}
