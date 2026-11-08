// Parcours séquentiel (scout → frame → build → clean → judge) — méthodes de la classe Orchestrator déplacées telles quelles depuis
// orchestrator.ts ; elles s'exécutent avec `this` = l'instance, via les délégués de la classe.
import { deciderDuPassage, traceDuPassage } from './boucle-reparation'
import { randomUUID } from 'node:crypto'
import { clampAggregateForJudge, serializeEvidenceForJudge } from '../verify/evidence-digest'
import {
  noteDuJuge,
  noteVerdictPrecedentPourJuge,
  reservesMineuresFigees,
  verdictPanelPourMemoire
} from '../juge/memoire-juge'
import { noteChangementsPourJuge } from '../juge/changements-juge'
import { noteTestsDejaJouesPourJuge } from '../verify/tests-deja-joues'
import { etapeResultatValide } from '../../shared/resultat-valide'
import { CONTRAT_OBJECTIONS, CONTRAT_QUESTIONS_AU_BUILD, dodDuVerdict, verdictAvecObjectionsPortees, verdictPanelValide, consigneTestsDuJuge, empreintesTestsDuJuge, empreintesDesFichiers, motifsTestModifie, reservesMineuresDuScout, resultatAvecReservesDuJuge, defautsDeLaRelectureSeule, objectionsDuJuge, resultatDeRelectureSeule, rejouerTestsDuJuge, noteDuRejeuDuJuge } from '../juge/objections-juge'
import type { RoleBinding } from '../profil/roles'
import { advisorAccepte } from '../providers/claude-advisor'
import { issueDuPanel, motifPanneDesJuges, noteDesAbsents, verdictDuPanel } from './quorum'
import { evaluateClosure, plafondDurReparations, reparationsAutorisees } from '../gates/stopgate'
import { mesureBundlePerime } from '../gates/bundle-perime'
import { fichiersEditesParLeRun } from '../hooks/default-gate-hooks'
import { type IndependentLearningAttestation } from '../brain/outcome-learning-proposal'
import { agregerPhasesPourLeJuge, agregerPhasesPourLUtilisateur } from '../juge/agregat-juge'
import { type NodePhase, isPipelinePhase } from '../skills/skill-pipeline'
import { etatDeCloture } from '../gardes/root-execution-contract'
import { isMutationTask } from './task-mutation-classifier'
import { routeSkillRequest } from '../skills/skill-routing'
import { nodeRanks, quorumForPhase, recoveriesFromGraph, type WorkflowGraph } from '../workflow/workflow-graph'
import { sortieScoutAvecCible } from '../scout/scout-cible'
import { sortieThinkAvecForme } from '../consignes/think-briefing'
import { shaHeadSurDisque } from '../git/depot-git'
import { ajusterNotesSurChoix, lecteurAncrageDepuisDisque, marquerDejaFait, plafonnerNotesScout, type SujetDejaFait } from '../scout/scout-plafond'
import { blocPistesDejaConnues, type FacteursChoix } from '../scout/scout-memoire'
import { sortieFrameAvecCasLimites } from './frame-cas-limites'
import { consigneDeLaReponse, consigneDeReprise, DELAI_QUESTION_CADRAGE_MS, issueDeRelecturePourLeCout, ligneDePanneDeRelecture, ligneDeRelecture, lireRelecture, promptDeRelecture, questionDuCadrageRepris, relectureAPasser, type IssueDeRelecture } from '../juge/relecture-froide'
import { briefArbitrage, createMidPhaseSupervision, readRouteVerdict, type RouteVerdict } from '../modeles/route-drift'
import { noterAppelCourt, ROLE_PETITES_TACHES, signalerPanneAppelCourt } from './petites-taches-trace'
import { estJugeTerminal, motifChaineApresJugeNonJouee, noeudsApresJuge, initialBudget, nextNode, readModelChoice, resolveChoice, type ModelChoice, type NodeVerdict } from '../workflow/workflow-walk'
import { phasesApresJugeHorsGraphe } from './task-regime'
import { CONSIGNE_RELECTURE_FROIDE, consigneFusionScout } from '../consignes/phase-briefs'
import { contratDeLaConversation, noteContratPourJuge } from '../conversations/conversation-task-contract'
import { hypothesesDuCadrage, noteHypothesesPourJuge } from '../../shared/cadrage-confiance'
import { convRunsRoot } from '../runs/conv-runs'
import { personaInstruction, WORKFLOW_IS_A_TOOL_INSTRUCTION } from '../../shared/persona'
import { retrieveBrainContext } from '../brain/brain-retrieval'
import { fusionnerListesBrain } from '../brain/brain-perso'
import { brainCorpusForWorkspace, scopeBrainRetrieval } from '../brain/brain-corpus-scope'
import { ECHO_MAX_BLOCK_CHARS, evictedCount, rememberedFacts, sessionMemoryBlock } from '../brain/session-memory-echo'
import { projectContextBlock } from '../consignes/context-files'
import { blocProfilUtilisateur } from '../profil/profil-utilisateur'
import { blocMemoireDeTete } from '../brain/memoire-de-tete'
import { blocLangueDeReponse } from '../profil/langue-reglage'
import type { ExecutionEvidence, PromptEnvelope, SendOptions, SendResult, Usage } from '../providers/types'
import { appendWorkspaceMutationEvidence, captureWorkspaceMutationSnapshot } from '../providers/workspace-mutation-evidence'
import { blocDEchange, decisionEchangeSansCause, empechementDEchange, inscrireEchangeAuJournal, lignesDeCause, questionSansCause } from '../gates/echange-sans-cause'
import { blocReponseAuJuge, examinerQuestionsDuJuge, questionsPourLeBuild, reponseInutilisable } from '../gates/echange-questions-juge'
import { STYLE_TON } from '../consignes/response-style'
import { CONSTITUTION } from '../consignes/constitution'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'
import { consigneBureauCache } from '../consignes/consigne-bureau-cache'
import { evidenceDeLErreur } from '../providers/evidence-portee-par-erreur'
import { classifyProviderFailure, describeFanoutFailure, explainRoleFailure, modeleDeRepliApresRefus } from '../providers/provider-failure-diagnosis'
import { CONTRAT_ETENDUE, doitDemanderLEtendue, issueDeLaReponse, objectionDEtendue, questionDEtendue } from '../gates/etendue-repetee'
import { TOURS_OUTILS_MAX, compteRenduDesOutils, demandeUnOutil, executerOutilsDuNoeud, lanceurQuiCompteLesNotes, type LanceurCommandeSkill } from '../skills/skill-node-tools'
import { demarrerServeurOutilsNoeudSkill, lecturesDirectesDuBrain, libelleAppelObserve, porteLesOutilsNatifs, type ServeurOutilsNoeudSkill } from '../skills/skill-node-mcp'
import { sharedBrainRoot } from '../brain/brain-paths'
import { BrainRetrievalEvent, GreedyTaskNode, JUDGE_FORMAT_CONTRACT, JUDGE_PHASE_CAP, JUDGE_TOOLSET_CONTRACT, OrchestrationPhase, OrchestrationResult, OrchestrationRuntimeSnapshot, OrchestrationStep, PhasePromptBlock, attestJudgeApprovedLearning, bindingDePhaseValide, bindingDeRepliPourPhase, consigneCandidatesBrain, costOfTrace, dernierJugeLitLeTexteFinal, evidenceSatisfiesTask, lireVerdictJuge, phasesApresBuildDeReparation, porterVersPhaseSuivante, sandboxForPhase, sansRetourReparationJuge, taskForPipelineContext, verdictDePhase, workspaceIsolationNotice } from './orchestrator-contrats'
import type { Orchestrator } from './orchestrator'
import { citationIntrouvableSurDisque } from './orchestrator'

