import {
  type DemandeDeLancement,
  type SuiviDuLancement,
  type FilLance,
  type ConfirmationDeLancement,
  confirmerLancement,
  lancerAvecFilet,
  EVT_LANCER_EN_FILS
} from './proposition-fils-evenements'
import {
  texteFil,
  newestNotice,
  TOUR_VIVANT_SONDE_MS,
  STOP_REARMEMENT_MS,
  traceSilentFailure,
  hydraterFilStocke,
  NEW_DRAFT_KEY
} from './chat-view-outils'
import type {
  Conv,
  ChatAttachment,
  AsstMsg,
  QueuedDirective,
  DirectiveReceipt,
  Msg,
  SendOptions
} from './chat-view-types'
import { texteDeLaTache } from '../../../shared/lancer-en-fils'
import { useRef, useEffect, useCallback, useEffectEvent } from 'react'
import {
  attendreAvantReprise,
  deciderRepriseSurcharge,
  libelleReprise,
  libelleRenoncement
} from '../../../shared/reprise-surcharge'
import { askEnAttente } from './chat-message-keys'
import { parseBtw, hydrateStoredAssistant, suiviDuBasApresEnvoi } from './chat-view-model'
import {
  signatureTour,
  DUREE_MAX_SONDAGE_FIL,
  DELAI_SONDAGE_FIL,
  DUREE_MAX_SONDAGE_FICHIER,
  DELAI_SONDAGE_FICHIER,
  arretChaineAuto,
  toursAutoDAffilee,
  premierPassageLaisseSortirLeTour,
  attenteFichierAReprendre,
  dernierTourEstUnScout,
  deciderRelanceAuto,
  quotaHebdoClaude
} from './chat-auto-mode'
import { noterArretChaine } from './arrets-chaine-persistes'
import { formaterDate, langueCourante } from '../langue'
import { reprendreToutesApresRedemarrage } from './chat-reprise'
import type { SelectionAPlanifier } from '../../../shared/plan-de-lots'
import type { IssuePlanDeSelection } from './CandidatsPickPanel'
import {
  type LotDeLancement,
  redigerPromptsDuPlan,
  selectionAPlanifier,
  planDeLaSaisie
} from './veille-candidats-message'
import { traduireChatDecisions } from '../textes-ecrans/chat-decisions'
import { type TerminalStatus, buildRefineDraft } from './chat-resume-refine'
import { pieceJointePasseePourLeFil } from './chat-attachments'
import { ecrireToursAuto } from './tours-auto-persistes'
import { oublierPositionLecture } from './position-lecture'
import { titreDepuisPremierMessage } from './titre-conversation'
import { resolveMentionsForSend } from './chat-mentions'
import { filDeLaVueMontee } from './vue-chat-montee'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type ToursEtEnvoiCtx = {
  activeId: string | null
  activeRef: React.RefObject<string | null>
  annulerEnvoiEnAttente: (
    conversationId: string,
    receipt: import('./chat-view-types').DirectiveReceipt
  ) => void
  annulerRelanceProgrammee: (id: string) => void
  autoActif: boolean
  autoAllumageManuelRef: React.RefObject<boolean>
  autoArmePour: (id: string | null | undefined) => boolean
  autoConvs: Set<string>
  autoDiffereesRef: React.RefObject<Map<string, number>>
  autoEssaisRef: React.RefObject<Map<string, number>>
  autoEtatsRef: React.RefObject<Map<string, { tour: string | null; prompt: string | null }>>
  autoFilAmorceRef: React.RefObject<string | null>
  autoNouveauFilRef: React.RefObject<boolean>
  autoProgrammeesRef: React.RefObject<Map<string, { minuteur: number; signature: string }>>
  autoRepriseApresRedemarrageRef: React.RefObject<boolean>
  autoSuiviesRef: React.RefObject<Set<string>>
  autoTic: number
  brouillonPresent: boolean
  busy: boolean
  busyConversations: Set<string>
  busyConversationsRef: React.RefObject<Set<string>>
  compactionEnAttenteRef: React.RefObject<Set<string>>
  composerDraftKeyRef: React.RefObject<string>
  composerDraftsRef: React.RefObject<Map<string, import('./chat-view-types').ComposerDraft>>
  composerRef: React.RefObject<import('./ChatComposer').ChatComposerHandle | null>
  composerSelectionGenerationRef: React.RefObject<number>
  consommerDossierNouveauFil: () => void
  convs: import('./chat-view-types').Conv[]
  convsRef: React.RefObject<import('./chat-view-types').Conv[]>
  depotPresent: boolean
  dernierScrollTopRef: React.RefObject<number>
  desarmerAuto: (id: string | null | undefined) => void
  dossierNouveauFilRef: React.RefObject<string | null>
  drainApresVerrouRef: React.RefObject<Set<string>>
  drainerApresVerrou: (id: string) => void
  effacerArretAuto: (conversationId: string) => void
  enqueueMessage: (
    id: string,
    text: string,
    mode?: 'btw' | undefined,
    attachments?: import('./chat-view-types').ChatAttachment[] | undefined,
    origine?: Pick<import('./chat-view-types').QueuedDirective, 'lot'> | undefined
  ) => void
  envoyerALaSuite: (id: string, textes: readonly string[]) => void
  followTailRef: React.RefObject<boolean>
  forkFromMessage: (messageId: string) => Promise<void>
  gardeChaine: (id: string) => {
    quotaHebdoPct: number | null
    toursAutoDAffilee: number
    seuilsChaine: import('./chat-auto-mode').SeuilsChaineAuto
  }
  gesteLecteurRef: React.RefObject<boolean>
  getComposerDraft: (key: string) => import('./chat-view-types').ComposerDraft
  interruptingConversationsRef: React.RefObject<Set<string>>
  journaliserSaisie: (
    conversationId: string,
    texte: string,
    voie: 'message' | 'orientation',
    origine?: 'mode-auto' | undefined
  ) => void
  lancerCompactionAuto: (conversationId: string) => void
  liveMessagesRef: React.RefObject<Map<string, import('./chat-view-types').Msg[]>>
  liveRuns: Record<
    string,
    import('./chat-view-model').ScopedLiveRun<import('./chat-view-model').OrchStep>
  >
  loadConv: (
    c: import('./chat-view-types').Conv,
    filDeRepli?: readonly import('./chat-view-types').Msg[] | undefined
  ) => Promise<void>
  lotsRetenusDansLeFil: (id: string) => boolean
  mentionSourcesRef: React.RefObject<import('./chat-mentions').MentionSources>
  messages: import('./chat-view-types').Msg[]
  modifierEtRelancer: (messageId: string) => Promise<void>
  nextQueueEntryIdRef: React.RefObject<number>
  ouvrirDansMosaique: (id: string) => Promise<void>
  patchLast: (
    conversationId: string,
    fn: (m: import('./chat-view-model').HydratedAssistantMessage) => void,
    porte?: ((m: import('./chat-view-model').HydratedAssistantMessage) => boolean) | undefined
  ) => void
  poserCompteArme: (conversationId: string) => Promise<void>
  poserModeleArme: (conversationId: string) => Promise<void>
  positionARestaurerRef: React.RefObject<import('./position-lecture').PositionLecture | null>
  publierFil: (conversationId: string | null, fil: import('./chat-view-types').Msg[]) => void
  queueRef: React.RefObject<Map<string, import('./chat-view-types').QueuedDirective[]>>
  quotaHebdoRef: React.RefObject<number | null>
  refreshRuntimeIdentity: (
    forceModels?: boolean
  ) => Promise<import('./chat-view-model').ChatRuntimeIdentity>
  retirerDirectiveReceipt: (conversationId: string, entryId: number) => void
  revenirAuTour: (messageId: string) => Promise<void>
  scrollRef: React.RefObject<HTMLDivElement | null>
  sendLocksRef: React.RefObject<Set<string>>
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>
  setAppNotice: React.Dispatch<React.SetStateAction<import('./chat-view-outils').AppNotice | null>>
  setArretsAuto: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setAtterrissageDemande: React.Dispatch<React.SetStateAction<number>>
  setAutoConvs: React.Dispatch<React.SetStateAction<Set<string>>>
  setAutoNouveauFil: React.Dispatch<React.SetStateAction<boolean>>
  setAutoTic: React.Dispatch<React.SetStateAction<number>>
  setConversationBusy: (id: string, value: boolean) => void
  setConversationInterrupting: (id: string, value: boolean) => void
  setConversationQueue: (id: string, next: import('./chat-view-types').QueuedDirective[]) => void
  setConvs: React.Dispatch<React.SetStateAction<import('./chat-view-types').Conv[]>>
  setConvViewMode: React.Dispatch<React.SetStateAction<'list' | 'mosaic'>>
  setDirectiveReceipt: (
    conversationId: string,
    entry: import('./chat-view-types').QueuedDirective,
    status: 'failed' | 'sending' | 'sent' | 'differee' | 'attente',
    reponse?: boolean | undefined,
    attente?:
      Pick<import('./chat-view-types').DirectiveReceipt, 'attenteMotif' | 'commande'> | undefined
  ) => void
  setDraftAttachments: (
    key: string,
    update: (
      current: import('./chat-view-types').ChatAttachment[]
    ) => import('./chat-view-types').ChatAttachment[]
  ) => void
  setDraftError: (key: string, error: string | null) => void
  setDraftInput: (key: string, value: string) => void
  setHasNewActivity: React.Dispatch<React.SetStateAction<boolean>>
  setQuotaHebdoConnu: React.Dispatch<React.SetStateAction<boolean>>
  setScrolledAwayFromTail: React.Dispatch<React.SetStateAction<boolean>>
  stopDemandeRef: React.RefObject<Set<string>>
  stoppedQueueDrainRef: React.RefObject<Set<string>>
  teteRetenueParLeVerrou: (id: string) => boolean
  texteDuComposer: () => string
  toursAutoRef: React.RefObject<Map<string, number>>
  vueMonteeRef: React.RefObject<boolean>
}

// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useToursEtEnvoi(ctx: ToursEtEnvoiCtx) {
  const {
    activeId,
    activeRef,
    annulerEnvoiEnAttente,
    annulerRelanceProgrammee,
    autoActif,
    autoAllumageManuelRef,
    autoArmePour,
    autoConvs,
    autoDiffereesRef,
    autoEssaisRef,
    autoEtatsRef,
    autoFilAmorceRef,
    autoNouveauFilRef,
    autoProgrammeesRef,
    autoRepriseApresRedemarrageRef,
    autoSuiviesRef,
    autoTic,
    brouillonPresent,
    busy,
    busyConversations,
    busyConversationsRef,
    compactionEnAttenteRef,
    composerDraftKeyRef,
    composerDraftsRef,
    composerRef,
    composerSelectionGenerationRef,
    consommerDossierNouveauFil,
    convs,
    convsRef,
    depotPresent,
    dernierScrollTopRef,
    desarmerAuto,
    dossierNouveauFilRef,
    drainApresVerrouRef,
    drainerApresVerrou,
    effacerArretAuto,
    enqueueMessage,
    envoyerALaSuite,
    followTailRef,
    forkFromMessage,
    gardeChaine,
    gesteLecteurRef,
    getComposerDraft,
    interruptingConversationsRef,
    journaliserSaisie,
    lancerCompactionAuto,
    liveMessagesRef,
    liveRuns,
    loadConv,
    lotsRetenusDansLeFil,
    mentionSourcesRef,
    messages,
    modifierEtRelancer,
    nextQueueEntryIdRef,
    ouvrirDansMosaique,
    patchLast,
    poserCompteArme,
    poserModeleArme,
    positionARestaurerRef,
    publierFil,
    queueRef,
    quotaHebdoRef,
    refreshRuntimeIdentity,
    retirerDirectiveReceipt,
    revenirAuTour,
    scrollRef,
    sendLocksRef,
    setActiveId,
    setAppNotice,
    setArretsAuto,
    setAtterrissageDemande,
    setAutoConvs,
    setAutoNouveauFil,
    setAutoTic,
    setConversationBusy,
    setConversationInterrupting,
    setConversationQueue,
    setConvs,
    setConvViewMode,
    setDirectiveReceipt,
    setDraftAttachments,
    setDraftError,
    setDraftInput,
    setHasNewActivity,
    setQuotaHebdoConnu,
    setScrolledAwayFromTail,
    stopDemandeRef,
    stoppedQueueDrainRef,
    teteRetenueParLeVerrou,
    texteDuComposer,
    toursAutoRef,
    vueMonteeRef
  } = ctx
  /**
   * « LANCER EN N FILS » (2026-10-25 — option A du cadrage
   * `fork-automatique-taches-independantes`). Le message de l'utilisateur portait plusieurs tâches
   * d'action. L'agent les a regroupées par fichiers communs (```aw-fils, `PropositionDeFils.tsx`),
   * et l'utilisateur a cliqué.
   *
   * « fils » : une BRANCHE du fil d'origine par groupe. Elle part du message de l'utilisateur qui
   * précède la carte, donc avec l'historique et le dossier de travail du fil. `create_conversation`
   * ne porte ni l'un ni l'autre. Chaque branche reçoit SA première tâche, et les suivantes du groupe
   * (mêmes fichiers) passent à la suite dans la même branche. Les branches travaillent dans le
   * dossier partagé, comme deux fils ouverts à la main. Une prévision de fichiers fausse est arrêtée
   * par la réservation des fichiers entre fils (`shared/reservation-fichiers.ts`), sans rien écraser.
   * « ici » : toutes les tâches à la suite, dans le fil d'origine.
   */
  async function lancerEnFils(
    demande: DemandeDeLancement,
    suivi: SuiviDuLancement = { fils: [], confirme: false }
  ): Promise<void> {
    const source = demande.conversationId ?? activeRef.current
    // `rienNestParti` : refus AVANT toute dépense, la carte rend ses boutons.
    const confirmer = (fils: FilLance[], refus: string[], rienNestParti = false): void => {
      const detail: ConfirmationDeLancement = {
        cle: demande.cle,
        mode: demande.mode,
        fils,
        ...(refus.length ? { refus } : {}),
        ...(rienNestParti ? { rienNestParti: true as const } : {})
      }
      confirmerLancement(detail)
      suivi.confirme = true
    }
    const toutes = demande.plan.flatMap((fil) => fil.taches)
    if (!source || toutes.length === 0) {
      confirmer([], [texteFil('fils.origineIntrouvable')], true)
      return
    }
    if (demande.mode === 'ici' || demande.plan.length < 2) {
      envoyerALaSuite(
        source,
        toutes.map((tache) => tache.demande)
      )
      confirmer([], [])
      setAppNotice((current) =>
        newestNotice(current, {
          text: texteFil('fils.aLaSuite', { n: toutes.length })
        })
      )
      return
    }
    // Le point de départ se lit dans le fil STOCKÉ, pas dans la copie à l'écran : une réponse
    // peinte en direct dans une fenêtre que rien n'a relue n'a pas d'identifiant de message, ni la
    // demande qui la précède (relecture externe du 2026-10-25). Le TOUR, lui, est le
    // même à l'écran et sur disque.
    let filStocke: Array<{ role: string; messageId?: string; turnId?: string }>
    try {
      const detail = (await window.api.conversation(source)) as {
        messages?: typeof filStocke
      } | null
      filStocke = detail?.messages ?? []
    } catch (erreur) {
      const raison = erreur instanceof Error ? erreur.message : String(erreur)
      confirmer([], [texteFil('fils.origineIllisible', { raison })], true)
      return
    }
    const parMessage = demande.messageId
      ? filStocke.findIndex((message) => message.messageId === demande.messageId)
      : -1
    const rangCarte =
      parMessage >= 0 || !demande.turnId
        ? parMessage
        : filStocke.findIndex(
            (message) => message.role === 'assistant' && message.turnId === demande.turnId
          )
    // Réponse introuvable sur disque = RIEN NE PART (3e relecture externe). Avant, le
    // lancement repartait en silence du DERNIER message de l'utilisateur de tout le fil, peut-être
    // écrit après la carte (« attends, ne fais rien »).
    if (rangCarte < 0) {
      confirmer([], [texteFil('fils.reponseIntrouvable')], true)
      return
    }
    const ancre = [...filStocke.slice(0, rangCarte)]
      .reverse()
      .find((message) => message.role === 'user' && message.messageId)?.messageId
    if (!ancre) {
      confirmer([], [texteFil('fils.messageIntrouvable')], true)
      return
    }
    // Partagée avec le filet (`lancerAvecFilet`) : une erreur imprévue nomme les fils déjà ouverts.
    const lances: FilLance[] = suivi.fils
    const envois: Array<{ id: string; textes: string[] }> = []
    const refus: string[] = []
    for (const [rang, prevu] of demande.plan.entries()) {
      const titre = prevu.taches.map((tache) => tache.titre).join(' + ')
      try {
        const branche = (await window.api.conversationsFork(source, ancre)) as Conv | undefined
        if (!branche?.id) {
          refus.push(texteFil('fils.brancheRefusee', { rang: rang + 1, titre }))
          continue
        }
        // Le titre est un confort : la branche EXISTE déjà. Un renommage refusé ne doit pas la
        // laisser vide dans la barre latérale, sans tâche (défaut 4 du juge).
        try {
          await window.api.conversationsRename?.(branche.id, titre)
        } catch {
          // La branche garde son titre « Copie de … » et reçoit quand même sa tâche.
        }
        const autres = toutes.filter((tache) => !prevu.taches.includes(tache))
        lances.push({ id: branche.id, titre })
        envois.push({
          id: branche.id,
          textes: prevu.taches.map((tache) => texteDeLaTache(tache, autres))
        })
      } catch (erreur) {
        const raison = erreur instanceof Error ? erreur.message : String(erreur)
        refus.push(texteFil('fils.refus', { rang: rang + 1, titre, raison }))
      }
    }
    if (lances.length > 0) {
      // Rafraîchir la liste est un confort, pas une condition : les branches existent déjà. Une
      // liste en panne laissait les branches vides et la carte figée sur « Lancement demandé… »
      // (défaut 3 du juge).
      try {
        const fraiches = (await window.api.conversations()) as Conv[]
        convsRef.current = fraiches
        setConvs(fraiches)
      } catch {
        // La barre latérale se mettra à jour au prochain rafraîchissement diffusé par le main.
      }
      setConvViewMode('mosaic')
      // Le fil d'ORIGINE reste sous les yeux, à gauche des branches : sa carte y montre le reçu et
      // les liens (demande du 2026-10-25). Déjà ouvert en mosaïque = laissé à sa place.
      await ouvrirDansMosaique(source)
    }
    for (const { id, textes } of envois) {
      await ouvrirDansMosaique(id)
      envoyerALaSuite(id, textes)
    }
    // Aucune branche créée : rien n'est parti, la carte rend ses boutons.
    confirmer(lances, refus, lances.length === 0)
    // L'avis compte ce qui est PARTI, pas ce qui était prévu : il annonçait « 0 fil lancé… Coût :
    // N tours » quand toutes les branches étaient refusées, et le coût des branches refusées lors d'un
    // lancement partiel (4e relecture externe). Il dit la même chose que la carte.
    const parties = envois.reduce((somme, envoi) => somme + envoi.textes.length, 0)
    const texte =
      lances.length === 0
        ? texteFil('fils.rienParti', {
            raisons: refus.join(' · ') || texteFil('fils.aucuneBranche')
          })
        : texteFil(lances.length > 1 ? 'fils.lances' : 'fils.lance', {
            n: lances.length,
            fils: lances.map((fil) => `${fil.titre} (${fil.id})`).join(' · ')
          }) +
          (parties > lances.length ? ` ${texteFil('fils.memesFichiers')}` : '') +
          ` ${texteFil(parties > 1 ? 'fils.couts' : 'fils.cout', { n: parties })}` +
          (refus.length ? ` ${texteFil('fils.nonParti', { refus: refus.join(' · ') })}` : '')
    setAppNotice((current) => newestNotice(current, { text: texte }))
  }
  const lancerEnFilsRef = useRef(lancerEnFils)
  lancerEnFilsRef.current = lancerEnFils
  useEffect(() => {
    const surDemande = (event: Event): void => {
      const demande = (event as CustomEvent<DemandeDeLancement>).detail
      if (!demande?.plan) return
      // Dernier filet (`lancerAvecFilet`) : une erreur imprévue répond quand même à la carte, avec
      // les fils déjà ouverts ; un reçu déjà donné n'est jamais écrasé.
      void lancerAvecFilet((aLancer, suivi) => lancerEnFilsRef.current(aLancer, suivi), demande)
    }
    window.addEventListener(EVT_LANCER_EN_FILS, surDemande)
    return () => window.removeEventListener(EVT_LANCER_EN_FILS, surDemande)
  }, [])
  /**
   * REPRISE APRÈS SURCHARGE DU MODÈLE (529) — demande utilisateur du 2026-09-03 : « quand le modèle
   * renvoie une erreur 529, forke la conversation et reprends (max 3 tentatives) ».
   *
   * Le fournisseur a refusé de répondre : la demande, elle, est intacte. On la rejoue dans une COPIE
   * de la conversation — l'original garde la trace de l'échec, la copie repart propre juste avant la
   * demande. Cousin de `promptDeRelanceGratuite`, qui couvre l'autre trou : le tour tué sans rien
   * produire. La décision (est-ce une surcharge ? reste-t-il des reprises ?) vit dans
   * `shared/reprise-surcharge.ts`, pure et testée ; ici on ne fait que l'appliquer.
   */
  async function relancerApresSurcharge(
    conversationId: string,
    texte: string,
    pieces: ChatAttachment[],
    reprise: { tentative: number; attenteMs: number; ancre?: string }
  ): Promise<void> {
    // Le CLI a déjà retenté ~10 fois pendant 2-3 min : repartir dans la seconde retomberait sur la
    // même surcharge. L'attente croît d'une reprise à l'autre.
    await attendreAvantReprise(reprise.attenteMs)
    let cible = conversationId
    if (reprise.ancre) {
      try {
        const copie = (await window.api.conversationsFork(conversationId, reprise.ancre)) as
          Conv | undefined
        const fraiches = (await window.api.conversations()) as Conv[]
        setConvs(fraiches)
        const ouverte = copie?.id ? fraiches.find((c) => c.id === copie.id) : undefined
        if (ouverte) {
          await loadConv(ouverte)
          cible = ouverte.id
        }
      } catch {
        // Copie impossible : on rejoue dans la conversation d'origine plutôt que d'abandonner.
      }
    }
    await send(texte, {
      targetConversationId: cible,
      keepComposerDraft: true,
      automatique: true,
      piecesJointesImposees: pieces,
      repriseSurcharge: reprise.tentative
    })
  }

  /**
   * PARITÉ claude.exe (demande du 2026-08-21) : le message tapé pendant un tour ORIENTE le tour en
   * cours, il n'est PLUS mis en file. C'est exactement le chemin `/btw` — même IPC `injectDirective`,
   * même reçu — donc plus deux comportements pour un seul geste. La file survit uniquement comme
   * REPLI de `submitBtw` quand l'injection est refusée (rien n'est perdu), et ses actions manuelles
   * (🧭 Orienter, ⏹ Interrompre et envoyer) restent disponibles sur ces entrées de repli.
   */
  function queueCurrentMessage(): void {
    if (!activeId) return
    const input = texteDuComposer()
    // IMAGE SEULE pendant un tour : `trim()` seul jetait le geste en silence — le composer gardait
    // l'image, rien ne partait, et le message n'arrivait jamais (constate le 2026-09-17). Une piece
    // jointe EST un message, meme sans texte : elle part en file avec le tour en cours.
    if (!input.trim() && getComposerDraft(composerDraftKeyRef.current).attachments.length === 0)
      return
    // Une question `ask` encore ouverte au bout du fil : ce texte y REPOND, meme tape a la main.
    // Sans ce test, seul le clic sur un bouton comptait comme reponse et le reçu disait « Orienté ».
    void submitBtw(input, 'normal', askEnAttente(liveMessagesRef.current.get(activeId) ?? []))
  }

  /**
   * TOUR FANTOME : le renderer se croit occupe, le main dit que rien ne tourne.
   *
   * `os:pilotChat:cancel` rend `{ ok: pilotAborted || orchestrationAborted }` : un `ok: false` n'est
   * pas un echec d'annulation, c'est la PREUVE — venant du processus qui detient la verite — qu'il
   * n'y avait aucun tour ni orchestration a couper. Cette reponse etait jetee : on ne relachait que
   * le libelle « Arret… » en laissant `busy` arme. Consequences vecues par l'utilisateur le 20/08 :
   * l'indicateur « 1 action en cours » restait colle alors que le panneau Sous-agents etait vide,
   * les messages tapes partaient EN FILE au lieu d'etre envoyes, et le bouton Stop ne pouvait plus
   * rien debloquer — la conversation etait definitivement muette.
   *
   * On passe par `patchLast`, l'entonnoir unique : `done = true` y declenche `settleIfDone`, donc les
   * actions sans issue deviennent `interrupted` et cessent de se lire « en cours ». L'issue ne
   * viendra jamais — le dire est la verite, la maquiller en echec constate (`ok: false`) serait faux.
   */
  /**
   * Le tour tourne-t-il ENCORE cote processus principal alors que sa promesse d'envoi est revenue ?
   *
   * Symptome vecu (2026-09-23) : « Reponse interrompue avant la fin » s'affichait, puis la
   * reponse repartait toute seule. Cause : les `finally` d'envoi et de reprise marquaient le tour
   * `interrupted` sur la seule fin de la promesse, sans demander a l'autorite (`pilotChatActive`)
   * si le tour vivait encore — puis `resumed`/les deltas le rallumaient. Choix utilisateur : garder
   * le tour « en cours » jusqu'a sa vraie fin. Un tour reellement mort est clos par la VEILLE
   * (deux sondes negatives -> `libererTourFantome`). Sonde absente/en echec = pas de preuve de vie.
   */
  async function tourEncoreVivant(id: string): Promise<boolean> {
    const dernier = [...(liveMessagesRef.current.get(id) ?? [])]
      .reverse()
      .find((message) => message.role === 'assistant') as AsstMsg | undefined
    if (!dernier || dernier.done || dernier.status !== 'streaming') return false
    try {
      return (await window.api.pilotChatActive?.(id))?.active === true
    } catch {
      return false
    }
  }

  function libererTourFantome(id: string): void {
    setConversationInterrupting(id, false)
    if (!busyConversationsRef.current.has(id)) return
    setConversationBusy(id, false)
    /**
     * Le VERROU D'ENVOI aussi, sans quoi la conversation reste muette par un autre chemin.
     *
     * `sendLocksRef` n'est relache que dans le `finally` de l'envoi, donc a la resolution de l'appel
     * IPC. Or c'est precisement ce cas-la qu'on traite : le main affirme que rien ne tourne pendant
     * que la promesse du renderer, elle, ne revient pas. Liberer `busy` sans liberer le verrou rend
     * l'interface debloquee EN APPARENCE — le bouton Envoyer repond, et il ne part rien. Le defaut
     * du 20/08 se serait rejoue d'un cran plus bas, en plus silencieux.
     *
     * Sur : le verrou existe pour empecher un DOUBLE envoi ; quand l'autorite dit qu'aucun tour ne
     * tourne, un second envoi est legitime. Si la promesse d'origine revient plus tard, son `finally`
     * supprime une cle deja absente — sans effet.
     */
    sendLocksRef.current.delete(id)
    patchLast(id, (message) => {
      message.done = true
      if (message.status === 'streaming') message.status = 'interrupted'
    })
  }

  /**
   * VEILLE sur les tours declares vivants : la sonde d'autorite tire aussi SANS changer de vue.
   *
   * DEFAUT VECU le 20/08 : « la conversation affiche une action en cours quand le workflow est
   * arrete ». La reconciliation existait deja (`reconcilierTourNonClos`, `libererTourFantome`) mais
   * ses deux seuls declencheurs sont l'OUVERTURE d'une conversation et un geste Stop. Sur la
   * conversation deja ouverte — celle qu'on regarde — un tour qui meurt sans rendre son evenement de
   * fin (workflow arrete, evenement perdu, main redemarre) n'etait interroge par personne : le badge
   * tournait jusqu'a un changement de conversation ou un redemarrage de l'app.
   *
   * DEUX sondes negatives consecutives sont exigees avant de clore : le renderer passe `busy` AVANT
   * que le main ait enregistre le controleur du tour (meme course que le `waitForActive(500)` de
   * l'injection), donc une seule sonde pourrait tuer un tour qui demarre.
   *
   * La liberation passe par un `useEffectEvent` : elle lit la DERNIERE version de
   * `libererTourFantome` sans relancer la veille a chaque rendu — la relancer remettrait a zero le
   * compte des sondes negatives, et un fil qui se redessine souvent ne serait jamais libere.
   */
  const libererTourFantomeDepuisLaVeille = useEffectEvent((id: string) => libererTourFantome(id))
  useEffect(() => {
    if (!busyConversations.size) return
    const manques = new Map<string, number>()
    const timer = window.setInterval(() => {
      for (const id of busyConversationsRef.current) {
        void (async () => {
          let active: boolean
          try {
            const sonde = await window.api.pilotChatActive?.(id)
            // Sonde absente ou en echec : on ne declare pas mort ce qu'on n'a pas pu verifier.
            if (sonde?.active !== false) {
              manques.delete(id)
              return
            }
            active = false
          } catch {
            manques.delete(id)
            return
          }
          if (active) return
          const negatives = (manques.get(id) ?? 0) + 1
          manques.set(id, negatives)
          if (negatives < 2) return
          manques.delete(id)
          libererTourFantomeDepuisLaVeille(id)
        })()
      }
    }, TOUR_VIVANT_SONDE_MS)
    return () => window.clearInterval(timer)
  }, [busyConversations, busyConversationsRef])

  /**
   * BORNE le libelle « Arret... ».
   *
   * DEFAUT VECU : `cancelPilotChat` repond `ok: true` (l'annulation A ete prise en charge) mais le
   * tour ne meurt pas — le pilote est bloque dans un appel provider ou dans `orchestrate`, sur
   * lequel l'abort n'a aucune prise. `interrupting` n'est alors relache par PERSONNE : le bouton
   * reste ecrit « Arret... », DESACTIVE, pour toujours — l'utilisateur ne peut meme plus recliquer.
   *
   * On ne masque pas la cause (le tour tourne vraiment) : on rend seulement la MAIN. Passe le delai,
   * si le tour est encore vivant, le bouton redevient cliquable pour un second Stop ; la veille des
   * tours fantomes reste seule juge de la liberation de `busy`.
   */
  function armerReprisesStop(id: string): void {
    window.setTimeout(() => {
      if (!interruptingConversationsRef.current.has(id)) return
      if (!busyConversationsRef.current.has(id)) return
      setConversationInterrupting(id, false)
    }, STOP_REARMEMENT_MS)
  }

  /**
   * Remet les messages encore en file dans le composer de la conversation `id`, puis vide la file.
   * Seule porte de sortie depuis que la file n'a plus d'affichage : appelee par Stop, qui gele le
   * drain. Si la conversation visee n'est pas celle affichee, on laisse la file tranquille — elle
   * repartira d'elle-meme au prochain tour.
   */
  function rendreLaFileAuComposer(id: string): void {
    if (id !== activeRef.current) return
    const enFile = queueRef.current.get(id) ?? []
    if (enFile.length === 0) return
    const draftKey = composerDraftKeyRef.current
    const draft = getComposerDraft(draftKey).input
    const textes = enFile.map((entree) => entree.text)
    setDraftInput(draftKey, [draft, ...textes].filter(Boolean).join('\n\n'))
    setConversationQueue(id, [])
  }

  /** Stop simple : annule le tour sans transformer la file en relance automatique. */
  /** `cible` : en mosaique, Stop vise SA fenetre — sinon il couperait le tour de la conversation active. */
  function stopPilotTurn(cible?: string): void {
    const id = cible ?? activeRef.current
    if (
      !id ||
      interruptingConversationsRef.current.has(id) ||
      !busyConversationsRef.current.has(id)
    )
      return
    stoppedQueueDrainRef.current.add(id)
    stopDemandeRef.current.add(id)
    // LA FILE N'A PLUS D'AFFICHAGE (panneau retire le 2026-09-17) : un Stop gele son drain, donc
    // sans cette restitution les messages en attente deviendraient INATTEIGNABLES — invisibles et
    // jamais envoyes. Ils reviennent donc dans le composer, ou l'utilisateur les voit et decide.
    rendreLaFileAuComposer(id)
    /*
     * STOP DESARME AUSSI LA CHAINE AUTO — sinon le bouton relance ce qu'il vient de couper.
     *
     * Mesure du 2026-09-03 : quatre fils (214, 215, 221) portent mot pour mot « kaizen je
     * click sur stop et ca fait que de relancer la task ». Ce geste ne posait qu'un gel sur la FILE
     * des messages en attente ; l'interrupteur auto, lui, restait arme. Le tour coupe arrivait donc
     * dans le fil comme un tour TERMINE, `deciderRelanceAuto` y lisait une suite a envoyer, et
     * repartait — exactement la tache que l'utilisateur venait d'arreter.
     *
     * On eteint le fil VISE uniquement (`id`, pas le fil affiche) : les autres conversations armees
     * gardent leur reglage, comme pour la branche d'arret naturel de la boucle.
     */
    autoSuiviesRef.current.delete(id)
    autoEssaisRef.current.delete(id)
    desarmerAuto(id)
    setConversationInterrupting(id, true)
    // Même si l'IPC perd la course avec la fin réelle du tour, le geste Stop garde la file.
    // En revanche, libère le feedback « Arrêt… » si aucune annulation n'a été prise en charge.
    void window.api
      .cancelPilotChat(id)
      .then((result) => {
        if (result?.ok === false) libererTourFantome(id)
        else armerReprisesStop(id)
      })
      .catch(() => setConversationInterrupting(id, false))
  }

  /**
   * L'issue HONNETE d'une injection acceptee.
   *
   * `injectDirective` repond `ok` des que la directive est empilee et qu'un tour est actif. Mais un
   * RUN ne peut pas la lire : le pilote ne draine les directives qu'entre deux de ses iterations, et
   * pendant une orchestration il est bloque dans l'appel `orchestrate` — l'orchestrateur n'ayant
   * aucune prise dessus. Annoncer « Oriente » ici est ce qui faisait dire « j'ai oriente et rien ne
   * se passe » (20/08). On distingue donc les deux cas au lieu de les confondre.
   */
  function issueDeLInjection(conversationId: string): 'sent' | 'differee' {
    return liveRuns[conversationId]?.status === 'running' ? 'differee' : 'sent'
  }

  /**
   * `/btw <texte>` — parité CLAUDE CODE : écrire pendant que l'agent travaille LIVRE le message
   * DANS LE TOUR EN COURS (drainé à l'itération suivante du pilote), sans l'interrompre. Ce n'est
   * donc PAS une mise en file : l'agent en tient compte immédiatement.
   * Repli : si l'injection échoue (tour non injectable), on enfile pour ne rien perdre.
   * Idle (aucun tour) → envoi normal.
   */
  async function submitBtw(
    body: string,
    // Mode du REPLI en file si l'injection échoue. `/btw` garde 'btw' (« celui-là passe en dernier ») ;
    // un message ORDINAIRE tapé pendant le tour doit, lui, retomber en file NORMALE — sinon le repli
    // le marquait btw et l'ordre de la file mentait sur ce que l'utilisateur avait tapé.
    repli: 'btw' | 'normal' = 'btw',
    /** Ce texte repond a une question `ask` — le reçu doit dire « Répondu », pas « Orienté ». */
    reponse = false,
    /**
     * CIBLE explicite : en mosaique, la fenetre qui oriente n'est pas forcement la conversation
     * ACTIVE. Sans elle, « Orienter » d'une case n'injectait nulle part (onQueue etait un no-op).
     */
    cible?: string
  ): Promise<void> {
    const replimode: QueuedDirective['mode'] = repli === 'btw' ? 'btw' : undefined
    const text = body.trim()
    const cleDraft = cible ?? composerDraftKeyRef.current
    const id = cible ?? activeRef.current
    if (!id) return
    const occupe = cible ? busyConversationsRef.current.has(cible) : busy
    if (!text && getComposerDraft(cleDraft).attachments.length === 0) {
      setDraftInput(cleDraft, '') // "/btw" seul → rien à injecter, on nettoie
      return
    }
    // PIECES JOINTES : elles partent AVEC l'injection, dans le tour en cours (2026-09-23). Avant,
    // le message attendait la fin du tour en file, et l'utilisateur voyait « rien envoye » pendant
    // des minutes. Si l'injection est refusee, le repli reste la file AVEC les pieces jointes.
    const jointes = getComposerDraft(cleDraft).attachments
    if (occupe && jointes.length > 0) {
      journaliserSaisie(id, text, 'orientation')
      setDraftInput(cleDraft, '')
      setDraftAttachments(cleDraft, () => [])
      let accepte = false
      try {
        accepte = (await window.api.injectDirective(id, text, jointes))?.ok === true
      } catch (error) {
        traceSilentFailure('inject-directive:pieces-jointes', error)
      }
      if (!accepte) enqueueMessage(id, text, replimode, jointes)
      return
    }
    if (!occupe) {
      // aucun tour en cours → le texte part comme message normal
      void send(text, cible ? { targetConversationId: cible } : undefined)
      return
    }
    // AVANT le vidage du composer : passé cette ligne, ce texte n'existe plus nulle part ailleurs.
    journaliserSaisie(id, text, 'orientation')
    setDraftInput(cleDraft, '')
    // REÇU, comme `steerWithoutInterrupt` : les deux chemins appellent la MÊME IPC `injectDirective`,
    // et seul l'autre en rendait compte. Sans ce reçu, le texte quittait le composer et RIEN
    // n'apparaissait dans le fil — d'où « je clique et ça devrait m'envoyer le message et me donner une
    // réponse ». Une divergence entre deux chemins du même mécanisme, pas un oubli isolé.
    // Même compteur que la file : un reçu et une entrée de file ne doivent jamais partager un id,
    // sinon le repli en file (ci-dessous) écraserait le reçu qu'on vient de poser.
    const entry: QueuedDirective = { id: nextQueueEntryIdRef.current++, text, mode: replimode }
    setDirectiveReceipt(id, entry, 'sending', reponse)
    let injected = false
    // Le main ECRIT desormais un vrai message pour la directive acceptee et rend son identifiant.
    // C'est ce qui manquait : le recu ne vivait qu'en memoire de l'ecran, un rechargement l'effacait
    // et le texte disparaissait (2026-09-01).
    let messageEcrit = false
    // REFUS VOULU ≠ PANNE : l'app principale refuse EXPRÈS d'ajouter une commande de skill
    // à un tour en cours, et le dit. Seule une exception de l'IPC est une vraie erreur d'envoi.
    let erreurDEnvoi = false
    let attente: Pick<DirectiveReceipt, 'attenteMotif' | 'commande'> = {}
    try {
      const issue = await window.api.injectDirective(id, text)
      injected = issue?.ok === true
      messageEcrit = typeof issue?.messageId === 'string' && issue.messageId.length > 0
      if (!injected && issue?.motif === 'commande' && issue.commande)
        attente = { attenteMotif: 'commande', commande: issue.commande }
      else if (!injected && issue?.motif === 'hors-tour') attente = { attenteMotif: 'hors-tour' }
    } catch (error) {
      traceSilentFailure('inject-directive:btw', error)
      injected = false
      erreurDEnvoi = true
    }
    // Repli explicite : l'injection a échoué → file d'attente (drainée en fin de tour), rien n'est perdu.
    if (!injected) enqueueMessage(id, text, replimode)
    if (injected && messageEcrit) {
      // Le fil porte le texte pour de bon : le recu provisoire ferait doublon.
      retirerDirectiveReceipt(id, entry.id)
      return
    }
    setDirectiveReceipt(
      id,
      entry,
      injected ? issueDeLInjection(id) : erreurDEnvoi ? 'failed' : 'attente',
      reponse,
      attente
    )
  }
  /** True (et déclenche submitBtw) si le composer commence par `/btw` ; sinon false (submit normal). */
  function handleBtw(): boolean {
    const parsed = parseBtw(texteDuComposer())
    if (!parsed.isBtw) return false
    void submitBtw(parsed.body)
    return true
  }
  // À la libération de `busy` (render frais, busy=false), on draine la FILE D'ATTENTE — un message
  // par tour (chacun = sa propre paire Q/R). Vaut aussi bien pour l'auto-drain fin de tour que pour
  // une interruption manuelle (les deux passent par une transition busy→false).
  /*
   * fix-ok: 9 alertes exhaustive-deps mesurées (scripts/derogations-lint.mjs) : ces
   * effets lisaient des fonctions que ChatView recrée à chaque rendu (`send`, `gardeChaine`…). Les
   * mettre en dépendances relancerait un effet payant à chaque rendu ; les taire figeait la version
   * du rendu déclencheur. Le corps passe dans un `useEffectEvent` : il lit la dernière version, et
   * l'effet ne se relance que sur ses déclencheurs d'origine, listés à l'identique.
   */
  const drainerLaFileDuFilAffiche = useEffectEvent(() => {
    const id = activeRef.current
    if (!id) return
    if (busy) return
    if (interruptingConversationsRef.current.has(id)) setConversationInterrupting(id, false)
    if (stoppedQueueDrainRef.current.delete(id)) return
    const queued = queueRef.current.get(id)
    if (!queued || queued.length === 0) return
    // Le lot d'avant a buté sur la limite de quota : le suivant attend la reprise.
    if (lotsRetenusDansLeFil(id)) return
    // `done` est arrivé, la réponse de `pilotChat` pas encore : la tête attend le verrou.
    if (teteRetenueParLeVerrou(id)) return
    const [nextMessage, ...rest] = queued
    setConversationQueue(id, rest)
    // Le drain n'est PAS un geste de l'utilisateur : il ne doit rien prendre au composer.
    void send(nextMessage.text, {
      keepComposerDraft: true,
      automatique: true,
      ...(nextMessage.attachments?.length ? { piecesJointesImposees: nextMessage.attachments } : {})
    })
  })
  useEffect(() => {
    drainerLaFileDuFilAffiche()
    // `activeId` AUTANT que `busy` : une file remplie pendant le tour de A survit à un aller-retour
    // vers une autre conversation. Le tour de A se terminant PENDANT l'absence, la transition
    // busy→false ne concerne plus A — sans `activeId` la file restait échouée là, et il fallait
    // renvoyer les messages à la main. Sûr par construction : les files vivent dans un `useRef` (rien
    // sur disque), donc un redémarrage ne peut pas ressusciter une file oubliée et envoyer à l'insu.
  }, [busy, activeId])

  /**
   * CHANGEMENT DE FIL : le mode auto reste ALLUMÉ, mais il ne relance pas ce qu'il trouve.
   *
   * Le tour déjà présent à l'arrivée est marqué comme traité : il a pu être écrit il y a des
   * heures, et le relancer dépenserait un tour que personne n'a demandé. La boucle repart sur le
   * PROCHAIN tour terminé dans ce fil.
   */
  /**
   * LA BOUCLE DU MODE AUTO. Fin de tour ⇒ on relit la clôture de l'agent et on renvoie la suite
   * qu'il propose, jusqu'à ce que sa rubrique « 👉 Recommandé » dise « rien ».
   *
   * Rien n'est décidé ici : `deciderRelanceAuto` tranche, cet effet exécute. Un envoi automatique
   * coûte un tour payant : sa condition ne doit pas être éparpillée dans la vue.
   */
  /*
   * Ce que le minuteur relit AU MOMENT où il sonne (des heures plus tard) : jamais une valeur
   * capturée à la programmation.
   */
  const autoArmePourRef = useRef(autoArmePour)
  autoArmePourRef.current = autoArmePour
  const activeIdAutoRef = useRef(activeId)
  activeIdAutoRef.current = activeId
  const messagesAfficheAutoRef = useRef(messages)
  messagesAfficheAutoRef.current = messages
  const sendAutoRef = useRef(send)
  sendAutoRef.current = send

  /**
   * PROGRAMME une suite différée : elle part seule à son échéance, si rien n'a bougé entre-temps
   * (mode toujours armé, aucun tour en cours, et le dernier tour du fil est TOUJOURS celui qui l'a
   * proposée — un message de l'utilisateur entre-temps l'annule).
   */
  function programmerRelanceAuto(
    id: string,
    decision: {
      texte: string
      signature: string
      echeance: number
      fichier?: string
      filAttendu?: string
    },
    /** Re-sondage gratuit d'un fichier ou d'un fil attendu : ne consomme PAS une relance payée. */
    sondeDepuis?: number
  ): void {
    annulerRelanceProgrammee(id)
    const etat = autoEtat(id)
    etat.tour = decision.signature
    if (sondeDepuis === undefined)
      autoDiffereesRef.current.set(id, (autoDiffereesRef.current.get(id) ?? 0) + 1)
    const minuteur = window.setTimeout(
      () => {
        autoProgrammeesRef.current.delete(id)
        if (!autoArmePourRef.current(id)) return
        if (busyConversationsRef.current.has(id)) return
        const fil =
          id === activeIdAutoRef.current
            ? messagesAfficheAutoRef.current
            : (liveMessagesRef.current.get(id) ?? [])
        if (signatureTour(fil) !== decision.signature) return
        // fix-ok: « quand le tour de conv-N est terminé » n'était pas une suite différée
        // (`suiteEstDifferee` rendait false sur ef5762bf) : elle partait aussitôt et payait un tour.
        if (decision.filAttendu) {
          /*
           * « quand le tour de conv-N est terminé » : l'état du fil est demandé au
           * processus principal, gratuitement, AVANT de payer un tour. SEUL `active === false`
           * envoie : une réponse inconnue ne prouve rien. Mesuré : 2 tours payés pour
           * lire « pas terminé », fin vue 51 min en retard.
           */
          const filAttendu = decision.filAttendu
          const sonde = window.api.pilotChatActive
          if (!sonde) {
            setAppNotice({
              text: texteFil('auto.verifFilIndisponible', { fil: filAttendu })
            })
            return
          }
          void Promise.resolve(sonde(filAttendu))
            .catch(() => undefined)
            .then((etatDuFil) => {
              if (etatDuFil?.active === false) return envoyer()
              if (etatDuFil?.active !== true)
                console.warn('[mode-auto] vérification de fil sans réponse', filAttendu, etatDuFil)
              const debut = sondeDepuis ?? Date.now()
              if (Date.now() - debut >= DUREE_MAX_SONDAGE_FIL) {
                setAppNotice({
                  text: texteFil('auto.filToujoursPasFini', {
                    fil: filAttendu,
                    heures: Math.round(DUREE_MAX_SONDAGE_FIL / 3_600_000)
                  })
                })
                return
              }
              programmerRelanceAuto(
                id,
                { ...decision, echeance: Date.now() + DELAI_SONDAGE_FIL },
                debut
              )
            })
          return
        }
        // fix-ok: la relance « quand X existe » payait un tour même fichier absent (sendAutoRef appelé sans sonde) — on sonde fs:exists avant.
        if (decision.fichier && !window.api.fichierExiste) {
          // Sans vérificateur, « existe » est invérifiable : payer un tour pour le constater est le
          // défaut mesuré (14:38:57, fin.txt absent). On attend l'utilisateur, en le disant.
          setAppNotice({
            text: texteFil('auto.verifFichierIndisponible', { fichier: decision.fichier })
          })
          return
        }
        if (decision.fichier && window.api.fichierExiste) {
          /*
           * « quand fin.txt existe » : sonde gratuite (lecture seule, processus principal) AVANT de
           * payer un tour. Absent → on revient voir toutes les DELAI_SONDAGE_FICHIER, sans consommer
           * de relance payée, jusqu'à DUREE_MAX_SONDAGE_FICHIER (48 h) : au-delà, on arrête et on le dit.
           * SEUL un `true` envoie : `null` ou une erreur ne prouvent rien et ne paient donc pas de tour
           * (La relance partait sur tout ce qui n'était pas `false`).
           */
          const base = convsRef.current.find((c) => c.id === id)?.projectPath?.trim() || undefined
          const fichier = decision.fichier
          void Promise.resolve(window.api.fichierExiste(fichier, base))
            .catch(() => null)
            .then((present) => {
              if (present === true) return envoyer()
              if (present !== false)
                console.warn('[mode-auto] vérification de fichier sans réponse', fichier, present)
              // La sonde ne coûte rien : pas de plafond de relances, mais une borne de temps DITE.
              const debut = sondeDepuis ?? Date.now()
              if (Date.now() - debut >= DUREE_MAX_SONDAGE_FICHIER) {
                setAppNotice({
                  text: texteFil('auto.fichierToujoursAbsent', {
                    fichier,
                    heures: Math.round(DUREE_MAX_SONDAGE_FICHIER / 3_600_000)
                  })
                })
                return
              }
              programmerRelanceAuto(
                id,
                { ...decision, echeance: Date.now() + DELAI_SONDAGE_FICHIER },
                debut
              )
            })
          return
        }
        envoyer()
      },
      Math.max(0, decision.echeance - Date.now())
    )
    function envoyer(): void {
      if (!autoArmePourRef.current(id)) return
      if (busyConversationsRef.current.has(id)) return
      // Des messages attendent dans la file de CE fil (lots suivants d'une sélection scout, textes
      // tapés pendant le tour) : ils passent avant la suite du mode auto, qui reprendra sur leur fin
      // de tour. Sinon la suite proposée par l'agent s'intercalait entre deux lots.
      if ((queueRef.current.get(id)?.length ?? 0) > 0) return
      // Le minuteur sonne parfois des heures plus tard : le garde-fou de la chaîne est relu ICI.
      const g = gardeChaine(id)
      const fil =
        id === activeIdAutoRef.current
          ? messagesAfficheAutoRef.current
          : (liveMessagesRef.current.get(id) ?? [])
      const arret = arretChaineAuto({
        quotaHebdoPct: g.quotaHebdoPct,
        toursAutoDAffilee: Math.max(g.toursAutoDAffilee, toursAutoDAffilee(fil)),
        seuils: g.seuilsChaine
      })
      if (arret) {
        desarmerAuto(id)
        noterArretChaine(window.localStorage, id, arret.message)
        setArretsAuto((courant) => ({ ...courant, [id]: arret.message }))
        return
      }
      etat.prompt = decision.texte
      // Le fil est suivi : la fin de CE tour sera enchaînée, même s'il n'est pas affiché.
      autoSuiviesRef.current.add(id)
      void sendAutoRef.current(decision.texte, {
        keepComposerDraft: true,
        automatique: true,
        suiteDuModeAuto: true,
        targetConversationId: id
      })
    }
    autoProgrammeesRef.current.set(id, { minuteur, signature: decision.signature })
  }
  const heureLisible = (t: number): string =>
    formaterDate(t, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

  /** L'avancement de la boucle pour CE fil — créé à la demande, jamais partagé entre fils. */
  function autoEtat(conversationId: string): { tour: string | null; prompt: string | null } {
    const connu = autoEtatsRef.current.get(conversationId)
    if (connu) return connu
    const neuf = { tour: null, prompt: null }
    autoEtatsRef.current.set(conversationId, neuf)
    return neuf
  }
  // Corps en `useEffectEvent` (voir le vidage de file) : un envoi automatique coûte un
  // tour payant, l'effet ne doit se relancer que sur ses déclencheurs, jamais sur un rendu de plus.
  const avancerLaBoucleDuFilAffiche = useEffectEvent(() => {
    if (!autoActif || !activeId) return
    /*
     * PREMIER PASSAGE DANS CE FIL : on prend le tour déjà là comme point de départ, sans l'envoyer.
     *
     * Défaut vécu le 2026-09-02 (« quand je change de conversation ça enlève le mode auto ») : la
     * dernière réponse d'un fil qu'on rouvre peut dater de la veille. La relancer dépenserait un
     * tour que personne n'a demandé. Tant qu'aucune réponse n'est chargée (signature nulle), on ne
     * fige rien — sinon le fil encore en cours de chargement passerait pour un fil déjà traité.
     */
    const etat = autoEtat(activeId)
    if (autoFilAmorceRef.current !== activeId) {
      const signatureArrivee = signatureTour(messages)
      if (signatureArrivee === null) return
      autoFilAmorceRef.current = activeId
      etat.prompt = null
      // ALLUMAGE MANUEL : l'utilisateur clique EN VOYANT la suite proposée — c'est sa demande de
      // l'envoyer. On ne fige donc pas ce tour, on le laisse passer la porte de décision.
      const allumageManuel = premierPassageLaisseSortirLeTour({
        allumageManuel: autoAllumageManuelRef.current,
        repriseApresRedemarrage: autoRepriseApresRedemarrageRef.current,
        // ATTENTE DE FICHIER (2026-09-26) : un redémarrage tuait sa surveillance et ce gel la
        // rendait définitive, ∞ affiché allumé. Déjà surveillée (fil rouvert) → on ne la relance pas.
        attenteFichier:
          !autoProgrammeesRef.current.has(activeId) &&
          attenteFichierAReprendre({
            depotPresent,
            actif: true,
            occupe: busy,
            fil: messages,
            brouillonPresent,
            tourEstUnScout: dernierTourEstUnScout(messages),
            relancesDifferees: autoDiffereesRef.current.get(activeId) ?? 0
          }) !== null
      })
      autoAllumageManuelRef.current = false
      autoRepriseApresRedemarrageRef.current = false
      etat.tour = allumageManuel ? null : signatureArrivee
      if (!allumageManuel) return
    }
    const decision = deciderRelanceAuto({
      depotPresent,
      actif: true,
      occupe: busy,
      fil: messages,
      dernierTourTraite: etat.tour,
      dernierPromptEnvoye: etat.prompt,
      brouillonPresent,
      // Fil AFFICHÉ : une chaîne finie demande une nouvelle cible au lieu de couper l'interrupteur.
      proposerNouvelleCible: true,
      // APRES UN SCOUT : la suite ne part que si une ligne `CIBLE:` nomme UNE piste.
      tourEstUnScout: dernierTourEstUnScout(messages),
      relancesDifferees: autoDiffereesRef.current.get(activeId) ?? 0,
      ...gardeChaine(activeId)
    })
    if (decision.action === 'attendre') {
      return
    }
    if (decision.action === 'arreter') {
      // N'eteint QUE le fil affiche : les autres fils armes gardent leur reglage.
      desarmerAuto(activeId)
      // L'arret DIT sa raison : sans elle, le bouton ∞ s'allumait puis s'eteignait sans un mot.
      // Rangé dans CE fil : affiché seulement quand il est à l'écran.
      if (decision.raison === 'quota-hebdo' || decision.raison === 'tours-auto-max')
        noterArretChaine(window.localStorage, activeId, decision.message)
      setArretsAuto((courant) => ({ ...courant, [activeId]: decision.message }))
      return
    }
    if (decision.action === 'programmer') {
      programmerRelanceAuto(activeId, decision)
      setAppNotice({
        text: decision.fichier
          ? texteFil('auto.attendFichier', { fichier: decision.fichier })
          : decision.filAttendu
            ? texteFil('auto.attendFil', { fil: decision.filAttendu })
            : texteFil('auto.attendMoment', { quand: heureLisible(decision.echeance) })
      })
      return
    }
    autoDiffereesRef.current.delete(activeId)
    etat.tour = decision.signature
    etat.prompt = decision.texte
    // Comme le vidage de file : ce n'est pas un geste de l'utilisateur, le composer n'est pas touché.
    void send(decision.texte, { keepComposerDraft: true, automatique: true, suiteDuModeAuto: true })
  })
  useEffect(() => {
    avancerLaBoucleDuFilAffiche()
  }, [autoActif, activeId, busy, messages, brouillonPresent])

  /*
   * RELEVÉ DU QUOTA HEBDOMADAIRE CLAUDE pour le garde-fou ∞ : à l'ouverture, à chaque fin de tour et
   * toutes les 60 s — AVANT tout allumage de ∞, sinon le premier tour partirait quota inconnu. Coût
   * nul : l'indicateur de quotas relève déjà toutes les 60 s et le main garde 60 s en cache.
   * Un relevé en échec laisse la dernière valeur connue ; jamais relevé = inconnu, seul le compte de
   * tours peut alors arrêter la chaîne.
   */
  useEffect(() => {
    if (typeof window.api?.modelQuotas !== 'function') return
    let vivant = true
    const relever = (): void => {
      void Promise.resolve(window.api.modelQuotas())
        .then((snapshot) => {
          const pct = quotaHebdoClaude(snapshot)
          if (vivant && pct !== null) {
            quotaHebdoRef.current = pct
            setQuotaHebdoConnu(true)
          }
        })
        .catch(() => undefined)
    }
    relever()
    const minuteur = window.setInterval(relever, 60_000)
    return () => {
      vivant = false
      window.clearInterval(minuteur)
    }
    // Ref (`useRef`) et setter (`useState`) de ChatView.tsx : stables, ils ne relancent rien.
  }, [busyConversations, quotaHebdoRef, setQuotaHebdoConnu])

  /**
   * LES AUTRES FILS — la boucle ne doit pas s'arrêter parce qu'on regarde ailleurs.
   *
   * Mesure du 2026-09-02 (journaux de tours) : un fil a fini son tour à 11:53:59 pendant que
   * un fil était à l'écran depuis 11:53:17. La suite proposée n'est jamais partie, et au retour
   * dans le fil la règle du premier passage marquait ce tour comme « déjà traité » — donc il ne
   * pouvait PLUS jamais repartir. La chaîne mourait en silence.
   *
   * La borne qui protège l'argent reste entière : on n'enchaîne QUE les fils dont on a vu le tour
   * tourner pendant que l'interrupteur était armé. Une vieille réponse d'un fil qu'on rouvre n'est
   * jamais relancée — c'est un tour que personne n'a demandé.
   */
  const enchainerLesFilsNonAffiches = useEffectEvent(() => {
    if (autoConvs.size === 0) return
    for (const id of busyConversations) if (autoArmePour(id)) autoSuiviesRef.current.add(id)
    for (const id of [...autoSuiviesRef.current]) {
      if (busyConversations.has(id)) continue
      if (!autoArmePour(id)) {
        autoSuiviesRef.current.delete(id)
        continue
      }
      autoSuiviesRef.current.delete(id)
      // Le fil affiché a son propre effet, qui sait en plus respecter un brouillon en cours.
      if (id === activeId) continue
      // Sa file passe d'abord (lots suivants d'une sélection scout) : le mode auto
      // reprendra sur la fin de tour du dernier message en attente.
      if ((queueRef.current.get(id)?.length ?? 0) > 0) continue
      const etat = autoEtat(id)
      const decision = deciderRelanceAuto({
        depotPresent,
        actif: true,
        occupe: false,
        fil: liveMessagesRef.current.get(id) ?? [],
        dernierTourTraite: etat.tour,
        dernierPromptEnvoye: etat.prompt,
        brouillonPresent: false,
        tourEstUnScout: dernierTourEstUnScout(liveMessagesRef.current.get(id) ?? []),
        relancesDifferees: autoDiffereesRef.current.get(id) ?? 0,
        ...gardeChaine(id)
      })
      /*
       * UN FIL D'ARRIÈRE-PLAN NE COUPE PLUS L'INTERRUPTEUR GLOBAL (demande du 2026-09-02).
       *
       * Son « rien » ne parle que de LUI : il ne dit rien du fil qu'on a sous les yeux ni des autres
       * fils suivis. On arrête donc de le suivre — il est déjà retiré de `autoSuiviesRef` juste
       * au-dessus — et le mode reste armé. Seul le fil AFFICHÉ peut éteindre le mode.
       */
      if (decision.action === 'arreter') {
        autoEssaisRef.current.delete(id)
        // Garde-fou de la chaîne : CE fil est désarmé et l'arrêt est rangé dans CE fil, comme au premier plan.
        if (decision.raison === 'quota-hebdo' || decision.raison === 'tours-auto-max') {
          desarmerAuto(id)
          noterArretChaine(window.localStorage, id, decision.message)
          setArretsAuto((courant) => ({ ...courant, [id]: decision.message }))
        }
        continue
      }
      if (decision.action === 'programmer') {
        autoEssaisRef.current.delete(id)
        programmerRelanceAuto(id, decision)
        continue
      }
      if (decision.action !== 'envoyer') {
        /*
         * LE TEXTE PEUT ÊTRE EN RETARD SUR LA FIN DU TOUR : les morceaux de réponse sont posés par
         * lots (`ChatView.pilot-delta-batch.test.tsx`), donc « terminé » peut arriver avant la
         * dernière ligne — celle qui porte justement la suite. On garde le fil en attente et on
         * repasse un instant plus tard, au lieu de le jeter définitivement.
         */
        if (decision.raison === 'aucun-prompt' || decision.raison === 'aucune-reponse') {
          const essais = (autoEssaisRef.current.get(id) ?? 0) + 1
          if (essais <= 5) {
            autoEssaisRef.current.set(id, essais)
            autoSuiviesRef.current.add(id)
            window.setTimeout(() => setAutoTic((t) => t + 1), 400)
          }
        }
        continue
      }
      autoEssaisRef.current.delete(id)
      autoDiffereesRef.current.delete(id)
      etat.tour = decision.signature
      etat.prompt = decision.texte
      void send(decision.texte, {
        keepComposerDraft: true,
        automatique: true,
        suiteDuModeAuto: true,
        targetConversationId: id
      })
    }
  })
  useEffect(() => {
    enchainerLesFilsNonAffiches()
  }, [autoConvs, autoArmePour, activeId, busyConversations, autoTic])

  /**
   * LES LOTS CONTINUENT QUAND ON REGARDE AILLEURS. Le drain de la file ne sert que le fil
   * AFFICHÉ (transition `busy→false`) : un fil quitté pendant le lot 1 gardait les lots 2 et 3 en
   * file jusqu'à ce qu'on y revienne — « lancés à la suite » ne tenait que les yeux sur l'écran.
   *
   * Borné aux fils où le panneau des candidats a MIS des lots en file (`filsAvecLotsRef`), et
   * seulement après les avoir VUS tourner (`lotsEnCoursRef`) : une fin de tour qu'on n'a pas vue ne
   * relâche rien. Le fil affiché garde son propre drain ; un Stop gèle la file, comme ailleurs.
   */
  const filsAvecLotsRef = useRef(new Set<string>())
  const lotsEnCoursRef = useRef(new Set<string>())
  const relacherLesLotsDesFilsNonAffiches = useEffectEvent(() => {
    for (const id of [...filsAvecLotsRef.current]) {
      if ((queueRef.current.get(id)?.length ?? 0) === 0) {
        filsAvecLotsRef.current.delete(id)
        lotsEnCoursRef.current.delete(id)
        continue
      }
      if (busyConversations.has(id)) {
        lotsEnCoursRef.current.add(id)
        continue
      }
      if (!lotsEnCoursRef.current.has(id) || id === activeId) continue
      if (stoppedQueueDrainRef.current.has(id) || stopDemandeRef.current.has(id)) continue
      lotsEnCoursRef.current.delete(id)
      // Retenus par la limite de quota : rien ne part, et seul un NOUVEAU tour vu dans ce fil (la
      // reprise) les relâchera à sa fin.
      if (lotsRetenusDansLeFil(id)) continue
      if (teteRetenueParLeVerrou(id)) continue
      const [tete, ...reste] = queueRef.current.get(id) ?? []
      if (!tete) continue
      setConversationQueue(id, reste)
      void send(tete.text, {
        keepComposerDraft: true,
        automatique: true,
        targetConversationId: id
      })
    }
  })
  useEffect(() => {
    relacherLesLotsDesFilsNonAffiches()
  }, [busyConversations, activeId])

  /** Bascule du mode auto : à l'allumage, l'anti-doublon et l'anti-boucle repartent de zéro. */
  function basculerModeAuto(): void {
    basculerModeAutoPour(activeId)
  }

  /**
   * MEME bascule, mais sur une conversation NOMMEE : le chat plein passe le fil affiche, la
   * mosaique passe l'id de SA fenetre (chaque fenetre a donc son propre bouton infini).
   */
  function basculerModeAutoPour(cible: string | null): void {
    const activeId = cible
    // FIL PAS ENCORE CREE : rien a armer, on garde l'intention pour la creation.
    if (!activeId) {
      setAutoNouveauFil((precedent) => !precedent)
      return
    }
    // ANCIEN REGLAGE GLOBAL (`*`, herite d'avant le retrait du bouton de la liste) : il n'a plus
    // de bouton a lui. L'eteindre ICI est donc la seule sortie possible — sinon il tournerait
    // sans interrupteur.
    if (autoConvs.has('*')) {
      autoAllumageManuelRef.current = false
      setAutoConvs((precedent) => {
        const suivant = new Set(precedent)
        suivant.delete('*')
        if (activeId) suivant.delete(activeId)
        return suivant
      })
      return
    }
    if (activeId ? autoConvs.has(activeId) : autoActif) {
      autoAllumageManuelRef.current = false
      // Éteindre ne coupe QUE ce fil : les autres conversations armées continuent leur chaîne.
      if (activeId) {
        autoSuiviesRef.current.delete(activeId)
        autoEssaisRef.current.delete(activeId)
      }
      if (activeId)
        setAutoConvs((precedent) => {
          const suivant = new Set(precedent)
          suivant.delete(activeId)
          return suivant
        })
      else desarmerAuto(activeId)
      return
    }
    if (activeId) {
      autoEtatsRef.current.delete(activeId)
      autoSuiviesRef.current.delete(activeId)
      autoEssaisRef.current.delete(activeId)
    }
    // À l'allumage, le fil courant est amorcé par la boucle elle-même — mais le tour SOUS LES YEUX
    // est justement celui que ce clic demande d'enchaîner, pas un vieux tour rouvert.
    autoFilAmorceRef.current = null
    autoAllumageManuelRef.current = true
    // Rallumer = repartir : l'ancien arrêt de ce fil ne décrit plus rien.
    if (activeId) effacerArretAuto(activeId)
    if (activeId) setAutoConvs((precedent) => new Set(precedent).add(activeId))
  }

  // Callback STABLE (le row est memo'd — une ref inline casserait la mémoïsation).
  const forkRef = useRef(forkFromMessage)
  forkRef.current = forkFromMessage
  const handleFork = useCallback((messageId: string) => void forkRef.current(messageId), [])
  // Callback STABLE pour la ligne mémoïsée, comme `handleFork` : passe par un ref.
  const modifierRef = useRef(modifierEtRelancer)
  modifierRef.current = modifierEtRelancer
  const handleModifier = useCallback((messageId: string) => void modifierRef.current(messageId), [])
  const revenirRef = useRef(revenirAuTour)
  revenirRef.current = revenirAuTour
  const handleRevenir = useCallback((messageId: string) => void revenirRef.current(messageId), [])
  /**
   * Un choix cliqué se comporte comme un message TAPÉ, tour en cours ou non.
   *
   * DÉFAUT VÉCU le 22/08 : `ask` ne SUSPEND pas le tour — le pilote enchaîne son
   * itération suivante sans attendre la réponse. Le bloc reste donc affiché pendant que la
   * conversation est occupée, et le clic partait dans `send()`, qui sort EN SILENCE sur `busy` :
   * ni file, ni reçu, ni message. « Je clique dans le bloc ask, il se passe rien » — littéralement.
   * Le composer traite déjà ce cas (`submitBtw`, parité claude.exe) ; c'est le même geste, donc le
   * même chemin, y compris son repli en file si l'injection est refusée.
   */
  // `send` est recréé à chaque render → une prop instable casserait le memo de ChatMessageRow.
  // On la stabilise via un ref (même pattern que forkRef), ici comme pour la relance gratuite.
  const sendRef = useRef(send)
  sendRef.current = send
  /**
   * LES ATTENTES DE FICHIER DES FILS ARMÉS NON AFFICHÉS, reprises au démarrage (2026-09-26 :
   * « après un redémarrage, ∞ reprend tout seul l'attente d'un fichier encore attendu »).
   *
   * La surveillance d'un « quand X existe » est un minuteur de l'écran : un redémarrage l'efface,
   * alors que ∞ est relu du stockage et reste allumé. Le fil affiché la reprend à son premier passage
   * (`attenteFichierAReprendre`) ; les autres fils armés, seulement ici. Une fois par démarrage, après
   * le chargement de la liste. Rien n'est envoyé : on reprogramme la sonde GRATUITE, qui n'envoie la
   * suite que si le fichier existe.
   */
  const attentesReprisesRef = useRef(false)
  const reprendreLesAttentesDesFilsArmes = useEffectEvent(() => {
    for (const id of autoConvs) {
      if (id === '*' || id === activeIdAutoRef.current || !convs.some((c) => c.id === id)) continue
      void (async () => {
        let fil = liveMessagesRef.current.get(id)
        if (!fil || fil.length === 0) {
          try {
            const detail = (await window.api.conversation(id)) as Conv | null
            fil = hydraterFilStocke(detail?.messages ?? [])
          } catch {
            return
          }
          // Un fil rempli entre-temps (tour lancé, fil ouvert) garde SA version.
          const recent = liveMessagesRef.current.get(id)
          if (recent && recent.length > 0) fil = recent
          else liveMessagesRef.current.set(id, fil)
        }
        // Devenu le fil affiché entre-temps : son premier passage s'en charge.
        if (id === activeIdAutoRef.current || !autoArmePourRef.current(id)) return
        if (autoProgrammeesRef.current.has(id) || busyConversationsRef.current.has(id)) return
        const decision = attenteFichierAReprendre({
          depotPresent,
          actif: true,
          occupe: false,
          fil,
          brouillonPresent: false,
          tourEstUnScout: dernierTourEstUnScout(fil),
          relancesDifferees: autoDiffereesRef.current.get(id) ?? 0,
          ...gardeChaine(id)
        })
        if (decision) programmerRelanceAuto(id, decision)
      })()
    }
  })
  useEffect(() => {
    if (attentesReprisesRef.current || convs.length === 0) return
    attentesReprisesRef.current = true
    reprendreLesAttentesDesFilsArmes()
  }, [convs])
  /**
   * REPRISE APRES UN REDEMARRAGE DEMANDE PAR L'AGENT (`restart_app`).
   *
   * On attend que la liste des conversations soit chargee : la consigne vise une conversation
   * precise, et l'ouvrir avant que le store ait repondu la ferait passer pour disparue. Une seule
   * tentative par demarrage (`repriseTenteeRef`) — le main a deja efface la consigne en la rendant.
   */
  const repriseTenteeRef = useRef(false)
  const reprendreApresRedemarrage = useEffectEvent(() => {
    void reprendreToutesApresRedemarrage({
      lire: async () => (await window.api.repriseEnAttente?.()) ?? null,
      ouvrir: async (conversationId) => {
        const cible = convsRef.current.find((conversation) => conversation.id === conversationId)
        if (!cible) return false
        await loadConv(cible)
        return true
      },
      /*
       * L'AUTORITE, pas l'ecran (2026-10-23) : `loadConv` lance sa sonde sans l'attendre,
       * donc le fil paraissait libre alors que le main y tenait encore le tour qui avait appele
       * `restart_app`. La consigne partait, etait refusee, et se perdait.
       */
      tourEnCours: async (conversationId) => {
        if (busyConversationsRef.current.has(conversationId)) return true
        try {
          return (await window.api.pilotChatActive?.(conversationId))?.active === true
        } catch {
          return false
        }
      },
      mettreEnFile: (consigne, conversationId) => {
        // Fil ADOPTE comme occupe (meme geste que `reconcilierTourNonClos`) : la veille des tours le
        // relache a la vraie fin du tour repris, et cette transition draine la file. Le drapeau de
        // reprise du mode auto n'est PAS leve : c'est la consigne qui poursuit, pas la suite proposee
        // par le tour repris (le mode auto attend de toute facon une file vide).
        if (!busyConversationsRef.current.has(conversationId))
          setConversationBusy(conversationId, true)
        enqueueMessage(conversationId, consigne)
        // La consigne attend EN VUE ; son recu part avec elle quand la file la relache.
        setDirectiveReceipt(
          conversationId,
          { id: nextQueueEntryIdRef.current++, text: consigne },
          'attente'
        )
      },
      envoyer: async (consigne, conversationId) => {
        // La chaine du mode auto REPREND ici : ce fil n'est pas « ouvert », il est poursuivi.
        autoRepriseApresRedemarrageRef.current = true
        await sendRef.current(consigne, { targetConversationId: conversationId })
      }
    })
  })
  useEffect(() => {
    if (repriseTenteeRef.current || convs.length === 0) return
    repriseTenteeRef.current = true
    reprendreApresRedemarrage()
  }, [convs])
  const pickRef = useRef<(prompt: string, suite?: readonly string[]) => void>(() => {})
  pickRef.current = (prompt: string, suite?: readonly string[]) => {
    /*
     * LES LOTS D'UNE SÉLECTION SCOUT : le panneau découpe la sélection en lots courts, qui
     * passent par la FILE du fil — un lot par tour, chacun sa paire question/réponse, jamais deux runs
     * en même temps sur le dépôt. Pendant un tour, TOUS attendent sa fin : un lot injecté dans le run
     * en cours deviendrait une consigne de ce run, pas son propre travail. Stop rend la file au
     * composer, comme pour tout message en attente.
     */
    const id = activeRef.current
    if (suite && suite.length > 0 && id) {
      // Un lot en file se VOIT : son reçu « Lot suivant » part avec lui quand la file le relâche
      // (`retirerRecusEnAttente`). Ids distincts du reçu et de l'entrée de file, comme `submitBtw`.
      const mettreEnFile = (texte: string): void => {
        setDirectiveReceipt(
          id,
          { id: nextQueueEntryIdRef.current++, text: texte },
          'attente',
          undefined,
          { attenteMotif: 'lot' }
        )
        enqueueMessage(id, texte, undefined, undefined, { lot: true })
        filsAvecLotsRef.current.add(id)
      }
      if (busy) {
        for (const texte of [prompt, ...suite]) mettreEnFile(texte)
        return
      }
      void sendRef.current(prompt)
      for (const texte of suite) mettreEnFile(texte)
      return
    }
    if (busy) void submitBtw(prompt, 'normal')
    else void sendRef.current(prompt)
  }
  const pickSuggestion = useCallback(
    (prompt: string, suite?: readonly string[]) => pickRef.current(prompt, suite),
    []
  )
  // Valeur STABLE, comme `pickSuggestion` : la ligne mémoïsée ignore ses callbacks (comparateur
  // data-only de `ChatMessageRow`). Seul le fil actif montre ses reçus (`activeDirectiveReceipts`).
  const annulerEnvoiRef = useRef(annulerEnvoiEnAttente)
  annulerEnvoiRef.current = annulerEnvoiEnAttente
  // `activeRef` vient de `useRef` (ChatView.tsx) : stable, le rappel le reste aussi.
  const annulerEnvoi = useCallback(
    (receipt: DirectiveReceipt) => {
      const id = activeRef.current
      if (id) annulerEnvoiRef.current(id, receipt)
    },
    [activeRef]
  )
  /**
   * UNE SÉLECTION EN PLUSIEURS LOTS PART EN SUPER CONVERSATION (2026-10-30). Depuis le
   * 22/10, 4 sélections ont prévu 12 lots dans la file du fil (`pickRef`) : 4 sont partis, jamais un
   * lot 2. Cette file vit dans la vue : Stop, un redémarrage ou un remontage l'effacent sans trace.
   * Le plan, lui, est sur disque (`plans-de-lots-app.ts`), fait 3 lots à la fois et se reprend.
   * `repli` : la file du fil reste la voie d'un fil qui ne peut pas mener de plan (le fil d'un lot).
   */
  const planSelectionRef = useRef<
    (selection: SelectionAPlanifier) => Promise<IssuePlanDeSelection>
  >(async () => ({ ok: false, erreur: '', repli: true }))
  planSelectionRef.current = async (selection) => {
    const id = activeRef.current
    if (!id || typeof window.api?.plansDeLots !== 'function')
      return { ok: false, erreur: '', repli: true }
    // Comme un envoi à la main : ce tour est traité, le mode auto n'enchaîne pas par-dessus le plan.
    const signature = signatureTour(liveMessagesRef.current.get(id) ?? [])
    if (signature !== null) autoEtat(id).tour = signature
    try {
      const reponse = await window.api.plansDeLots(
        'lancer-selection',
        id,
        undefined,
        undefined,
        selection
      )
      return reponse.ok ? { ok: true } : reponse
    } catch (erreur) {
      return { ok: false, erreur: erreur instanceof Error ? erreur.message : String(erreur) }
    }
  }
  const planSelection = useCallback(
    (selection: SelectionAPlanifier) => planSelectionRef.current(selection),
    []
  )
  /**
   * « 1 et 12 » TAPÉ SOUS LE PANNEAU VAUT LE CLIC. Un lot part en message, comme le
   * bouton ; plusieurs lots partent en plan. Plan refusé : le texte reste dans la saisie, le refus se
   * lit dans le bandeau, rien ne part en silence.
   */
  async function lancerPlanTape(plan: readonly LotDeLancement[], cleSaisie: string): Promise<void> {
    const prompts = redigerPromptsDuPlan(plan)
    const [premier, ...suite] = prompts
    if (premier === undefined) return
    if (suite.length === 0) {
      await send(premier)
      return
    }
    const issue = await planSelectionRef.current(selectionAPlanifier(plan))
    if (issue.ok) {
      setDraftInput(cleSaisie, '')
      setAppNotice({
        text: traduireChatDecisions('candidats.planLance', langueCourante(), { n: plan.length })
      })
      return
    }
    if (issue.repli) {
      setDraftInput(cleSaisie, '')
      pickRef.current(premier, suite)
      return
    }
    setAppNotice({
      text: traduireChatDecisions('candidats.planRefuse', langueCourante(), {
        erreur: issue.erreur
      })
    })
  }
  /**
   * LE CLIC AUTOMATIQUE SUR LES CANDIDATS — mode auto seulement, et UNE SEULE FOIS par message.
   *
   * Demande du 2026-09-06 : « l'orchestrateur decide des candidats et clique sur le bouton avec la
   * selection ». Le choix vient du texte du scout (`CIBLE:` / section `## Cible`), l'envoi part
   * d'ici. La reponse est memorisee par message : rouvrir la conversation plus tard REMONTE le
   * panneau, et sans cette memoire il relancerait un workflow payant deja lance.
   */
  const autoCandidatsRef = useRef<Map<string, 'en-cours' | 'lance'>>(new Map())
  const doitAutoLancerCandidats = useCallback(
    (cle: string, dernier: boolean, fini: boolean): boolean => {
      const etat = autoCandidatsRef.current.get(cle)
      if (etat === 'lance') return true
      if (!fini) {
        // Le message S'ECRIT sous nos yeux : on le marque seulement, on ne repond pas encore. Sans
        // cette marque, la premiere reponse (« non », le message n'est pas fini) etait memorisee
        // definitivement et le clic auto ne partait JAMAIS sur un vrai tour en direct.
        if (dernier && autoActif) autoCandidatsRef.current.set(cle, 'en-cours')
        return false
      }
      // VU S'ECRIRE ICI, sinon rien. C'est ce qui distingue un tour qui vient de se terminer d'une
      // conversation ROUVERTE dont le dernier message etait deja termine — relancer celui-la
      // repayait un workflow deja paye.
      if (!autoActif || !dernier) return false
      autoCandidatsRef.current.set(cle, 'lance')
      return true
    },
    [autoActif]
  )
  /**
   * REPONDRE A UNE QUESTION `ask` — parite claude.exe : c'est un MESSAGE, jamais une orientation.
   *
   * `ask` clot desormais le tour (cf. `agent-pilot`), donc le cas normal est un envoi ordinaire.
   * Un run peut malgre tout tourner encore (orchestration en vol) : le transport passe alors par
   * l'injection, comme le composer, mais le reçu est marque `reponse` — le fil affiche
   * « ✓ Répondu » et non « ✓ Orienté », qui decrivait un geste que l'utilisateur n'avait pas fait.
   */
  const answerAskRef = useRef<(prompt: string) => void>(() => {})
  answerAskRef.current = (prompt: string) => {
    if (busy) void submitBtw(prompt, 'normal', true)
    else void sendRef.current(prompt)
  }
  const answerAsk = useCallback((prompt: string) => answerAskRef.current(prompt), [])
  /** Meme envoi, vise une conversation NOMMEE : la mosaique repond depuis sa propre fenetre. */
  const submitBtwRef = useRef<(prompt: string, cible: string) => void>(() => {})
  submitBtwRef.current = (prompt: string, cible: string) => {
    void submitBtw(prompt, 'normal', true, cible)
  }
  /**
   * « Reprendre en précisant… » : REMPLIT le composer (prompt d'origine + motif), et s'arrête là.
   * Aucun envoi, aucune orchestration — le geste appartient à l'utilisateur.
   * Callback STABLE (le row est memo'd) : passe par un ref, comme fork/send.
   */
  const refineDraftRef = useRef<
    (prompt: string, status: TerminalStatus, reason?: string | null) => void
  >(() => {})
  refineDraftRef.current = (prompt, status, reason) => {
    setDraftInput(composerDraftKeyRef.current, buildRefineDraft(prompt, status, reason))
    requestAnimationFrame(() => composerRef.current?.focusAt(-1))
  }
  const refineResumeDraft = useCallback(
    (prompt: string, status: TerminalStatus, reason?: string | null) =>
      refineDraftRef.current(prompt, status, reason),
    []
  )

  /**
   * SESSION EXPIREE — ouvre le login officiel du provider (meme canal que « Se reconnecter » de la
   * page Routeur). Offert a la place de « Renvoyer » : renvoyer le prompt echouerait a l'identique.
   */
  const ouvrirLogin = useCallback(() => {
    void window.api.providerLogin('claude').catch((raison: unknown) => {
      console.error('providerLogin claude', raison)
    })
  }, [])

  /* --- envoi --- */

  function flatten(
    msgs: Msg[]
  ): Array<{ role: 'user' | 'assistant'; content: string; attachments?: ChatAttachment[] }> {
    return msgs.map((m) => {
      if (m.role === 'user') {
        /*
         * LES PIECES JOINTES DES TOURS PASSES TRAVERSENT L'IPC.
         *
         * Avant, cette fonction rendait `{ role, content }` : le process principal ne voyait que
         * les pieces jointes du message COURANT, rattachees a la main juste apres l'appel. Une
         * image jointe au tour 1 etait donc invisible au tour 2 — mesure le 2026-08-27, avec la
         * trace de prompt pour preuve : le tour 2 ne portait AUCUN chemin de piece jointe.
         *
         * Miniature seulement, et jamais le binaire : voir `pieceJointePasseePourLeFil`. Le message
         * courant, lui, garde son original — il est rattache apres coup par l'appelant.
         */
        const passees = (m.attachments ?? [])
          .map((piece) => pieceJointePasseePourLeFil(piece))
          .filter((piece): piece is NonNullable<typeof piece> => piece !== undefined)
        return {
          role: 'user' as const,
          content: m.content,
          ...(passees.length ? { attachments: passees as ChatAttachment[] } : {})
        }
      }
      const content = m.parts
        .map((p) => {
          if (p.kind === 'text') return p.text
          // Reste en français : historique transmis à l'agent, pas un texte de l'écran.
          if (p.kind === 'artifact') return `[artefact ${p.artifact.name}]`
          if (p.kind === 'error') return `⚠️ ${p.message}`
          return `[a exécuté ${p.name}${p.ok === false ? ' (échec)' : ''}]`
        })
        .join('\n')
      return { role: 'assistant' as const, content }
    })
  }

  /**
   * `keepComposerDraft` — envoi qui N'EMPRUNTE RIEN au composer : ni son texte en cours de frappe, ni
   * ses pièces jointes, et qui ne le vide pas. Indispensable pour le drain de la file d'attente : il
   * part sur une transition (fin de tour, retour sur la conversation) et non sur un geste de l'utilisateur.
   * Sans cette porte, le drain effaçait un brouillon jamais envoyé et accrochait ses pièces jointes en
   * attente au message de la FILE — deux pertes silencieuses, aucune reliée à une action visible.
   */
  async function send(text?: string, options?: SendOptions): Promise<void> {
    const value = (text ?? texteDuComposer()).trim()
    /*
     * `activeRef.current`, PAS `activeId` : la valeur du render est FIGEE dans la closure. Vecu le
     * 2026-09-12 — le bouton « Traiter » du bandeau des travaux non publies ouvre une conversation
     * neuve (activeRef remis a null, setActiveId(null)) puis envoie le `/salvage` a l'image
     * suivante. Le `send` capture, lui, gardait l'ANCIEN id : le prompt partait dans la
     * conversation ou l'on etait, et aucune conversation neuve n'apparaissait. Le ref est tenu a
     * jour de facon synchrone partout ou l'active change, c'est donc la seule source fiable ici.
     */
    const sourceConversationId = options?.targetConversationId ?? activeRef.current
    const sendDraftKey = options?.targetConversationId ?? composerDraftKeyRef.current
    const keepComposerDraft = options?.keepComposerDraft === true
    const outgoingDraft = getComposerDraft(sendDraftKey)
    // Un rejeu automatique (reprise après surcharge) impose SES pièces jointes — celles de la
    // demande d'origine. Sans cela, la reprise repartirait sans l'image que l'utilisateur avait mise.
    const outgoingAttachments =
      options?.piecesJointesImposees ?? (keepComposerDraft ? [] : outgoingDraft.attachments)
    const sendSelectionGeneration = composerSelectionGenerationRef.current
    const sendLockKey = sourceConversationId ?? NEW_DRAFT_KEY
    // Seulement ce que l'utilisateur tape (`text` absent) : ni un clic, ni un envoi automatique.
    if (
      text === undefined &&
      sourceConversationId &&
      outgoingAttachments.length === 0 &&
      !busyConversationsRef.current.has(sourceConversationId) &&
      !sendLocksRef.current.has(sendLockKey)
    ) {
      const planTape = planDeLaSaisie(
        value,
        liveMessagesRef.current.get(sourceConversationId) ?? []
      )
      if (planTape) {
        journaliserSaisie(sourceConversationId, value, 'message')
        await lancerPlanTape(planTape, sendDraftKey)
        return
      }
    }
    if (
      (!value && outgoingAttachments.length === 0) ||
      (sourceConversationId ? busyConversationsRef.current.has(sourceConversationId) : busy) ||
      sendLocksRef.current.has(sendLockKey)
    )
      return
    sendLocksRef.current.add(sendLockKey)
    // Tours automatiques d'affilée (garde-fou ∞) : +1 pour une suite du mode auto, 0 pour tout autre envoi.
    if (sourceConversationId) {
      if (options?.suiteDuModeAuto === true)
        toursAutoRef.current.set(
          sourceConversationId,
          (toursAutoRef.current.get(sourceConversationId) ?? 0) + 1
        )
      else toursAutoRef.current.delete(sourceConversationId)
      ecrireToursAuto(window.localStorage, toursAutoRef.current)
    }
    // L'utilisateur répond lui-même dans ce fil : la pause du mode auto qui l'y invitait est levée.
    if (sourceConversationId && !options?.automatique) effacerArretAuto(sourceConversationId)
    if (sourceConversationId && !options?.automatique)
      stopDemandeRef.current.delete(sourceConversationId)
    /*
     * UN ENVOI A LA MAIN CONSOMME LE TOUR QUE LE MODE AUTO AURAIT ENCHAINE.
     *
     * Le mode auto ne retenait comme « traite » que ce qu'il envoyait lui-meme. Tant que le message
     * reste dans ce fil, le tour suivant change la signature et rien ne se voit. Mais quand le routeur
     * l'EMPORTE dans un fil neuf, ce fil-ci retrouve exactement son dernier tour : le mode auto le
     * croyait encore a traiter et renvoyait la meme suite. Vecu le 2026-10-15 (
     * 58:13) : la suite acceptee par Tab est partie, puis le mode auto l'a renvoyee
     * 32 ms plus tard — deux bancs identiques sur le meme Bureau.
     * Temoin : `ChatView.mode-auto-reste-dans-le-fil.test.tsx`.
     */
    if (sourceConversationId && !options?.automatique) {
      const signature = signatureTour(liveMessagesRef.current.get(sourceConversationId) ?? [])
      if (signature !== null) autoEtat(sourceConversationId).tour = signature
    }
    // Même filet que l'orientation : le composer va être vidé, ce texte doit exister sur disque
    // AVANT — y compris si la création de la conversation ou l'envoi échoue juste après.
    // saisies ts 1791317725882 vs 1791317691042 : un envoi de ∞ se distingue d'un texte tapé.
    if (value)
      journaliserSaisie(
        sourceConversationId ?? 'nouvelle-conversation',
        value,
        'message',
        options?.suiteDuModeAuto === true ? 'mode-auto' : undefined
      )

    let convId = sourceConversationId
    let messageCommitted = false
    /** Décidé à l'échec du tour, exécuté APRÈS sa clôture (voir le `finally`). */
    let repriseApresSurcharge: { tentative: number; attenteMs: number; ancre?: string } | null =
      null
    /**
     * Le tour a-t-il « réussi » en ne rendant QUE l'incident du fournisseur ? Mesuré le 2026-09-03
     * La surcharge est arrivée dans le TEXTE de la réponse, pas dans `error`. Le tour
     * comptait pour un succès, la porte de reprise répondait « succès », et l'utilisateur devait
     * retaper sa demande. Le texte rendu n'est connu qu'après la clôture : on garde donc de quoi
     * rejuger là-bas.
     */
    let ancreCopieSurcharge: string | undefined
    const sourcePreviousMessages = sourceConversationId
      ? (liveMessagesRef.current.get(sourceConversationId) ?? [])
      : messages
    let previousMessagesForTarget = sourcePreviousMessages
    const optimisticHistory: Msg[] = [
      ...sourcePreviousMessages,
      {
        role: 'user',
        content: value,
        ts: Date.now(),
        attachments: outgoingAttachments.map(
          ({ name, mimeType, size, kind, content, thumbnail }) => ({
            name,
            mimeType,
            size,
            ...(kind === 'image' && { content }),
            ...(thumbnail && { thumbnail })
          })
        )
      },
      hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
    ]

    // Commit VISUEL avant tout await : Entrée vide le composer et affiche le prompt sans exposer
    // la latence du classifieur de routage. Ce commit reste local jusqu'à pilotChat.
    if (sourceConversationId) liveMessagesRef.current.set(sourceConversationId, optimisticHistory)
    publierFil(sourceConversationId, optimisticHistory)
    // La LISTE se reordonne au meme instant que le fil. Sans cela, la recence utilisee par la barre
    // laterale (`lastUserMessageAt`) n'arrive qu'au refresh diffuse par le main, donc la conversation
    // ou l'on vient d'ecrire ne remontait pas en tete — constate le 2026-08-30, capture a l'appui.
    // Valeur OPTIMISTE assumee : le prochain rafraichissement du store l'ecrase par la vraie date.
    if (sourceConversationId) {
      const ecritA = Date.now()
      const rafraichir = (liste: Conv[]): Conv[] =>
        liste.map((conversation) =>
          conversation.id === sourceConversationId
            ? { ...conversation, lastUserMessageAt: ecritA, updatedAt: ecritA }
            : conversation
        )
      convsRef.current = rafraichir(convsRef.current)
      setConvs(rafraichir)
    }
    if (!keepComposerDraft) {
      setDraftInput(sendDraftKey, '')
      setDraftAttachments(sendDraftKey, () => [])
      setDraftError(sendDraftKey, null)
    }
    followTailRef.current = suiviDuBasApresEnvoi({
      suivaitLeBas: followTailRef.current,
      envoiAutomatique: options?.automatique === true
    })
    /*
     * ENVOYER remet a zero les signaux d'alerte du fil : le lecteur veut voir sa reponse, pas un
     * bouton « il y a du nouveau » herite d'avant l'envoi. La DESCENTE elle-meme reste pilotee par
     * l'effet sur `messages` plus bas.
     *
     * Defaut vecu le 2026-09-06, RESOLU AILLEURS : « quand je prompt ca met pas la vue sur le
     * dernier message, je suis oblige de scroll down ». Une premiere tentative armait ici
     * `descenteEnVolRef` ; elle a ete retiree car elle faisait tomber `ChatView.behavior` « un
     * message arrive juste avant un scroll vers le haut ne ramene pas l'utilisateur en bas » —
     * armer la descente a l'envoi confisque au lecteur le droit de remonter aussitot apres.
     * La cause a ete localisee dans le gestionnaire `onScroll` : un defilement SANS geste de
     * lecture y coupait le suivi du bas. Le correctif est la-bas, pas ici ; temoin :
     * `ChatView.descente-envoi.test.tsx`.
     */
    if (
      followTailRef.current &&
      scrollRef.current &&
      (!sourceConversationId || sourceConversationId === activeRef.current)
    ) {
      gesteLecteurRef.current = false
      dernierScrollTopRef.current = scrollRef.current.scrollTop
      setHasNewActivity(false)
      setScrolledAwayFromTail(false)
      /*
       * ENVOYER VAUT DEMANDE D'ATTERRISSAGE. Deux trous restaient, tous deux vecus comme « ca me
       * scroll pas sur mon message » :
       *   - une REPRISE DE LECTURE encore en attente (on vient d'ouvrir le fil au milieu) : l'effet
       *     de descente prenait sa branche de restauration et REMONTAIT au lieu de descendre ;
       *   - un fil dont le tableau de messages ne change pas d'IDENTITE au moment de l'envoi :
       *     l'effet, qui depend de `messages`, ne se rejouait jamais et personne ne descendait.
       * Envoyer un message dit sans ambiguite ou le lecteur veut etre : en bas, sur ce qu'il envoie.
       *
       * ... ET LA POSITION RETENUE SUR LE DISQUE PART AVEC (2026-10-23 : « quand j'envoie
       * le message ca doit me scroll down la conv »). Annuler la seule reprise EN ATTENTE ne suffisait
       * pas : le `refresh` du fil emis juste apres l'envoi (il est retitre a chaque message) repasse
       * par `loadConv`, qui relisait la position retenue avant l'envoi et y REMONTAIT le fil ~1 s
       * apres la descente. Temoin : `ChatView.descente-envoi-rechargement.test.tsx`.
       */
      positionARestaurerRef.current = null
      if (activeRef.current) oublierPositionLecture(activeRef.current)
      setAtterrissageDemande((tour) => tour + 1)
    }
    if (sourceConversationId) setConversationBusy(sourceConversationId, true)

    try {
      // Le message part dans le fil OU IL A ETE ECRIT : plus aucun tri ne le deplace vers un fil
      // neuf quand le sujet change (retire le 2026-10-17, « c invasif je sais gerer »).
      // Pas de conversation active → on en crée une (titre = début du message).
      if (!convId) {
        const identity = await refreshRuntimeIdentity()
        const titleSource = value || outgoingAttachments[0].name
        const title = titreDepuisPremierMessage(titleSource)
        const c = await window.api.conversationsCreate({
          title,
          category: identity.provider,
          provider: identity.provider
        })
        convId = c.id
        // Le dossier arme dans « Nouveau fil » devient le dossier de travail DES le premier tour :
        // `dossierDeTravailDuTour` lit le rangement de la conversation, il doit donc etre pose avant.
        if (dossierNouveauFilRef.current) {
          await window.api.conversationsSetProject?.(c.id, dossierNouveauFilRef.current)
          consommerDossierNouveauFil()
        }
        // Le modèle et le compte armés dans « Nouveau fil » se posent de même AVANT le premier tour.
        await poserModeleArme(c.id)
        await poserCompteArme(c.id)
        const shouldAdoptCreatedConversation =
          activeRef.current === null &&
          composerDraftKeyRef.current === sendDraftKey &&
          composerSelectionGenerationRef.current === sendSelectionGeneration
        sendLocksRef.current.add(convId)
        sendLocksRef.current.delete(sendLockKey)
        previousMessagesForTarget = liveMessagesRef.current.get(convId) ?? []
        if (shouldAdoptCreatedConversation) {
          activeRef.current = c.id
          setActiveId(c.id)
          composerDraftKeyRef.current = c.id
          composerDraftsRef.current.set(c.id, { input: '', attachments: [], error: null })
        }
        // L'intention prise AVANT la creation se pose sur le fil qui vient de naitre.
        if (autoNouveauFilRef.current) {
          const filNeuf = convId
          setAutoConvs((precedent) => new Set(precedent).add(filNeuf))
          autoNouveauFilRef.current = false
          setAutoNouveauFil(false)
        }
      }

      /*
       * Conversation CREEE D'AVANCE (fenetre mosaique, ouverture directe) : elle porte le titre
       * provisoire « Nouvelle conversation ». Elle n'est plus renommee ICI : le stockage retitre
       * le fil a CHAQUE message de l'utilisateur (`ConversationStore.beginTurn`), et
       * `conversationsRename` est desormais le renommage MANUEL — l'appeler d'ici figerait le
       * titre comme s'il avait ete choisi.
       */

      const history: Msg[] = [
        ...previousMessagesForTarget,
        {
          role: 'user',
          content: value,
          ts: Date.now(),
          attachments: outgoingAttachments.map(
            ({ name, mimeType, size, kind, content, thumbnail }) => ({
              name,
              mimeType,
              size,
              ...(kind === 'image' && { content }),
              ...(thumbnail && { thumbnail })
            })
          )
        },
        hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
      ]
      liveMessagesRef.current.set(convId, history)
      publierFil(convId, history)
      setConversationBusy(convId, true)
      messageCommitted = true
      const payload: Array<{
        role: 'user' | 'assistant'
        content: string
        attachments?: ChatAttachment[]
      }> = flatten(history.slice(0, -1))
      payload[payload.length - 1].attachments = outgoingAttachments
      // Mentions `@run:` / `@fichier:` : le fil garde le texte TAPÉ (lisible), le prompt ENVOYÉ porte
      // en plus le bloc de cibles résolues — désigner au lieu de décrire, sans polluer l'affichage.
      payload[payload.length - 1].content = resolveMentionsForSend(
        payload[payload.length - 1].content,
        mentionSourcesRef.current
      )
      // Point de copie : le dernier message DÉJÀ ENREGISTRÉ avant la demande. La copie s'arrête donc
      // juste avant elle, et la reprise la rejoue proprement.
      ancreCopieSurcharge = [...previousMessagesForTarget]
        .reverse()
        .find((m) => m.messageId)?.messageId
      const res = await window.api.pilotChat(payload, convId)
      if (!res.ok || res.cancelled) {
        // Surcharge du modèle : on décide ICI, on exécute après la clôture du tour.
        const decision = deciderRepriseSurcharge({
          ok: res.ok,
          cancelled: res.cancelled === true,
          erreur: res.error,
          tentativesDejaFaites: options?.repriseSurcharge ?? 0
        })
        if (decision.action === 'forker-et-reprendre')
          repriseApresSurcharge = {
            tentative: decision.tentative,
            attenteMs: decision.attenteMs,
            // Point de copie : le dernier message DÉJÀ ENREGISTRÉ avant la demande qui a échoué. La
            // copie s'arrête donc juste avant elle, et la reprise la rejoue proprement.
            ancre: ancreCopieSurcharge
          }
        const plafondAtteint =
          decision.action === 'renoncer' && decision.raison === 'plafond-atteint'
        patchLast(convId, (m) => {
          m.status = res.cancelled ? 'cancelled' : 'failed'
          m.done = true
          // Part d'ERREUR structurée (et non plus un `⚠️ …` texte, que rien ne distinguait d'une
          // réponse du modèle) : cause + message, rendus par un bloc `role="alert"` dédié.
          if (!res.cancelled)
            m.parts.push({
              kind: 'error',
              cause: 'turn',
              // La reprise ne se fait JAMAIS en silence : le fil dit qu'elle part, ou qu'on renonce.
              message: repriseApresSurcharge
                ? `${res.error ?? 'erreur'} — ${libelleReprise(repriseApresSurcharge.tentative)}`
                : plafondAtteint
                  ? `${res.error ?? 'erreur'} — ${libelleRenoncement()}`
                  : (res.error ?? 'erreur')
            })
        })
      }
    } catch (error) {
      if (!messageCommitted) {
        if (sourceConversationId) {
          liveMessagesRef.current.set(sourceConversationId, sourcePreviousMessages)
          setConversationBusy(sourceConversationId, false)
        }
        if (convId && convId !== sourceConversationId) {
          liveMessagesRef.current.delete(convId)
          setConversationBusy(convId, false)
        }
        publierFil(sourceConversationId, sourcePreviousMessages)
        setDraftInput(sendDraftKey, value)
        setDraftAttachments(sendDraftKey, () => outgoingAttachments)
        setDraftError(
          sendDraftKey,
          texteFil('envoi.impossible', {
            raison: error instanceof Error ? error.message : String(error)
          })
        )
      } else if (convId) {
        patchLast(convId, (m) => {
          m.status = 'failed'
          m.done = true
          m.parts.push({
            kind: 'error',
            cause: 'send',
            message: error instanceof Error ? error.message : String(error)
          })
        })
      }
    } finally {
      sendLocksRef.current.delete(sendLockKey)
      if (convId) sendLocksRef.current.delete(convId)
      if (messageCommitted && convId) {
        // Les derniers événements pilote peuvent encore être EN VOL (IPC) quand la promesse
        // se résout : on les laisse se réduire AVANT de finaliser et de couper la garde busy,
        // sinon la fin de la réponse est silencieusement perdue (course busy-flag).
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
        // Toujours vivant cote main : rien a clore, la fin viendra par ses propres evenements.
        if (!(await tourEncoreVivant(convId))) {
          patchLast(convId, (m) => {
            if (m.status === 'streaming') m.status = 'interrupted'
            m.done = true
            // Un tour annulé/interrompu porte désormais son propre libellé terminal (msg-terminal) :
            // le remplissage « aucune réponse » ferait doublon et masquerait la vraie raison.
            if (m.parts.length === 0 && m.status !== 'cancelled' && m.status !== 'interrupted')
              m.parts.push({ kind: 'text', text: texteFil('fil.aucuneReponse') })
          })
          setConversationBusy(convId, false)
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
          // La vue a pu être REMONTÉE pendant le tour : sa copie du fil est alors morte et ne garde
          // que le début de la réponse (12 « Réponse affichée » tronquées sur 50, 2026-10-12). On
          // lit celle de la vue montée, qui a reçu toute la suite.
          const filAffiche =
            (vueMonteeRef.current ? undefined : filDeLaVueMontee(convId)) ??
            liveMessagesRef.current.get(convId) ??
            []
          const rendered = [...filAffiche]
            .reverse()
            .find((message) => message.role === 'assistant') as AsstMsg | undefined
          const renderedText =
            rendered?.parts
              .filter((part) => part.kind === 'text')
              .map((part) => part.text)
              .join('\n') ?? ''
          if (renderedText.trim()) await window.api.markResponseDisplayed(convId, renderedText)
          // Le tour s'est CLOS sans erreur, mais tout ce qu'il a rendu est l'incident du fournisseur :
          // c'est la même perte qu'un échec, elle passait juste par un autre chemin. On la fait juger
          // par la MÊME porte, avec le texte rendu — jamais par une règle parallèle.
          if (!repriseApresSurcharge) {
            const surTexte = deciderRepriseSurcharge({
              ok: true,
              cancelled: false,
              texteRendu: renderedText,
              tentativesDejaFaites: options?.repriseSurcharge ?? 0
            })
            if (surTexte.action === 'forker-et-reprendre') {
              repriseApresSurcharge = {
                tentative: surTexte.tentative,
                attenteMs: surTexte.attenteMs,
                ancre: ancreCopieSurcharge
              }
              patchLast(convId, (m) => {
                m.status = 'failed'
                m.parts.push({
                  kind: 'error',
                  cause: 'turn',
                  message: `${renderedText.trim()} — ${libelleReprise(surTexte.tentative)}`
                })
              })
            }
          }
        }
      }
      // APRÈS la clôture du tour, jamais avant : le rejeu se heurterait sinon à la garde « un tour
      // est déjà en cours » et serait avalé sans bruit.
      if (repriseApresSurcharge && convId)
        void relancerApresSurcharge(convId, value, outgoingAttachments, repriseApresSurcharge)
      // La compaction décidée au `done` de CE tour attendait son verrou : elle passe AVANT la file,
      // comme quand elle partait directement au `done` ; la file attendra la fin du résumé.
      if (convId && compactionEnAttenteRef.current.has(convId)) lancerCompactionAuto(convId)
      // Même raison : un drain a vu le fil libre pendant que CET envoi tenait encore son verrou ;
      // la tête de file l'a attendu, elle part maintenant (`teteRetenueParLeVerrou`).
      if (convId && drainApresVerrouRef.current.delete(convId)) drainerApresVerrou(convId)
    }
  }
  return {
    queueCurrentMessage,
    tourEncoreVivant,
    rendreLaFileAuComposer,
    stopPilotTurn,
    submitBtw,
    handleBtw,
    filsAvecLotsRef,
    basculerModeAuto,
    basculerModeAutoPour,
    handleFork,
    handleModifier,
    handleRevenir,
    sendRef,
    pickSuggestion,
    annulerEnvoi,
    planSelection,
    doitAutoLancerCandidats,
    answerAsk,
    submitBtwRef,
    refineResumeDraft,
    ouvrirLogin,
    send
  }
}
