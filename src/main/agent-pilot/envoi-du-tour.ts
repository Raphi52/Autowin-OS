// Envoi d'UNE itération d'un tour de chat au modèle : message et options de l'appel, outils
// directs, flux diffusé en direct, reprises après erreur (`reprise-apres-erreur.ts`), puis journal
// de l'appel — session retenue, fichiers écrits, coût. Sorti tel quel de la boucle de
// AgentPilot.chat() (lot 4).
import { randomUUID } from 'node:crypto'
import { lireLigneDErreur } from '../../shared/erreur-d-action'
import { VisibleStreamFilter } from '../../shared/stream-markup-filter'
import {
  appendCallMutationTraces,
  appendWorkspaceMutationTrace,
  captureMutationTraceBase
} from '../activity/trace-workspace-mutation'
import { estUnOutilDirectDuChat, ouvrirOutilsNatifsDuChat } from '../chat/chat-mcp'
import {
  baliserRelanceAutomatique,
  bilanDesOutilsNatifsRecuperes,
  buildTurnMessageBlocks,
  statusEstUneAction,
  statusEstUneLecture,
  statutComplet
} from '../chat/chat-turn-messages'
import { ecritUnFichierDeMemoire } from '../brain/lecon-non-retenue'
import type { Message, SendOptions, SendResult } from '../providers/types'
import { captureSaufAnnulation, fichiersEcritsDuProjet } from './aides-du-tour'
import type { ContexteDuTour } from './contexte-du-tour'
import { iterationDuTour, type IterationDuTour } from './iteration-du-tour'
import { REJECTED_QUESTION_MARKER } from './jetons-de-commande'
import { masquerLesQuestionsPosees } from '../../shared/balise-question'
import { reprendreApresErreur } from './reprise-apres-erreur'

/**
 * Joue l'appel de l'itération `i` jusqu'à une réponse (reprises comprises) et le consigne. Rend la
 * réponse et l'état de l'itération que la suite de chat() partage.
 */