export async function runInner(
  this: Orchestrator,
  task: string,
  workCwd: string,
  onStep?: (s: OrchestrationStep) => void,
  onPhase?: (p: OrchestrationPhase) => void,
  onDelta?: (step: 'exec' | 'judge', delta: string, note?: string, reasoning?: string) => void,
  signal?: AbortSignal,
  greedyPlan?: GreedyTaskNode[],
  collectedContext = '',
  runId = '',
  /** SURVIE NIVEAU 3 : acquis d'un run interrompu → ces phases sont REJOUÉES, pas refaites. */
  resumeOutputs: {
    phase: NodePhase
    text: string
    agentToken?: string
    executionEvidence?: ExecutionEvidence[]
  }[] = [],
  conversationId?: string,
  bindingOverride?: RoleBinding,
  onBrainRetrieved?: (event: BrainRetrievalEvent) => void,
  turnId?: string,
  runtimeSnapshot?: OrchestrationRuntimeSnapshot
): Promise<OrchestrationResult> {
  if (!runtimeSnapshot) {
    throw new Error("Snapshot runtime manquant dans le coeur d'orchestration")
  }
  if (conversationId || turnId) this.costContextByRun.set(runId, { conversationId, turnId })
  const { registry, roles, trust } = this.deps
  const cost = this.costFor(runId)
  // Souveraineté contexte (décision PLIER) : Autowin lit LUI-MÊME le fichier projet gagnant de la
  // chaîne de précédence et le plie dans chaque system → source unique, quel que soit le modèle.
  const projectContext =
    projectContextBlock(this.deps.executionWorkspace) +
    blocProfilUtilisateur() +
    blocMemoireDeTete() +
    blocLangueDeReponse()
  const trace: OrchestrationStep[] = []
  const push = (s: OrchestrationStep): void => {
    trace.push(s)
    onStep?.(s)
  }
  /**
   * LES PISTES DEJA PROPOSEES sur ce depot (`scout-memoire.ts`), lues UNE fois, avant tout scout du
   * run : une reparation du scout ne doit pas se voir interdire sa propre liste. Une memoire
   * illisible ne bloque pas le run, mais se DIT dans la trace.
   */
  let blocPistesConnues = ''
  let facteursChoix: FacteursChoix = {}
  try {
    // D'abord les CHOIX : une demande de sélection dit quelles pistes du scout précédent ont été
    // prises et lesquelles laissées (piste 7) ; le bilan suit, dans la même consigne.
    this.deps.memoireScout?.choisir?.(this.deps.executionWorkspace, task, runId)
    blocPistesConnues = blocPistesDejaConnues(
      this.deps.memoireScout?.connues(this.deps.executionWorkspace, runId, task) ?? [],
      this.deps.memoireScout?.bilan?.(this.deps.executionWorkspace) ?? ''
    )
    facteursChoix = this.deps.memoireScout?.facteurs?.(this.deps.executionWorkspace) ?? {}
  } catch (erreur) {
    push({
      step: 'gate',
      role: 'gate',
      detail: `mémoire des pistes du scout illisible (${erreur instanceof Error ? erreur.message : String(erreur)}) — le scout part sans elle`
    })
  }
  const consigneDePhase = (phase: NodePhase, withFoundation: boolean): PhasePromptBlock => {
    const consigne = this.phasePrompt(phase, withFoundation)
    return phase === 'scout' && blocPistesConnues
      ? { ...consigne, text: `${consigne.text}\n\n${blocPistesConnues}` }
      : consigne
  }

  // 1. Le sous-agent EXÉCUTE la tâche via la PIPELINE de phases (1 skill du kit par phase,
  //    provider-agnostique). Défaut ['build'] = exec simple ; prod = ['frame','build'] etc.
  const subBinding =
    bindingOverride ?? runtimeSnapshot?.roles.subagent ?? roles.getBinding('subagent')
  const subProvider = subBinding.provider
  // Sélection ADAPTATIVE (proportionnalité) : `classifyPhases(task)` prime si fourni — une tâche
  // triviale ne joue pas les 5 phases. Fallback `execPhases` statique (rétrocompat/tests).
  // Un workflow nommé REMPLACE ce pipeline : c'est ici que l'exécution se décide (le calcul du
  // devis, plus haut, en fait sa propre lecture — les deux doivent voir la même liste).
  const execPhases: NodePhase[] = this.effectivePhases(task)
  /**
   * Le verdict de la phase qui vient de finir. C'est lui qui décide quelle arête le marcheur franchit.
   * Vert par défaut, DÉLIBÉRÉMENT : une phase qui ne déclare rien ne doit pas déclencher une réparation
   * que personne n'a demandée. Seul un rejet explicite en tête de sortie fait basculer au rouge —
   * même idiome qu'au juge, dont la validité se lit déjà sur les premiers mots de son verdict.
   */
  let dernierVerdict: NodeVerdict = 'green'
  /**
   * Ce que le modèle a demandé pour la suite, ou rien.
   *
   * Consommé à chaque pas puis remis à zéro : un souhait ne vaut que pour la transition qui suit,
   * sinon il repiloterait tout le reste du run depuis une phase déjà passée.
   */
  let souhaitModele: ModelChoice
  /**
   * La suite des phases à jouer. Avec un graphe, on le MARCHE (retours compris, budgets consommés) ;
   * sans graphe, on déroule la liste plate d'avant. Un générateur plutôt qu'un tableau : la suite ne
   * peut pas être connue à l'avance, elle dépend du verdict de chaque phase au moment où elle finit.
   */
  // `graphePourTache` et non le workflow brut : sur une demande triviale, AUCUN graphe ne pilote —
  // ni la marche, ni la consigne « tu peux dévier », qui parlerait d'étapes qu'on ne joue pas.
  const grapheBrut = this.graphePourTache(task)
  /**
   * Le graphe tel que le MARCHEUR le voit — privé du seul retour `judge --red--> build`.
   *
   * Ce retour-là est déjà joué en aval par la boucle de réparation, qui fait plus que revenir au
   * build : elle le RENOURRIT des raisons du gate. Le laisser aussi au marcheur le jouerait DEUX
   * fois, et doublerait silencieusement le coût que le devis a provisionné.
   */
  const graphePilote: WorkflowGraph | undefined = grapheBrut
    ? sansRetourReparationJuge(grapheBrut)
    : undefined
  /**
   * Plafond de BIFURCATIONS, sur les DEUX branches. Il existe pour la même raison que
   * `maxTraversals` sur une arête de retour : sans borne, une phase qui redemande la même
   * déviation à chaque tentative ne finit jamais, et le devis cesse d'être calculable. Trois
   * suffit — au-delà, ce n'est plus une correction de route, c'est une girouette.
   *
   * IL NE BORNAIT QUE LA BRANCHE SANS GRAPHE, et c'était un trou béant. Avec un graphe — le cas
   * courant — `nextNode()` honore le souhait du modèle même vers une phase qu'AUCUNE arête ne
   * desservait ; il fabrique alors une arête synthétique, qui par construction n'a aucune entrée
   * dans la Map de budget. Mesuré : 250 bifurcations auto-référentes laissent `budget.size === 0`.
   * Seul le garde-fou générique `pas < 200` arrêtait la course, soit jusqu'à 200 phases RÉELLEMENT
   * payées au lieu de trois — la contrainte « le pire cas du devis reste calculable » était donc
   * violée précisément par le mécanisme censé la respecter.
   */
  const PLAFOND_BIFURCATIONS = 3
  let bifurcations = 0
  /** La phase que la demande NOMME (`/scout`, « scout … »), ou rien. */
  const phaseNommee = routeSkillRequest(task)?.explicitPhase
  /**
   * Le souhait du modèle est-il une BIFURCATION à décompter, ou un simple pas dans le graphe ?
   *
   * Une destination déjà desservie par une arête est prévue par le graphe : son budget la borne
   * déjà, la compter deux fois rétrécirait un workflow composé à la main. Ce qui doit être borné
   * ici est la destination HORS graphe, celle que le marcheur atteint par une arête inventée.
   */
  const bifurcationHorsGraphe = (
    graphe: WorkflowGraph,
    depuis: string,
    voulu: ModelChoice
  ): boolean => {
    if (!voulu || voulu.kind === 'stop') return false
    const cible = resolveChoice(graphe, voulu)
    if (!cible) return false
    return !graphe.edges.some((edge) => edge.from === depuis && edge.to === cible)
  }
  const suitePhases = function* (): Generator<NodePhase> {
    if (!graphePilote?.nodes?.length) {
      /**
       * SANS GRAPHE, la déviation était MORTE : `souhaitModele` n'était lu que par le marcheur, et
       * une liste plate se déroulait jusqu'au bout quoi qu'il arrive. Une dérive détectée
       * mi-parcours pouvait donc être mesurée, arbitrée, tracée — et ne rien changer à la suite du
       * run. Un mécanisme qui n'agit que dans la moitié des configurations est un décor.
       */
      for (const phase of execPhases) {
        yield phase
        const voulu = souhaitModele
        souhaitModele = undefined // consommé : un souhait ne vaut que pour CETTE transition
        if (!voulu) continue
        if (voulu.kind === 'stop') return
        if (voulu.kind === 'phase' && isPipelinePhase(voulu.phase)) {
          /*
           * UNE PHASE NOMMEE EST UNE COMMANDE ICI AUSSI : `graphePourTache` ecartait deja
           * le graphe pour un `/scout`, mais cette branche suivait encore le `SUITE: frame` du
           * modele, et le scout demande en lecture seule finissait en build dans un autre depot.
           * Seul le retour vers la MEME phase reste permis : c'est par lui qu'un cadrage refuse
           * (`frame-cas-limites.ts`) est refait.
           */
          if (phaseNommee && voulu.phase !== phaseNommee) {
            push({
              step: 'gate',
              role: 'gate',
              detail: `SUITE: ${voulu.phase} ignorée — la phase « ${phaseNommee} » a été nommée par la demande, aucune autre ne s'enchaîne.`
            })
            continue
          }
          if (bifurcations >= PLAFOND_BIFURCATIONS) continue
          bifurcations += 1
          yield voulu.phase
        }
      }
      return
    }
    const rangs = nodeRanks(graphePilote)
    const budget = initialBudget(graphePilote, rangs)
    const parId = new Map(graphePilote.nodes.map((node) => [node.id, node]))
    let courant: string | undefined = graphePilote.entry
    // Garde-fou de dernier ressort : les budgets bornent déjà le run, ce plafond n'existe que pour
    // qu'un graphe corrompu (arête vers un nœud absent, budget incohérent) ne fige pas le process.
    for (let pas = 0; pas < 200 && courant && parId.has(courant); pas++) {
      const node = parId.get(courant)!
      /**
       * Le juge TERMINAL du canevas est le gate final exécuté juste après cette marche. Le jouer
       * ici aussi ferait deux appels identiques (constaté sur le run réel), dont le
       * premier avait en plus le sandbox d'une phase de mutation. Un juge INTERMÉDIAIRE, lui,
       * garde son comportement de routage.
       *
       * La condition était « aucune arête sortante » — et elle ne s'est JAMAIS déclenchée : un
       * profil exprime « sur rouge, retourne au build » PAR une arête sortante, donc aucun des
       * sept profils livrés n'a de juge sans sortie. Le marcheur consommait alors le budget de
       * retour, puis la boucle de réparation relisait le MÊME `maxTraversals` comme s'il était
       * intact : 5 à 7 passages `build` mesurés là où le profil en annonce 2 ou 3, et un devis qui
       * sous-provisionnait d'autant. `estJugeTerminal` porte la définition juste — plus aucune
       * arête qui AVANCE — et la mesure vit dans `workflow-walk.recovery-budget.test.ts`.
       */
      if (estJugeTerminal(graphePilote, courant, rangs)) {
        return
      }
      yield node.phase
      let voulu = souhaitModele
      souhaitModele = undefined // consommé : un souhait ne vaut que pour CETTE transition
      // Une bifurcation HORS graphe se décompte, et au-delà du plafond on l'IGNORE : le graphe
      // reprend la main plutôt que le run continue de payer une déviation qui se répète.
      if (bifurcationHorsGraphe(graphePilote, courant, voulu)) {
        if (bifurcations >= PLAFOND_BIFURCATIONS) voulu = undefined
        else bifurcations += 1
      }
      const suivant = nextNode(graphePilote, courant, dernierVerdict, budget, rangs, voulu)
      if (!suivant) return
      courant = suivant.to
    }
  }
  let execPrompt
  let lastExecText = ''
  let lastUsage: Usage | undefined
  const aggregatedEvidence: ExecutionEvidence[] = []
  // SURVIE NIVEAU 3 : on repart de l'acquis persisté (phases déjà terminées avant le kill).
  // Une phase dont le livrable est VIDE n'est PAS un acquis : la sauter perdrait le travail
  // (constaté en réel — un run interrompu avait persisté `frame` avec 0 caractère). On ne reprend
  // donc que les phases porteuses de contenu ; les autres seront rejouées normalement.
  const usableResume = resumeOutputs.filter((output) => output.text.trim().length > 0)
  const phaseOutputs: {
    phase: NodePhase
    text: string
    agentToken?: string
    executionEvidence?: ExecutionEvidence[]
  }[] = [...usableResume]
  for (const output of usableResume) {
    aggregatedEvidence.push(...(output.executionEvidence ?? []))
  }
  /**
   * Début des preuves dont l'ORDRE est chronologique : base du bloc « TESTS DÉJÀ JOUÉS » du juge
   * (`tests-deja-joues.ts`, piste 4). Avance après une reprise, et après toute étape
   * où plusieurs agents travaillent en parallèle dans la même copie : leurs preuves arrivent dans
   * l'ordre où ils FINISSENT, pas dans celui où ils ont agi.
   * fix-ok: piste 4 — mesuré sur le contrôle final de run-a8a70cd0ee56-1 : 247 s dont 30 s
   * à relancer vitest et typecheck, faute de savoir si le code avait changé depuis ; sans cette
   * borne, le test d'un agent parallèle passerait pour postérieur à l'édition d'un autre.
   */
  let debutPreuvesOrdonnees = aggregatedEvidence.length
  /**
   * Les phases déjà payées, comptées par OCCURRENCE et non par nom.
   *
   * Un Set de noms de phase suffisait quand le moteur déroulait une liste plate où chaque phase
   * apparaissait une fois. Avec un graphe, un `frame` peut être rejoué LÉGITIMEMENT par une arête
   * de retour : un Set le sauterait pour toujours, et le travail annoncé par ce retour n'aurait
   * jamais lieu. On décompte donc : la 1re visite d'une phase reprise est sautée, les suivantes
   * s'exécutent.
   */
  const resteAPasser = new Map<NodePhase, number>()
  for (const output of usableResume) {
    resteAPasser.set(output.phase, (resteAPasser.get(output.phase) ?? 0) + 1)
  }
  /**
   * Le texte de CHAQUE visite reprise, dans l'ordre, par phase.
   *
   * Pré-amorcer le verdict depuis la seule DERNIÈRE phase reprise ne suffisait pas : la marche relit
   * `dernierVerdict` à chaque pas, et une phase rejouée sort par `dejaPayee` sans passer par
   * `recordPhase`. Un nœud intermédiaire choisissait donc son arête avec le verdict de quelqu'un
   * d'autre. Cas mesuré : acquis `scout → judge(ROUGE) → clean`, le pré-amorçage retenait `clean`
   * (vert), le marcheur franchissait l'arête VERTE au nœud judge et SAUTAIT la réparation que le
   * rouge devait déclencher — en se déclarant réussi.
   */
  const textesRepris = new Map<NodePhase, string[]>()
  for (const output of usableResume) {
    const file = textesRepris.get(output.phase) ?? []
    file.push(output.text)
    textesRepris.set(output.phase, file)
  }
  /** Consomme et rend le texte d'une occurrence déjà payée, dans son ordre réel. */
  const takePaidPhase = (phase: NodePhase): string | undefined => {
    const reste = resteAPasser.get(phase) ?? 0
    if (reste <= 0) return undefined
    resteAPasser.set(phase, reste - 1)
    // Le verdict de CETTE visite rejouée — même décompte que `resteAPasser`, donc la Nᵉ visite de la
    // phase consomme le Nᵉ acquis de cette phase. C'est ce qui fait suivre au rejeu le chemin
    // RÉELLEMENT emprunté avant l'interruption, et non celui du dernier acquis.
    const texte = textesRepris.get(phase)?.shift()
    if (texte !== undefined) dernierVerdict = verdictDePhase(phase, texte)
    return texte
  }
  /** `true` = occurrence déjà payée, donc aucun appel provider à rejouer. */
  const dejaPayee = (phase: NodePhase): boolean => takePaidPhase(phase) !== undefined
  const jugeReprisLitLeTexteFinal = dernierJugeLitLeTexteFinal(usableResume)
  /**
   * Le verdict repris du contrôle final : celui du DERNIER juge enregistré, et seulement s'il a lu le
   * texte final (`dernierJugeLitLeTexteFinal`). Les juges restants sont tous consommés : un verdict
   * intermédiaire ne doit être rejoué ni maintenant ni après la prochaine réparation.
   */
  const verdictReprisDuTexteFinal = (): string | undefined => {
    const repris: string[] = []
    let texte = takePaidPhase('judge')
    while (texte !== undefined) {
      repris.push(texte)
      texte = takePaidPhase('judge')
    }
    return jugeReprisLitLeTexteFinal ? repris.at(-1) : undefined
  }
  /**
   * Combien de phases ce run a RÉELLEMENT jouées (hors occurrences reprises via `dejaPayee`). La
   * boucle de réparation le relit : un passage qui n'a rien joué n'a rien changé à juger.
   */
  let phasesJouees = 0
  /**
   * LES NOTES QUE LE RUN DEPOSE AU BRAIN : chaque `remember` confirme d'un noeud, par
   * outil natif comme par repli texte, passe par CE lanceur. Le compte sort du run
   * (`notesBrainDeposees`) pour que la bulle dise « N notes en revue », pas « aucune leçon ».
   */
  let notesBrainDeposees = 0
  const lanceurQuiCompte = (): LanceurCommandeSkill | undefined => {
    const lanceur = this.deps.skillCommands?.()
    return lanceur && lanceurQuiCompteLesNotes(lanceur, () => (notesBrainDeposees += 1))
  }
  /**
   * LA GARDE « un scout engage une cible » (`scout-cible.ts`), appliquee AU TEXTE DE PHASE.
   *
   * Appliquee dans `recordPhase` SEULE, elle ne servait a rien : ce qui part vers la phase
   * suivante n'est pas `phaseOutputs` mais le texte pousse dans le contexte par l'appelant.
   * Elle est donc appliquee sur la variable que LES DEUX chemins lisent.
   */
  // Le PLAFOND DE PREUVE passe au meme endroit, et pour la meme raison : les deux chemins lisent
  // ce texte. Idempotent (une note deja a 50 ne bouge plus). Voir `scout-plafond.ts`.
  const lireAncrages = lecteurAncrageDepuisDisque(this.deps.executionWorkspace)
  // « Déjà fait ? » (piste 4) : `git log` tourne DANS le dossier de travail, donc sa
  // lecture rejoint celle des fichiers, que la fin du run attend (EBUSY, voir `lecturesDeFondByRun`).
  // Pas encore revenue quand le scout finit : pas de marque, rien d'autre ne change.
  let dejaFaits: readonly SujetDejaFait[] = []
  const lireDejaFaits = this.deps.memoireScout?.dejaFaits
  const lectureDejaFaits = lireDejaFaits
    ? Promise.resolve()
        .then(() => lireDejaFaits(this.deps.executionWorkspace))
        .then(
          (liste) => {
            dejaFaits = liste
          },
          (erreur: unknown) =>
            push({
              step: 'gate',
              role: 'gate',
              detail: `sujets déjà traités illisibles (${erreur instanceof Error ? erreur.message : String(erreur)}) — pas de marque « déjà fait ? »`
            })
        )
    : Promise.resolve()
  this.lecturesDeFondByRun.set(
    runId,
    Promise.all([lireAncrages.pret, lectureDejaFaits]).then(() => undefined)
  )
  // La note ajustee sur les choix reels passe AVANT le plafond : un aveu reste a 50.
  // fix-ok: le facteur des choix (piste 7) n'atteignait pas la note sans ce branchement :
  // orchestrator.scout-cible.test.ts rend 72 au lieu de 36 quand il manque.
  const garderCibleScout = (phase: NodePhase, texte: string): string =>
    phase === 'scout'
      ? sortieScoutAvecCible(
          marquerDejaFait(
            plafonnerNotesScout(ajusterNotesSurChoix(texte, facteursChoix), lireAncrages),
            dejaFaits
          )
        )
      : texte

  /**
   * MEME ACCROCHE, autre defaut mesure : un cadrage qui decrit une ENTREE utilisateur sans
   * enumerer ses cas limites ne part pas tel quel a `terrain`. Le refus est mis en tete et porte
   * `SUITE: frame`, donc le cadrage repasse par `frame` au lieu d'etre transmis incomplet.
   * Mesure (banc arena-bench-ax3, 3 repliques, une vague) : sans cas limites 0 correctif conforme
   * sur 3, avec la liste 3 sur 3. Voir `frame-cas-limites.ts`.
   */
  const garderCasLimitesFrame = (phase: NodePhase, texte: string): string =>
    phase === 'frame' ? sortieFrameAvecCasLimites(texte) : texte

  /**
   * MEME ACCROCHE pour le briefing `think` : sans les six titres de `skills/think/SKILL.md` §5, il
   * part AVERTI en tete, sans relance (`think` ignore `SUITE:`). Voir `think-briefing.ts`.
   */
  // fix-ok: 5 sorties `think` sur 34 (run-state, 2026-10-01) sans les six titres, aucune garde n'existait — branchee aux memes points que les deux autres.
  const garderFormeThink = (phase: NodePhase, texte: string): string =>
    phase === 'think' ? sortieThinkAvecForme(texte) : texte

  /** Enregistre une phase terminée ET notifie l'appelant pour qu'il persiste l'acquis. */
  const recordPhase = (
    phase: NodePhase,
    text: string,
    executionEvidence: ExecutionEvidence[] = [],
    /** `true` quand la ligne `SUITE:` finale vient de l'arbitre de dérive, pas du modèle. */
    suiteDeLArbitre = false
  ): void => {
    // Point d'accroche UNIQUE du verdict : tous les chemins de phase (séquentiel, fan-out, greedy)
    // passent par ici. Le brancher ailleurs laisserait une branche muette, donc un retour jamais pris.
    //
    // RESTREINT AU JUGE : seul son brief impose le vocabulaire `DEFAUT:`/`VALIDE`. Un `scout` ou un
    // `frame` rédige librement ; l'un d'eux ouvrant par « KO » ou « Rejeté » aurait fait basculer
    // tout le run sur une arête rouge que personne n'a demandée. Les autres phases sont vertes —
    // elles racontent leur travail, elles ne se prononcent pas.
    // UN SCOUT QUI N'ENGAGE RIEN ne se poursuit pas en silence. Il rend une LISTE ; en mode auto
    // personne ne choisit, et la phase suivante repart du tableau entier — donc de rien de precis.
    // La garde est de FORME (une cible declaree existe, ou non), la seule verifiable quand le
    // producteur et le juge sont le meme modele. Voir `scout-cible.ts`.
    const texte = garderCasLimitesFrame(
      phase,
      garderCibleScout(phase, garderFormeThink(phase, text))
    )
    dernierVerdict = verdictDePhase(phase, texte)
    // Le souhait du modèle pour la suite, s'il s'est prononcé. Il PRIME sur le graphe : un workflow
    // est un outil, et l'agent qui vient de travailler sait mieux que le plan si l'étape prévue a
    // encore un sens. Silence = le graphe décide, ce qui reste le cas courant.
    souhaitModele = readModelChoice(texte)
    // SAUF `think` : il redige un briefing, il ne choisit pas la suite. L'invitation « LE WORKFLOW
    // EST UN OUTIL » lui est donnee comme a tout noeud, et un `SUITE: fin` de sa part a coupe
    // un fil avant 2 etapes sur 3. Ignore ICI, le seul point par lequel passent tous les chemins.
    // fix-ok: l'arbitre de derive ecrit sa decision par la MEME ligne `SUITE:` (bloc « [dérive] »),
    // son arret apres `think` etait donc ignore aussi — orchestrator.greedy.test.ts rouge (2/2) avant.
    if (phase === 'think' && souhaitModele && !suiteDeLArbitre) {
      const ecrit =
        souhaitModele.kind === 'stop'
          ? 'fin'
          : souhaitModele.kind === 'phase'
            ? souhaitModele.phase
            : souhaitModele.id
      push({
        step: 'gate',
        role: 'gate',
        detail: `SUITE: ${ecrit} ignorée — le briefing \`think\` ne choisit pas la suite du run.`
      })
      souhaitModele = undefined
    }
    // Les pistes de CE scout rejoignent la memoire des suivants (`scout-memoire.ts`). Une ecriture
    // ratee ne casse pas le run, mais se dit : un scout suivant refera alors ce travail.
    if (phase === 'scout' && this.deps.memoireScout) {
      try {
        this.deps.memoireScout.noter(this.deps.executionWorkspace, texte, runId)
      } catch (erreur) {
        push({
          step: 'gate',
          role: 'gate',
          detail: `pistes du scout non mémorisées (${erreur instanceof Error ? erreur.message : String(erreur)})`
        })
      }
    }
    const alreadyAttributed = new Set(
      phaseOutputs.flatMap((output) => (output.agentToken ? [output.agentToken] : []))
    )
    const attributableAgents = this.agentsOf(runId).filter(
      (agent) =>
        agent.phase === phase &&
        agent.fanOut === false &&
        agent.active === false &&
        !alreadyAttributed.has(agent.token)
    )
    const agentToken = attributableAgents.length === 1 ? attributableAgents[0].token : undefined
    // Le commit du code que `think` vient de lire : une reprise ne réutilise son briefing que si
    // les fichiers qu'il cite n'ont pas changé depuis (`think-briefing.ts`, `sansThinkPerime`).
    // Une phase reprise ne repasse pas ici (`dejaPayee`) : elle garde le commit de SON briefing.
    const codeSha = phase === 'think' ? shaHeadSurDisque(workCwd) : ''
    phaseOutputs.push({
      phase,
      text: texte,
      ...(agentToken ? { agentToken } : {}),
      ...(codeSha ? { codeSha } : {}),
      ...(executionEvidence.length > 0 ? { executionEvidence: [...executionEvidence] } : {})
    })
    try {
      this.deps.onPhaseCompleted?.({
        runId,
        task,
        conversationId,
        turnId,
        bindingOverride,
        runtimeSnapshot,
        phaseOutputs: [...phaseOutputs],
        executionQuote: this.deps.currentExecutionQuote?.(),
        usage: this.deps.currentExecutionUsage?.(),
        agents: this.agentsOf(runId)
      })
    } catch {
      /* best-effort : une panne de persistance ne casse jamais le run en cours */
    }
  }
  let failedTasks: string[] | undefined
  let skippedTasks: string[] | undefined
  /*
   * CE QUI RESTE EN ATTENTE, distinct des deux unions ci-dessus.
   *
   * Elles cumulent DELIBEREMENT tout ce qui a echoue dans le run (« une phase suivante reussie ne
   * doit pas effacer les echecs deja observes »), ce qui est juste pour rendre compte mais
   * inutilisable pour decider : gater dessus interdirait a toute reparation de rendre la main, une
   * sous-tache reparee restant marquee en echec pour toujours.
   *
   * Ce registre-ci ne garde que le travail ENCORE non livre : une sous-tache rejouee avec succes en
   * sort. C'est lui que le gate lit, et c'est ce qui permet a la boucle de reparation existante de
   * conclure vert quand elle a effectivement repare.
   */
  const travauxNonLivres = new Set<string>()
  // RAG Brain : 1×/run, on récupère du cerveau la LISTE des notes pertinentes pour la
  // tâche (titre, chemin, taille) et on l'injecte en tête de contexte. Plus d'extraits coupés à
  // 2 000 caractères (2026-09-27) : chaque sous-agent ouvre EN ENTIER les notes qu'il juge
  // nécessaires. Dégrade à '' si le serveur est absent.
  const brainCorpus = brainCorpusForWorkspace(this.deps.executionWorkspace)
  /*
   * BRAIN PERSO (2026-10-28, demande utilisateur : « étends le Brain perso au contexte
   * des travaux lancés en arrière-plan »). Interrogé EN MÊME TEMPS que celui de l'équipe : le run
   * n'attend pas plus longtemps. Aucun filtre de dépôt (ses notes ne sont rangées par aucun
   * projet), mêmes règles sinon : sources signées seules, jamais `inbox/`. Ses chemins arrivent
   * préfixés `perso:`, ce que le `brain_read` des phases reconnaît pour ouvrir le bon Brain.
   */
  let envPerso: NodeJS.ProcessEnv | undefined
  try {
    envPerso = this.deps.brainPerso?.()
  } catch {
    // Réglage perso illisible : le run part avec le seul Brain d'équipe.
    envPerso = undefined
  }
  const brainPersoEnCours = envPerso
    ? (this.deps.retrieveBrain ?? retrieveBrainContext)(task, {
        env: envPerso,
        mode: 'candidates'
      }).catch(() => undefined)
    : undefined
  const brain =
    brainCorpus?.length === 0
      ? { context: '', status: 'empty' as const }
      : await (this.deps.retrieveBrain ?? retrieveBrainContext)(task, {
          corpus: brainCorpus,
          mode: 'candidates'
        })
  const brainPerso = await brainPersoEnCours
  if (brainPerso?.status === 'unavailable' && brainPerso.unavailableReason === 'network') {
    try {
      this.deps.persoInjoignable?.()
    } catch {
      // Relancer le serveur perso est un confort : jamais une cause d'échec du run.
    }
  }
  const brainRetrievedAt = new Date().toISOString()
  const scopedBrain = scopeBrainRetrieval(brain, brainCorpus)
  const persoScoped = brainPerso ? scopeBrainRetrieval(brainPerso, undefined) : undefined
  const listePerso = persoScoped?.status === 'found' ? persoScoped.context.trim() : ''
  const brainContext = listePerso
    ? fusionnerListesBrain(scopedBrain.context, listePerso)
    : scopedBrain.context
  /**
   * NOTIFIÉ ICI, à l'endroit où l'appel a EU LIEU — et non trente lignes plus bas comme avant.
   *
   * Tant qu'il n'y avait qu'un appel Brain par run, la position de cette notification n'avait
   * aucune importance. Depuis que l'empreinte du dépôt se déclare elle aussi, elle en a une : la
   * différer faisait sortir les deux appels dans l'ordre INVERSE de leur exécution, et une
   * chronologie qui inverse deux évènements ne vaut pas mieux que celle qui en oublie un.
   */
  const brainQuery = scopedBrain.navigation?.query || task
  try {
    onBrainRetrieved?.({
      timestamp: brainRetrievedAt,
      // Le canal transporte DEUX appels par run : chacun se nomme, plutot que de laisser le
      // premier se reconnaitre a sa seule position dans la liste.
      kind: 'automatic',
      query: brainQuery,
      found: brainContext.length > 0,
      // Le statut est celui de l'équipe, sauf quand des notes perso ont été servies.
      status: listePerso ? 'found' : scopedBrain.status,
      injectedChars: brainContext.length,
      navigation: scopedBrain.navigation
    })
  } catch {
    // L'observabilité Brain ne doit jamais faire échouer le run.
  }
  /**
   * PLUS D'« EMPREINTE DU DÉPÔT » (retirée le 2026-09-27, choix de l'utilisateur).
   *
   * Un second appel partait à chaque run avec une question FIGÉE (« empreinte du dépôt X — ce qu'il
   * est, ce qu'il fait… »), et son résultat était injecté en tête de toutes les phases. Mesuré sur
   * 335 runs : 12 notes distinctes seulement, et 82 % du temps la note qui décrit… cette empreinte
   * elle-même, retenue pour le mot « empreinte » (similarité médiane 0,33). Aucune note ne décrivait
   * réellement le dépôt : c'était ~2 000 caractères de bruit payés à chaque run. Le contexte du
   * dépôt vient désormais de la liste de candidates de la tâche ci-dessus, et du nœud `think`, qui
   * ouvre lui-même ce qu'il juge nécessaire.
   */
  const memoryEcho = sessionMemoryBlock(
    rememberedFacts(conversationId, this.deps.executionWorkspace),
    ECHO_MAX_BLOCK_CHARS,
    evictedCount(conversationId, this.deps.executionWorkspace)
  )
  let causalMemory = ''
  if (conversationId && this.deps.causalMemoryFor) {
    try {
      causalMemory = this.deps.causalMemoryFor(conversationId).slice(0, 3_000)
    } catch {
      // Une vue dérivée de la mémoire ne doit jamais empêcher le run courant.
    }
  }
  // #1 carte du code (repo-map) RÉFUTÉE par mesure A/B (2026-07-22) : injecter un rapport de graphe (28k) à
  // chaque phase coûtait +206k tokens (ON 573k vs OFF 367k) SANS réduire la lecture agentique du
  // sous-agent → contre-productif (piège du soft-steer saturé). Levier retiré. Cf. harnais
  // scripts/measure-orchestration-tokens.mjs pour re-mesurer une éventuelle version micro.
  const taskBody = taskForPipelineContext(task)
  const taskContext = `TÂCHE: ${taskBody}`
  /**
   * LE NOM DE CHAQUE INJECTION DE CONTEXTE, tenu à part du texte.
   *
   * `phaseContext` est un tableau de chaînes qui grossit tout au long du run (acquis d'une reprise,
   * directives absorbées, sortie de chaque phase). Les blocs y perdaient leur identité dès la
   * construction : l'Observatory recevait un message utilisateur composé où plus rien ne
   * distinguait ce que l'HUMAIN avait écrit de ce qu'Autowin avait poussé. On garde donc un
   * registre texte → nom, alimenté par `pousserContexte`, et on le lit au moment d'envoyer.
   *
   * Un registre PARALLÈLE plutôt qu'un tableau d'objets : `phaseContext` est lu et poussé depuis
   * une douzaine d'endroits de ce fichier (`join`, `find`, `map`), et en changer la forme pour de
   * l'observabilité aurait touché du code de décision. Une entrée absente du registre n'est jamais
   * devinée — elle ressort « non nommé » et l'inventaire la compte comme non attribuée.
   */
  const phaseContextNames = new Map<string, string>()
  const contexteNomme = (name: string, text: string): string => {
    phaseContextNames.set(text, name)
    return text
  }
  const phaseContext: string[] = [
    ...(memoryEcho ? [contexteNomme('memoryEcho', memoryEcho)] : []),
    ...(causalMemory ? [contexteNomme('causalMemory', causalMemory)] : []),
    ...(brainContext
      ? [
          contexteNomme('brainContext', brainContext),
          contexteNomme(
            'brainPriorite',
            consigneCandidatesBrain(
              scopedBrain.navigation?.root,
              listePerso
                ? { racine: persoScoped?.navigation?.root ?? envPerso?.AUTOWIN_BRAIN_ROOT }
                : undefined
            )
          )
        ]
      : []),
    contexteNomme('tache', taskContext),
    ...(collectedContext ? [contexteNomme('collectedContext', collectedContext)] : [])
  ]
  /**
   * Une demande de mutation reste le BUT du workflow, pas la mission immédiate des phases amont.
   *
   * Le dire seulement dans le system prompt ne suffisait pas en réel : le message user
   * `TÂCHE: ajoute ...` dominait et scout/frame tentaient le patch avant d'afficher un faux
   * « bloqué — Edit absent ». On rend donc la hiérarchie explicite au même niveau que le besoin.
   */
  const analysisMission = (phase: NodePhase): string => {
    if (phase !== 'scout' && phase !== 'frame' && phase !== 'terrain') return ''
    return [
      `MISSION ACTIVE — ${phase.toUpperCase()} UNIQUEMENT : produis le livrable textuel de cette phase en lecture seule.`,
      `Le BESOIN GLOBAL ci-dessous décrit le résultat final du workflow ; ses verbes de mutation sont réservés à BUILD. N'essaie pas d'écrire ni de préparer un patch, et ne signale pas le fait de ne rien écrire comme un blocage : tu as Edit/Write, ta phase ne s'en sert pas (conv-1582).`
    ].join(' ')
  }
  /**
   * Le contexte de la phase, DÉCOMPOSÉ. `userContextForPhase` en dérive la chaîne envoyée et
   * `contextBlocksForPhase` la liste nommée remise à l'observabilité : une seule composition, donc
   * pas de seconde vérité qui dériverait de la première à la prochaine évolution du format.
   */
  const contextEntriesForPhase = (phase: NodePhase): Array<{ name: string; text: string }> => {
    const mission = analysisMission(phase)
    const entries = phaseContext.map((entry) => ({
      name: phaseContextNames.get(entry) ?? 'non nommé',
      text:
        mission && entry === taskContext
          ? `BESOIN GLOBAL (contexte, pas une action immédiate) : ${taskBody}`
          : entry
    }))
    return mission ? [{ name: 'missionAnalyse', text: mission }, ...entries] : entries
  }
  const userContextForPhase = (phase: NodePhase): string =>
    contextEntriesForPhase(phase)
      .map((entry) => entry.text)
      .join('\n\n')
  const contextBlocksForPhase = (phase: NodePhase): Array<{ name: string; chars: number }> =>
    contextEntriesForPhase(phase).map((entry) => ({
      name: entry.name,
      chars: entry.text.length
    }))
  const pousserContexte = (name: string, text: string): void => {
    phaseContext.push(contexteNomme(name, text))
  }
  // Session-resume chaîné (levier coût) : on RÉUTILISE la session de l'exécuteur d'une phase à la
  // suivante quand le provider rend un sessionId. La tâche + le Brain + l'acquis des phases sont
  // alors DÉJÀ dans l'historique de session → on n'envoie que l'instruction de la nouvelle phase
  // (supprime la re-injection ×N). Dégrade proprement : pas de sessionId → resumeSessionId undefined
  // → on retombe sur la re-injection complète (comportement actuel). Une phase d'analyse reste
  // read-only meme pour une tache de mutation : on ne reprend donc jamais une session a travers
  // le changement de sandbox qui ouvre ensuite BUILD/CLEAN en ecriture.
  let prevSessionId: string | undefined
  let prevSessionSandbox: NonNullable<SendOptions['execution']>['sandbox'] | undefined
  /**
   * La session du DERNIER build, gardée à part : en fin de run `prevSessionId` désigne le nettoyage
   * (chaîne des sessions). Seule cible des questions d'un échange avant réparation (
   * refus « sans cause » et questions du juge, `gates/echange-*.ts`) ; absente = pas d'échange,
   * réparation normale.
   */
  let sessionDuBuild:
    { id: string; provider: string; options: SendOptions; model?: string } | undefined
  /** Échanges tentés dans ce run, TOUTES sources : le plafond de 2 est partagé (cadrage). */
  let echangesDuRun = 0
  /** Questions du juge déjà posées au build : une question répétée redevient bloquante. */
  const questionsPoseesDuRun: string[] = []
  // Réinjecte l'acquis d'un run repris pour que la phase suivante l'ait dans son contexte.
  for (const output of usableResume) {
    pousserContexte(
      `acquisPhase:${output.phase}`,
      `[phase ${output.phase}] ${porterVersPhaseSuivante(output.text)}`
    )
    lastExecText = output.text
  }
  /**
   * ORIENTATION EN COURS DE RUN, a la granularite de la PHASE.
   *
   * On ne touche pas au sous-agent en vol : ses droits, son bureau isole et son devis sont deja
   * engages, et l'interrompre pour lui parler serait « interrompre », precisement ce que
   * l'utilisateur ne demande pas. La directive entre donc dans le contexte de la phase SUIVANTE,
   * et y reste : c'est une correction du cadre, pas une remarque jetable.
   */
  const absorberLesDirectives = (): void => {
    if (!conversationId) return
    const directives = this.deps.drainDirectives?.(conversationId) ?? []
    for (const directive of directives) {
      pousserContexte(
        'directiveUtilisateur',
        `DIRECTIVE UTILISATEUR ARRIVEE PENDANT LE RUN — PRIORITAIRE, elle CORRIGE le cadre : ${directive}`
      )
    }
  }

  const executePipelinePhase = async (phase: NodePhase): Promise<void> => {
    // SURVIE NIVEAU 3 : phase déjà terminée avant l'interruption → on ne la refait pas. Compté par
    // occurrence : une visite ULTÉRIEURE du même nœud, via une arête de retour, doit bien s'exécuter.
    if (dejaPayee(phase)) return
    phasesJouees += 1
    // Un build en parallèle ne laisse aucune session à questionner : jamais celle d'un build d'avant.
    if (phase === 'build') sessionDuBuild = undefined
    absorberLesDirectives()
    const evidenceStart = aggregatedEvidence.length
    // DECOUPAGE DE TOUTE PHASE (et non du seul `build`). Mesure du 2026-07-28 : une
    // phase d'exploration monolithique a coute 10,90 $ en 11 min, quand le meme travail decoupe en
    // 5 sous-taches ciblees revenait a ~0,8 $ et ~1 min chacune. Rien ne justifiait de reserver ce
    // levier au build : une phase longue est presque toujours plusieurs travaux qui s'ignorent.
    // Le garde-fou reste le decomposeur lui-meme : sans au moins 2 sous-taches, on retombe sur le
    // chemin sequentiel d'origine. Les droits ne changent pas (ils viennent de isMutationTask).
    if (phase === 'build' && greedyPlan && greedyPlan.length >= 2) {
      const greedy = await this.runGreedyBuildPhase(
        task,
        greedyPlan,
        workCwd,
        runId,
        phaseContext.join('\n\n'),
        true,
        phase,
        push,
        onPhase,
        onDelta,
        signal,
        bindingOverride,
        runtimeSnapshot
      )
      aggregatedEvidence.push(...greedy.evidence)
      debutPreuvesOrdonnees = aggregatedEvidence.length // sous-tâches parallèles : ordre inconnu
      lastExecText = greedy.aggregate
      const agregatGreedy = garderCasLimitesFrame(
        phase,
        garderCibleScout(phase, garderFormeThink(phase, greedy.aggregate))
      )
      recordPhase(phase, agregatGreedy, aggregatedEvidence.slice(evidenceStart))
      pousserContexte(
        `acquisPhase:${phase}`,
        `[phase ${phase}] ${porterVersPhaseSuivante(agregatGreedy)}`
      )
      // Plusieurs phases peuvent réutiliser le même DAG. Une phase suivante réussie ne doit pas
      // effacer les échecs/skips déjà observés (sinon un Terrain rouge disparaît après Build).
      failedTasks = [...new Set([...(failedTasks ?? []), ...greedy.failed])]
      skippedTasks = [...new Set([...(skippedTasks ?? []), ...greedy.skipped])]
      // Reussi CETTE passe = present au plan, ni en echec ni saute. Une sous-tache reparee sort donc
      // du registre, et le gate peut rendre la main.
      const enAttenteCettePasse = new Set([...greedy.failed, ...greedy.skipped])
      for (const noeud of greedyPlan) {
        if (enAttenteCettePasse.has(noeud.id)) travauxNonLivres.add(noeud.id)
        else travauxNonLivres.delete(noeud.id)
      }
      prevSessionId = undefined
      return
    }
    // Panel scout/frame/terrain : ≥1 modèle déposé dans le bloc topology → la phase s'exécute sur
    // CHAQUE membre. Avec un seul membre, sa sortie est réutilisée directement sans synthèse ;
    // avec plusieurs, l'orchestrateur synthétise. Aucun membre → binding subagent rétrocompatible.
    const membresDeLaPhase = bindingOverride
      ? []
      : this.resolvePhaseFanOut(phase, task, runtimeSnapshot)
    /**
     * Une brique SKILL réglée sur UN agent — le modèle choisi dans le canevas d'Agent Studio — n'est
     * pas un panel. Le chemin panel ne sert ni les outils natifs ni la boucle d'outils d'un nœud
     * skill : choisir un modèle sur `think` lui retirait donc brain_query et remember sans un mot.
     * Elle joue le chemin simple, sur le binding de son agent.
     */
    const agentPropreDuNoeudSkill =
      !isPipelinePhase(phase) && membresDeLaPhase.length === 1 ? membresDeLaPhase[0] : undefined
    const fanMembers = agentPropreDuNoeudSkill ? [] : membresDeLaPhase
    if (fanMembers.length >= 1) {
      // Le fan-out casse la chaîne de session (N sessions //). Chaque membre part du contexte complet.
      const fanContextBlocks = contextBlocksForPhase(phase)
      const fanMessages = [{ role: 'user' as const, content: userContextForPhase(phase) }]
      /**
       * ORDRE = DU PLUS STABLE AU PLUS VOLATILE. Le cache de préfixe du provider s'arrête au
       * PREMIER octet qui diffère : un bloc invariant placé APRÈS un bloc variable n'est jamais
       * réutilisé, même s'il est identique d'un appel à l'autre.
       *
       * Avant ce réordonnancement, `phasePrompt` — qui change à chaque phase — était en position 2,
       * donc `discipline`, `workflowTool` et `style`, trois blocs CONSTANTS, tombaient derrière lui :
       * le préfixe cachable se réduisait au seul `CONSTITUTION`. Mesuré le 2026-08-11 sur 688 appels
       * réels du magasin `prompt-observability` : acteur `subagent` à 55,4 % de cache seulement
       * (243 431 485 tokens d'entrée NON cachés), acteur `judge` à 10,6 %.
       *
       * Le contenu remis au modèle est IDENTIQUE — seul l'ordre de concaténation change.
       */
      const parts = [
        { name: 'constitution', text: CONSTITUTION },
        { name: 'discipline', text: PIPELINE_DISCIPLINE_INSTRUCTION },
        { name: 'style', text: STYLE_TON },
        // Le droit de dévier n'est dit QUE si un graphe pilote : sinon la consigne parlerait
        // d'étapes qui n'existent pas, et inviterait à sortir d'un chemin qu'on ne suit pas.
        // Constant pour toute la durée d'un run (dépend du graphe, pas de la phase).
        { name: 'workflowTool', text: grapheBrut ? WORKFLOW_IS_A_TOOL_INSTRUCTION : '' },
        // Constant par workspace, donc encore devant la phase.
        { name: 'projectContext', text: projectContext },
        // VARIABLE par phase — d'où sa place ici, et non en position 2.
        consigneDePhase(phase, true),
        // VARIABLE par sandbox : le plus volatile, donc en dernier.
        // VARIABLE par run : le bureau caché réservé à CE run.
        { name: 'bureauCache', text: consigneBureauCache(runId) },
        {
          name: 'workspaceIsolation',
          text: workspaceIsolationNotice(workCwd, this.deps.executionWorkspace)
        }
      ]
      const fanSystemBlocks = parts
        .filter((p) => p.text)
        .map((p) => ({ name: p.name, chars: p.text.length }))
      const fanSystem = parts.map((p) => p.text).join('')
      const sandbox = sandboxForPhase(task, phase)
      const runMember = async (
        member: (typeof fanMembers)[number],
        rang: number
      ): Promise<
        | {
            member: (typeof fanMembers)[number]
            text: string
            ok: true
            cause: undefined
            session: { id: string; options: SendOptions } | undefined
          }
        | {
            member: (typeof fanMembers)[number]
            text: string
            ok: false
            cause: string
            session: undefined
          }
      > => {
          // L'identité prend la persona quand il y en a une, sinon le modèle. Le rang n'est ajouté
          // QUE s'il lève une ambiguïté réelle : trois membres sur le même modèle portaient
          // jusqu'ici le MÊME agentId et se télescopaient dans le suivi comme dans l'UI ; deux
          // modèles distincts, eux, n'ont jamais eu besoin d'un suffixe.
          const signatureMembre = member.persona ?? member.model ?? member.provider
          const homonymes = fanMembers.filter(
            (autre) => (autre.persona ?? autre.model ?? autre.provider) === signatureMembre
          ).length
          const identite =
            homonymes > 1
              ? `${phase}:${signatureMembre}:${rang + 1}`
              : `${phase}:${signatureMembre}`
          const execution = {
            phase,
            agentId: identite,
            taskId: identite,
            groupId: `${phase}:fanout`,
            dependencyIds: [] as string[],
            attemptId: randomUUID()
          }
          // La persona s'ajoute AU PROMPT de ce membre-là. Un prompt commun à tous rendrait le
          // fan-out inutile : N fois le même avis, pour N fois le prix.
          const personaBloc = personaInstruction(member.persona)
          const membreSystemBlocks = personaBloc
            ? [...fanSystemBlocks, { name: 'persona', chars: personaBloc.length }]
            : fanSystemBlocks
          // LE PROMPT DU MEMBRE (2026-10-13) : ce chemin n'annonçait AUCUNE enveloppe, ni au départ
          // ni à la fin. Un membre en éventail (`frame:probleme`…) n'écrivait donc jamais son prompt
          // dans la trace : sa fiche du graphe ne montrait que son retour.
          // Même construction que les autres chemins : décrite avant l'appel, précisée par
          // `observePrompt` quand le fournisseur la voit partir.
          let enveloppeMembre: PromptEnvelope | undefined
          const opts: SendOptions = {
            system: fanSystem + personaBloc,
            systemBlocks: membreSystemBlocks,
            contextBlocks: fanContextBlocks,
            model: member.model,
            reasoningEffort: member.reasoningEffort,
            execution: this.executionOptions(
              workCwd,
              sandbox,
              runId,
              phase,
              member.provider,
              fanMembers.length > 1,
              member.model
            ),
            signal,
            observePrompt: (observed) => {
              observed.systemBlocks = membreSystemBlocks
              observed.contextBlocks = fanContextBlocks
              enveloppeMembre = observed
            }
          }
          enveloppeMembre = registry.describePrompt(
            member.provider,
            fanMessages,
            opts,
            member.model
          )
          enveloppeMembre.systemBlocks = membreSystemBlocks
          enveloppeMembre.contextBlocks = fanContextBlocks
          const startedAt = performance.now()
          onPhase?.({
            step: 'exec',
            provider: member.provider,
            role: 'subagent',
            model: member.model,
            reasoningEffort: member.reasoningEffort,
            phase,
            prompt: enveloppeMembre,
            execution
          })
          /**
           * SUPERVISION D'UN MEMBRE DE FAN-OUT — elle OBSERVE, et elle ne route pas non plus.
           *
           * Deux raisons distinctes de ne rien faire d'autre que rapporter. La première tient à la
           * doctrine « plus aucune coupe de run » : ce n'est pas à ce code d'arrêter un tour. La
           * seconde est propre au fan-out : plusieurs membres dérivent indépendamment, et si chacun
           * réclamait sa bifurcation, la destination du run dépendrait de l'ordre d'arrivée des
           * réponses. La dérive part donc dans la SYNTHÈSE, seul endroit d'où une route se décide.
           */
          const supervision = createMidPhaseSupervision({
            forward: (delta) => onDelta?.('exec', delta)
          })
          try {
            const res = await registry.send(member.provider, fanMessages, opts, (c) => {
              supervision.onDelta(c.delta)
              if (c.reasoning) onDelta?.('exec', '', undefined, c.reasoning)
              // LE BATTEMENT D'OUTIL, comme sur le chemin du binding du rôle. Ce chemin
              // le jetait : une étape à modèle attitré — build sur le poste de l'utilisateur —
              // restait 46 à 53 min sans une ligne d'activité au fil (conv-1069/1070/1077,
              // mesuré). Plusieurs membres battent en parallèle sur la MÊME ligne :
              // chacun la signe de son modèle, sinon on ne sait plus qui fait quoi.
              if (c.status) {
                onDelta?.(
                  'exec',
                  '',
                  fanMembers.length > 1
                    ? `${member.model ?? member.provider} · ${c.status}`
                    : c.status
                )
              }
            })
            const derive = supervision.trip()
            if (derive) {
              onDelta?.(
                'exec',
                `\n[dérive] membre ${member.model ?? member.provider} : ${derive.detail} — signalé, rien n'a été interrompu\n`
              )
            }
            if (res.usage) {
              cost.add({
                provider: res.provider ?? member.provider,
                role: 'subagent',
                model: member.model,
                inputTokens: res.usage.inputTokens,
                outputTokens: res.usage.outputTokens,
                cacheReadTokens: res.usage.cacheReadTokens,
                cacheCreationTokens: res.usage.cacheCreationTokens,
                costUsd: res.usage.costUsd
              })
            }
            push({
              step: 'exec',
              provider: res.provider ?? member.provider,
              role: 'subagent',
              model: res.model ?? member.model,
              text: res.text,
              thinking: res.thinking,
              tokens: res.usage ? res.usage.inputTokens + res.usage.outputTokens : undefined,
              costUsd: res.usage?.costUsd,
              usage: res.usage,
              prompt: enveloppeMembre,
              status: 'completed',
              durationMs: performance.now() - startedAt,
              evidence: res.executionEvidence,
              artifacts: res.artifacts,
              detail: `phase ${phase} · modèle ${member.model ?? member.provider}`,
              execution
            })
            aggregatedEvidence.push(...(res.executionEvidence ?? []))
            supervision.dispose()
            // Sa session, pour un build à membre UNIQUE : c'est alors la session du build.
            const { observePrompt: _observeMembre, ...optionsDuMembre } = opts
            return {
              member,
              text: res.text,
              ok: true as const,
              cause: undefined,
              session: res.sessionId ? { id: res.sessionId, options: optionsDuMembre } : undefined
            }
          } catch (error) {
            supervision.dispose()
            push({
              step: 'exec',
              provider: member.provider,
              role: 'subagent',
              model: member.model,
              text: '',
              status: 'failed',
              evidence: evidenceDeLErreur(error),
              error: error instanceof Error ? error.message : String(error),
              durationMs: performance.now() - startedAt,
              detail: `phase ${phase} · modèle ${member.model ?? member.provider}`,
              execution
            })
            return {
              member,
              text: '',
              ok: false as const,
              // La cause est CONSERVEE : c'est elle qui manquait a l'utilisateur (2026-07-29).
              cause: error instanceof Error ? error.message : String(error),
              session: undefined
            }
          }
        }
      const memberOutputs = await Promise.all(fanMembers.map(runMember))
      // Membres parallèles dans la même copie : l'ordre de leurs preuves n'est pas celui de leurs actes.
      if (fanMembers.length > 1) debutPreuvesOrdonnees = aggregatedEvidence.length
      // SYNTHÈSE par l'orchestrateur (le rôle le + capable) : union dédupliquée, PAS de re-décision.
      // Un modèle en échec (ok=false / texte vide) ne pollue pas la synthèse (filtré).
      let good = memberOutputs.filter((o) => o.ok && o.text.trim())
      if (good.length === 0) {
        // fix-ok: tour 4dfe2821 — refus « safeguards flagged » du seul membre claude-opus-5, fan-out sans repli -> tour rouge
        // REPLI APRÈS REFUS (tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4) : le seul membre
        // build a été refusé par le filtre de sécurité du modèle et le tour a fini rouge sans rien
        // tenter. Relancer le MÊME modèle échoue pareil : on rejoue UNE fois sur le modèle voisin.
        const refuse = memberOutputs.find(
          (o) => !o.ok && classifyProviderFailure(o.cause ?? '') === 'refused'
        )
        const repli = refuse ? modeleDeRepliApresRefus(refuse.member.model) : undefined
        if (refuse && repli && !fanMembers.some((m) => m.model === repli)) {
          onDelta?.(
            'exec',
            `\n[repli] ${refuse.member.model} a refusé le message — nouvel essai sur ${repli}\n`
          )
          const rescue = await runMember({ ...refuse.member, model: repli }, fanMembers.length)
          memberOutputs.push(rescue)
          good = [rescue].filter((o) => o.ok && o.text.trim())
        }
      }
      if (good.length === 0) {
        // Tous les modèles du fan-out ont échoué → échec de phase EXPLICITE (jamais une synthèse
        // fantôme sur du vide qui se propagerait comme un résultat valide). Aligne le comportement
        // sur le chemin mono-modèle (une exec en échec propage l'erreur).
        // Les causes etaient DEJA connues ici et etaient jetees en remontant : « aucun modele n'a
        // produit de sortie » ne disait pas que le role etait binde sur un provider non connecte.
        const causes = memberOutputs
          .filter((o) => !o.ok)
          .map((o) => ({
            provider: o.member.provider,
            ...(o.member.model ? { model: o.member.model } : {}),
            message: o.cause ?? 'échec sans message'
          }))
        const explained = describeFanoutFailure(phase, 'subagent', causes)
        push({
          step: 'exec',
          role: 'subagent',
          text: '',
          status: 'failed',
          error: explained,
          detail: `phase ${phase} : les ${fanMembers.length} modèles du fan-out ont échoué`,
          durationMs: 0
        })
        throw new Error(explained)
      }
      if (good.length === 1) {
        // Un seul survivant → rien à agréger : on réutilise sa sortie directement, sans appel de
        // synthèse (inutile + risque de reformulation d'un texte unique).
        const solo = garderCasLimitesFrame(
          phase,
          garderCibleScout(phase, garderFormeThink(phase, good[0].text))
        )
        lastExecText = solo
        recordPhase(phase, solo, aggregatedEvidence.slice(evidenceStart))
        pousserContexte(
          `acquisPhase:${phase}`,
          `[phase ${phase}] ${porterVersPhaseSuivante(solo)}`
        )
        prevSessionId = undefined
        /*
         * fix-ok: (run-ec2036c0932d-1) — 7 refus « sans cause » sur 7 partis en
         * réparation complète : « aucune session du build à reprendre ». Le profil « feature »
         * pose un agent composé (`persona: minimal`) sur build : les 18 builds sont passés ici
         * (bloc `persona` dans prompt-observability/conv-1146.jsonl), et ce chemin ne gardait pas
         * la session. Un membre UNIQUE est le build lui-même ; plusieurs membres n'en ont aucune.
         */
        const sessionSolo = good[0].session
        if (
          phase === 'build' &&
          fanMembers.length === 1 &&
          sessionSolo &&
          registry.honoursSessionResume(good[0].member.provider)
        ) {
          sessionDuBuild = {
            id: sessionSolo.id,
            provider: good[0].member.provider,
            options: sessionSolo.options,
            ...(good[0].member.model ? { model: good[0].member.model } : {})
          }
        }
        return
      }
      const orchBinding =
        bindingOverride ?? runtimeSnapshot?.roles.orchestrator ?? roles.getBinding('orchestrator')
      const labelled = good
        .map(
          (o, i) =>
            `### Proposition ${i + 1} (modèle ${o.member.model ?? o.member.provider})\n${o.text}`
        )
        .join('\n\n')
      const synthParts = [
        { name: 'constitution', text: CONSTITUTION },
        { name: 'style', text: STYLE_TON },
        { name: 'projectContext', text: projectContext }
      ]
      let synthEnvelopePhase: PromptEnvelope | undefined
      const synthPhaseBlocks = synthParts
        .filter((p) => p.text)
        .map((p) => ({ name: p.name, chars: p.text.length }))
      const synthOptions: SendOptions = {
        observePrompt: (observed) => {
          observed.systemBlocks = synthPhaseBlocks
          synthEnvelopePhase = observed
        },
        system: synthParts.map((p) => p.text).join(''),
        systemBlocks: synthPhaseBlocks,
        model: orchBinding.model,
        reasoningEffort: orchBinding.reasoningEffort,
        execution: this.executionOptions(
          workCwd,
          'read-only',
          runId,
          phase,
          orchBinding.provider,
          false,
          orchBinding.model
        ),
        signal
      }
      const synthMessages = [
        {
          role: 'user' as const,
          // Un panel scout se fusionne selon le contrat du scout (`consigneFusionScout`).
          content:
            phase === 'scout'
              ? consigneFusionScout(good.length, labelled)
              : `Phase « ${phase} » exécutée par ${good.length} modèle(s) indépendant(s). Fusionne leurs sorties en UNE seule : ` +
                `UNION DÉDUPLIQUÉE — conserve tous les angles/idées/questions distincts, supprime uniquement les redites. ` +
                `NE hiérarchise pas, NE tranche pas au-delà du regroupement (agréger ≠ re-décider).\n\n${labelled}`
        }
      ]
      const synthStartedAt = performance.now()
      const synthExecution = {
        phase,
        agentId: `${phase}:synthesis`,
        taskId: `${phase}:synthesis`,
        groupId: `${phase}:synthesis`,
        dependencyIds: good.map(({ member }) => `${phase}:${member.model ?? member.provider}`),
        attemptId: randomUUID()
      }
      synthEnvelopePhase = registry.describePrompt(
        orchBinding.provider,
        synthMessages,
        synthOptions,
        orchBinding.model
      )
      synthEnvelopePhase.systemBlocks = synthPhaseBlocks
      onPhase?.({
        step: 'exec',
        provider: orchBinding.provider,
        role: 'orchestrator',
        model: orchBinding.model,
        reasoningEffort: orchBinding.reasoningEffort,
        phase,
        // Fusion multi-modeles d'une phase : elle n'annoncait aucune enveloppe, le deplie
        // « prompt envoye » restait vide (saisie ts=1789550244094).
        prompt: synthEnvelopePhase,
        execution: synthExecution
      })
      const synth = await this.sendWithRoleContext(
        `synthèse ${phase}`,
        'orchestrator',
        orchBinding.provider,
        orchBinding.model,
        () =>
          registry.send(orchBinding.provider, synthMessages, synthOptions, (c) =>
            onDelta?.('exec', c.delta)
          )
      )
      if (synth.usage) {
        cost.add({
          provider: synth.provider ?? orchBinding.provider,
          role: 'orchestrator',
          model: orchBinding.model,
          inputTokens: synth.usage.inputTokens,
          outputTokens: synth.usage.outputTokens,
          cacheReadTokens: synth.usage.cacheReadTokens,
          cacheCreationTokens: synth.usage.cacheCreationTokens,
          costUsd: synth.usage.costUsd
        })
      }
      push({
        step: 'exec',
        provider: synth.provider ?? orchBinding.provider,
        role: 'orchestrator',
        model: synth.model ?? orchBinding.model,
        text: synth.text,
        tokens: synth.usage ? synth.usage.inputTokens + synth.usage.outputTokens : undefined,
        costUsd: synth.usage?.costUsd,
        usage: synth.usage,
        status: 'completed',
        durationMs: performance.now() - synthStartedAt,
        detail: `synthèse ${phase} (${good.length} modèles)`,
        execution: synthExecution
      })
      lastExecText = synth.text
      lastUsage = synth.usage
      const texteSynth = garderCasLimitesFrame(
        phase,
        garderCibleScout(phase, garderFormeThink(phase, synth.text))
      )
      recordPhase(phase, texteSynth, aggregatedEvidence.slice(evidenceStart))
      pousserContexte(
        `acquisPhase:${phase}`,
        `[phase ${phase}] ${porterVersPhaseSuivante(texteSynth)}`
      )
      prevSessionId = undefined // fan-out : pas de session linéaire à chaîner
      return
    }
    // Un nœud `judge` répond au rôle JUDGE — sinon l'exécutant s'évalue avec son propre modèle, ce
    // qui n'est pas une vérification. `bindingOverride` reste autoritaire : un binding figé pour le
    // run prime sur tous les rôles (même règle qu'au chemin décomposé et qu'au gate final).
    const jugeDedie = phase === 'judge' && !bindingOverride
    const phaseSandbox = sandboxForPhase(task, phase)
    if (prevSessionId && prevSessionSandbox !== phaseSandbox) {
      prevSessionId = undefined
      prevSessionSandbox = undefined
    }
    // Et il ne REPREND PAS la session de l'exécution : son provider peut différer, où cette session
    // n'existe pas. Reprendre y aurait remplacé tout le contexte par « acquis déjà connus, ne les
    // redemande pas » — le juge aurait jugé à l'aveugle. Il reçoit donc le contexte complet.
    // Même règle pour une brique skill sur son propre agent : son fournisseur peut
    // différer de celui qui a ouvert la session.
    const sansSessionReprise = jugeDedie || Boolean(agentPropreDuNoeudSkill)
    const resuming = Boolean(prevSessionId) && !sansSessionReprise
    // Le CADRAGE (phase frame) est le socle du prompt remis aux sous-agents : on le ré-injecte
    // TOUJOURS explicitement, même en resume. Se fier à l'historique de session (opaque, variable
    // par provider, cassé par un fan-out) faisait perdre le besoin cadré exactement au moment où
    // la phase suivante en a le plus besoin → prompt de sous-agent dégradé.
    // Le DERNIER : un cadrage refait remplace le précédent, qui peut être celui qui a été refusé.
    // fix-ok: le test du rappel en session rend « Cadrage incomplet » sur a41081d6 : find() rappelait la version refusée.
    const framed = phaseContext.filter((entry) => entry.startsWith('[phase frame]')).at(-1) ?? ''
    /**
     * Les blocs poussés côté user sont composés EN MÊME TEMPS que le texte envoyé, y compris sur
     * la branche `resuming` qui n'emprunte pas `userContextForPhase`. Décrire cette branche-là
     * depuis le contexte complet aurait annoncé des injections que la reprise ne fait justement
     * PAS — une observabilité fausse est pire qu'absente.
     */
    const userEntries = resuming
      ? [
          { name: 'missionAnalyse', text: analysisMission(phase) },
          {
            name: 'repriseSession',
            text: `Phase suivante du pipeline : ${phase}. Continue À PARTIR de l'état de la session (tâche, connaissance Brain et acquis des phases précédentes déjà connus — ne les redemande pas). Applique la consigne de phase et enrichis le livrable existant.`
          },
          {
            name: 'rappelCadrage',
            text: framed ? `RAPPEL DU CADRAGE — c'est LA référence du livrable :\n${framed}` : ''
          }
        ].filter((entry) => entry.text)
      : contextEntriesForPhase(phase)
    const userContent = userEntries.map((entry) => entry.text).join('\n\n')
    const userBlocks = userEntries.map((entry) => ({
      name: entry.name,
      chars: entry.text.length
    }))
    const phaseMessages = [{ role: 'user' as const, content: userContent }]
    // F6 — le system est composé de blocs NOMMÉS : on garde leur décomposition (nom + taille)
    // pour l'observabilité, en plus de la chaîne concaténée réellement envoyée.
    // Consigne courte purpose-built (phase-briefs) : ~1-2k au lieu du SKILL.md brut. L'état
    // (besoin + acquis des phases) vit dans le message user ci-dessous, pas dans le system.
    // Modèle EFFECTIF de la phase : override par phase (petit modèle sur analyse, gros sur build)
    // → défaut = modèle du binding. Générique/rétrocompat (resolvePhaseBinding).
    const roleDeLaPhase = jugeDedie ? 'judge' : 'subagent'
    // L'instantané est VALIDÉ contre les providers réellement enregistrés : il ne doit pas survivre
    // à la disparition de sa cible. Et sa divergence avec la configuration courante est ANNONCÉE
    // ici, avant l'appel — jusqu'ici on ne l'apprenait qu'en lisant l'erreur, une fois la phase
    // cassée, et il fallait fouiller cinq fichiers de configuration pour comprendre.
    const choix = jugeDedie
      ? bindingDePhaseValide(
          bindingDeRepliPourPhase(phase, roles, runtimeSnapshot),
          roles.getBinding(roleDeLaPhase),
          registry.ids()
        )
      : { binding: agentPropreDuNoeudSkill ?? subBinding }
    const bindingDeLaPhase = choix.binding
    const providerDeLaPhase = bindingDeLaPhase.provider
    if (choix.note) onDelta?.('exec', `[binding] Phase ${phase} — ${choix.note}\n`)
    // L'effort suit l'effort par défaut de l'étape quand il hérite du rôle (roles.ts,
    // effortParDefautDeLEtape) ; un binding figé pour le run ou un juge dédié part tel quel. L'agent
    // propre d'une brique skill aussi : `resolvePhaseFanOut` lui a déjà donné son effort.
    const phaseBinding = this.resolveEtape(
      bindingDeLaPhase,
      phase,
      task,
      jugeDedie || Boolean(bindingOverride) || Boolean(agentPropreDuNoeudSkill)
    )
    // Un advisor réglé mais refusé par la table du CLI ne part pas (claude.ts) : on dit pourquoi,
    // sinon le réglage disparaîtrait sans un mot.
    if (phaseBinding.advisorModel && providerDeLaPhase === 'claude') {
      const accord = advisorAccepte(phaseBinding.model, phaseBinding.advisorModel)
      if (!accord.accepte)
        onDelta?.('exec', `[advisor] Phase ${phase} — non transmis : ${accord.raison}\n`)
    }
    // Anti-perte-de-contexte / longs runs : en session-resume, la discipline (~1-2k) et le
    // projectContext (≤32k) sont DÉJÀ connus de la session (envoyés en phase 1) → les ré-envoyer
    // à chaque phase gonfle le contexte pour rien ("ENGINE injectée N fois", "1M3 tokens"). On ne
    // renvoie que la consigne de phase (qui CHANGE) + le style. Fallback (pas de resume) = complet.
    // ORDRE = DU PLUS STABLE AU PLUS VOLATILE dans les DEUX branches (cf. commentaire du site
    // fan-out). Même en session-resume, mettre `style` — constant — devant la consigne de phase
    // qui change permet au préfixe d'être réutilisé au lieu d'être invalidé dès le second bloc.
    const parts = resuming
      ? [
          { name: 'style', text: STYLE_TON },
          // VARIABLE par phase.
          consigneDePhase(phase, false),
          // VARIABLE par sandbox.
          // VARIABLE par run : le bureau caché réservé à CE run.
          { name: 'bureauCache', text: consigneBureauCache(runId) },
          {
            name: 'workspaceIsolation',
            text: workspaceIsolationNotice(workCwd, this.deps.executionWorkspace)
          }
        ]
      : [
          { name: 'constitution', text: CONSTITUTION },
          { name: 'discipline', text: PIPELINE_DISCIPLINE_INSTRUCTION },
          { name: 'style', text: STYLE_TON },
          // Le droit de dévier n'est dit QUE si un graphe pilote : sinon la consigne parlerait
          // d'étapes qui n'existent pas, et inviterait à sortir d'un chemin qu'on ne suit pas.
          // Constant pour la durée du run.
          { name: 'workflowTool', text: grapheBrut ? WORKFLOW_IS_A_TOOL_INSTRUCTION : '' },
          // Constant par workspace.
          { name: 'projectContext', text: projectContext },
          // VARIABLE par phase.
          consigneDePhase(phase, true),
          // VARIABLE par sandbox — le plus volatile, donc en dernier.
          // VARIABLE par run : le bureau caché réservé à CE run.
          { name: 'bureauCache', text: consigneBureauCache(runId) },
          {
            name: 'workspaceIsolation',
            text: workspaceIsolationNotice(workCwd, this.deps.executionWorkspace)
          }
        ]
    const systemBlocks = parts
      .filter((p) => p.text)
      .map((p) => ({ name: p.name, chars: p.text.length }))
    /**
     * LE SERVEUR D'OUTILS DU NŒUD SKILL — ouvert avec la phase, fermé avec elle.
     *
     * Portée volontairement courte : le port n'est joignable que pendant le nœud qui s'en sert.
     * Un serveur à la durée du RUN resterait ouvert pendant les huit phases du pipeline, qui ne
     * doivent précisément disposer d'aucun outil.
     *
     * Son échec n'est JAMAIS fatal : sans serveur, la boucle à protocole texte reste en place et
     * la phase se déroule normalement — on trace la privation au lieu de perdre le run.
     */
    const lanceurDuNoeud = isPipelinePhase(phase) ? undefined : lanceurQuiCompte()
    let serveurOutils: ServeurOutilsNoeudSkill | undefined
    /**
     * On n'ouvre un serveur que pour un provider qui le CONSOMME reellement.
     *
     * `gemini` et `kimi` spawnaient un CLI sans drapeau MCP. Ouvrir un port pour eux annoncait « outils natifs servis »
     * sur un appel qui ne les recevrait jamais — le meme mensonge de trace que ce chantier a
     * corrige pour `describePrompt`, reproduit pour trois providers sur quatre. On dit desormais
     * la PRIVATION, et le repli texte reste en place.
     */
    if (lanceurDuNoeud && !porteLesOutilsNatifs(providerDeLaPhase)) {
      push({
        step: 'exec',
        role: 'subagent',
        detail: `outils natifs indisponibles sur ${providerDeLaPhase} pour ${phase} — repli sur le protocole texte`
      })
    }
    /**
     * Fermer ET LE DIRE, par un seul point de passage.
     *
     * La fermeture existait a un seul endroit et n'etait pas tracee : un port laisse ouvert par un
     * chemin d'exception ne se voyait donc NULLE PART, et aucun test ne pouvait l'attraper. Trois
     * relecteurs independants ont trouve ce chemin ; la trace est ce qui rend le correctif
     * verifiable au lieu d'etre affirme.
     */
    const fermerOutilsNatifs = async (motif: string): Promise<void> => {
      if (!serveurOutils) return
      const ouvert = serveurOutils
      serveurOutils = undefined
      await ouvert.arreter()
      push({
        step: 'exec',
        role: 'subagent',
        detail: `outils natifs fermes pour ${phase} (${motif})`
      })
    }
    if (lanceurDuNoeud && porteLesOutilsNatifs(providerDeLaPhase)) {
      try {
        serveurOutils = await demarrerServeurOutilsNoeudSkill(lanceurDuNoeud, {
          observer: (appel) =>
            push({
              step: 'exec',
              role: 'subagent',
              /**
               * L'ISSUE METIER est dite, pas seulement le transport. Mesure du 2026-08-20
               * Cette ligne affichait `remember : ok` pendant que le Brain refusait
               * l'ecriture (`stored: false`). Un artefact de preuve qui annonce « ok » sur un
               * no-op est pire qu'une absence de trace. Depuis le 2026-09-27, la ligne porte aussi
               * la note ouverte et la longueur lue (`libelleAppelObserve`).
               */
              detail: libelleAppelObserve(appel, phase)
            })
        })
        push({
          step: 'exec',
          role: 'subagent',
          detail: `outils natifs servis a ${phase} : ${serveurOutils.nomsExposes().join(', ')}`
        })
        /**
         * L'HERITAGE EST DIT, parce qu'il change la surface d'outils du noeud.
         *
         * La garde demandait de « journaliser les serveurs MCP herites ». Autowin ne PEUT PAS les
         * nommer : c'est le CLI qui lit la configuration de la machine, et il ne rend pas cette
         * liste. Ce qui est dans nos moyens — et qui sert le meme but, rendre le cout accepte
         * VISIBLE — c'est de dire que l'heritage est ACTIF pour cet appel, donc que la surface
         * d'outils depend du poste. Nommer ce qu'on ne peut pas voir aurait ete une fausse garde.
         */
        push({
          step: 'exec',
          role: 'subagent',
          detail: `heritage MCP machine ACTIF pour ${phase} : la surface d'outils de ce noeud depend de la configuration du poste, en plus des deux commandes du bus`
        })
      } catch (error) {
        push({
          step: 'exec',
          role: 'subagent',
          detail: `outils natifs indisponibles pour ${phase} : ${
            error instanceof Error ? error.message : String(error)
          } — repli sur le protocole texte`
        })
      }
    }
    const subOptions: SendOptions = {
      system: parts.map((p) => p.text).join(''),
      systemBlocks,
      contextBlocks: userBlocks,
      model: phaseBinding.model,
      reasoningEffort: phaseBinding.reasoningEffort,
      ...(phaseBinding.advisorModel ? { claude: { advisorModel: phaseBinding.advisorModel } } : {}),
      // Pas la session de l'exécution pour un juge dédié : elle n'existe pas chez son provider, et
      // la lui passer l'enverrait reprendre un fil inconnu. `resuming` est déjà faux — cohérence.
      resumeSessionId: sansSessionReprise ? undefined : prevSessionId,
      execution: this.executionOptions(
        workCwd,
        // B3 — une tâche NON-mutation (cadrage/analyse) n'a aucune raison d'écrire : sandbox
        // read-only → pas d'effet de bord (ex. RUN.md fantôme dans Audit/). Mutation → full access.
        phaseSandbox,
        runId,
        phase,
        providerDeLaPhase,
        false,
        phaseBinding.model
      ),
      signal,
      /**
       * INTENTION EXPLICITE. On ne laisse pas l'adaptateur deduire « noeud skill » depuis la
       * presence d'un bloc `execution` : les huit phases du pipeline en portent un aussi, et elles
       * seraient toutes outillees par accident.
       */
      ...(serveurOutils
        ? {
            skillNodeTools: {
              mcpConfig: serveurOutils.configMcp(),
              allowedTools: serveurOutils.nomsExposes(),
              /**
               * Heriter des serveurs MCP de la machine EN PLUS des notres — decision explicite de
               * l'utilisateur (2026-08-20), le cout lui ayant ete dit : la surface d'outils d'un
               * noeud devient machine-dependante. D'ou le refus runtime du lanceur comme barriere
               * AUTORITAIRE sur `orchestrate`, et la journalisation des outils reellement servis.
               */
              inheritMachineMcp: true
            }
          }
        : {}),
      observePrompt: (observed) => {
        observed.systemBlocks = systemBlocks
        observed.contextBlocks = userBlocks
        execPrompt = observed
      }
    }
    execPrompt = registry.describePrompt(
      providerDeLaPhase,
      phaseMessages,
      subOptions,
      phaseBinding.model
    )
    execPrompt.systemBlocks = systemBlocks
    execPrompt.contextBlocks = userBlocks
    const execution = {
      phase,
      agentId: `${phase}:subagent`,
      taskId: `${phase}:exec`,
      groupId: `${phase}:sequential`,
      dependencyIds: [] as string[],
      attemptId: randomUUID()
    }
    onPhase?.({
      step: 'exec',
      provider: providerDeLaPhase,
      role: roleDeLaPhase,
      model: phaseBinding.model,
      reasoningEffort: phaseBinding.reasoningEffort,
      phase,
      prompt: execPrompt,
      execution
    })
    const phaseStartedAt = performance.now()
    /**
     * SUPERVISION MI-PHASE — l'orchestrateur voyait déjà tout, il ne jugeait rien.
     *
     * Chaque chunk continue d'aller à l'interface exactement comme avant ; il passe EN PLUS au
     * détecteur de dérive. L'agent VA AU BOUT de son tour : « plus aucune coupe de run » (doctrine
     * utilisateur du 2026-08-19). Le trip est retenu, DIT à l'utilisateur, et c'est seulement à la
     * fin NATURELLE de la phase qu'il peut faire changer de route — ce qui donne la correction de
     * trajectoire demandée sans jamais jeter un tour qu'un humain n'a pas décidé de jeter.
     */
    const supervision = createMidPhaseSupervision({
      forward: (delta) => onDelta?.('exec', delta)
    })
    let phaseRes
    // Modèle qui a VRAIMENT répondu : celui du binding, ou son voisin après un refus du filtre.
    let modeleDeLaPhase = phaseBinding.model
    // Surcharge API transitoire (529/503) : on rejoue la MÊME phase au lieu de perdre le run
    // (incident ak-9d3fa074346ba9da). Le réessai est annoncé dans le flux, jamais silencieux.
    // La supervision mi-phase de HEAD est CONSERVÉE : elle vit dans le callback de flux, donc
    // elle continue de recevoir les deltas de la tentative qui aboutit.
    const envoyer = (options: SendOptions): Promise<SendResult> =>
      this.sendSurvivingOverload(
        () =>
          registry.send(providerDeLaPhase, phaseMessages, options, (c) => {
            supervision.onDelta(c.delta)
            if (c.reasoning) onDelta?.('exec', '', undefined, c.reasoning)
            /*
             * LE BATTEMENT D'OUTIL EXISTAIT ET ETAIT JETE ICI.
             *
             * Mesure du 2026-09-07 : le journal du tour n'a rien recu entre la fin de
             * `frame` (1788764779503) et celle de `build` (1788766075667) — 21 min 36 s de
             * silence pendant que la phase lisait, editait et rejouait des suites. Le fournisseur
             * battait pourtant toutes les 30 s : `claude.ts` traduit `tool_progress` en
             * `chunk.status` (« Bash en cours - 2 min 30 s - vitest run »), et le pilote de chat
             * lit ce champ depuis toujours (`agent-pilot.ts`, evenement `provider-status`).
             * Ce callback de phase ne lisait que `delta` et `reasoning` : la seule source de vie
             * d'une phase longue tombait donc dans le vide, et le tour paraissait mort.
             *
             * On REUTILISE le canal de note deja prevu pour exactement ce libelle (cf. le
             * commentaire de `commands.ts` : « Une NOTE (« Bash en cours — 2 min 30 s ») voyage
             * sur le meme evenement mais dans son propre champ ») — en ouvrir un second ferait
             * diverger deux verites sur le meme fait.
             */
            if (c.status) onDelta?.('exec', '', c.status)
          }),
        (note) => onDelta?.('exec', `\n${note}\n`),
        signal
      )
    try {
      try {
        phaseRes = await envoyer(subOptions)
      } catch (error) {
        /*
         * REPLI APRÈS REFUS, comme le lancement en parallèle (plus haut). Mesuré
         * 2026-09-30 13:42 : l'étape build, sur le SEUL modèle du rôle subagent
         * (claude-opus-5-5), a été refusée par le filtre de sécurité, et le run a fini rouge sans
         * rien tenter. Relancer le MÊME modèle échoue pareil : on rejoue UNE fois sur le voisin,
         * avec la même session (sur une reprise, le message ne porte que « continue »).
         */
        const cause = error instanceof Error ? error.message : String(error)
        const repli =
          classifyProviderFailure(cause) === 'refused'
            ? modeleDeRepliApresRefus(subOptions.model)
            : undefined
        if (!repli || repli === subOptions.model) throw error
        push({
          step: 'exec',
          provider: providerDeLaPhase,
          role: roleDeLaPhase,
          model: subOptions.model,
          text: '',
          prompt: execPrompt,
          status: 'failed',
          evidence: evidenceDeLErreur(error),
          error: explainRoleFailure(
            `Phase ${phase}`,
            roleDeLaPhase,
            { provider: providerDeLaPhase, model: subOptions.model, message: cause },
            roles.getBinding(roleDeLaPhase).provider
          ),
          durationMs: performance.now() - phaseStartedAt,
          execution
        })
        onDelta?.(
          'exec',
          `\n[repli] ${subOptions.model} a refusé le message — nouvel essai sur ${repli}\n`
        )
        modeleDeLaPhase = repli
        phaseRes = await envoyer({ ...subOptions, model: repli })
      }
    } catch (error) {
      supervision.dispose()
      // L'erreur brute dit la cause mais pas QUEL role l'a subie ni son binding : on prefixe.
      //
      // DEUX defauts corriges ici. (1) Le role etait ecrit EN DUR a `'subagent'` alors que
      // `roleDeLaPhase` — utilise deux lignes plus bas dans le meme `push` — vaut `'judge'` sur une
      // phase de juge dedie : un echec de juge s'affichait donc « le role subagent ». (2) Le
      // provider passe est celui qui a SERVI a l'appel ; sur une phase de juge il vient de
      // `bindingDeRepliPourPhase`, qui lit un INSTANTANE de roles pris au demarrage du run. Il peut
      // donc differer de la config courante — d'ou le binding REEL transmis en dernier argument,
      // pour que le message dise « parti sur X, binde sur Y » au lieu d'affirmer un reglage absent.
      const explained = explainRoleFailure(
        `Phase ${phase}`,
        roleDeLaPhase,
        {
          provider: providerDeLaPhase,
          ...(modeleDeLaPhase ? { model: modeleDeLaPhase } : {}),
          message: error instanceof Error ? error.message : String(error)
        },
        roles.getBinding(roleDeLaPhase).provider
      )
      push({
        step: 'exec',
        provider: providerDeLaPhase,
        role: roleDeLaPhase,
        text: '',
        prompt: execPrompt,
        status: 'failed',
        evidence: evidenceDeLErreur(error),
        error: explained,
        durationMs: performance.now() - phaseStartedAt,
        execution
      })
      /**
       * LE SERVEUR D'OUTILS SE FERME AUSSI QUAND LA PHASE ECHOUE.
       *
       * Ce `throw` est la SEULE sortie non locale entre l'ouverture du serveur et sa fermeture
       * plus bas : un echec provider, un timeout, ou une annulation par le signal sautait donc la
       * fermeture, et le port loopback — avec son jeton — survivait au noeud qui le justifiait,
       * pour toute la duree de vie du process principal. Trois relecteurs independants ont
       * converge sur ce chemin ; il est reproduit par un test qui fait echouer l'appel provider.
       *
       * `arreter()` est idempotent : le fermer ici ET en fin de phase ne peut pas nuire, alors
       * qu'envelopper toute la region dans un `try/finally` deplacerait la portee des variables
       * declarees entre les deux et changerait bien plus que ce defaut.
       */
      await fermerOutilsNatifs('echec de la phase')
      throw new Error(explained)
    }
    // Chaîne la session pour la phase suivante (fallback : garde l'ancien id si le provider n'en
    // rend pas de nouveau — un resume claude conserve le même id et y APPEND les tours).
    //
    // RESUME FANTÔME : on ne chaîne que si l'adaptateur REPREND vraiment. `codex` rend un
    // `thread_id` sans savoir le reprendre ; le chaîner faisait basculer la phase suivante dans la
    // branche `resuming`, qui remplace tout `phaseContext` par « acquis déjà connus — ne les
    // redemande pas ». L'acquis des phases était donc perdu au moment précis où la phase suivante
    // en dépend. Sans capacité prouvée : pas de session, donc ré-injection complète.
    // Un juge dédié ne CHAÎNE pas sa session dans l'exécution : son provider peut différer, et sa
    // session n'est pas la continuation du travail. On préserve la chaîne de l'exécution telle
    // quelle — sinon la phase suivante reprendrait la session du juge au lieu de la sienne.
    supervision.dispose()
    // La brique skill sur son propre agent COUPE la chaîne, comme un panel : sa session est peut-être
    // chez un autre fournisseur, et la phase suivante reçoit alors le contexte complet.
    prevSessionId = jugeDedie
      ? prevSessionId
      : agentPropreDuNoeudSkill
        ? undefined
        : registry.honoursSessionResume(providerDeLaPhase)
          ? (phaseRes.sessionId ?? prevSessionId)
          : undefined
    prevSessionSandbox = prevSessionId ? phaseSandbox : undefined
    if (
      phase === 'build' &&
      phaseRes.sessionId &&
      registry.honoursSessionResume(providerDeLaPhase)
    ) {
      const { observePrompt: _observe, ...optionsDuBuild } = subOptions
      sessionDuBuild = {
        id: phaseRes.sessionId,
        provider: providerDeLaPhase,
        options: optionsDuBuild,
        model: modeleDeLaPhase
      }
    }
    if (phaseRes.usage) {
      cost.add({
        // Provider RÉEL ayant répondu (le registre peut rerouter une exécution vers un executor
        // local) — pas le demandé, sinon trace/coût mentent sur qui a vraiment tourné.
        provider: phaseRes.provider ?? subProvider,
        role: 'subagent',
        model: phaseRes.model ?? modeleDeLaPhase,
        inputTokens: phaseRes.usage.inputTokens,
        outputTokens: phaseRes.usage.outputTokens,
        cacheReadTokens: phaseRes.usage.cacheReadTokens,
        cacheCreationTokens: phaseRes.usage.cacheCreationTokens,
        costUsd: phaseRes.usage.costUsd
      })
    }
    push({
      step: 'exec',
      provider: phaseRes.provider ?? subProvider,
      role: 'subagent',
      model: phaseRes.model ?? modeleDeLaPhase,
      text: phaseRes.text,
      thinking: phaseRes.thinking,
      tokens: phaseRes.usage
        ? phaseRes.usage.inputTokens + phaseRes.usage.outputTokens
        : undefined,
      costUsd: phaseRes.usage?.costUsd,
      usage: phaseRes.usage,
      prompt: execPrompt,
      status: 'completed',
      durationMs: performance.now() - phaseStartedAt,
      evidence: phaseRes.executionEvidence,
      artifacts: phaseRes.artifacts,
      detail: execPhases.length > 1 ? `phase ${phase}` : undefined,
      execution
    })
    aggregatedEvidence.push(...(phaseRes.executionEvidence ?? []))
    // Lectures DIRECTES du Brain (Read d'une note, Grep sous sa racine) : sans ces lignes, la trace
    // ne montrait que les `brain_read` et taisait les notes lues comme fichiers (mesure 2026-09-27).
    for (const detail of lecturesDirectesDuBrain(
      phaseRes.executionEvidence,
      sharedBrainRoot(),
      phase
    )) {
      push({ step: 'exec', role: 'subagent', detail })
    }
    lastExecText = phaseRes.text
    lastUsage = phaseRes.usage
    /**
     * LA DÉRIVE, DITE ET ARBITRÉE — à la fin NATURELLE de la phase, l'agent étant allé au bout.
     *
     * Rien n'a été interrompu : la seule chose que la dérive change est la SUITE. On le dit d'abord
     * à l'utilisateur (c'était la demande : « il coupe pas, l'orchestrateur m'écrit que c'est
     * arrivé »), puis UN appel de modèle tranche si la route prévue a encore un sens. Le détecteur
     * ne choisit jamais la destination : trancher demande de comprendre l'objectif, et une
     * heuristique déguisée en jugement est exactement ce qu'on refuse.
     */
    const derive = supervision.trip()
    let texteDePhase = phaseRes.text
    /**
     * BOUCLE D'OUTILS d'un noeud SKILL — reservee aux noeuds skill, jamais aux huit phases.
     *
     * Sans elle, une skill qui prescrit « appelle brain_query » / « appelle remember » produisait
     * un texte DECRIVANT l'action au lieu de l'accomplir, et le graphe affichait une brique qui
     * avait l'air d'avoir travaille. Le catalogue est une liste blanche de deux commandes :
     * `orchestrate` en est absent deliberement, sans quoi un noeud pourrait lancer un run depuis
     * l'interieur d'un run.
     *
     * Rien ici ne coupe : plafond atteint, outil en echec ou commande refusee, on garde le
     * dernier texte, on le TRACE, et la phase se termine normalement.
     */
    const lanceurOutils = isPipelinePhase(phase) ? undefined : lanceurQuiCompte()
    if (lanceurOutils) {
      for (let tour = 0; tour < TOURS_OUTILS_MAX; tour++) {
        if (!demandeUnOutil(texteDePhase)) break
        const appels = await executerOutilsDuNoeud(texteDePhase, lanceurOutils)
        if (appels.length === 0) break
        for (const appel of appels) {
          const etat = appel.refuse ? 'refuse' : appel.ok ? 'ok' : 'echec'
          push({
            step: 'exec',
            role: 'subagent',
            detail: `outil ${appel.name} (${phase}) : ${etat}`
          })
        }
        const compteRendu = compteRenduDesOutils(appels)
        if (!compteRendu) break
        try {
          /**
           * `observePrompt` est RETIRE pour ce tour : il ecrase `execPrompt`, et la trace du run
           * aurait alors montre le prompt du tour d'outil a la place de celui de la phase. Une
           * observabilite qui ment sur ce qui a ete envoye est pire qu'une absente.
           */
          const { observePrompt: _ignore, ...optionsOutil } = subOptions
          /**
           * UN SEUL message utilisateur, qui reporte TOUT.
           *
           * Le provider Claude n'envoie que le DERNIER message utilisateur
           * (`providers/claude.ts` : `lastUser = lastUserMessage?.content`). Passer un tableau
           * `[contexte, reponse, resultat]` en croyant a une conversation faisait donc perdre le
           * contexte de la phase : le tour d'outil ne voyait plus que le resultat de sa propre
           * commande.
           *
           * Mesure sur le run reel : le noeud `learn` a interroge le Brain, puis a
           * conclu « mon contexte ne contient aucune sortie de phase precedente — ni diff, ni
           * chemin de fichier ». Il disait VRAI : son premier tour avait 3661 caracteres avec
           * `[phase think]` et `[phase build]`, son second n'avait plus que le compte rendu de
           * l'outil. La boucle censee l'outiller le rendait aveugle.
           */
          const rappel = [
            phaseMessages.map((m) => m.content).join('\n\n'),
            `TA REPONSE PRECEDENTE :\n${texteDePhase}`,
            compteRendu
          ].join('\n\n')
          const suivant = await registry.send(
            providerDeLaPhase,
            [{ role: 'user', content: rappel }],
            optionsOutil
          )
          /**
           * Le COUT de ce tour est compte comme celui de la phase. Sans cela, jusqu'a deux appels
           * provider par noeud skill restaient invisibles au recap de cout : le run paraissait
           * moins cher qu'il ne l'etait, en silence. Ce depot combat precisement les couts
           * invisibles — en ajouter un ici serait se contredire.
           */
          if (suivant.usage) {
            cost.add({
              provider: suivant.provider ?? providerDeLaPhase,
              role: 'subagent',
              model: suivant.model ?? phaseBinding.model,
              inputTokens: suivant.usage.inputTokens,
              outputTokens: suivant.usage.outputTokens,
              cacheReadTokens: suivant.usage.cacheReadTokens,
              cacheCreationTokens: suivant.usage.cacheCreationTokens,
              costUsd: suivant.usage.costUsd
            })
          }
          if (!suivant.text?.trim()) break
          texteDePhase = suivant.text
        } catch {
          // Le tour d'outil supplementaire est un BONUS : son echec laisse le livrable precedent
          // intact plutot que de perdre la phase.
          break
        }
      }
    }
    /**
     * Fermeture du serveur d'outils : la phase est terminee, tours d'outils compris. Un port laisse
     * ouvert survivrait au noeud qui le justifiait.
     */
    await fermerOutilsNatifs('fin de phase')
    // La ligne `SUITE:` ajoutee plus bas est celle de l'ARBITRE : `recordPhase` doit la distinguer
    // de celle du modele, qu'il ignore pour `think`.
    let suiteArbitree = false
    if (derive) {
      const constat = `dérive détectée (${derive.signal}) — ${derive.detail}`
      onDelta?.(
        'exec',
        `\n[dérive] ${constat}. La phase \`${phase}\` est allée au bout, rien n'a été interrompu — arbitrage de la suite…\n`
      )
      let verdict: RouteVerdict = { kind: 'continuer' }
      // Le brief est compose UNE fois : le declarer en le recalculant ferait de l'inventaire une
      // seconde evaluation, qui pourrait annoncer une taille differente de celle envoyee.
      const briefDeLArbitrage = briefArbitrage(derive, phase, task)
      try {
        // Une ligne à rendre, sans outil : le modèle des PETITES TÂCHES (Haiku par défaut).
        // Il partait sur le modèle de la phase, donc Opus en effort maximal.
        const arbitreBinding = roles.bindingDesPetitesTaches()
        const arbitre = await this.sendWithRoleContext(
          `arbitrage dérive ${phase}`,
          ROLE_PETITES_TACHES,
          arbitreBinding.provider,
          arbitreBinding.model,
          () =>
            registry.send(
              arbitreBinding.provider,
              [{ role: 'user', content: 'Tranche maintenant.' }],
              {
                system: briefDeLArbitrage,
                // Une seule injection ici, mais elle doit se NOMMER : sans bloc declare, un system
                // non vide se lisait comme « rien d'inventorie » au lieu de « un brief d'arbitrage ».
                systemBlocks: [{ name: 'briefArbitrage', chars: briefDeLArbitrage.length }],
                model: arbitreBinding.model,
                reasoningEffort: arbitreBinding.reasoningEffort,
                // L'annulation UTILISATEUR est honorée pendant l'arbitrage aussi : sans ce signal
                // il tournait jusqu'à son terme au moment précis où l'utilisateur veut couper.
                ...(signal ? { signal } : {})
              }
            )
        )
        verdict = readRouteVerdict(arbitre.text)
        noterAppelCourt(cost, {
          appel: 'arbitrageDerive',
          binding: arbitreBinding,
          res: arbitre,
          issue: verdict?.kind === 'phase' ? `phase : ${verdict.phase}` : (verdict?.kind ?? '')
        })
      } catch (error) {
        // Arbitre injoignable : on ne bifurque pas sur une décision qu'on n'a pas. Le plan reprend.
        signalerPanneAppelCourt('arbitrageDerive', error)
        verdict = { kind: 'continuer' }
      }
      /**
       * La bifurcation passe par le mécanisme de déviation qui existe DÉJÀ : `recordPhase()` lit une
       * ligne `SUITE:` en fin de sortie (`readModelChoice`) et le marcheur l'honore, même vers une
       * phase que le graphe n'enchaînait pas. Aucune seconde plomberie de routage à maintenir.
       */
      const suite =
        verdict?.kind === 'phase'
          ? `\nSUITE: ${verdict.phase}`
          : verdict?.kind === 'stop'
            ? `\nSUITE: fin`
            : ''
      const decision =
        verdict?.kind === 'phase'
          ? `route reprise en \`${verdict.phase}\``
          : verdict?.kind === 'stop'
            ? 'plus rien à jouer sur cette demande'
            : 'le plan prévu reprend'
      onDelta?.('exec', `[dérive] ${decision}\n`)
      texteDePhase = `${phaseRes.text}\n\n[dérive] ${constat} — ${decision}.${suite}`
      suiteArbitree = suite !== ''
    }
    texteDePhase = garderCasLimitesFrame(
      phase,
      garderCibleScout(phase, garderFormeThink(phase, texteDePhase))
    )
    recordPhase(phase, texteDePhase, aggregatedEvidence.slice(evidenceStart), suiteArbitree)
    // B4 — le contexte PORTÉ à la phase suivante est borné (la sortie complète reste dans
    // phaseOutputs + la trace) : évite une croissance quadratique du prompt sur les chaînes longues.
    const carried = porterVersPhaseSuivante(texteDePhase)
    pousserContexte(
      `deriveArbitrage:${phase}`,
      `[phase ${phase}] ${carried}` +
        // L'EXTRAIT part avec le constat : la phase insérée (un `scout`, typiquement) recevait le
        // COMPTE (« la même erreur est revenue 3 fois ») sans le fragment qui l'a montré.
        (derive?.extrait ? `\nExtrait fautif : ${derive.extrait}` : '')
    )
  }
  /**
   * LA RELECTURE À FROID DU CADRAGE (règles et mesure dans `relecture-froide.ts`).
   *
   * Branchée sur la boucle des phases, et non dans `recordPhase` qui est synchrone : tous les chemins
   * d'un cadrage (séquentiel, groupe, solo) y repassent. La reprise joue `frame` directement au lieu
   * d'écrire `SUITE: frame` : une liste plate ignore une seconde déviation, et c'est le cadrage
   * repris, pas le refusé, qui doit garder la main sur la suite.
   */
  let relectureFaite = false
  const dernierCadrage = (): string =>
    phaseOutputs.filter((sortie) => sortie.phase === 'frame').at(-1)?.text ?? ''
  const retirerDuContexte = (entree: string): void => {
    const rang = phaseContext.indexOf(entree)
    if (rang >= 0) phaseContext.splice(rang, 1)
  }
  const reprendreLeCadrage = async (ecarts: readonly string[]): Promise<void> => {
    onDelta?.(
      'exec',
      `\n[relecture à froid] ${ecarts.length} écart(s) avec la demande : le cadrage repart une fois.\n`
    )
    const consigne = consigneDeReprise(ecarts)
    const remplaces = phaseContext.filter((entree) => entree.startsWith('[phase frame]'))
    pousserContexte('relectureFroide', consigne)
    // Comme une réparation : une session reprise ne recevrait ni la consigne ni le contexte complet.
    prevSessionId = undefined
    try {
      await executePipelinePhase('frame')
    } catch (error) {
      if (signal?.aborted) throw error
      retirerDuContexte(consigne)
      const motif = error instanceof Error ? error.message : String(error)
      push({
        step: 'gate',
        role: 'gate',
        detail: `Le cadrage repris est en panne, le run garde le premier : ${motif.slice(0, 300)}`
      })
      return
    }
    // Le build ne lit plus ni l'ordre de refaire le cadrage, ni la version remplacée.
    retirerDuContexte(consigne)
    remplaces.forEach(retirerDuContexte)
    const question = questionDuCadrageRepris(dernierCadrage())
    if (!question) return
    // Le délai passe par le signal : c'est lui qui libère la file de questions et ferme la fenêtre
    // (`askModelQuestion`, `index.ts`). Une fenêtre ignorée gardait sinon le run avant le code.
    const delai = new AbortController()
    const minuteur = setTimeout(
      () => delai.abort('Question restée sans réponse'),
      DELAI_QUESTION_CADRAGE_MS
    )
    const reponse = await this.deps
      .demanderALUtilisateur?.(
        question,
        task,
        signal ? AbortSignal.any([signal, delai.signal]) : delai.signal
      )
      ?.catch(() => undefined)
    clearTimeout(minuteur)
    if (signal?.aborted) return
    const consigneUtilisateur = consigneDeLaReponse(reponse)
    if (consigneUtilisateur) {
      pousserContexte(
        'directiveUtilisateur',
        `DIRECTIVE UTILISATEUR ARRIVEE PENDANT LE RUN — PRIORITAIRE, elle CORRIGE le cadre : ${consigneUtilisateur}`
      )
      prevSessionId = undefined
    }
    push({
      step: 'gate',
      role: 'gate',
      detail: consigneUtilisateur
        ? `Question du cadrage repris : réponse transmise à la suite (« ${consigneUtilisateur.slice(0, 200)} »).`
        : `Question du cadrage repris restée sans réponse, le run continue : « ${question.text} »`
    })
  }
  const relireLeCadrage = async (cadrageJoue: boolean): Promise<void> => {
    const cadrage = dernierCadrage()
    const aPasser = relectureAPasser({
      dejaFaite: relectureFaite,
      buildPrevu: (grapheBrut?.nodes.map((node) => node.phase) ?? execPhases).includes('build'),
      cadrageJoue,
      arretDemande: souhaitModele?.kind === 'stop',
      annule: signal?.aborted === true,
      critique: this.difficulteDuRun(task) === 'critical',
      cadrage
    })
    if (!aPasser) return
    relectureFaite = true
    let issue: IssueDeRelecture
    try {
      const relecteur = roles.bindingDesPetitesTaches()
      const reponse = await this.sendWithRoleContext(
        'relecture à froid du cadrage',
        ROLE_PETITES_TACHES,
        relecteur.provider,
        relecteur.model,
        () =>
          registry.send(
            relecteur.provider,
            [{ role: 'user', content: promptDeRelecture(task, cadrage) }],
            {
              system: CONSIGNE_RELECTURE_FROIDE,
              systemBlocks: [
                { name: 'relectureFroide', chars: CONSIGNE_RELECTURE_FROIDE.length }
              ],
              model: relecteur.model,
              reasoningEffort: relecteur.reasoningEffort,
              toolProfile: 'sans-outil',
              ...(signal ? { signal } : {})
            }
          )
      )
      issue = lireRelecture(reponse.text)
      noterAppelCourt(cost, {
        appel: 'relectureFroide',
        binding: relecteur,
        res: reponse,
        issue: issueDeRelecturePourLeCout(issue)
      })
      push({
        step: 'gate',
        role: 'gate',
        detail: ligneDeRelecture(issue, reponse.usage?.costUsd)
      })
    } catch (error) {
      if (signal?.aborted) return
      signalerPanneAppelCourt('relectureFroide', error)
      push({ step: 'gate', role: 'gate', detail: ligneDePanneDeRelecture(error) })
      return
    }
    if (issue.kind === 'ecarts' && !signal?.aborted) await reprendreLeCadrage(issue.ecarts)
  }
  for (const phase of suitePhases()) {
    const phasesDejaJouees = phasesJouees
    await executePipelinePhase(phase)
    if (phase === 'frame') await relireLeCadrage(phasesJouees > phasesDejaJouees)
  }
  // J1 — le juge (et le résultat) reçoivent l'AGRÉGAT de toutes les phases, jamais la seule
  // dernière : sinon un livrable produit en frame/terrain devient invisible si clean dérive.
  // Recalculable : une phase de réparation (B5) ajoute à phaseOutputs, l'agrégat suit.
  // La marque de coupe nomme la copie entiere. Un chemin illisible (identifiant de run
  // refuse) retombe sur la marque d'avant plutot que de casser le jugement.
  const cheminDuLivrableEntierDuRun = (): string | undefined => {
    try {
      return this.deps.cheminDuLivrableEntier?.(runId)
    } catch {
      return undefined
    }
  }
  /** Réponses du build aux refus « sans cause », ajoutées APRÈS l'agrégat (hors coupe par étape). */
  const blocsDEchange: string[] = []
  const avecEchanges = (texte: string): string =>
    blocsDEchange.length ? `${texte}\n\n${blocsDEchange.join('\n\n')}` : texte
  const buildExec = (): {
    text: string
    /** Le même agrégat, SANS les versions remplacées : ce que lit l'utilisateur. */
    rendu: string
    usage: Usage | undefined
    executionEvidence: ExecutionEvidence[]
  } => ({
    // #3 — chaque bloc de phase est borné avant agrégation pour le juge (l'agrégat n'est plus la
    // concaténation des sorties COMPLÈTES). Sortie intégrale = phaseOutputs.
    text: avecEchanges(
      phaseOutputs.length > 1
        ? agregerPhasesPourLeJuge(
            phaseOutputs,
            JUDGE_PHASE_CAP,
            undefined,
            cheminDuLivrableEntierDuRun()
          )
        : lastExecText
    ),
    rendu:
      phaseOutputs.length > 1
        ? agregerPhasesPourLUtilisateur(
            phaseOutputs,
            JUDGE_PHASE_CAP,
            undefined,
            cheminDuLivrableEntierDuRun()
          )
        : lastExecText,
    usage: lastUsage,
    executionEvidence: aggregatedEvidence
  })
  let exec = buildExec()
  let lastJudgeText = ''
  /** Verdict tel que les juges l'ont RENDU (panel : reconstruit depuis les membres) — memoire du juge. */
  let lastJudgeMemoire = ''
  /** Le dernier verdict LU (lecteur canonique + note), rendu avec `judgeText`. */
  let dernierVerdictLu: { valide: boolean; note?: number } | undefined
  const lireLeVerdict = (valide: boolean, texte: string): { valide: boolean; note?: number } => {
    const note = noteDuJuge(texte)
    return note === undefined ? { valide } : { valide, note }
  }
  /** Le livrable agrégé tel que le juge précédent l'a reçu : base du bloc « CE QUI A CHANGÉ » (changements-juge.ts). */
  let texteDejaJuge = ''
  /**
   * Les MINEUR du DERNIER verdict qui a clos un `/scout` nommé sans nouveau passage (
   * `reservesMineuresDuScout`) : ajoutés au résultat rendu, jamais perdus. Vidé à chaque jugement.
   */
  let reservesDuJuge: string[] = []
  /**
   * Les objections d'une RELECTURE SEULE qui a refusé en les nommant (piste 5
   * `defautsDeLaRelectureSeule`) : la relecture est livrée, et ces défauts du travail relu sont
   * écrits en tête du résultat. Vidé à chaque jugement.
   */
  let defautsDeLaRelecture: string[] = []
  /**
   * Le motif d'un panel de juges tombé en panne sans quorum (`quorum.ts`). Présent, le
   * passage s'arrête : rejouer un build ne ferait pas répondre les juges. Vidé à chaque jugement.
   */
  let panneDesJuges: string | undefined
  /**
   * Le texte RENDU à l'utilisateur : l'agrégat du DERNIER jugement SANS les versions remplacées
   * d'une étape rejouée (`exec.rendu`). Figé avec `exec` : learn, joué après, n'y entre
   * pas. Le juge garde `exec.text`.
   * fix-ok: tour b6150a1a — `result` reprenait `exec.text`, l'agrégat écrit pour le juge :
   * la réponse affichée commençait par deux « [phase scout] (version remplacée…, plus bas) ».
   */
  const texteRendu = (): string =>
    phaseOutputs.length > 0
      ? exec.rendu
      : resultatDeRelectureSeule(lastJudgeText, defautsDeLaRelecture)

  // 2. Un JUGE (autre rôle → potentiellement autre modèle) évalue le résultat.
  const judgeBinding =
    bindingOverride ?? runtimeSnapshot?.roles.judge ?? roles.getBinding('judge')
  const judgeProvider = judgeBinding.provider

  /** La trace DIT pourquoi un `/scout` nommé s'arrête malgré des MINEUR. */
  const pousserReservesDuJuge = (): void => {
    if (reservesDuJuge.length === 0) return
    push({
      step: 'gate',
      role: 'gate',
      detail: `Réserves mineures du juge gardées dans le résultat (${reservesDuJuge.length}) : un /scout nommé ne relance pas l'analyse pour des objections MINEUR seules.`
    })
  }

  // Une passe JUGE (autre rôle → décorrélation) + GATE déterministe sur l'état COURANT de `exec`.
  // Rejouable : après une phase de réparation, l'agrégat `exec` change et on re-juge.
  const judgeAndGate = async (): Promise<{
    valid: boolean
    gate: ReturnType<typeof evaluateClosure>
    learningAttestations: IndependentLearningAttestation[]
    /** Refusé par les contrôles locaux, AVANT tout juge (échange « sans cause »). */
    refusAvantJuge?: true
    /** Refus du juge fait UNIQUEMENT de questions au build (échange de l'étape 2). */
    questionsDuJuge?: string[]
  }> => {
    // Les contrôles locaux falsifiables passent AVANT le juge payant. Un livrable sans preuve ou
    // bloqué par pre-green clôture rouge, ou rejoint une reprise explicitement dessinée : le juge
    // ne peut rien apprendre qu'un oracle local vient déjà de réfuter.
    reservesDuJuge = []
    panneDesJuges = undefined
    const evidenceOk = evidenceSatisfiesTask(task, exec.executionEvidence)
    const hookOutcome = await this.hooks.run('pre-green', {
      task,
      cwd: workCwd,
      verifyCmd: this.resolveVerifyCmd(workCwd),
      requireProof: isMutationTask(task),
      evidenceOkCount: (exec.executionEvidence ?? []).filter((e) => e.ok).length,
      evidence: exec.executionEvidence,
      output: exec.text,
      editsByFile: fichiersEditesParLeRun(exec.executionEvidence, workCwd),
      fichiersTouchesAvantLeRun: this.fichiersSalesAuDemarrage
    })
    // UN SEUL endroit calcule l'etat de cloture (`root-execution-contract.ts`) : cette decision
    // vivait ici en ligne, donc hors de portee des tests — une mutation de sa garde ne faisait
    // rougir aucun test (mesure du 2026-08-18). Elle porte la regle du run en LECTURE SEULE : un
    // run qui n'a joue que scout/frame/terrain n'a aucune mutation a prouver, meme si la phrase de
    // l'utilisateur en annoncait une pour la suite.
    const cloture = etatDeCloture(task, phaseOutputs, evidenceOk, isMutationTask(task))
    /*
     * Le travail NON LIVRE compte a CHAQUE sortie de cloture, pas seulement a la derniere.
     * Un juge externe a compte le 2026-08-22 : six sites `evaluateClosure` dans ce fichier, DEUX
     * cables. Le pre-gate et le juge repris d'un CLI detache retournent tous deux en avance, donc
     * une sous-tache en echec les traversait et le run se rendait « succeeded ». Bloquer au
     * pre-gate est en prime moins cher : cela coupe AVANT de payer le juge.
     */
    const preGate = evaluateClosure({
      // fix-ok: tour 8641812d-6401-4129-a6b0-13a64228e0bc (activity 04:27:22.132Z) — un hook
      // bloquant forcait `red`, donc le refus s'ouvrait sur « Échec déjà déclaré » alors que le run
      // n'avait rien declare : seul le fix-gate bloquait, et il porte deja sa raison (meme defaut
      // que 11f829ad au gate final). Sans raison du hook, on garde `red` pour ne pas bloquer muet.
      status: hookOutcome.blocked && hookOutcome.reasons.length === 0 ? 'red' : cloture.status,
      dod: cloture.dod.map((check) => ({ ...check, hasContent: true })),
      travauxNonLivres: [...travauxNonLivres]
    })
    if (hookOutcome.blocked) {
      preGate.blocked = true
      preGate.reasons.push(...hookOutcome.reasons)
    }
    if (preGate.blocked) {
      onPhase?.({ step: 'gate' })
      push({
        step: 'gate',
        role: 'gate',
        detail: `Arrêté au contrôle final : ${preGate.reasons.join('; ')}`
      })
      return { valid: false, gate: preGate, learningAttestations: [], refusAvantJuge: true }
    }

    // Un juge terminal peut avoir fini dans son CLI détaché après la mort d'Electron. Le
    // rattachement l'ajoute alors aux acquis APRÈS les éventuels juges intermédiaires du graphe.
    // Consommer ici l'occurrence restante évite de payer/rejouer exactement le même verdict — mais
    // seulement si elle a jugé le texte final, pas un texte dépassé.
    const resumedJudgeText = verdictReprisDuTexteFinal()
    if (resumedJudgeText !== undefined) {
      const verdictDuJuge = lireVerdictJuge(verdictAvecObjectionsPortees(resumedJudgeText))
      // Sur un `/scout` nommé, des MINEUR seuls sont des réserves, pas un refus.
      const reserves = evidenceOk ? reservesMineuresDuScout(phaseNommee, resumedJudgeText) : []
      // Piste 5 : une relecture seule qui nomme ses objections est livrée.
      const defautsRelus =
        evidenceOk && !verdictDuJuge
          ? defautsDeLaRelectureSeule(phaseNommee, phaseOutputs.length, resumedJudgeText)
          : []
      const ok = evidenceOk && (verdictDuJuge || reserves.length > 0 || defautsRelus.length > 0)
      reservesDuJuge = verdictDuJuge ? [] : reserves
      defautsDeLaRelecture = defautsRelus
      lastJudgeText = resumedJudgeText.trim()
      lastJudgeMemoire = lastJudgeText
      dernierVerdictLu = lireLeVerdict(verdictDuJuge, lastJudgeText)
      // Le juge repris a statué sur le texte repris, celui que porte `exec` ici.
      texteDejaJuge = exec.text
      // Rattachement au run et a la conversation : sans eux, aucun verdict n'est re-etiquetable
      // apres coup par l'humain, et calibration() reste a accuracy:null (186 lignes muettes).
      // La calibration garde le vote RÉEL du juge : des réserves gardées ne le changent pas en vert.
      trust.record({
        judgeModel: judgeProvider,
        verdict: evidenceOk && verdictDuJuge ? 'green' : 'red',
        runId,
        conversationId: conversationId
      })
      push({
        step: 'judge',
        provider: judgeProvider,
        role: 'judge',
        model: judgeBinding.model,
        text: lastJudgeText,
        detail: ok
          ? reservesDuJuge.length > 0
            ? 'verdict repris · validé avec réserves mineures'
            : defautsDeLaRelecture.length > 0
              ? 'verdict repris · relecture livrée, défauts relevés dans le travail relu'
              : 'verdict repris · validé'
          : 'verdict repris · défaut',
        status: 'completed',
        execution: {
          phase: 'judge',
          agentId: 'judge:recovered',
          taskId: 'judge:recovered',
          groupId: 'judge:recovered',
          dependencyIds: []
        }
      })
      onPhase?.({ step: 'gate' })
      const recoveredGate = evaluateClosure({
        // Le refus est porte par la DoD du verdict ; `red` y ajoutait un faux « Échec déjà déclaré ».
        status: 'green',
        dod: dodDuVerdict(ok, resumedJudgeText),
        // Meme raison qu'au pre-gate : un verdict REPRIS ne rend pas livre ce qui n'a pas ete livre.
        travauxNonLivres: [...travauxNonLivres]
      })
      push({
        step: 'gate',
        role: 'gate',
        detail: recoveredGate.blocked
          ? `BLOQUÉ: ${recoveredGate.reasons.join('; ')}`
          : 'clôture autorisée'
      })
      pousserReservesDuJuge()
      return {
        valid: ok,
        gate: recoveredGate,
        learningAttestations: attestJudgeApprovedLearning(
          exec.text,
          ok,
          runId,
          judgeProvider,
          judgeBinding.model,
          workCwd,
          resumedJudgeText
        )
      }
    }

    // fix-ok: cause PROUVÉE en live (verdict : « le livrable requis est un RUN.md
    // physique ») — A2 a chargé le SKILL judge du kit qui exige un RUN.md/fingerprint absent
    // in-app ; on neutralise ce couplage côté juge, comme J4/B2 côté exec.
    // Une demande `judge` explicite ne joue AUCUNE phase d'exécution (`regimePhases` rend `[]`) :
    // l'agrégat et les preuves sont alors vides PAR CONSTRUCTION. Réclamer « au moins une preuve
    // d'outil ci-dessous » sur une liste vide condamnait ce cas au rouge quel que soit l'état réel
    // du dépôt — mesuré sur le run (« DEFAUT: livrable agrégé vide et aucune preuve
    // d'outil observée », trace : judge + gate, zéro exec). Ici le juge n'atteste pas le travail
    // d'un autre : il EST l'unique agent, et sa propre inspection read-only est la preuve.
    // CONTRAT DE TÂCHE DE LA CONVERSATION : un tour de relance (« finis », « répare ») ne nomme
    // plus sa cible, donc le juge la perdait de vue — c'est ainsi que quatre runs ont
    // été validés 96/100 sur un AUTRE fichier que celui demandé. Le contrat encore ouvert est
    // déduit des `RUN.md` de la conversation (aucun nouveau stockage) et RAPPELÉ au juge. On
    // informe, on ne bloque pas : l'autorité reste au juge, qui peut peser une relocalisation
    // causale justifiée là où une règle déterministe produirait des faux blocages (mesuré).
    const noteContrat = conversationId
      ? (noteContratPourJuge(task, contratDeLaConversation(conversationId, convRunsRoot())) ?? '')
      : ''
    /*
     * SUPPOSITIONS DU CADRAGE : un livrable peut etre impeccable et reposer sur une affirmation que
     * le cadrage avait lui-meme marquee NON VERIFIEE. Sans ce rappel, le juge validait en silence —
     * rien dans son prompt ne nommait ce sur quoi le travail repose. Meme source que le bloc montre
     * a l'utilisateur : la section `## Confiance` du livrable de FRAME, aucune nouvelle donnee.
     */
    // Note : elle ne sert QUE la branche avec phases. La branche « juge seul » exige
    // `phaseOutputs.length === 0`, donc aucun cadrage a lire et une note toujours vide — l'y
    // injecter aurait ete une ligne qui fait semblant d'agir.
    const noteHypotheses = noteHypothesesPourJuge(
      hypothesesDuCadrage(dernierCadrage(), {
        citationIntrouvable: (chemin, ligne) => citationIntrouvableSurDisque(workCwd, chemin, ligne)
      })
    )
    const jugeSeul = phaseOutputs.length === 0 && !exec.text.trim()
    /*
     * LE FIL DE LA CONVERSATION, POUR LE JUGE SEUL. Les phases le reçoivent (`phaseContext`,
     * `collectedContext`) ; le juge seul, UNIQUE agent du run, ne recevait que la TÂCHE nue.
     * fix-ok: run « judge-projet-ameliore-boucle-objectif-muwn6zvy » — « Judge le Projet »
     * dans un fil consacré à PaperTrading2 mais rangé dans D:\Chirurgien\AssistantChirurgien : la
     * trace du juge contient 0 mention de PaperTrading, seul le CLAUDE.md du dossier (« # Projet :
     * assistant patients… ») nommait un projet. Il a jugé le dossier, et la chaîne a suivi.
     */
    const filPourJugeSeul =
      jugeSeul && collectedContext.trim()
        ? `${collectedContext.trim()}\n` +
          `[FIN DU FIL — « le projet », « ça » dans la TÂCHE renvoient à CE fil. S'il désigne un autre ` +
          `dossier que ton dossier de travail, inspecte celui qu'il désigne ou dis l'écart, au lieu de juger le mauvais.]\n`
        : ''
    const judgePrompt = jugeSeul
      ? `Tu es un juge outillé en lecture seule, et tu es le SEUL agent de ce run : AUCUNE phase d’exécution ` +
        `n’a tourné avant toi, il n’existe donc ni livrable agrégé ni preuve d’outil préalable — ce n’est pas un défaut. ` +
        `Inspecte TOI-MÊME le workspace avec tes outils de lecture et fonde ton verdict sur ce que tu as réellement lu ; ` +
        `n’affirme rien que ton inspection n’établit pas.\n` +
        `IMPORTANT (in-app Autowin OS) : n'exige jamais de RUN.md physique, d'empreinte SHA-256 ni de chemin kit.\n` +
        filPourJugeSeul +
        noteContrat +
        `TÂCHE: ${task}\n` +
        `Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: <raison courte>".
Puis, APRÈS cette première ligne (sans jamais la modifier), complète pour l'utilisateur :
SCORE: <entier 0-100 — conformité du livrable au besoin, preuves à l'appui>
${CONTRAT_OBJECTIONS}`
      : `Tu es un juge outillé en lecture seule. Inspecte réellement le workspace et confronte au moins une preuve d'outil ci-dessous. ` +
        `Une affirmation sans preuve d'exécution observable est un défaut.\n` +
        `IMPORTANT (in-app Autowin OS) : le livrable est le TEXTE agrégé ci-dessous, PAS un fichier ` +
        `RUN.md sur disque (Autowin le gère). N'exige jamais de RUN.md physique, d'empreinte SHA-256 ` +
        `ni de chemin kit ; juge la SUBSTANCE du livrable et les preuves d'outil réellement observées.\n` +
        JUDGE_FORMAT_CONTRACT +
        JUDGE_TOOLSET_CONTRACT +
        noteContrat +
        noteHypotheses +
        // A partir du 2e passage, `lastJudgeMemoire` est encore le verdict PRECEDENT.
        noteVerdictPrecedentPourJuge(lastJudgeMemoire) +
        // À partir du 2e passage, le juge reçoit aussi les lignes changées depuis le texte déjà jugé.
        noteChangementsPourJuge(texteDejaJuge, exec.text) +
        // piste 4 : les tests joués sur le code actuel ne sont pas à relancer.
        noteTestsDejaJouesPourJuge(aggregatedEvidence.slice(debutPreuvesOrdonnees)) +
        `TÂCHE: ${task}\nRÉPONSE (livrable agrégé de TOUTES les phases) : ${clampAggregateForJudge(exec.text)}\n` +
        `PREUVES OUTILS OBSERVÉES: ${serializeEvidenceForJudge(exec.executionEvidence)}\n` +
        `Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: <raison courte>".
Puis, APRÈS cette première ligne (sans jamais la modifier), complète pour l'utilisateur :
SCORE: <entier 0-100 — conformité du livrable au besoin, preuves à l'appui>
${CONTRAT_OBJECTIONS}
${CONTRAT_ETENDUE}
${CONTRAT_QUESTIONS_AU_BUILD}`
    const judgeMessages = [{ role: 'user' as const, content: judgePrompt }]
    texteDejaJuge = exec.text
    let judgeEnvelope
    // A2 — le juge charge le SKILL.md judge du kit ; F6 — blocs nommés pour l'observabilité.
    const judgeParts = [
      this.phasePrompt('judge', true),
      { name: 'style', text: STYLE_TON },
      { name: 'projectContext', text: projectContext }
    ]
    const judgeBlocks = judgeParts
      .filter((p) => p.text)
      .map((p) => ({ name: p.name, chars: p.text.length }))
    const judgeOptions: SendOptions = {
      system: judgeParts.map((p) => p.text).join(''),
      systemBlocks: judgeBlocks,
      model: judgeBinding.model,
      reasoningEffort: judgeBinding.reasoningEffort,
      execution: this.executionOptions(
      workCwd,
      'read-only',
      runId,
      'judge',
      judgeProvider,
      false,
      judgeBinding.model
    ),
      signal,
      observePrompt: (observed) => {
        observed.systemBlocks = judgeBlocks
        judgeEnvelope = observed
      }
    }
    judgeEnvelope = registry.describePrompt(
      judgeProvider,
      judgeMessages,
      judgeOptions,
      judgeBinding.model
    )
    judgeEnvelope.systemBlocks = judgeBlocks
    const judgeMembers = bindingOverride ? [] : this.resolveJudgeFanOut(runtimeSnapshot)
    const singleJudgeExecution = {
      phase: 'judge' as const,
      agentId: 'judge:single',
      taskId: 'judge:single',
      groupId: 'judge:single',
      dependencyIds: [] as string[],
      attemptId: randomUUID()
    }
    if (judgeMembers.length < 2) {
      onPhase?.({
        step: 'judge',
        phase: 'judge',
        provider: judgeProvider,
        role: 'judge',
        model: judgeBinding.model,
        reasoningEffort: judgeBinding.reasoningEffort,
        execution: singleJudgeExecution
      })
    }
    const judgeStartedAt = performance.now()
    let verdict
    let memoirePanel = ''
    // FAN-OUT JUGE : ≥2 modèles dans le bloc topology judge → N juges en parallèle puis QUORUM
    // de vote MÉCANIQUE (compter les VALIDE ; majorité = pass). Agréger ≠ re-décider : aucun juge
    // supplémentaire ne tranche, on compte les voix. <2 ou absent → un seul juge (rétrocompat).
    if (judgeMembers.length >= 2) {
      const interrogerLesJuges = (
        membres: RoleBinding[]
      ): Promise<{ ok: boolean; responded: boolean; text: string }>[] =>
        membres.map(async (member) => {
          const execution = {
            phase: 'judge' as const,
            agentId: `judge:${member.model ?? member.provider}`,
            taskId: `judge:${member.model ?? member.provider}`,
            groupId: 'judge:fanout',
            dependencyIds: [] as string[],
            attemptId: randomUUID()
          }
          const opts: SendOptions = {
            ...judgeOptions,
            model: member.model,
            reasoningEffort: member.reasoningEffort,
            execution: this.executionOptions(
              workCwd,
              'read-only',
              runId,
              'judge',
              member.provider,
              true,
              member.model
            )
          }
          const startedAt = performance.now()
          onPhase?.({
            step: 'judge',
            phase: 'judge',
            provider: member.provider,
            role: 'judge',
            model: member.model,
            reasoningEffort: member.reasoningEffort,
            execution
          })
          try {
            const r = await this.sendWithRoleContext(
              'jugement (panel)',
              'judge',
              member.provider,
              member.model,
              () =>
                registry.send(member.provider, judgeMessages, opts, (c) =>
                  onDelta?.('judge', c.delta)
                )
            )
            if (r.usage) {
              cost.add({
                provider: r.provider ?? member.provider,
                role: 'judge',
                model: member.model,
                inputTokens: r.usage.inputTokens,
                outputTokens: r.usage.outputTokens,
                cacheReadTokens: r.usage.cacheReadTokens,
                cacheCreationTokens: r.usage.cacheCreationTokens,
                costUsd: r.usage.costUsd
              })
            }
            // Une réponse vide n'est pas un refus du juge : elle suit le chemin d'une panne.
            if (!r.text.trim()) throw new Error('le juge a rendu une réponse vide')
            // Un membre qui valide EN LISTANT des écarts vote DEFAUT : ses objections rejoignent
            // alors le verdict agrégé, donc le feedback de la réparation.
            const votesValide = lireVerdictJuge(verdictAvecObjectionsPortees(r.text))
            push({
              step: 'judge',
              provider: r.provider ?? member.provider,
              role: 'judge',
              model: r.model ?? member.model,
              text: r.text.trim(),
              tokens: r.usage ? r.usage.inputTokens + r.usage.outputTokens : undefined,
              costUsd: r.usage?.costUsd,
              usage: r.usage,
              detail: votesValide ? 'vote: VALIDE' : 'vote: DEFAUT',
              status: 'completed',
              durationMs: performance.now() - startedAt,
              execution
            })
            return { ok: votesValide, responded: true, text: r.text.trim() }
          } catch (error) {
            push({
              step: 'judge',
              provider: member.provider,
              role: 'judge',
              model: member.model,
              text: '',
              status: 'failed',
              evidence: evidenceDeLErreur(error),
              error: error instanceof Error ? error.message : String(error),
              durationMs: performance.now() - startedAt,
              execution
            })
            // Crashé : ne vote PAS. Il reste un juge prévu, donc un absent nommé.
            return { ok: false, responded: false, text: '' }
          }
        })
      const premiersVotes = await Promise.all(interrogerLesJuges(judgeMembers))
      // UNE relance du seul membre en panne, dans ce passage : `skills/judge/SKILL.md:62`.
      const aRappeler = signal?.aborted
        ? []
        : judgeMembers.filter((_, rang) => !premiersVotes[rang]?.responded)
      const results = [...premiersVotes, ...(await Promise.all(interrogerLesJuges(aRappeler)))]
      // Le seuil se calcule sur les juges PRÉVUS (renversement voulu, voir `quorum.ts`).
      // fix-ok: seuil borné aux répondants : test M1 rejoué sur a41081d6, vert à 1 VALIDE sur 3 juges prévus, absents jamais nommés.
      const responders = results.filter((r) => r.responded)
      const valideVotes = responders.filter((r) => r.ok).length
      const graphQuorum = this.workflowDuRun()?.graph
        ? quorumForPhase(this.workflowDuRun()!.graph!, 'judge')
        : undefined
      const issuePanel = issueDuPanel({
        prevus: judgeMembers.length,
        valides: valideVotes,
        refus: responders.length - valideVotes,
        ...(graphQuorum === undefined ? {} : { quorumDuGraphe: graphQuorum })
      })
      const reasons = responders.filter((r) => !r.ok && r.text).map((r) => r.text)
      panneDesJuges = motifPanneDesJuges(issuePanel)
      const absentsNommes = noteDesAbsents(issuePanel)
      if (absentsNommes) push({ step: 'gate', role: 'gate', detail: absentsNommes })
      // Verdict AGRÉGÉ synthétique consommé par le gate ci-dessous. usage=undefined → le coût,
      // déjà ajouté par juge ci-dessus, n'est pas re-compté.
      memoirePanel = verdictPanelPourMemoire(
        responders.map((r) => r.text),
        ''
      )
      verdict = {
        text: verdictDuPanel(issuePanel, {
          // Quorum atteint : les objections des membres RESTENT dans le verdict (
          // tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e) au lieu d'etre reduites au mot VALIDE.
          verdictValide: verdictPanelValide(responders.map((r) => ({ text: r.text, ok: r.ok }))),
          raisons: reasons
        }),
        provider: undefined,
        systemInjected: true,
        usage: undefined
      }
    } else {
      try {
        verdict = await this.sendWithRoleContext(
          'verdict',
          'judge',
          judgeProvider,
          judgeOptions.model,
          () =>
            registry.send(judgeProvider, judgeMessages, judgeOptions, (c) =>
              onDelta?.('judge', c.delta)
            )
        )
      } catch (error) {
        push({
          step: 'judge',
          provider: judgeProvider,
          role: 'judge',
          model: judgeBinding.model,
          text: '',
          prompt: judgeEnvelope,
          status: 'failed',
          evidence: evidenceDeLErreur(error),
          error: error instanceof Error ? error.message : String(error),
          durationMs: performance.now() - judgeStartedAt,
          execution: singleJudgeExecution
        })
        throw error
      }
      if (verdict.usage) {
        cost.add({
          provider: verdict.provider ?? judgeProvider,
          role: 'judge',
          model: verdict.model ?? judgeBinding.model,
          inputTokens: verdict.usage.inputTokens,
          outputTokens: verdict.usage.outputTokens,
          cacheReadTokens: verdict.usage.cacheReadTokens,
          cacheCreationTokens: verdict.usage.cacheCreationTokens,
          costUsd: verdict.usage.costUsd
        })
      }
    }
    // Un reproche dont le propre `TEST:` du juge passe déjà dans la copie du run ne bloque plus.
    const rejeuDuJuge = await rejouerTestsDuJuge(verdict.text, workCwd)
    const noteDuRejeu = noteDuRejeuDuJuge(rejeuDuJuge.rejeux)
    if (noteDuRejeu) push({ step: 'gate', role: 'gate', detail: noteDuRejeu })
    if (rejeuDuJuge.texte !== verdict.text) verdict = { ...verdict, text: rejeuDuJuge.texte }
    /*
     * UN SEUL LECTEUR DE VERDICT — mesure du 2026-09-03.
     *
     * Ce site testait encore `/^\s*valide/i`, c'est-a-dire les premiers mots SEULEMENT. Un juge
     * qui a ecrit « VALIDE » puis s'est corrige a la ligne suivante par « DEFAUT: ... / SCORE: 40 »
     * a donc ferme le run en VERT : trace `causal-trace/conv-9.jsonl` sequence 11 (le texte du
     * verdict porte les deux) et sequence 16 (`valid : true`, `gateBlocked : false`). L'utilisateur
     * a lu « Le resultat demande a ete produit et valide » sur un livrable note 40/100.
     *
     * `lireVerdictJuge` est le lecteur durci et deja canonique (cf. son commentaire) : un
     * `DEFAUT:` n'importe ou dans le texte prime sur toute mention d'approbation. Le chemin greedy
     * (ligne 2522) l'utilisait deja ; les trois chemins du pipeline principal, non — le doublon
     * annonce comme resorbe ne l'etait que sur une lignee.
     */
    const verdictDuJuge = lireVerdictJuge(verdictAvecObjectionsPortees(verdict.text))
    // Sur un `/scout` nommé, des MINEUR seuls sont des réserves ajoutées au résultat,
    // pas un refus qui relance scout + juge. Un MAJEUR, et tout autre run, gardent le blocage.
    const reserves = evidenceOk ? reservesMineuresDuScout(phaseNommee, verdict.text) : []
    // Piste 5 : une relecture seule qui nomme ses objections est LIVRÉE — son verdict
    // est la réponse. Le vote du juge, lui, reste `red` dans la calibration ci-dessous.
    const defautsRelus =
      evidenceOk && !verdictDuJuge
        ? defautsDeLaRelectureSeule(phaseNommee, phaseOutputs.length, verdict.text)
        : []
    const ok = evidenceOk && (verdictDuJuge || reserves.length > 0 || defautsRelus.length > 0)
    reservesDuJuge = verdictDuJuge ? [] : reserves
    defautsDeLaRelecture = defautsRelus
    lastJudgeText = verdict.text.trim()
    lastJudgeMemoire = memoirePanel.trim() || lastJudgeText
    dernierVerdictLu = lireLeVerdict(verdictDuJuge, lastJudgeText)
    // Étape 2 de l'option A : les questions au build d'un refus du juge. Sans section
    // QUESTIONS AU BUILD, l'examen rend tout vide et la clôture ci-dessous est celle d'avant.
    const examenDesQuestions = examinerQuestionsDuJuge({
      verdict: verdict.text,
      refusDuJuge: evidenceOk && !ok,
      objectionsBloquantes: objectionsDuJuge(verdict.text).length,
      travauxNonLivres: travauxNonLivres.size,
      panel: judgeMembers.length >= 2,
      dejaPosees: questionsPoseesDuRun
    })
    // Rattachement au run et a la conversation : sans eux, aucun verdict n'est re-etiquetable
    // apres coup par l'humain, et calibration() reste a accuracy:null (186 lignes muettes).
    // La calibration garde le vote RÉEL du juge : des réserves gardées ne le changent pas en vert.
    trust.record({
      judgeModel: judgeProvider,
      verdict: evidenceOk && verdictDuJuge ? 'green' : 'red',
      runId,
      conversationId: conversationId
    })
    push({
      step: 'judge',
      provider: judgeMembers.length >= 2 ? undefined : (verdict.provider ?? judgeProvider),
      role: judgeMembers.length >= 2 ? 'orchestrator' : 'judge',
      model: judgeMembers.length >= 2 ? undefined : (verdict.model ?? judgeBinding.model),
      text: verdict.text.trim(),
      tokens: verdict.usage ? verdict.usage.inputTokens + verdict.usage.outputTokens : undefined,
      costUsd: verdict.usage?.costUsd,
      usage: verdict.usage,
      detail: ok
        ? reservesDuJuge.length > 0
          ? 'validé avec réserves mineures'
          : defautsDeLaRelecture.length > 0
            ? 'relecture livrée, défauts relevés dans le travail relu'
            : 'validé'
        : 'défaut',
      prompt: judgeMembers.length >= 2 ? undefined : judgeEnvelope,
      status: 'completed',
      durationMs: performance.now() - judgeStartedAt,
      execution:
        judgeMembers.length >= 2
          ? {
              phase: 'judge',
              agentId: 'judge:quorum',
              taskId: 'judge:quorum',
              groupId: 'judge:quorum',
              dependencyIds: judgeMembers.map(
                (member) => `judge:${member.model ?? member.provider}`
              )
            }
          : singleJudgeExecution
    })

    // Gate final après verdict : le juge reste nécessaire, mais seulement sur un candidat ayant
    // déjà franchi le pré-gate local. Le juge est read-only, le signal local n'a donc pas changé.
    onPhase?.({ step: 'gate' })
    const g = evaluateClosure({
      // fix-ok: tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb — pre-gate deja passe, donc `red` ne
      // venait que du juge : il doublait chaque refus d'un faux « Échec déjà déclaré » (reparations 1-9).
      // Le refus reste bloquant : dodDuVerdict(false) rend toujours au moins une case non cochee.
      status: 'green',
      // fix-ok: tour 24e29815 — une case DoD muette cachait les objections du juge a la reparation et figeait le refus
      // Une question redevenue bloquante (trop longue, répétée, au-delà de 3) est NOMMÉE ici.
      dod: [...dodDuVerdict(ok, verdict.text), ...examenDesQuestions.dod],
      // Une sous-tache en echec ou sautee est du travail ANNONCE et non livre : elle bloque, et la
      // boucle de reparation ci-dessous s'en saisit comme de n'importe quel refus du gate.
      travauxNonLivres: [...travauxNonLivres]
    })
    push({
      step: 'gate',
      role: 'gate',
      detail: g.blocked ? `BLOQUÉ: ${g.reasons.join('; ')}` : 'clôture autorisée'
    })
    for (const note of examenDesQuestions.notes)
      push({ step: 'gate', role: 'gate', detail: note })
    pousserReservesDuJuge()
    return {
      valid: ok,
      gate: g,
      ...(examenDesQuestions.aPoser.length > 0
        ? { questionsDuJuge: examenDesQuestions.aPoser }
        : {}),
      learningAttestations: attestJudgeApprovedLearning(
        exec.text,
        ok,
        runId,
        judgeMembers.length >= 2 ? 'judge-panel' : judgeProvider,
        judgeMembers.length >= 2 ? undefined : (verdict.model ?? judgeBinding.model),
        workCwd,
        verdict.text
      )
    }
  }

  // B5 — pour une MUTATION bloquée, UNE réparation ciblée (feedback = raisons du gate) AVANT
  // d'escalader à l'humain. La doctrine tranche le mode : en mesure seule (défaut, décision du
  // 12/08 — « 1 prompt = 1 réussite »), le juge rouge déclenche la réparation automatiquement,
  // bornée par le graphe ou le devis. En mode bloquant, aucune relance : une stratégie nouvelle
  // doit arriver d'un nouveau tour humain avant toute nouvelle dépense.
  const graphRecoveries = grapheBrut ? recoveriesFromGraph(grapheBrut) : undefined
  const enforceSpend =
    (this.deps.currentExecutionQuote?.()?.limits.spendEnforcement ?? 'metering-only') ===
    'blocking'
  /**
   * La politique de relance vit dans `gates/stopgate` (`reparationsAutorisees`), pas ici.
   *
   * Elle y corrige deux defauts mesures le 2026-08-20 : une tache NON-MUTATION n'obtenait AUCUNE
   * reparation — alors qu'un refus « analyse absente » ou « DoD non cochee » se repare par un
   * nouveau passage — et un budget bloquant ramenait le compte a zero EN SILENCE. Le motif est
   * desormais rendu, et POUSSE dans la trace : un plafond qui mord doit se dire.
   */
  const politique = reparationsAutorisees({
    mutation: isMutationTask(task),
    budgetBloquant: enforceSpend,
    ...(grapheBrut
      ? { retoursDuGraphe: graphRecoveries ?? 0 }
      : { retoursDuDevis: this.deps.currentExecutionQuote?.()?.limits.maxRecoveries ?? 1 })
  })
  if (politique.motif) {
    push({ step: 'gate', role: 'gate', detail: politique.motif })
  }
  /**
   * ÉCHANGE AVANT RÉPARATION — refus « sans cause » seul (2026-10-24, étape 1 de
   * l'option A du cadrage forum-agents-partie2-juge-build ; règles dans `gates/echange-sans-cause.ts`).
   *
   * Mesure du 24/10 : 18 refus du contrôle final faits du SEUL fix-gate, dont 10 suivis d'un refus
   * du juge dès qu'il tourne — le juge, lui, n'avait jamais tourné. Au lieu de rejouer build +
   * nettoyage à l'aveugle, on demande sa cause à la session du build. Rend `true` quand ses lignes
   * de cause ont rejoint le texte contrôlé : le contrôle ET le juge se rejouent alors dans le même
   * passage. Toute autre issue (session absente, plafond, panne, réponse vide, copie modifiée)
   * rend `false`, DIT pourquoi dans la trace, et la réparation normale suit.
   */
  /**
   * La mécanique COMMUNE aux deux sources d'échange (étapes 1 et 2) : la question part
   * à la session du build, son coût est compté, l'échange est inscrit au journal commun, et
   * « ne rien modifier » est vérifié par l'empreinte de la copie. Rend la réponse, ou le motif de
   * l'échec à écrire dans la trace — l'appelant le dit, la réparation normale suit.
   */
  const interrogerLeBuild = async (
    session: NonNullable<typeof sessionDuBuild>,
    question: string
  ): Promise<{ reponse: string } | { echec: string }> => {
    // Aucun mode lecture seule n'existe (`sandboxForPhase`) : « ne rien modifier » tient par
    // l'empreinte de la copie, prise avant et après la réponse.
    const avant = await captureWorkspaceMutationSnapshot(workCwd)
    let reponse: SendResult
    try {
      reponse = await registry.send(session.provider, [{ role: 'user', content: question }], {
        ...session.options,
        resumeSessionId: session.id,
        ...(session.model ? { model: session.model } : {})
      })
    } catch (erreur) {
      if (conversationId) inscrireEchangeAuJournal({ fil: conversationId, runId, question })
      // La panne nomme le rôle et son binding, comme tout autre appel de modèle : sans ça, la trace
      // disait « panne pendant la réponse (spawn … ENOENT) » sans dire qui avait échoué (garde
      // `provider-failure-diagnosis.test.ts`, rouge sur main depuis l'ajout de cet échange — salvage).
      // La cause brute reste en tête, entre parenthèses : c'est elle que la trace et ses tests lisent.
      const message = erreur instanceof Error ? erreur.message : String(erreur)
      const explique = explainRoleFailure(
        'Échange avant réparation',
        'subagent',
        {
          provider: session.provider,
          ...(session.model ? { model: session.model } : {}),
          message
        },
        roles.getBinding('subagent').provider
      )
      return {
        echec: `refus maintenu : panne pendant la réponse (${message}) — ${explique}`
      }
    }
    if (reponse.usage) {
      cost.add({
        provider: reponse.provider ?? session.provider,
        role: 'subagent',
        model: reponse.model ?? session.model,
        inputTokens: reponse.usage.inputTokens,
        outputTokens: reponse.usage.outputTokens,
        cacheReadTokens: reponse.usage.cacheReadTokens,
        cacheCreationTokens: reponse.usage.cacheCreationTokens,
        costUsd: reponse.usage.costUsd
      })
    }
    if (conversationId)
      inscrireEchangeAuJournal({
        fil: conversationId,
        runId,
        question,
        reponse: reponse.text ?? ''
      })
    const delta: ExecutionEvidence[] = []
    await appendWorkspaceMutationEvidence(avant, workCwd, delta)
    const mutationsDeLaReponse = (reponse.executionEvidence ?? []).filter(
      (e) => e.kind === 'mutation'
    )
    if (mutationsDeLaReponse.length > 0 || delta.length > 0) {
      // La modification est réelle : elle rejoint les preuves du run, la réparation la verra.
      aggregatedEvidence.push(
        ...(mutationsDeLaReponse.length > 0 ? (reponse.executionEvidence ?? []) : delta)
      )
      return { echec: 'annulé : la réponse a modifié la copie de travail' }
    }
    return { reponse: reponse.text ?? '' }
  }
  const echangeMaintenu = (n: number, raison: string): false => {
    push({ step: 'gate', role: 'gate', detail: `Échange ${n} — ${raison} — réparation normale.` })
    return false
  }
  const echangerAvantReparation = async (motifs: readonly string[]): Promise<boolean> => {
    const session = sessionDuBuild
    const decision = decisionEchangeSansCause({
      motifs,
      echangesDuRun,
      sessionDuBuild: Boolean(session)
    })
    if (!decision.tenter || !session) {
      if (!decision.tenter && decision.motif)
        push({ step: 'gate', role: 'gate', detail: decision.motif })
      return false
    }
    echangesDuRun += 1
    const n = echangesDuRun
    push({
      step: 'gate',
      role: 'gate',
      detail: `Échange ${n} — tenté : refus « sans cause » seul sur ${decision.fichiers.join(', ')} — question à la session du build, sans réparation.`
    })
    const issue = await interrogerLeBuild(session, questionSansCause(decision.fichiers))
    if ('echec' in issue) return echangeMaintenu(n, issue.echec)
    const lignes = lignesDeCause(issue.reponse)
    if (lignes.length === 0)
      return echangeMaintenu(n, 'refus maintenu : la réponse ne donne aucune ligne de cause')
    blocsDEchange.push(blocDEchange(n, lignes))
    exec = buildExec()
    return true
  }
  /**
   * ÉCHANGE AVANT RÉPARATION — refus du juge fait UNIQUEMENT de questions au build (
   * 2026-10-25, étape 2 ; règles dans `gates/echange-questions-juge.ts`). Même mécanique que
   * l'étape 1, même plafond. Rend `true` quand la réponse a rejoint le texte jugé, marquée comme
   * donnée : le juge rejuge alors dans le même passage, sur ses propres preuves.
   */
  const echangerQuestionsDuJuge = async (questions: readonly string[]): Promise<boolean> => {
    const session = sessionDuBuild
    const empechement = empechementDEchange({ echangesDuRun, sessionDuBuild: Boolean(session) })
    if (empechement || !session) {
      if (empechement) push({ step: 'gate', role: 'gate', detail: empechement })
      return false
    }
    echangesDuRun += 1
    const n = echangesDuRun
    questionsPoseesDuRun.push(...questions)
    push({
      step: 'gate',
      role: 'gate',
      detail: `Échange ${n} — tenté : ${questions.length} question(s) du juge — question à la session du build, sans réparation.`
    })
    const issue = await interrogerLeBuild(session, questionsPourLeBuild(questions))
    if ('echec' in issue) return echangeMaintenu(n, issue.echec)
    const inutilisable = reponseInutilisable(issue.reponse)
    if (inutilisable) return echangeMaintenu(n, `refus maintenu : ${inutilisable}`)
    blocsDEchange.push(blocReponseAuJuge(n, questions, issue.reponse))
    exec = buildExec()
    return true
  }
  /**
   * LE PLAFOND DUR, et non plus le nombre de tentatives permises.
   *
   * Avant, la boucle s'arretait quand `MAX_ATTEMPTS` etait atteint — EN SILENCE. Desormais c'est le
   * PROGRES qui decide (`arretDeLaReparation`) et ce plafond n'est qu'un garde-fou de dernier
   * ressort : il existe parce que le budget ne bloque PAS par defaut, donc sans lui rien
   * n'arreterait un run qui reformule indefiniment son refus. Quand il mord, il le DIT.
   *
   * Il est genereux par rapport aux reparations accordees (le double, au moins deux) : un run qui
   * PROGRESSE a le droit d'aller au-dela de ce que la politique de depense provisionnait, ce qui
   * etait precisement le reproche. Il reste fini.
   */
  const PLAFOND_DUR = plafondDurReparations(politique.reparations)
  let valid = false
  let gate!: ReturnType<typeof evaluateClosure>
  let learningAttestations: IndependentLearningAttestation[] = []
  /** Motifs du refus precedent : sert a reconnaitre un refus qu'un rejeu ne peut pas faire evoluer. */
  let motifsPrecedents: string[] = []
  /** Combien de fois DE SUITE le refus est revenu mot pour mot (tour 52fbe05f : 4). */
  let refusIdentiquesConsecutifs = 0
  /** Meilleure note du juge sur le run : une note qui la dépasse n'est pas un refus répété. */
  let meilleureNote: number | undefined
  /**
   * Empreintes d'ORIGINE de chaque fichier TEST: designe par un juge, accumulees sur TOUT le run :
   * jamais videes, un nouveau TEST: s'ajoute, un fichier deja releve garde sa premiere empreinte
   * (juge independant : une passe propre ou un 2e TEST: levaient la protection).
   */
  const empreintesProtegees: Record<string, string | null> = {}
  // Choix utilisateur, on repare jusqu'a ce qu'il n'y ait plus de defaut. Seul un budget
  // BLOQUANT (reparations accordees = 0) garde l'ancienne borne ; sinon on ne sort que sur un vert
  // ou sur un code perime (`arretDeLaReparation`).
  // Les tests d'orchestrateur gardent l'ancien plafond (tests/reinit-couts-session.ts).
  const jusquAuVert =
    politique.reparations > 0 && process.env.AUTOWIN_REPARATION_BORNEE !== '1'
  // L'objection d'étendue du DERNIER verdict du juge, et si l'utilisateur a déjà tranché.
  let etenduePrecedente: string | undefined
  let etendueTranchee = false
  for (
    let attempt = 0;
    attempt <= PLAFOND_DUR || jusquAuVert;
    attempt++
  ) {
    if (attempt > 0) {
      /*
       * UNE REPARATION REJOUE LA PHASE NOMMEE, pas `build` (un `/scout` refuse par le
       * juge a ete « repare » par un build qui a ecrit dans un autre depot). Un `/judge` nomme n'a
       * rien a rejouer : son verdict EST la reponse demandee.
       */
      if (phaseNommee === 'judge') {
        push({
          step: 'gate',
          role: 'gate',
          detail:
            'aucune réparation : la demande nomme le juge seul, son verdict est la réponse — aucune autre phase ne se joue.'
        })
        break
      }
      const phaseDeReparation: NodePhase = phaseNommee ?? 'build'
      // Une reprise n'est pas une primitive parallèle au graphe : elle REJOUE le vrai nœud (build,
      // ou la phase nommée), donc son panel, sa synthèse, sa concurrence et sa télémétrie.
      pousserContexte(
        `reparation:${attempt}`,
        `[RÉPARATION ${attempt}] Le gate a bloqué : ${gate.reasons.join('; ')}. Objections du juge : ${lastJudgeText || '(verdict vide)'}.${consigneTestsDuJuge(lastJudgeText)} Corrige le livrable et fournis une PREUVE d'outil (test rouge→vert / exit-code).`
      )
      // LE PASSAGE SE NOMME DANS LA TRACE : sans cette ligne, un run mort par epuisement ne
      // permet pas de compter ses rejeus apres coup (objection du juge).
      const ligneDuPassage = traceDuPassage(attempt, PLAFOND_DUR, jusquAuVert, phaseDeReparation)
      if (ligneDuPassage) push({ step: 'gate', role: 'gate', detail: ligneDuPassage })
      // Le nouveau passage doit recevoir le contexte complet, pas reprendre une session linéaire
      // qui ne contient ni le verdict du juge ni, dans le cas d'un panel, les autres membres.
      prevSessionId = undefined
      const phasesJoueesAvantLePassage = phasesJouees
      /**
       * UNE REPARATION QUI NE PEUT PLUS S'EXECUTER ARRETE LA BOUCLE, ELLE N'ANNULE PAS LE TOUR.
       *
       * fix-ok: tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e — le build de reparation a leve
       * « Budget d'appels provider atteint : 42 appels ». L'exception traversait toute la boucle :
       * `orchestrate` rendait ok:false, et TOUT le travail deja juge (4 verdicts, objections
       * comprises) disparaissait de la reponse. L'utilisateur ne voyait qu'« echec du workflow ».
       * Desormais l'echec du passage de reparation est un MOTIF de refus nomme : le verdict et les
       * objections du dernier juge restent dans le resultat du run.
       */
      // Le fichier TEST: du juge est fige pendant la reparation (piste 2 /build).
      // fix-ok: juge independant (2 MAJEUR) : vider apres une passe propre, ou ne relever qu'a vide, laissait passer un test retouche. On accumule ; un fichier absent (null) peut etre releve plus tard.
      for (const [cle, empreinte] of Object.entries(empreintesTestsDuJuge(lastJudgeText, workCwd))) {
        if (empreintesProtegees[cle] == null) empreintesProtegees[cle] = empreinte
      }
      try {
        await executePipelinePhase(phaseDeReparation)
        // Le graphe reste la source de vérité après un rouge : le build de réparation est suivi de
        // toutes les étapes dessinées avant le nouveau juge (notamment clean), pas d'un raccourci
        // codé en dur build → judge. Une phase nommée n'a pas de graphe (`graphePourTache`) : elle
        // est seule rejouée.
        for (const phase of grapheBrut ? phasesApresBuildDeReparation(grapheBrut) : []) {
          await executePipelinePhase(phase)
        }
      } catch (erreur) {
        const motif = `Réparation ${attempt} interrompue (${
          erreur instanceof Error ? erreur.message : String(erreur)
        }) — le verdict et les objections du dernier passage restent ci-dessous.`
        gate.reasons.push(motif)
        push({ step: 'gate', role: 'gate', detail: motif })
        break
      }
      exec = buildExec()
      /*
       * UNE RÉPARATION DÉJÀ PAYÉE NE REPAIE PAS SON JUGE.
       *
       * fix-ok: run-85d8e7f57af2-1 (redémarrage du 2026-10-01 12:54) — `phaseOutputs` est
       * pré-rempli avec les 15 étapes reprises : le juge du premier passage voit déjà le texte
       * final. Chaque réparation rejouée sortait ensuite par `dejaPayee` sans rien jouer, et
       * `judgeAndGate` repayait un juge sur un texte IDENTIQUE (3 juges constatés, `phaseOutputs`
       * resté à 15). Les verdicts intermédiaires ne sont pas des acquis : rien ne les rendait.
       * Un passage qui n'a joué aucune phase garde donc le verdict courant, sans juge ni décompte
       * de refus (il n'a rien tenté). Fini : chaque passage consomme au moins un acquis.
       */
      if (phasesJouees === phasesJoueesAvantLePassage) {
        push({
          step: 'gate',
          role: 'gate',
          detail: `Réparation ${attempt} déjà payée avant l’interruption : reprise de ses étapes, texte inchangé — aucun nouveau juge.`
        })
        continue
      }
    }
    const verdictDuPassagePrecedent = attempt > 0 ? lastJudgeMemoire : ''
    let r = await judgeAndGate()
    // Refus « sans cause » seul : une question au build, puis contrôle + juge dans CE passage.
    if (r.refusAvantJuge && (await echangerAvantReparation(r.gate.reasons))) {
      r = await judgeAndGate()
      push({
        step: 'gate',
        role: 'gate',
        detail: r.refusAvantJuge
          ? `Échange ${echangesDuRun} — refus maintenu : le contrôle refuse encore (${r.gate.reasons.join('; ')}) — réparation normale.`
          : `Échange ${echangesDuRun} — refus levé : la réponse du build nomme la cause ; le juge a statué sans nouveau build.`
      })
    }
    // Refus du juge fait UNIQUEMENT de questions (étape 2) : la réponse du build, puis le juge
    // rejuge dans CE passage. Un seul échange par refus : un nouveau refus va en réparation.
    if (r.questionsDuJuge && (await echangerQuestionsDuJuge(r.questionsDuJuge))) {
      const n = echangesDuRun
      r = await judgeAndGate()
      push({
        step: 'gate',
        role: 'gate',
        detail:
          r.valid && !r.gate.blocked
            ? `Échange ${n} — refus levé : le juge a validé après la réponse du build, sans nouveau build.`
            : `Échange ${n} — refus maintenu : ${r.refusAvantJuge ? 'le contrôle' : 'le juge'} refuse encore après la réponse du build — réparation normale.`
      })
    }
    valid = r.valid
    gate = r.gate
    // Une reparation qui a retouche le test designe par le juge ne clot jamais en vert.
    // fix-ok: lastJudgeText est remplacé par le nouveau jugement, donc on garde le texte d'avant réparation ; le refus doit tomber entre gate = r.gate et if (!gate.blocked), seul point de décision du vert.
    const motifsTest = motifsTestModifie(empreintesProtegees, empreintesDesFichiers(Object.keys(empreintesProtegees)))
    if (motifsTest.length > 0) {
      valid = false
      gate = { ...gate, blocked: true, reasons: [...gate.reasons, ...motifsTest] }
      for (const motif of motifsTest) push({ step: 'gate', role: 'gate', detail: motif })
    }
    learningAttestations = r.learningAttestations
    if (!gate.blocked) {
      /*
       * CAPITALISATION APRES LE GATE — jamais avant, et seulement sur un verdict qui PASSE.
       *
       * `learn` ne peut pas etre un noeud de la marche : un juge joue par le marcheur PUIS par le
       * gate final produit deux appels identiques, et un juge non terminal fait
       * consommer au marcheur le budget de retour que la boucle de reparation relit ensuite
       * (mesure du 2026-08-25 : `correctif` a 3 passages build la ou le profil en annonce 1).
       * `estJugeTerminal` ignore donc l'arete vers `learn`, et c'est ICI qu'elle se joue.
       *
       * TROIS bornes, chacune fermant une facon de nuire :
       *   - seulement si le profil le DECLARE (`noeudsApresJuge`) — opt-in, car cela
       *     coute un appel fournisseur et `eclair` promet « aucun ceremonial » ;
       *   - seulement sur gate NON BLOQUE — on ne tire pas de lecon d'un travail refuse ;
       *   - une panne de capitalisation NE ROUGIT PAS le run : la lecon n'est pas le livrable, et
       *     faire echouer un travail valide parce que le Brain a hoquete serait un faux rouge.
       *     `valid` et `gate` ne sont plus touches apres ce point.
       */
      // Sans graphe (run mono-phase) : cf. `phasesApresJugeHorsGraphe` (task-regime.ts).
      const apresGate: NodePhase[] = graphePilote
        ? noeudsApresJuge(graphePilote)
            .map((id) => graphePilote.nodes.find((n) => n.id === id)?.phase)
            .filter((phase): phase is NodePhase => phase !== undefined)
        : phasesApresJugeHorsGraphe(task)
      // Un silence n'est pas une explication : quand la chaine ne se joue pas, la trace DIT laquelle
      // des deux causes a mordu (verdict non vert / aucun noeud learn declare).
      const motifSansChaine = motifChaineApresJugeNonJouee({
        noeudsDeclares: apresGate,
        gateBloque: false
      })
      if (motifSansChaine) push({ step: 'gate', role: 'gate', detail: motifSansChaine })
      // Piste 3 : le résultat validé part AVANT learn/salvage — voir shared/resultat-valide.ts.
      if (apresGate.length > 0) {
        push(
          etapeResultatValide(
            resultatAvecReservesDuJuge(texteRendu(), reservesDuJuge)
          )
        )
      }
      for (const phaseApresGate of apresGate) {
        try {
          await executePipelinePhase(phaseApresGate)
        } catch (erreur) {
          push({
            step: 'exec',
            role: 'subagent',
            detail: `${phaseApresGate} impossible (${
              erreur instanceof Error ? erreur.message : String(erreur)
            }) — le verdict du run n'en est pas affecte`
          })
        }
      }
      break
    }
    /**
     * LE PROGRES decide, le plafond n'est qu'un garde-fou — et les DEUX se disent.
     *
     * Un refus qui CHANGE d'un passage a l'autre est un progres : on continue, meme au-dela des
     * reparations provisionnees. Un refus identique et entierement hors de portee de build ne peut
     * pas evoluer : on s'arrete (mesure : 3 passages, le meme refus mot pour mot, 2 min
     * brulees). Et si le plafond dur mord, il le DIT — avant, cette sortie etait muette, si bien
     * qu'un run rendait « bloque » sans qu'on sache s'il avait renonce faute de progres ou faute de
     * tours.
     */
    /*
     * OBJECTION D'ÉTENDUE RÉPÉTÉE → PAUSE ET QUESTION (règles dans
     * `gates/etendue-repetee.ts`). Quatre refus « ta demande n'est pas remplie »
     * ont relancé quatre réparations, en mode jusqu'au vert où rien d'autre n'arrête la boucle.
     * Seul un verdict RENDU par le juge dans ce passage compte : un refus du contrôle avant le juge
     * laisse `lastJudgeText` sur le verdict précédent.
     */
    if (!r.refusAvantJuge) {
      const etendueCourante = objectionDEtendue(lastJudgeText)
      const demander = doitDemanderLEtendue({
        jusquAuVert,
        dejaTranchee: etendueTranchee,
        courante: etendueCourante,
        precedente: etenduePrecedente
      })
      etenduePrecedente = etendueCourante
      if (demander && etendueCourante) {
        etendueTranchee = true
        push({
          step: 'gate',
          role: 'gate',
          detail: `Pause : le juge refuse deux fois de suite pour l'étendue de la demande — question posée à l'utilisateur, aucune réparation avant sa réponse.`
        })
        const reponse = await this.deps
          .demanderALUtilisateur?.(questionDEtendue(etendueCourante), task, signal)
          ?.catch(() => undefined)
        const issue = issueDeLaReponse(reponse)
        if (issue.kind === 'arreter') {
          gate.reasons.push(issue.motif)
          push({ step: 'gate', role: 'gate', detail: issue.motif })
          break
        }
        if (issue.kind === 'consigne')
          pousserContexte(
            'directiveUtilisateur',
            `DIRECTIVE UTILISATEUR ARRIVEE PENDANT LE RUN — PRIORITAIRE, elle CORRIGE le cadre : ${issue.texte}`
          )
        // 05/11/2026 : l'utilisateur vient de trancher CE refus. Le frein du refus
        // répété, qui mord désormais jusqu'au vert, repart de zéro : sinon il couperait
        // au passage suivant la suite qu'il vient de choisir.
        motifsPrecedents = []
        refusIdentiquesConsecutifs = 0
        push({
          step: 'gate',
          role: 'gate',
          detail:
            issue.kind === 'consigne'
              ? `Reprise sur ta consigne d'étendue : « ${issue.texte.slice(0, 200)} ».`
              : 'Reprise : tu as choisi de continuer jusqu’à couvrir toute la demande.'
        })
      }
    }
    const passage = deciderDuPassage({
      attempt,
      reparationsAccordees: politique.reparations,
      plafondDur: PLAFOND_DUR,
      motifsCourants: gate.reasons,
      etat: { motifsPrecedents, refusIdentiquesConsecutifs, meilleureNote },
      // Seule la note rendue DANS ce passage compte : un refus avant le juge laisse
      // `lastJudgeText` sur le verdict précédent.
      noteDuJuge: r.refusAvantJuge ? undefined : noteDuJuge(lastJudgeText),
      // fix-ok: tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb — 14 reparations refusees
      // parce que out/main/index.js (11:06) etait plus ancien que les correctifs commites
      // (11:11-11:31) : le code qui jugeait n'etait pas celui qu'on reparait. La boucle le NOMME
      // desormais au lieu de bruler un build et un panel de juge par passage.
      bundlePerime: mesureBundlePerime(process.cwd()),
      jusquAuVert,
      ...(panneDesJuges ? { panneDesJuges } : {}),
      // fix-ok: la boucle juge-réparation relançait un passage quand le juge rendait VALIDE avec les MÊMES réserves MINEUR (107 passages sur 109 après validation) ; arrêt décidé par le code, jamais par le juge
      reservesMineuresFigees: reservesMineuresFigees(
        attempt,
        lastJudgeMemoire,
        verdictDuPassagePrecedent
      )
    })
    if (passage.arret) {
      gate.reasons.push(passage.arret)
      /**
       * LE MOTIF EST AUSSI POUSSE DANS LA TRACE, et pas seulement dans le resultat.
       *
       * Defaut trouve sur le run reel : le motif etait ajoute a `gate.reasons` APRES que
       * la ligne « Arrete au controle final » ait deja ete poussee. Il atteignait donc le resultat
       * du run mais JAMAIS la trace — la revendication « une borne qui mord doit se dire » n'etait
       * tenue qu'a moitie, et c'est precisement la moitie que l'on relit apres coup.
       */
      push({ step: 'gate', role: 'gate', detail: passage.arret })
      break
    }
    refusIdentiquesConsecutifs = passage.etatSuivant.refusIdentiquesConsecutifs
    motifsPrecedents = passage.etatSuivant.motifsPrecedents
    meilleureNote = passage.etatSuivant.meilleureNote
  }
  if (gate.blocked) {
    const motifBloque = motifChaineApresJugeNonJouee({
      noeudsDeclares: graphePilote ? noeudsApresJuge(graphePilote) : [],
      gateBloque: true
    })
    if (motifBloque) push({ step: 'gate', role: 'gate', detail: motifBloque })
  }
  if (gate.blocked && enforceSpend && (graphRecoveries ?? 0) > 0) {
    gate.reasons.push(
      'Reprise automatique desactivee : une strategie nouvelle doit etre fournie avant un nouvel appel.'
    )
  }

  return {
    task,
    // Les MINEUR gardés sur un `/scout` nommé suivent le résultat rendu (vide sinon).
    result: resultatAvecReservesDuJuge(
      texteRendu(),
      valid && !gate.blocked ? reservesDuJuge : []
    ),
    valid,
    gateBlocked: gate.blocked,
    gateReasons: gate.reasons,
    phaseOutputs,
    // Le verdict SORT du run : sans ce champ il mourait dans `lastJudgeText` et n'atteignait
    // jamais le RUN.md, donc jamais la mémoire inter-runs.
    ...(lastJudgeText.trim() ? { judgeText: lastJudgeText.trim() } : {}),
    ...(lastJudgeText.trim() && dernierVerdictLu ? { verdictDuJuge: dernierVerdictLu } : {}),
    ...(valid && !gate.blocked && defautsDeLaRelecture.length > 0
      ? { defautsDuTravailRelu: [...defautsDeLaRelecture] }
      : {}),
    // Seulement si une étape a écrit quelque chose — un fichier vide n'est pas écrit.
    ...(phaseOutputs.some((sortie) => sortie.text.trim()) && cheminDuLivrableEntierDuRun()
      ? { livrableEntier: cheminDuLivrableEntierDuRun() }
      : {}),
    ...(learningAttestations.length ? { learningAttestations } : {}),
    ...(notesBrainDeposees > 0 ? { notesBrainDeposees } : {}),
    brainQuery,
    brainRetrievedAt,
    brainNavigation: scopedBrain.navigation,
    brainInjectedChars: brainContext.length,
    costUsd: costOfTrace(trace),
    quote: this.deps.currentExecutionQuote?.(),
    trace,
    failedTasks,
    skippedTasks
  }
}
