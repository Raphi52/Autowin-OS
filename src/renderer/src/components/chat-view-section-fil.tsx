import { texteFil, type ModeleDuFil } from './chat-view-outils'
import { ChatFindBar } from './ChatFindBar'
import { EnTeteDuFil } from './chat-view-entete'
import { TravauxNonPublies } from './TravauxNonPublies'
import {
  arretReglableDansBehaviour,
  lireSeuilsChaine,
  CLE_SEUILS_CHAINE_AUTO
} from './chat-auto-mode'
import { createPortal } from 'react-dom'
import { CarteRenommerConversation, CarteSuppressionRun } from './chat-view-cartes'
import { SuppressionConversationsCarte } from './SuppressionConversationsCarte'
import { FilDesMessages } from './chat-view-fil-messages'
import { AscenseurDuFil } from './AscenseurDuFil'
import { BarrePassage, type PassageAffiche } from './BarrePassage'
import { oublierPositionLecture, type PositionLecture } from './position-lecture'
import {
  scrollChatToBottom,
  type OrchestratorModelOption,
  type ScopedLiveRun,
  type OrchStep,
  type RuntimeModel,
  type ChatRuntimeIdentity,
  type SlashCommand
} from './chat-view-model'
import { ProdAutorisationHote } from './ProdAutorisationHote'
import { BarriereErreur } from './BarriereErreur'
import { SuperConvDuChat } from './SuperConvMosaique'
import { TableauDesLots } from './TableauDesLots'
import { QuestionACote } from './QuestionACote'
import { SaisieDuFil } from './chat-view-saisie'
import type {
  Conv,
  DirectiveReceipt,
  ChatAttachment,
  RunEntry,
  Msg,
  SendOptions
} from './chat-view-types'
import type { ActionPassage } from './passage-selectionne'
import type { ChatComposerHandle } from './ChatComposer'
import type { OrchestratorAccounts } from './OrchestratorModelSelector'
import type { ContexteStatique } from '../../../shared/contexte-detaille'
import type { CopieAffichee } from './copie-du-fil-entete'
import type { FrictionEchecsRepetes } from '../../../shared/friction-echecs-repetes'
import type { HypotheseDeCadrage } from '../../../shared/cadrage-confiance'
import type { ContextGauge } from '../../../shared/context-gauge'
import type { MentionSources } from './chat-mentions'
import type { PlanDeLots } from '../../../shared/plan-de-lots'
import type { MomentPointe } from './video-pointage-context'
import type { PropositionSuite } from '../../../shared/prompt-suivant'
import type { OutilDuPanneau } from './panneau-outil'
import type { UsageDeSkill } from './chat-home-suggestions'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** Le fil unique (hors mosaïque) : en-tête, bandeaux, cartes de confirmation, messages, barres du bas et saisie. */
export function SectionDuFil({
  active,
  activeDirectiveReceipts,
  activeId,
  activeRef,
  addFiles,
  agirSurPassage,
  annulerEnvoi,
  arretsAuto,
  attachmentError,
  attachments,
  autoActif,
  autoConvs,
  autoNouveauFil,
  avisApp,
  basculeConvRef,
  basculerModeAuto,
  basculerNavigateur,
  bindingEffectif,
  brouillonPresent,
  bulkDeleteAsking,
  bulkDeleteError,
  bureauxNonVus,
  bureauxOuverts,
  busy,
  busyConversations,
  cadrageReplie,
  changerModeleDuFil,
  composerDraftKeyRef,
  composerRef,
  comptesDeConversation,
  confirmBulkDelete,
  confirmDeleteRun,
  confirmRemoveConv,
  confirmRenameConv,
  contextesStatiques,
  convLoad,
  convs,
  copieAffichee,
  defaultWorkspace,
  deleteCandidate,
  deleteRunCandidate,
  dernierScrollTopRef,
  descenteEnVolRef,
  dossierProjetAffiche,
  dragActive,
  effacerArretAuto,
  estDossierPersonnel,
  fileInputRef,
  filRendu,
  followTailRef,
  friction,
  gesteLecteurRef,
  ghostRecommendation,
  gitBranch,
  gitCwd,
  handleBtw,
  hasNewActivity,
  hypothesesCadrage,
  identifiantCopie,
  interruptingConversations,
  isActive,
  jaugeCourante,
  listeNonPubliee,
  listeTelOuverte,
  liveRuns,
  loadConv,
  mentionSources,
  messageNonPublieMasque,
  messages,
  messagesUtilisateurAvantDebut,
  modelCatalog,
  modelCatalogLoaded,
  modelChangeError,
  modelChangePending,
  modeleDuFil,
  navigateurOuvert,
  ongletDuFilOuvert,
  openRunsCount,
  pagesNonVues,
  passageSelectionne,
  phrasesAccueil,
  placePanneau,
  planDuFilOuvert,
  pointerMomentVideo,
  positionARestaurerRef,
  propositionsSuite,
  questionACoteOuverte,
  questionsDesLots,
  queueCurrentMessage,
  quotaHebdoConnu,
  rechercheFilOuverte,
  remplirSaisie,
  renameCandidate,
  rendrePiecesJointesEnAttente,
  repriseEnCours,
  resumeAvailable,
  resumePilotTurn,
  retirerPieceJointeDuBrouillonCourant,
  runDeleteError,
  runDeletePending,
  runDuCadrageRef,
  runtimeIdentity,
  scrolledAwayFromTail,
  scrollRef,
  selectedConvIds,
  send,
  setBrancheMenu,
  setBrouillonPresent,
  setBulkDeleteAsking,
  setCadrageReplie,
  setConvFolderMenu,
  setDeleteCandidate,
  setDeleteRunCandidate,
  setDraftInput,
  setDragActive,
  setHasNewActivity,
  setIdentifiantCopie,
  setListeNonPubliee,
  setListeTelOuverte,
  setMessageNonPublieMasque,
  setPanneaux,
  setQuestionACoteOuverte,
  setRechercheFilOuverte,
  setRenameCandidate,
  setScrolledAwayFromTail,
  setShowRuns,
  showRuns,
  skillCommands,
  stopPilotTurn,
  surClicLienDuFil,
  surRelachementDansLeFil,
  traiterTravauxNonPublies,
  travailNonPublie,
  usagesAccueil
}: {
  active: Conv | undefined
  activeDirectiveReceipts: DirectiveReceipt[]
  activeId: string | null
  activeRef: React.RefObject<string | null>
  addFiles: (
    files: FileList | File[],
    cible?: string | undefined,
    cleDeDoublon?: (fichier: { name: string; size: number }) => string
  ) => Promise<void>
  agirSurPassage: (action: ActionPassage, texte: string) => void
  annulerEnvoi: (receipt: DirectiveReceipt) => void
  arretsAuto: Record<string, string>
  attachmentError: string | null
  attachments: ChatAttachment[]
  autoActif: boolean
  autoConvs: Set<string>
  autoNouveauFil: boolean
  avisApp: React.JSX.Element | null
  basculeConvRef: React.RefObject<boolean>
  basculerModeAuto: () => void
  basculerNavigateur: () => void
  bindingEffectif: ModeleDuFil | null
  brouillonPresent: boolean
  bulkDeleteAsking: boolean
  bulkDeleteError: string | null
  bureauxNonVus: number
  bureauxOuverts: boolean
  busy: boolean
  busyConversations: Set<string>
  cadrageReplie: Record<string, string>
  changerModeleDuFil: (option: OrchestratorModelOption | null) => Promise<void>
  composerDraftKeyRef: React.RefObject<string>
  composerRef: React.RefObject<ChatComposerHandle | null>
  comptesDeConversation: OrchestratorAccounts | undefined
  confirmBulkDelete: () => Promise<void>
  confirmDeleteRun: () => Promise<void>
  confirmRemoveConv: () => Promise<void>
  confirmRenameConv: () => Promise<void>
  contextesStatiques: Record<string, ContexteStatique>
  convLoad: {
    status: 'error' | 'idle' | 'loading'
    target?: Conv | undefined
    error?: string | undefined
  }
  convs: Conv[]
  copieAffichee: CopieAffichee | null
  defaultWorkspace: string | undefined
  deleteCandidate: Conv | null
  deleteRunCandidate: {
    run: RunEntry
    scope: 'conv' | 'tous'
    conversationId?: string | undefined
  } | null
  dernierScrollTopRef: React.RefObject<number>
  descenteEnVolRef: React.RefObject<boolean>
  dossierProjetAffiche: string | undefined
  dragActive: boolean
  effacerArretAuto: (conversationId: string) => void
  estDossierPersonnel: (chemin: string | null | undefined) => boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  filRendu: React.JSX.Element[]
  followTailRef: React.RefObject<boolean>
  friction: FrictionEchecsRepetes | undefined
  gesteLecteurRef: React.RefObject<boolean>
  ghostRecommendation: string | null
  gitBranch: string | null
  gitCwd: string | undefined
  handleBtw: () => boolean
  hasNewActivity: boolean
  hypothesesCadrage: Record<string, HypotheseDeCadrage[]>
  identifiantCopie: string | null
  interruptingConversations: Set<string>
  isActive: boolean
  jaugeCourante: ContextGauge | undefined
  listeNonPubliee: boolean
  listeTelOuverte: boolean
  liveRuns: Record<string, ScopedLiveRun<OrchStep>>
  loadConv: (c: Conv, filDeRepli?: readonly Msg[] | undefined) => Promise<void>
  mentionSources: MentionSources
  messageNonPublieMasque: string | null
  messages: Msg[]
  messagesUtilisateurAvantDebut: number
  modelCatalog: RuntimeModel[]
  modelCatalogLoaded: boolean
  modelChangeError: string | null
  modelChangePending: boolean
  modeleDuFil: ModeleDuFil | null
  navigateurOuvert: boolean
  ongletDuFilOuvert: number | 'chef' | null
  openRunsCount: number
  pagesNonVues: number
  passageSelectionne: (PassageAffiche & { fil: string | null }) | null
  phrasesAccueil: string[]
  placePanneau: string
  planDuFilOuvert: PlanDeLots | null
  pointerMomentVideo: (moment: MomentPointe) => void
  positionARestaurerRef: React.RefObject<PositionLecture | null>
  propositionsSuite: PropositionSuite[]
  questionACoteOuverte: boolean
  questionsDesLots: ReadonlySet<string>
  queueCurrentMessage: () => void
  quotaHebdoConnu: boolean
  rechercheFilOuverte: boolean
  remplirSaisie: (texte: string) => void
  renameCandidate: { conv: Conv; value: string } | null
  rendrePiecesJointesEnAttente: (
    fichiers: ChatAttachment[],
    retirer: (index: number) => void
  ) => React.ReactNode
  repriseEnCours: boolean
  resumeAvailable: boolean
  resumePilotTurn: (cible?: string | undefined) => Promise<void>
  retirerPieceJointeDuBrouillonCourant: (fileIndex: number) => void
  runDeleteError: string | null
  runDeletePending: boolean
  runDuCadrageRef: React.RefObject<Record<string, string>>
  runtimeIdentity: ChatRuntimeIdentity | null
  scrolledAwayFromTail: boolean
  scrollRef: React.RefObject<HTMLDivElement | null>
  selectedConvIds: ReadonlySet<string>
  send: (text?: string | undefined, options?: SendOptions | undefined) => Promise<void>
  setBrancheMenu: React.Dispatch<
    React.SetStateAction<{
      top: number
      left: number
      branches: string[] | null
      refus?: string | undefined
    } | null>
  >
  setBrouillonPresent: React.Dispatch<React.SetStateAction<boolean>>
  setBulkDeleteAsking: React.Dispatch<React.SetStateAction<boolean>>
  setCadrageReplie: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setConvFolderMenu: React.Dispatch<
    React.SetStateAction<{
      conv: Conv | null
      ids?: string[] | undefined
      top: number
      left: number
      mode: 'dossier' | 'categorie'
    } | null>
  >
  setDeleteCandidate: React.Dispatch<React.SetStateAction<Conv | null>>
  setDeleteRunCandidate: React.Dispatch<
    React.SetStateAction<{
      run: RunEntry
      scope: 'conv' | 'tous'
      conversationId?: string | undefined
    } | null>
  >
  setDraftInput: (key: string, value: string) => void
  setDragActive: React.Dispatch<React.SetStateAction<boolean>>
  setHasNewActivity: React.Dispatch<React.SetStateAction<boolean>>
  setIdentifiantCopie: React.Dispatch<React.SetStateAction<string | null>>
  setListeNonPubliee: React.Dispatch<React.SetStateAction<boolean>>
  setListeTelOuverte: React.Dispatch<React.SetStateAction<boolean>>
  setMessageNonPublieMasque: React.Dispatch<React.SetStateAction<string | null>>
  setPanneaux: (
    changer: (
      ouverts: Readonly<Record<string, OutilDuPanneau>>
    ) => Readonly<Record<string, OutilDuPanneau>>
  ) => void
  setQuestionACoteOuverte: React.Dispatch<React.SetStateAction<boolean>>
  setRechercheFilOuverte: React.Dispatch<React.SetStateAction<boolean>>
  setRenameCandidate: React.Dispatch<React.SetStateAction<{ conv: Conv; value: string } | null>>
  setScrolledAwayFromTail: React.Dispatch<React.SetStateAction<boolean>>
  setShowRuns: React.Dispatch<React.SetStateAction<boolean>>
  showRuns: boolean
  skillCommands: SlashCommand[]
  stopPilotTurn: (cible?: string | undefined) => void
  surClicLienDuFil: (event: React.MouseEvent<HTMLElement, MouseEvent>) => void
  surRelachementDansLeFil: () => void
  traiterTravauxNonPublies: () => Promise<void>
  travailNonPublie: string | null
  usagesAccueil: UsageDeSkill[]
}): React.JSX.Element {
  return (
    <section
      className={`lisere-dessus chat${dragActive ? ' is-file-dragging' : ''}`}
      onDragEnter={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault()
          setDragActive(true)
        }
      }}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault()
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragActive(false)
        void addFiles(event.dataTransfer.files)
      }}
      onClick={surClicLienDuFil}
    >
      {dragActive && (
        <div className="file-drop-overlay" aria-hidden="true">
          <strong>{texteFil('depot.titre')}</strong>
          <span>{texteFil('depot.detail')}</span>
        </div>
      )}
      {rechercheFilOuverte && (
        <ChatFindBar
          racine={() => scrollRef.current}
          onFermer={() => setRechercheFilOuverte(false)}
        />
      )}
      <EnTeteDuFil
        active={active}
        activeId={activeId}
        basculerNavigateur={basculerNavigateur}
        bindingEffectif={bindingEffectif}
        bureauxNonVus={bureauxNonVus}
        bureauxOuverts={bureauxOuverts}
        busy={busy}
        changerModeleDuFil={changerModeleDuFil}
        comptesDeConversation={comptesDeConversation}
        contextesStatiques={contextesStatiques}
        copieAffichee={copieAffichee}
        defaultWorkspace={defaultWorkspace}
        dossierProjetAffiche={dossierProjetAffiche}
        estDossierPersonnel={estDossierPersonnel}
        gitBranch={gitBranch}
        gitCwd={gitCwd}
        identifiantCopie={identifiantCopie}
        jaugeCourante={jaugeCourante}
        listeTelOuverte={listeTelOuverte}
        modelCatalog={modelCatalog}
        modelCatalogLoaded={modelCatalogLoaded}
        modelChangeError={modelChangeError}
        modelChangePending={modelChangePending}
        modeleDuFil={modeleDuFil}
        navigateurOuvert={navigateurOuvert}
        openRunsCount={openRunsCount}
        pagesNonVues={pagesNonVues}
        placePanneau={placePanneau}
        runtimeIdentity={runtimeIdentity}
        send={send}
        setBrancheMenu={setBrancheMenu}
        setConvFolderMenu={setConvFolderMenu}
        setIdentifiantCopie={setIdentifiantCopie}
        setListeTelOuverte={setListeTelOuverte}
        setPanneaux={setPanneaux}
        setShowRuns={setShowRuns}
        showRuns={showRuns}
      />

      {travailNonPublie && travailNonPublie !== messageNonPublieMasque && (
        <div
          className="chat-workflow-notice chat-travail-non-publie fade-in"
          data-testid="chat-travail-non-publie"
          role="status"
        >
          <span>{travailNonPublie}</span>
          <button
            type="button"
            data-testid="chat-travail-non-publie-traiter"
            onClick={() => void traiterTravauxNonPublies()}
            title={texteFil('nonPublie.traiter.titre')}
          >
            {texteFil('nonPublie.traiter')}
          </button>
          <button
            type="button"
            data-testid="chat-travail-non-publie-ouvrir"
            onClick={() => setListeNonPubliee((v) => !v)}
            title={texteFil('nonPublie.liste.titre')}
          >
            {texteFil('nonPublie.liste')}
          </button>
          <button
            type="button"
            data-testid="chat-travail-non-publie-fermer"
            className="chat-travail-non-publie__fermer"
            onClick={() => setMessageNonPublieMasque(travailNonPublie)}
            aria-label={texteFil('nonPublie.fermer')}
            title={texteFil('nonPublie.masquer')}
          >
            ×
          </button>
        </div>
      )}
      {listeNonPubliee && <TravauxNonPublies onFermer={() => setListeNonPubliee(false)} />}

      {avisApp}
      {activeId && arretsAuto[activeId] && (
        <div className="chat-workflow-notice fade-in" data-testid="chat-auto-arret" role="alert">
          <span>
            {`« ${convs.find((c) => c.id === activeId)?.title || activeId} » — ${arretsAuto[activeId]}`}
          </span>
          {/* Seuil réglable : le bandeau ouvre Settings › Behaviour au lieu d'un chemin à recopier,
                  qui avait vieilli sans bruit (« Settings › Budget », section retirée le 23/10). Le
                  nom `behaviour` mène à cette section (shared/navigation.ts). */}
          {arretReglableDansBehaviour(arretsAuto[activeId]) && (
            <button
              type="button"
              data-testid="chat-auto-arret-reglages"
              className="chat-workflow-notice__action"
              onClick={() => void window.api.appCommand?.('navigate', { tab: 'behaviour' })}
              title={texteFil('auto.ouvrirSeuils.titre')}
            >
              {texteFil('auto.ouvrirSeuils')}
            </button>
          )}
          <button
            type="button"
            onClick={() => effacerArretAuto(activeId)}
            aria-label={texteFil('auto.fermerArret')}
          >
            ×
          </button>
        </div>
      )}

      {activeId && autoActif && !quotaHebdoConnu && (
        <div
          className="chat-workflow-notice fade-in"
          data-testid="chat-auto-quota-inconnu"
          role="status"
        >
          <span>
            {texteFil('auto.quotaInconnu', {
              tours: lireSeuilsChaine(window.localStorage.getItem(CLE_SEUILS_CHAINE_AUTO))
                .toursAutoMax
            })}
          </span>
        </div>
      )}

      {/* Rendues dans `body`, comme la carte de suppression des fils : dans le panneau
              du chat, la poignée de largeur de la liste (`.conv-pane-resizer`) passait au-dessus. */}
      {renameCandidate &&
        createPortal(
          <CarteRenommerConversation
            confirmRenameConv={confirmRenameConv}
            renameCandidate={renameCandidate}
            setRenameCandidate={setRenameCandidate}
          />,
          document.body
        )}

      {/* Une conversation ou un lot : la même carte, qui nomme les fils et leurs messages
              (« Implémenter la 2 · En-tête en ligne »). */}
      {deleteCandidate && (
        <SuppressionConversationsCarte
          fils={[deleteCandidate]}
          total={1}
          onGarder={() => setDeleteCandidate(null)}
          onSupprimer={() => void confirmRemoveConv()}
        />
      )}

      {bulkDeleteAsking && (
        <SuppressionConversationsCarte
          fils={convs.filter((c) => selectedConvIds.has(c.id))}
          total={selectedConvIds.size}
          erreur={bulkDeleteError}
          onGarder={() => setBulkDeleteAsking(false)}
          onSupprimer={() => void confirmBulkDelete()}
        />
      )}

      {deleteRunCandidate &&
        createPortal(
          <CarteSuppressionRun
            confirmDeleteRun={confirmDeleteRun}
            deleteRunCandidate={deleteRunCandidate}
            runDeleteError={runDeleteError}
            runDeletePending={runDeletePending}
            setDeleteRunCandidate={setDeleteRunCandidate}
          />,
          document.body
        )}

      <FilDesMessages
        activeDirectiveReceipts={activeDirectiveReceipts}
        activeId={activeId}
        activeRef={activeRef}
        annulerEnvoi={annulerEnvoi}
        basculeConvRef={basculeConvRef}
        brouillonPresent={brouillonPresent}
        busy={busy}
        busyConversations={busyConversations}
        convLoad={convLoad}
        dernierScrollTopRef={dernierScrollTopRef}
        descenteEnVolRef={descenteEnVolRef}
        filRendu={filRendu}
        followTailRef={followTailRef}
        gesteLecteurRef={gesteLecteurRef}
        isActive={isActive}
        liveRuns={liveRuns}
        loadConv={loadConv}
        messages={messages}
        phrasesAccueil={phrasesAccueil}
        pointerMomentVideo={pointerMomentVideo}
        remplirSaisie={remplirSaisie}
        repriseEnCours={repriseEnCours}
        scrollRef={scrollRef}
        setHasNewActivity={setHasNewActivity}
        setScrolledAwayFromTail={setScrolledAwayFromTail}
        surRelachementDansLeFil={surRelachementDansLeFil}
        usagesAccueil={usagesAccueil}
      />

      {/* Ascenseur à crans du fil (« 1 · Dépli en place ») : remplace l'ascenseur
              du système, un cran par message de l'utilisateur, carte du fil à la molette. */}
      <AscenseurDuFil
        key={activeId ?? 'aucune'}
        conteneurRef={scrollRef}
        numeroDepart={messagesUtilisateurAvantDebut}
        onGesteLecteur={() => {
          gesteLecteurRef.current = true
        }}
      />

      {passageSelectionne && passageSelectionne.fil === activeId && (
        <BarrePassage passage={passageSelectionne} onAction={agirSurPassage} />
      )}

      {(hasNewActivity || scrolledAwayFromTail) && (
        <button
          type="button"
          className="chat-jump-latest"
          onClick={() => {
            followTailRef.current = true
            setHasNewActivity(false)
            setScrolledAwayFromTail(false)
            /*
             * DESCENDRE PAR LE BOUTON, C'EST QUITTER SA LECTURE (2026-10-23). La
             * position retenue ne partait que si un `scroll` touchait le bas pendant que le
             * drapeau « geste du lecteur » etait leve ; apres une reprise de lecture, il est
             * baisse, et le rechargement suivant du fil y RAMENAIT le lecteur. Meme regle qu'a
             * l'envoi. Temoin : `ChatView.bouton-dernier-message-rechargement.test.tsx`.
             */
            positionARestaurerRef.current = null
            if (activeRef.current) oublierPositionLecture(activeRef.current)
            if (scrollRef.current) scrollChatToBottom(scrollRef.current)
          }}
        >
          {hasNewActivity ? texteFil('fil.derniereReponse') : texteFil('fil.dernierMessage')}
        </button>
      )}

      {/*
       * LA DEMANDE D'AUTORISATION DE PRODUCTION VIT ICI, DANS LE FIL — pas en fenêtre flottante.
       * Elle se pose au bas de la conversation, juste au-dessus de la file d'attente et de la
       * zone de saisie : l'utilisateur lit la cible et l'opération SANS perdre de vue ce que
       * l'agent venait de dire, et le reste de l'application reste utilisable pendant qu'il
       * décide. La version précédente couvrait tout l'écran d'un voile translucide et rendait le
       * fil et la question illisibles l'un à travers l'autre (capture).
       */}
      <ProdAutorisationHote conversationId={activeId} />
      {/* Les messages entre agents de fils du même dépôt vivent dans Détails > Runs
              (2026-10-25 : « ranges ce bloc dans Détails > Runs »), plus ici. */}
      {/*
       * LA FRISE DE LA SUPER CONV, EN BAS (2026-10-31 : « ce bloc mets-le plutôt en
       * bas »). Sous l'en-tête, elle poussait le fil vers le bas et le lecteur la traversait à
       * chaque arrivée sur le fil. Elle se pose ici, juste au-dessus du tableau du plan, qui
       * complète sa ligne de chiffres. Les onglets ne bougent pas : `fixed`, dans la bande des
       * boutons de fenêtre (SuperConvMosaique.css), quel que soit l'endroit du bloc.
       */}
      {planDuFilOuvert && ongletDuFilOuvert !== null ? (
        <BarriereErreur zone="chat-lots" cle={planDuFilOuvert.id}>
          <SuperConvDuChat
            key={planDuFilOuvert.id}
            plan={planDuFilOuvert}
            onglet={ongletDuFilOuvert}
            questions={questionsDesLots}
          />
        </BarriereErreur>
      ) : null}
      {/* Plan de lots d'un fil chef : avancement, et le seul clic qui le lance. */}
      <BarriereErreur zone="chat-lots" cle={activeId}>
        <TableauDesLots conversationId={activeId} aCoteDeLaFrise={ongletDuFilOuvert !== null} />
      </BarriereErreur>
      {questionACoteOuverte && activeId && (
        <BarriereErreur zone="chat-question-a-cote" cle={activeId}>
          <QuestionACote
            key={activeId}
            conversationId={activeId}
            onFermer={() => {
              setQuestionACoteOuverte(false)
              composerRef.current?.focus()
            }}
          />
        </BarriereErreur>
      )}
      <SaisieDuFil
        activeId={activeId}
        addFiles={addFiles}
        attachmentError={attachmentError}
        attachments={attachments}
        autoConvs={autoConvs}
        autoNouveauFil={autoNouveauFil}
        basculerModeAuto={basculerModeAuto}
        bindingEffectif={bindingEffectif}
        busy={busy}
        cadrageReplie={cadrageReplie}
        composerDraftKeyRef={composerDraftKeyRef}
        composerRef={composerRef}
        comptesDeConversation={comptesDeConversation}
        fileInputRef={fileInputRef}
        friction={friction}
        ghostRecommendation={ghostRecommendation}
        handleBtw={handleBtw}
        hypothesesCadrage={hypothesesCadrage}
        interruptingConversations={interruptingConversations}
        mentionSources={mentionSources}
        propositionsSuite={propositionsSuite}
        questionACoteOuverte={questionACoteOuverte}
        queueCurrentMessage={queueCurrentMessage}
        rendrePiecesJointesEnAttente={rendrePiecesJointesEnAttente}
        resumeAvailable={resumeAvailable}
        resumePilotTurn={resumePilotTurn}
        retirerPieceJointeDuBrouillonCourant={retirerPieceJointeDuBrouillonCourant}
        runDuCadrageRef={runDuCadrageRef}
        send={send}
        setBrouillonPresent={setBrouillonPresent}
        setCadrageReplie={setCadrageReplie}
        setDraftInput={setDraftInput}
        setQuestionACoteOuverte={setQuestionACoteOuverte}
        skillCommands={skillCommands}
        stopPilotTurn={stopPilotTurn}
      />
    </section>
  )
}
