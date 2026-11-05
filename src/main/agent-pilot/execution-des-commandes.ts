// Exécution des `<cmd>` d'une réponse du modèle, dans leur ordre : texte diffusé entre les
// commandes, blocs illisibles signalés, `ask` borné à une question par tour, `orchestrate` gardé
// par les deux lectures et par le verrou du tour, résultats comptés et bornés. Sortie telle quelle
// de la boucle de AgentPilot.chat() (conv-1580, lot 4) : rend les résultats à réinjecter au modèle.
import { refusDeRepriseEstTransitoire, classifierRefusDeReprise } from '../runs/resume-refusal'
import type { CommandResult } from '../commands'
import {
  askFaitChoisirUneProposition,
  REFUS_ASK_DRAFT,
  STATUT_REFUS_ASK_DRAFT
} from '../draft-choix-par-boutons'
import { cleDEchec } from '../chat-turn-messages'
import { tacheAvecLectureRetenue } from '../deux-lectures'
import {
  formatOrchestrationOutcome,
  formatOrchestrationOutcomePourLeModele,
  isDeliveredOrchestrationOutcome,
  orchestrationEnEchec,
  ORCHESTRATION_ALREADY_ISSUED_REFUSAL,
  type OrchestrationOutcome
} from '../../shared/orchestration-outcome'
import { bornerResultatDeCommande } from '../resultat-de-commande-borne'
import { cleAppelNatif } from '../chat-mcp'
import { cleDeVideo } from '../videos-livrees'
import { fluxDuBloc, texteDuBlocDansLeFil } from '../montrer-bloc-command'
import { consumeStreamedPrefix, retirerConclusionBloquantePrematuree } from './collage-des-deltas'
import type { ContexteDuTour } from './contexte-du-tour'
import { commandResultSucceeded, failedOrchestrationOutcome } from './issue-des-commandes'
import type { IterationDuTour } from './iteration-du-tour'
import type { OrderedPilotToken } from './jetons-de-commande'