export async function appelDuModele(
  tour: ContexteDuTour,
  i: number
): Promise<{ res: SendResult; iter: IterationDuTour }> {
  const {
    etat,
    emit,
    registry,
    provider,
    binding,
    catalog,
    convo,
    currentAttachments,
    providerResumes,
    contextBlocksDuTour,
    system,
    systemBlocks,
    systemeAvecOutilsDirects,
    providerLimits,
    watchdogReadOnly,
    workspaceDuTour,
    recoveredProviderCall,
    conversationId,
    turnId,
    signal,
    onProviderJournal,
    partiesDuMessage,
    nomsDuTour,
    etatRecuParLeModele,
    chatSessions,
    oublierSession,
    persisterSession,
    compteDuTour,
    cleDeSession,
    outilsNatifs,
    executerAppelNatif,
    noterUnGeste,
    timer
  } = tour
  const iterationAttachments = [
    ...(i === 0 ? (currentAttachments ?? []) : []),
    ...etat.commandAttachments
  ]
  etat.commandAttachments = []
  /**
   * LE FIL N'EST PAS REPAYÉ À CHAQUE ITÉRATION.
   *
   * Mesuré le 2026-08-31 : le livrable d'une phase `frame` (≈ 6 000 caractères)
   * repartait VERBATIM à chaque itération suivante du même tour — cinq fois — alors que la
   * session du provider portait DÉJÀ tous les segments précédents (`resumeSessionId` est armé
   * à chaque itération). On n'expédie donc que les segments NOUVEAUX quand la
   * reprise est réelle.
   *
   * Le repli est le comportement d'avant, et il est SÛR : sans session reprise (provider qui
   * n'honore pas `--resume`, premier appel, session perdue en cours de tour), le fil entier
   * repart. Amputer un prompt que le provider ne complète pas est exactement le défaut
   * Il reste fermé.
   */
  const reprisePorteLeFil = providerResumes && Boolean(etat.sessionEnCours)
  const segmentsAEnvoyer = reprisePorteLeFil ? convo.slice(etat.segmentsDejaEnvoyes) : convo
  etat.segmentsDejaEnvoyes = convo.length
  const messages: Message[] = [
    {
      role: 'user',
      content: `${segmentsAEnvoyer.map(baliserRelanceAutomatique).join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)`,
      ...(iterationAttachments.length ? { attachments: iterationAttachments } : {})
    }
  ]
  let contextBlocks = contextBlocksDuTour()
  let prompt = registry.describePrompt(
    provider,
    messages,
    {
      system,
      systemBlocks,
      contextBlocks,
      model: binding.model,
      reasoningEffort: binding.reasoningEffort,
      ...providerLimits
    },
    binding.model
  )
  prompt.systemBlocks = systemBlocks
  prompt.contextBlocks = contextBlocks
  // Les blocs RÉELLEMENT envoyés : complets, ou sans les commandes servies en outils directs.
  let blocsSystemeDeCetEnvoi = systemBlocks
  let attempt =
    recoveredProviderCall && i === recoveredProviderCall.iteration
      ? recoveredProviderCall.attempt
      : 0
  const requestId = randomUUID()
  const options: SendOptions = {
    system,
    systemBlocks,
    contextBlocks,
    model: etat.modeleApresRefus ?? binding.model,
    reasoningEffort: binding.reasoningEffort,
    ...providerLimits,
    /**
     * REPRIS À CHAQUE ITÉRATION, sur la session RÉELLEMENT ouverte.
     *
     * Le commentaire précédent affirmait que les itérations suivantes « chaînaient déjà » sur la
     * session ouverte par ce tour. Elles ne chaînaient rien : `resumeSessionId` n'était passé
     * qu'à `i === 0`, donc chaque itération suivante démarrait une session VIERGE — avec un
     * message `convo` construit UNE fois et, sous reprise, volontairement amputé de tout
     * l'historique (il est censé vivre dans la session CLI). Le modèle qui rédige la réponse
     * finale, après un appel d'outil, n'avait donc jamais vu le fil.
     *
     * Mesuré le 2026-08-28 : l'agent nie connaître une variante qu'il avait
     * lui-même proposée deux tours plus tôt. Test : `agent-pilot.session-intra-tour.test.ts`.
     */
    ...(etat.sessionEnCours ? { resumeSessionId: etat.sessionEnCours } : {}),
    // Un tour de CHAT sait rouvrir un tour de reprise dans sa conversation : le provider peut
    // donc confier ses commandes de fond coupees au lieu de dire « relance la demande ».
    // Le panneau « Contexte » du chat, detaille par categorie : seul un tour de chat a un ecran.
    // Options lues par le seul moteur Claude (`SendOptions.claude`).
    ...(conversationId
      ? {
          claude: {
            relancerTachesDeFond: true,
            ...(!watchdogReadOnly ? { mesurerContexte: true } : {})
          }
        }
      : {}),
    // Le fil qui écrit : le hook des agents réserve en son nom les fichiers édités, et refuse
    // ceux qu'un autre fil tient encore (shared/reservation-fichiers.ts).
    ...(conversationId ? { conversationId } : {}),
    observePrompt: (observed) => {
      observed.systemBlocks = blocsSystemeDeCetEnvoi
      observed.contextBlocks = contextBlocks
      prompt = observed
    },
    signal,
    requestId,
    ...(onProviderJournal
      ? {
          onJournal: (token: string, journalPath: string) => {
            const streamId = `${i}:${attempt}`
            onProviderJournal({
              provider,
              token,
              journalPath,
              iteration: i,
              attempt,
              streamId,
              requestId
            })
          }
        }
      : {})
  }
  const recoveredHere =
    recoveredProviderCall && i === recoveredProviderCall.iteration
      ? recoveredProviderCall
      : undefined
  let res: SendResult | undefined = recoveredHere?.result
  let etatAvantEnvoi: Awaited<ReturnType<typeof captureMutationTraceBase>>
  let callStartedAt = performance.now()
  // Préfixe diffusé, tentative réussie, flux affichés et effacement de la réponse relancée,
  // partagés avec la suite de l'itération : agent-pilot/iteration-du-tour.ts (lot 4).
  const iter = iterationDuTour({ i, recoveredHere, etat, emit })
  if (iter.successfulStreamedPrefix)
    iter.fluxAffichesCetteIteration.add(`${i}:${iter.successfulAttempt}`)
  etat.gesteDansLAppel = false
  etat.texteApresLeDernierGeste = false
  // Etat des outils directs pour CETTE iteration (partage entre ses tentatives d'envoi).
  etat.executesParCanalNatif = new Set<string>()
  etat.echecNatifCetteIteration = false
  etat.echecsNatifsNonRattrapes.clear()
  /*
   * Remis a plat ICI, au debut de chaque iteration — pas seulement dans la boucle des `<cmd>`,
   * qu'un tour 100 % outils directs n'atteint jamais. Sans cela, un `verify` direct rouge puis
   * rejoue VERT laissait le drapeau leve : « ta derniere action a ECHOUE » revenait a chaque
   * cloture (2026-10-12). Un echec encore NON repare reste vu par
   * `commandesEnEchecNonRattrape`, qui couvre tout le tour.
   */
  etat.echecDeLaDerniereIteration = false
  etat.rejeuNatifCetteIteration = false
  etat.iterationNatif = i
  // Appel récupéré après redémarrage : ses outils natifs n'ont battu que dans le process mort.
  // Sans ce bilan, « question sans lecture » relançait un tour qui avait lu (tour
  // 9296f09c-6986-41f9-8b6d-f4c2b2a9c2bc, 1,70 $) — voir `bilanDesOutilsNatifsRecuperes`.
  if (recoveredHere) {
    const bilan = bilanDesOutilsNatifsRecuperes(recoveredHere.result.executionEvidence)
    if (bilan.lecture) etat.anyReadExecuted = true
    if (bilan.action) etat.actionNativeCeTour = true
  }
  /**
   * SESSION ABANDONNÉE = FIL ENTIER RENVOYÉ, ET SESSION OUBLIÉE PARTOUT.
   *
   * Point unique des trois sorties qui lâchent la session du fournisseur en cours de tour
   * (« Prompt is too long », plantage du CLI à 0 jeton, refus du filtre de sécurité). Seule la
   * branche « refus » reconstruisait le message : les deux autres repartaient dans une session
   * NEUVE avec le message d'une reprise — sans historique, et affirmant « ta session en porte
   * l'historique » (`agent-pilot.reprise-abandonnee.test.ts`). Et « Prompt is too
   * long » n'oubliait la session qu'en mémoire : elle revenait du disque après un redémarrage.
   *
   * Le message renvoyé est `convo` ENTIER : blocs d'ouverture refaits sans reprise (historique
   * complet, état entier au lieu d'un diff) + tous les échanges déjà faits dans ce tour, qu'une
   * itération reprise n'envoyait plus puisque la session les portait.
   */
  const repartirSansSession = (): void => {
    etat.sessionEnCours = undefined
    delete options.resumeSessionId
    if (conversationId) {
      chatSessions.delete(conversationId)
      oublierSession(conversationId)
    }
    if (etat.blocsInitiauxAmputes) {
      const blocsSansReprise = buildTurnMessageBlocks({
        ...partiesDuMessage,
        resumeSessionId: undefined
      })
      for (const bloc of blocsSansReprise) nomsDuTour.set(bloc.text, bloc.name)
      convo.splice(0, etat.blocsInitiaux, ...blocsSansReprise.map((bloc) => bloc.text))
      etat.blocsInitiaux = blocsSansReprise.length
      etat.blocsInitiauxAmputes = false
    }
    etat.segmentsDejaEnvoyes = convo.length
    messages[0] = {
      ...messages[0],
      content: `${convo.map(baliserRelanceAutomatique).join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)`
    }
    contextBlocks = contextBlocksDuTour()
    options.contextBlocks = contextBlocks
  }
  /** Compte actif au départ de l'envoi : c'est lui qui ouvre la session qu'il rendra. */
  let compteDeCetEnvoi = compteDuTour()
  while (!res) {
    const streamId = `${i}:${attempt}`
    compteDeCetEnvoi = compteDuTour()
    // Le compte a changé depuis l'ouverture de la session : elle est inouvrable
    // depuis le nouveau dossier, on la lâche et le fil ENTIER part sur le compte actif.
    if (etat.sessionEnCours && compteDeCetEnvoi !== etat.compteDeSession) repartirSansSession()
    const visibleFilter = new VisibleStreamFilter()
    let attemptStreamedPrefix = ''
    let commandBoundarySeen = false
    etat.gesteDansLAppel = false
    etat.texteApresLeDernierGeste = false
    const emitVisiblePrefix = (segments: ReturnType<VisibleStreamFilter['pushSegments']>): void => {
      for (const segment of segments) {
        if (segment.kind === 'control') {
          if (segment.control === 'cmd') commandBoundarySeen = true
          continue
        }
        if (commandBoundarySeen || !segment.text) continue
        attemptStreamedPrefix += segment.text
        iter.fluxAffichesCetteIteration.add(streamId)
        etat.texteApresLeDernierGeste = true
        emit({ kind: 'delta', streamId, text: segment.text, iteration: i })
      }
    }
    // AVANT/APRES du tour (2026-09-23) : un fichier modifie par une commande shell (python,
    // sed…) n'apparait dans aucune preuve Edit/Write, et l'onglet Fichiers restait a 0.
    etatAvantEnvoi =
      conversationId && workspaceDuTour
        ? await captureSaufAnnulation(workspaceDuTour, signal)
        : undefined
    /*
     * OUTILS DIRECTS (`chat-mcp.ts`) : ouverts pour CET envoi, fermes avec lui (`finally` plus
     * bas, y compris sur erreur et sur arret). Meme catalogue que le texte du tour ; jamais pour
     * le tour de surveillance, qui reste sans aucune commande. Un echec n'est jamais fatal : on
     * reste au texte `<cmd>` et on le DIT dans le fil, une fois par motif.
     */
    const natif = outilsNatifs
      ? watchdogReadOnly
        ? undefined
        : await ouvrirOutilsNatifsDuChat({
            provider,
            catalogue: catalog,
            exec: (nom, args) => executerAppelNatif(nom, args),
            ...(typeof outilsNatifs === 'object' && outilsNatifs.demarrer
              ? { demarrer: outilsNatifs.demarrer }
              : {})
          })
      : undefined
    const outilsDeCetEnvoi = natif && 'servis' in natif ? natif.servis : undefined
    // Le service NORMAL ne s'annonce pas : la ligne « 37 commandes servies » sortait a CHAQUE
    // tour dans le bloc d'actions sans rien apprendre a l'utilisateur. Seule une
    // panne se dit, ci-dessous.
    if (natif && 'repli' in natif && !etat.replisNatifsDits.has(natif.repli)) {
      etat.replisNatifsDits.add(natif.repli)
      emit({
        kind: 'provider-status',
        iteration: i,
        text: `Outils directs indisponibles — retour au texte <cmd> : ${natif.repli}`
      })
    }
    try {
      callStartedAt = performance.now()
      timer.mark(`send${i}:start`)
      let sawFirstChunk = false
      // Outils servis : la consigne ne redit plus les commandes qu'ils décrivent déjà.
      // Repli au texte `<cmd>` : la liste complète, seul chemin qui reste au modèle.
      const systemeDeCetEnvoi = outilsDeCetEnvoi
        ? systemeAvecOutilsDirects(outilsDeCetEnvoi.noms)
        : { system, systemBlocks }
      blocsSystemeDeCetEnvoi = systemeDeCetEnvoi.systemBlocks
      prompt.system = systemeDeCetEnvoi.system
      prompt.systemBlocks = systemeDeCetEnvoi.systemBlocks
      const optionsDeCetEnvoi: SendOptions = outilsDeCetEnvoi
        ? { ...options, ...systemeDeCetEnvoi, skillNodeTools: outilsDeCetEnvoi.options }
        : options
      res = await registry.send(provider, messages, optionsDeCetEnvoi, (chunk) => {
        /**
         * ARTEFACTS EN DIRECT — a leur place dans le fil.
         *
         * Une image lue par `Read` ou une capture d'ecran arrive au MILIEU du tour. Attendre le
         * `SendResult` pour l'afficher la faisait tomber sous le bloc de cloture (mesure du
         * 2026-09-10, : « les blocs image read apparaissent apres le bloc Fait »). On
         * l'emet donc au moment ou le provider la voit, et on retient son identifiant pour ne
         * pas la republier a la fin du tour.
         */
        if (chunk.artifacts?.length) {
          for (const artifact of chunk.artifacts) {
            if (etat.artefactsDejaEmis.has(artifact.id)) continue
            etat.artefactsDejaEmis.add(artifact.id)
            emit({ kind: 'artifact', artifact, iteration: i })
            noterUnGeste()
          }
          if (!chunk.delta) return
        }
        // TESTS DU TERMINAL : le tour les garde, la carte du fil les lit comme des
        // vérifications. Fragment sans texte : il ne doit pas passer pour le premier mot.
        if (chunk.testsDuTerminal?.length) {
          emit({ kind: 'tests-du-terminal', data: chunk.testsDuTerminal, iteration: i })
          if (!chunk.delta && !chunk.status) return
        }
        // COUPURE DU FILTRE DE SÉCURITÉ : une donnée pour le journal du tour, que
        // lisent la rétrospective et le kaizen. L'avis lisible suit dans `delta`, s'il y en a un.
        if (chunk.coupureFiltre) {
          const categorie = chunk.coupureFiltre.categorie
          emit({
            kind: 'coupure-filtre',
            iteration: i,
            text:
              "Réponse coupée par le filtre de sécurité d'Anthropic" +
              (categorie ? ` (catégorie : ${categorie})` : ''),
            data: chunk.coupureFiltre
          })
          if (!chunk.delta && !chunk.status) return
        }
        // Raisonnement : canal SÉPARÉ, diffusé en direct, hors du texte de la réponse.
        if (chunk.status) {
          /*
           * UNE LECTURE NATIVE COMPTE. Les outils natifs du modele (`Read`, `Grep`, `Glob`, un
           * `Bash` de type `cat`/`sed -n`/`grep`) n'emettent aucun jeton `<cmd>` : ils passent
           * ICI, en battement d'outil. Sans cette ligne, `anyReadExecuted` restait faux apres
           * une douzaine de fichiers lus et le garde « question sans lecture » mordait a chaque
           * question -- en ordonnant d'avancer sans demander, donc en ecrasant la skill `draft`
           * qui exige justement de faire choisir l'humain (2026-09-03).
           */
          // Juge la commande ENTIERE, pas le libelle coupe a 120 caracteres.
          const statutEntier = statutComplet(chunk.status, chunk.statusTarget)
          // Le message d'erreur d'une action rouge n'est ni une lecture ni un geste :
          // son action a été classée à son départ. Les classeurs reconnaissent un outil natif à
          // son NOM en tête de ligne : « Glob erreur - … » passerait sinon pour une lecture.
          if (!lireLigneDErreur(chunk.status)) {
            if (statusEstUneLecture(statutEntier)) etat.anyReadExecuted = true
            // Un Write/Edit/Bash natif a AGI : le garde « annonce sans action » doit le voir.
            if (statusEstUneAction(statutEntier)) etat.actionNativeCeTour = true
            if (ecritUnFichierDeMemoire(statutEntier)) etat.depotMemoireCeTour = true
          }
          // Un outil direct de l'app a DEJA sa carte d'action : son battement la doublerait.
          if (estUnOutilDirectDuChat(chunk.status)) return
          // Canal SEPARE du raisonnement : un battement d'outil n'est pas une pensee.
          emit({
            kind: 'provider-status',
            text: chunk.status,
            iteration: i,
            // Le journal recopie `text` : sans cette cible entiere, il n'y garde qu'un moignon.
            ...(chunk.statusTarget ? { data: { target: chunk.statusTarget } } : {}),
            ...(chunk.statusDetail ? { detail: chunk.statusDetail } : {})
          })
          return
        }
        if (chunk.reasoning) {
          emit({ kind: 'reasoning', text: chunk.reasoning, iteration: i })
          return
        }
        if (!sawFirstChunk) {
          sawFirstChunk = true
          timer.mark(`send${i}:firstToken`) // ← fin de la latence PERÇUE
          if (!etat.timingWritten) {
            etat.timingWritten = true
            /*
             * TAILLE DU PROMPT ENVOYE, a cote des jalons.
             *
             * Mesure du 2026-08-29 (turn-timing.jsonl, 1360 tours) : une fois le recensement git
             * sorti du thread main (commit 2d9dea86), TOUT le reste de la latence percue vit
             * entre `send:start` et `send:firstToken`. Le journal ne portait aucune grandeur
             * capable d EXPLIQUER cet ecart : impossible de dire si un tour lent est un gros
             * prompt ou un fournisseur lent. On persiste donc la taille reellement envoyee.
             */
            timer.end({
              provider,
              model: binding.model,
              promptChars: messages.reduce((n, m) => n + (m.content?.length ?? 0), 0),
              promptMessages: messages.length
            }) // persiste les jalons du 1er token
          }
        }
        emitVisiblePrefix(visibleFilter.pushSegments(chunk.delta))
      })
      timer.mark(`send${i}:done`)
      emitVisiblePrefix(visibleFilter.finishSegments())
      iter.successfulStreamedPrefix = attemptStreamedPrefix
      iter.successfulAttempt = attempt
    } catch (error) {
      // Annulation, session abandonnée, bascule de compte, repli après refus, rejeu :
      // agent-pilot/reprise-apres-erreur.ts (lot 4). Rend la tentative suivante, ou jette.
      attempt = await reprendreApresErreur(tour, {
        error,
        i,
        attempt,
        streamId,
        attemptStreamedPrefix,
        options,
        prompt,
        callStartedAt,
        repartirSansSession
      })
    } finally {
      // Le port ne survit jamais a son envoi : reussite, erreur, rejeu ou arret.
      await outilsDeCetEnvoi?.arreter()
    }
  }
  // L'envoi est accepté : le modèle a reçu l'état de ce tour, qui devient la base du diff suivant.
  etatRecuParLeModele()
  emit({
    kind: 'prompt-call',
    iteration: i,
    prompt,
    // `?? ''` : un provider qui ne rend AUCUN texte ne doit pas faire planter le tour. Constate
    // le 2026-08-15 — une relance de forme supplementaire suffisait a epuiser la reponse et le
    // pilote tombait sur « Cannot read properties of undefined ». Un tour sans texte est un cas
    // METIER (le tour muet a sa garde) ; ce n'en est pas un pour l'interpreteur.
    response: masquerLesQuestionsPosees(res.text ?? '', REJECTED_QUESTION_MARKER),
    status: 'completed',
    callUsage: res.usage,
    callDurationMs: performance.now() - callStartedAt,
    sessionId: res.sessionId,
    ...(res.model ? { resolvedModel: res.model } : {})
  })
  // Mémorise la session pour que le PROCHAIN tour la reprenne au lieu de re-payer l'historique.
  // PERSISTÉ sur disque en plus du cache mémoire : sans ça, le prochain démarrage de l'app oublie
  // la session et re-paie l'historique entier — le gain de la reprise s'évaporait à chaque
  // relance. Le cache mémoire reste la source rapide ; le disque est le filet.
  // La session avance AUSSI au sein du tour, même sans `conversationId` : l'itération suivante
  // doit reprendre celle-ci et non repartir à blanc.
  if (res.sessionId && providerResumes) {
    etat.sessionEnCours = res.sessionId
    etat.compteDeSession = compteDeCetEnvoi
  }
  if (conversationId) {
    if (res.sessionId && providerResumes) {
      const cle = cleDeSession(etat.compteDeSession)
      chatSessions.set(conversationId, { key: cle, sessionId: res.sessionId })
      persisterSession(conversationId, cle, res.sessionId)
    } else {
      // Un provider qui ne rend pas de nouvelle session ne garantit pas que ce tour appartient
      // à la précédente. La conserver ferait élider un historique qu'il n'a peut-être jamais reçu.
      chatSessions.delete(conversationId)
      oublierSession(conversationId)
    }
  }
  etat.tracesDuTour.push(...(res.executionEvidence ?? []))
  /*
   * JOURNAL DES FICHIERS : ce que l'appel a écrit, outils d'édition et commandes shell. Le commit
   * automatique du chat en dépend (voir chat-turn-publication.ts) ; l'écriture du journal ne fait
   * jamais échouer le tour, et une seule photo du dépôt couvre tout l'appel : le spinner attend ce
   * passage.
   */
  if (conversationId && workspaceDuTour) {
    const dejaTraces = await appendCallMutationTraces({
      conversationId,
      ...(turnId ? { turnId } : {}),
      workspaceRoot: workspaceDuTour,
      evidence: res.executionEvidence ?? []
    })
    const etatApres = etatAvantEnvoi
      ? await captureSaufAnnulation(workspaceDuTour, signal)
      : undefined
    if (etatAvantEnvoi) {
      const changes = [...(etatApres ?? [])]
        .filter(([path, empreinte]) => etatAvantEnvoi.get(path) !== empreinte)
        .map(([path]) => path)
        .filter((path) => !dejaTraces.has(path.replaceAll('\\', '/').toLowerCase()))
      // LA RÉPONSE GARDE CE QUE SON TOUR A ÉCRIT : la carte du fil ne range plus dans « À vérifier »
      // une demande qui n'a touché aucun fichier. Une liste vide n'est dite que si Git a lu LES DEUX
      // photos : une photo sans Git est vide sans rien dire, et une écriture par le terminal
      // passerait pour « rien écrit ».
      const ecrits = fichiersEcritsDuProjet([...dejaTraces, ...changes])
      const photosLues = etatAvantEnvoi.gitLu && etatApres?.gitLu === true
      if (ecrits.length > 0 || photosLues)
        emit({ kind: 'fichiers-ecrits', data: ecrits, iteration: i })
      if (changes.length > 0)
        await appendWorkspaceMutationTrace({
          conversationId,
          ...(turnId ? { turnId } : {}),
          workspaceRoot: workspaceDuTour,
          source: 'chat_tool',
          paths: changes,
          before: etatAvantEnvoi,
          // `changes` sort de cette photo : la reprendre ne relirait que le même état.
          ...(etatApres ? { after: etatApres } : {})
        })
    }
  }
  if (res.usage) {
    etat.usage.inputTokens += res.usage.inputTokens
    etat.usage.outputTokens += res.usage.outputTokens
    etat.usage.costUsd += res.usage.costUsd ?? 0
    // ECRASE, ne cumule pas : la jauge de contexte veut la DERNIERE entree, pas leur somme.
    // `res.usage.inputTokens` est le CUMUL du tour cote provider : l'ecraser ici ne le
    // desagregeait pas, la jauge restait donc collee a 100 % (2026-09-04). Le
    // provider expose desormais l'entree de son DERNIER appel ; repli sur le cumul si absent.
    etat.usage.derniereEntree = res.usage.derniereEntree ?? res.usage.inputTokens
    etat.usage.derniereEntreeCache = res.usage.derniereEntreeCache ?? res.usage.cacheReadTokens
    // Le modele SERVI, sinon aucune fenetre de contexte n'est trouvable en aval.
    if (res.model) etat.usage.model = res.model
    etat.usage.provider = provider
  }
  // Ecrase, comme `derniereEntree` : le detail decrit le DERNIER appel. Un appel sans mesure
  // garde celle du precedent du meme tour, dont la partie fixe est la meme.
  if (res.contexte) etat.usage.contexte = res.contexte
  return { res, iter }
}