export async function executerLesCommandes(
  tour: ContexteDuTour,
  iter: IterationDuTour,
  ordered: OrderedPilotToken[]
): Promise<string[]> {
  const {
    etat,
    emit,
    signal,
    provider,
    latestUserMessage,
    draftChoixParBoutons,
    deuxLecturesDuTour,
    annoncerLaLectureRetenue,
    poserLaQuestionDesLectures,
    lectureRetenue: lectureRetenueDuTour,
    execCommandTolerante,
    comptabiliserCommande
  } = tour
  const { i, recoveredHere } = iter
  const results: string[] = []
  // Remis a plat a chaque iteration — mais sur ce que les OUTILS DIRECTS de cette iteration ont
  // deja constate pendant l'envoi : les effacer ici ferait taire leur echec (faux sans eux).
  etat.echecDeLaDerniereIteration = etat.echecNatifCetteIteration
  // Remis a plat a chaque iteration, comme son jumeau : sinon un rejeu d'une iteration
  // precedente ferait escalader une iteration qui n'a rencontre qu'un mur neuf.
  etat.dernierEchecEstUnRejeu = etat.rejeuNatifCetteIteration
  let commandIndex = 0
  let tokenIndex = 0
  let streamedPrefixRemaining = iter.successfulStreamedPrefix
  for (const token of ordered) {
    signal?.throwIfAborted()
    if (token.kind === 'text') {
      const texteVisible = retirerConclusionBloquantePrematuree(token.text)
      if (!texteVisible) {
        tokenIndex += 1
        continue
      }
      const consumed = consumeStreamedPrefix(texteVisible, streamedPrefixRemaining)
      const visible = consumed.visible
      streamedPrefixRemaining = consumed.prefixRemaining
      if (visible)
        iter.fluxAffichesCetteIteration.add(`${i}:${iter.successfulAttempt}:ordered:${tokenIndex}`)
      if (visible)
        emit({
          kind: 'delta',
          streamId: `${i}:${iter.successfulAttempt}:ordered:${tokenIndex}`,
          text: visible,
          iteration: i
        })
      tokenIndex += 1
      continue
    }

    if (token.kind === 'invalid') {
      /**
       * Bloc `<cmd>` inexploitable. Avant, il disparaissait sans trace : le modele croyait avoir
       * agi, l'utilisateur lisait une conclusion, et rien ne s'etait produit. Desormais l'echec
       * est (a) VISIBLE dans le fil et (b) REINJECTE au modele pour qu'il corrige au tour
       * suivant. Aucune action n'est inventee : on signale, on ne devine pas l'intention.
       */
      const actionId = `${i}:${commandIndex++}`
      emit({ kind: 'command', actionId, name: 'commande illisible', args: {} })
      emit({
        kind: 'result',
        actionId,
        name: 'commande illisible',
        ok: false,
        data: `${token.reason} — aucune action n'a été exécutée`
      })
      results.push(
        `COMMANDE ILLISIBLE (${token.reason}) — AUCUNE action executee. Bloc recu : ` +
          `${token.raw.slice(0, 300)}. Re-emets une commande VALIDE au format exact ` +
          `<cmd>{"name":"...","args":{...}}</cmd>, ou reponds sans commande.`
      )
      tokenIndex += 1
      continue
    }

    if (etat.executesParCanalNatif.has(cleAppelNatif(token.name, token.args))) {
      // DEJA EXECUTEE par l'outil direct pendant cette reponse (meme nom, memes arguments) : le
      // modele l'a appelee ET recopiee en texte. On ne la rejoue pas, et on le dit.
      emit({
        kind: 'provider-status',
        iteration: i,
        text: `${token.name} : déjà exécutée par l'outil direct dans cette réponse, non rejouée`
      })
      results.push(
        `${token.name} → déjà exécutée par l'outil direct dans cette réponse : non rejouée ` +
          '(son résultat t’a déjà été rendu).'
      )
      tokenIndex += 1
      continue
    }
    const actionId = `${i}:${commandIndex++}`
    etat.anyActionExecuted = true
    if (token.name === 'desktop_act' || token.name === 'desktop_observe') etat.bureauUtilise = true
    // Les commandes qui OBSERVENT reellement le disque. `get_state` n'en est pas : c'est
    // l'apercu partiel dont l'agent tirait justement ses chiffres faux.
    if (token.name === 'list_files' || token.name === 'read_file' || token.name === 'find_in_files')
      etat.anyReadExecuted = true
    if (token.name === 'ask' && etat.reponseTardiveAUneQuestion !== undefined) {
      // L'utilisateur a REPONDU avant que la question ne parte : la reposer afficherait des
      // boutons pour un choix deja fait.
      emit({ kind: 'command', actionId, name: token.name, args: token.args })
      emit({
        kind: 'result',
        actionId,
        name: token.name,
        ok: true,
        data: `Question non reposée — l’utilisateur a déjà répondu : ${etat.reponseTardiveAUneQuestion}`
      })
      results.push(
        `ask → l’utilisateur a DÉJÀ répondu pendant ce tour : « ${etat.reponseTardiveAUneQuestion} ». ` +
          'Ne repose pas la question, traite cette réponse.'
      )
      tokenIndex += 1
      continue
    }
    if (token.name === 'ask' && etat.questionPoseeCeTour) {
      // UNE SEULE QUESTION PAR TOUR. conv-844, turn 852bb2fd-25e4-40dd-a959-57d9337b084c : la
      // relance « question sans lecture » a fait reposer la meme question -> 2 cartes a l'ecran.
      // La premiere est deja affichee : la seconde n'est pas emise.
      results.push('ask → une question est DÉJÀ affichée dans ce tour : ne la repose pas.')
      tokenIndex += 1
      continue
    }
    if (token.name === 'ask' && draftChoixParBoutons && askFaitChoisirUneProposition(token.args)) {
      // /draft : LE CHOIX SE FAIT PAR LES BOUTONS DU BLOC. Tours 938a67c1-78bc-4bc5-addf-865167663f44
      // (conv-312) et c7d72274-db73-49bd-93fe-435f6647863a (conv-310) : `ask` sans aucun bloc de
      // choix, malgre la procedure. La question n'est pas affichee et le tour continue : le
      // modele recoit l'ordre de poser le carrousel (draft-choix-par-boutons.ts).
      emit({ kind: 'provider-status', iteration: i, text: STATUT_REFUS_ASK_DRAFT })
      results.push(REFUS_ASK_DRAFT)
      tokenIndex += 1
      continue
    }
    if (token.name === 'ask') etat.questionPoseeCeTour = true
    const settledAction = recoveredHere?.settledActions?.find(
      (action) => action.actionId === actionId && action.name === token.name
    )
    if (
      token.name === 'orchestrate' &&
      !settledAction &&
      !etat.orchestrationIssued &&
      !etat.questionPoseeCeTour
    ) {
      // Le run n'est PAS lancé : la question remplace l'orchestration (deux-lectures.ts).
      const issueAvantRun = await deuxLecturesDuTour('avant-d-agir')
      // Une lecture domine : le run part, mais sur ELLE (`rootTask` ci-dessous), et le fil la
      // nomme (conv-1123).
      if (issueAvantRun?.kind === 'retenue') annoncerLaLectureRetenue(issueAvantRun)
      if (issueAvantRun?.kind === 'question') {
        await poserLaQuestionDesLectures(actionId, issueAvantRun.lectures)
        etat.questionPoseeCeTour = true
        etat.questionDesLecturesPosee = true
        results.push(
          'orchestrate → NON LANCÉ : la demande a deux lectures plausibles, la question est ' +
            'posée à l’utilisateur. Ne relance rien dans ce tour.'
        )
        tokenIndex += 1
        continue
      }
    }
    if (!settledAction)
      emit({
        kind: 'command',
        actionId,
        name: token.name,
        args: token.args,
        ...(token.reparation ? { reparation: token.reparation } : {})
      })
    if (token.name === 'orchestrate' && etat.orchestrationIssued) {
      const refusal = ORCHESTRATION_ALREADY_ISSUED_REFUSAL
      emit({
        kind: 'result',
        actionId,
        name: token.name,
        ok: false,
        data: refusal
      })
      // conv-1499 (2026-11-04) : « Termine avec son resultat » faisait RÉÉCRIRE la clôture déjà
      // affichée — trois blocs « ✅ Fait » empilés dans une seule bulle. Le texte du refus reste
      // tel quel (le fil le reconnaît à l'égalité, chat-view-model.ts) ; la consigne s'y ajoute.
      results.push(
        `${token.name} → ERREUR ${refusal} Ta clôture déjà écrite reste affichée : ne la ` +
          `réécris pas et ne répète pas l’état. N’ajoute qu’une ligne sur ce refus, ou ce que ` +
          `change un autre geste réellement fait ensuite.`
      )
      tokenIndex += 1
      continue
    }
    if (token.name === 'orchestrate') etat.orchestrationIssued = true
    signal?.throwIfAborted()
    const lectureRetenue = lectureRetenueDuTour()
    // `rootTask` est l'autorité du run (commands.ts) : la lecture annoncée y est jointe, sinon le
    // run relirait la demande brute et pourrait faire l'autre lecture (conv-1123).
    const authoritativeArgs =
      token.name === 'orchestrate' && latestUserMessage
        ? {
            ...token.args,
            rootTask: lectureRetenue
              ? tacheAvecLectureRetenue(
                  latestUserMessage,
                  lectureRetenue.retenue,
                  lectureRetenue.ecartee
                )
              : latestUserMessage
          }
        : token.args
    const r: CommandResult = settledAction
      ? settledAction.ok
        ? {
            ok: true,
            data: settledAction.data,
            ...(settledAction.attachments?.length ? { attachments: settledAction.attachments } : {})
          }
        : {
            ok: false,
            error: String(settledAction.data ?? 'échec déjà journalisé'),
            ...(settledAction.attachments?.length ? { attachments: settledAction.attachments } : {})
          }
      : await execCommandTolerante(token.name, authoritativeArgs, (text) =>
          emit({ kind: 'action-progress', actionId, text })
        )
    if (r.attachments?.length) etat.commandAttachments.push(...r.attachments)
    /*
     * LA CAPTURE QUI SERT A VALIDER EST MONTREE (conv-1450).
     *
     * `attachments` alimentait uniquement le prochain prompt du modele : l'utilisateur ne voyait
     * jamais l'image sur laquelle reposait le verdict « c'est bon ». On la republie donc comme
     * ARTEFACT, seul canal deja rendu et persiste par le fil. Restreint aux IMAGES : un log ou un
     * payload texte n'est pas une preuve visuelle et n'a rien a faire en apercu.
     */
    for (const piece of r.attachments ?? []) {
      if (piece.kind !== 'image' || !piece.content) continue
      emit({
        kind: 'artifact',
        iteration: i,
        artifact: {
          id: `tool-capture-${actionId}-${etat.commandAttachments.length}-${piece.name}`,
          name: piece.name,
          mimeType: piece.mimeType,
          kind: 'image',
          size: piece.size,
          createdAt: Date.now(),
          encoding: 'base64',
          content: piece.content,
          source: { provider, tool: token.name }
        }
      })
    }
    /*
     * CARTES DU FIL RENDUES PAR UNE COMMANDE (`show_video`, conv-253). Champ distinct
     * d'`attachments` : elles s'affichent dans le fil et ne partent JAMAIS au modèle IA — une
     * vidéo dans `commandAttachments` serait envoyée au prochain appel.
     */
    for (const artifact of r.artifacts ?? []) {
      if (etat.artefactsDejaEmis.has(artifact.id)) continue
      etat.artefactsDejaEmis.add(artifact.id)
      if (artifact.kind === 'video' && artifact.path)
        etat.videosDejaMontrees.add(cleDeVideo(artifact.path))
      emit({ kind: 'artifact', iteration: i, artifact })
    }
    // Meme clef que la comptabilite d'echec plus bas (nom + cible), calculee ici parce que le
    // resultat est emis AVANT le bloc qui la tient : c'est le seul endroit ou l'on sait encore
    // quel echec cette reussite repare.
    const cleDeCetteAction = cleDEchec(token.name, authoritativeArgs as Record<string, unknown>)
    const echecRattrape = commandResultSucceeded(r)
      ? etat.actionIdParEchec.get(cleDeCetteAction)
      : undefined
    if (!settledAction)
      emit({
        kind: 'result',
        actionId,
        name: token.name,
        ok: commandResultSucceeded(r),
        data: r.ok ? r.data : r.error,
        ...(echecRattrape ? { retryOf: echecRattrape } : {}),
        ...(r.attachments?.length ? { attachments: r.attachments } : {})
      })
    // `montrer_bloc` (conv-1306) : même pose que par le canal direct, juste après le résultat.
    for (const [index, bloc] of (r.blocs ?? []).entries())
      emit({
        kind: 'delta',
        streamId: fluxDuBloc(`${actionId}:${index}`),
        text: texteDuBlocDansLeFil(bloc),
        iteration: i
      })
    // `orchestrate` rend déjà l'issue AUTORITATIVE du pipeline complet : build, juge, gate,
    // publication et fermeture du RUN. Redemander au modèle de l'interpréter coûtait un appel
    // supplémentaire et, pire, lui faisait parfois suivre le rapport PROVISOIRE du worker
    // (« RUN open, lance judge ») alors que le gate venait de fermer et publier le run. On clôt
    // donc mécaniquement le tour sur le résultat structuré, comme le chemin `/skill` explicite.
    if (token.name === 'orchestrate') {
      const outcome = r.ok
        ? (r.data as OrchestrationOutcome | undefined)
        : failedOrchestrationOutcome(r.error)
      const deliveryClosed = r.ok && isDeliveredOrchestrationOutcome(outcome ?? {})
      /*
       * UN REFUS TRANSITOIRE NE CONSOMME PAS LE VERROU DU TOUR (mesure conv-489, 2026-09-12).
       *
       * `orchestrationIssued` est pose AVANT l'execution, inconditionnellement : il protege
       * d'une SECONDE orchestration payante dans le meme tour. Mais « Reprise refusee : N
       * appel(s) provider encore actif(s) » est jete AVANT tout appel provider — rien n'a
       * demarre, rien n'a coute. Le verrou restait pourtant pose : l'agent lisait « je ne peux
       * pas relancer dans ce tour », rendait la main sans rien livrer, et l'utilisateur payait
       * un tour entier pour zero ligne de code puis devait relancer a la main. Le refus dit
       * lui-meme « la suite correcte est de relancer la MEME demande » : on lui en rend le
       * droit, dans ce tour-ci. Le garde-fou anti-double-depense reste intact pour tous les
       * autres cas, y compris les echecs definitifs.
       */
      if (!r.ok && refusDeRepriseEstTransitoire(classifierRefusDeReprise(String(r.error ?? '')))) {
        etat.orchestrationIssued = false
      }
      /*
       * LA COMPTABILITE D'ECHEC EST TENUE MEME ICI, avant le retour anticipe.
       *
       * La cloture mecanique du tour sur l'issue structuree est DELIBEREE (voir juste au-dessus) et
       * n'est pas remise en cause : l'echec est bel et bien DIT a l'utilisateur par
       * `formatOrchestrationOutcome` (« Echec du workflow », « ARRETE au controle final », « la
       * livraison n'est pas prouvee »), et la REPARATION d'une orchestration appartient a la
       * boucle de l'orchestrateur, pas au tour de chat.
       *
       * Mais sauter ce bloc laissait `anyActionFailed` a false sur l'echec le plus couteux de
       * l'application. Aujourd'hui c'est inerte — on retourne juste apres. Demain, toute garde
       * ajoutee en aval raterait silencieusement les orchestrations plantees. Signale par un juge
       * externe le 2026-08-22 ; on tient la comptabilite juste plutot que de laisser un piege.
       */
      /*
       * LA COMPTABILITE LIT SON PROPRE PREDICAT, pas celui de l'affichage.
       *
       * Regression trouvee au cycle 2 de l'audit du 2026-08-26 : `isDeliveredOrchestrationOutcome`
       * avait ete resserre pour que l'UI cesse d'ecrire « ✅ Workflow terminé » sur un travail
       * reste dans sa copie isolee. Effet de bord non trace : un run VERT en `publication: 'hold'`
       * tombait ici comme un ECHEC et armait `exigeCorrigerEtPoursuivre` — l'agent repartait
       * reparer ce qui n'avait pas casse, sur le chemin le plus courant du travail retenu.
       */
      if (orchestrationEnEchec(outcome ?? {})) {
        etat.anyActionFailed = true
        etat.echecDeLaDerniereIteration = true
        const cleOrchestration = cleDEchec(token.name, authoritativeArgs as Record<string, unknown>)
        etat.commandesEnEchecNonRattrape.add(cleOrchestration)
        etat.actionIdParEchec.set(cleOrchestration, actionId)
      }
      const closureNotice = deliveryClosed
        ? 'Clôture Autowin : gate validé, RUN fermé green ; aucune autre orchestration ni aucun second judge ne sont nécessaires dans ce tour.'
        : 'Clôture Autowin : résultat terminal rendu ; aucune autre orchestration n’est relancée dans ce tour.'
      /*
       * LE MODELE REPREND LA PAROLE — decision utilisateur du 2026-08-27, et le contraire de ce
       * que ce chemin faisait.
       *
       * Constate sur conv-1449 : le pied gabarit annoncait « 👉 Recommandé : faire exécuter le
       * travail si le besoin n'est pas encore réalisé » quand le RUN.md du meme run portait
       * `### phase build` + `### phase judge`, la DoD cochee et `status: green`. Le gabarit DEVINE
       * la portee depuis `phaseOutputs` ; vide, il avoue une ignorance qui n'existe pas — tout en
       * affirmant « ✅ Fait » deux lignes plus haut. Trois mensonges deja (20/08, 21/08, 23/08),
       * trois branches de rustine : c'est la METHODE qui est fausse. Un gabarit ne peut pas
       * savoir ce qui a ete fait ; celui qui vient de le faire, si.
       *
       * Le risque que la cloture mecanique couvrait est NOMME et couvert autrement : le modele
       * suivait parfois le rapport PROVISOIRE du worker (« RUN open, lance judge ») contre l'issue
       * reelle. On lui rend donc le compte-rendu AUTORITATIF (`formatOrchestrationOutcome`, la
       * meme source qui s'affichait) explicitement etiquete comme faisant foi.
       *
       * Le risque de second run payant, lui, etait DEJA couvert avant ce changement :
       * `orchestrationIssued` (plus haut) refuse toute 2e orchestration dans le meme tour.
       */
      etat.orchestrationOutcome = outcome as Record<string, unknown> | undefined
      const compteRenduAutoritatif = formatOrchestrationOutcome(
        r.ok,
        outcome,
        r.ok ? undefined : String(r.error ?? ''),
        closureNotice
      )
      etat.compteRenduOrchestration = compteRenduAutoritatif
      // Le MODELE lit le resultat ENTIER (conv-914) ; `compteRenduAutoritatif`, coupe a 4 000
      // caracteres, ne sert plus que de repli AFFICHE. La borne de tout resultat injecte
      // (conv-312) protege seule la fenetre de contexte.
      const compteRenduPourLeModele = bornerResultatDeCommande(
        token.name,
        formatOrchestrationOutcomePourLeModele(
          r.ok,
          outcome,
          r.ok ? undefined : String(r.error ?? ''),
          closureNotice
        )
      )
      results.push(
        `${token.name} → ISSUE AUTORITATIVE DU PIPELINE (elle fait foi contre tout rapport ` +
          `provisoire d'un worker ; aucune autre orchestration ne sera acceptée dans ce tour) :
` +
          compteRenduPourLeModele +
          `

Écris maintenant ta clôture pour l'utilisateur à partir de CES faits, sans en ` +
          `inventer d'autres et sans contredire cette issue.`
      )
      tokenIndex += 1
      continue
    }
    // Comptabilite COMMUNE avec les outils directs : voir `comptabiliserCommande`.
    const commandSucceeded = comptabiliserCommande(
      token.name,
      authoritativeArgs as Record<string, unknown>,
      r,
      actionId
    ).reussie
    // BORNE OBLIGATOIRE : sans elle, une lecture volumineuse (`retrospective`, `read_file`,
    // `conversation_read`) part telle quelle dans le prompt et tue le tour — conv-312, 2 860 957
    // caracteres injectes, « Prompt is too long », fil devenu un cul-de-sac.
    results.push(
      bornerResultatDeCommande(
        token.name,
        `${token.name} → ${
          commandSucceeded
            ? JSON.stringify(r.data)
            : 'ERREUR ' + (r.ok ? JSON.stringify(r.data) : r.error)
        }`
      )
    )
    tokenIndex += 1
  }
  return results
}
