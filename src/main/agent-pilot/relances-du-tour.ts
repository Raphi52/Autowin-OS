// Relances de fin d'itération d'un tour de chat. Chaque contrôle lit l'état du tour
// (`etat-du-tour.ts`) et rend la relance à envoyer au modèle — consignes poussées dans le fil,
// motif de l'itération accordée en plus du cap, réponse affichée à remplacer —, ou rien ; quand il
// mord, il consomme lui-même son crédit. AgentPilot.chat() garde l'ORDRE des contrôles et l'envoi.
// Sortis tels quels de la boucle de chat(), textes compris (lot 4).
import { cheminsRelatifsCites, relanceCheminsComplets } from '../fichiers/chemins-complets'
import {
  blocVisuelNonFerme,
  consigneApresEchec,
  exigeAgirPasAnnoncer,
  exigeCorrigerEtPoursuivre,
  exigeDireLEchec,
  exigeFaireLeGeste,
  exigePreuveAvantDePromettre,
  exigeUnChiffreVerifie,
  exigeUneConclusion,
  preuveManquanteDuTour,
  questionPoseeSansAvoirLu,
  relanceDePreuveManquante,
  RELANCE_BLOC_VISUEL_NON_FERME,
  RELANCE_CHIFFRE_NON_VERIFIE,
  RELANCE_FAIRE_LE_GESTE,
  RELANCE_PREUVE_AVANT_DE_PROMETTRE,
  RELANCE_QUESTION_SANS_LECTURE
} from '../chat/chat-turn-messages'
import {
  conversationPretendueInaccessible,
  correctionConversationLisible,
  correctionOutilsPresents,
  outilsFaussementAbsents
} from '../../shared/outil-pretendu-absent'
import type { MotifDeRallonge } from './aides-du-tour'
import type { ContexteDuTour } from './contexte-du-tour'
import type { EtatDuTour } from './etat-du-tour'
import { RELANCE_CONCLUSION_ABSENTE } from './issue-des-commandes'
import { REJECTED_QUESTION_MARKER, type OrderedPilotToken } from './jetons-de-commande'

/** Une relance : ce que chat() envoie au modèle avant de rejouer l'itération. */
export interface Relance {
  /** Motif de l'itération accordée en plus du cap (`grantRecoveryIteration`). */
  motif: MotifDeRallonge
  /** Segments poussés dans le fil, dans cet ordre. */
  consignes: string[]
  /** La réponse relancée REMPLACE celle de cette itération à l'écran (D2). */
  remplace?: true
}

/** Consignes de budget poussées en tête de l'itération `i`, avant l'envoi au modèle. */
export function consignesDuBudget(etat: EtatDuTour, i: number): string[] {
  const consignes: string[] = []
  /**
   * CAP RÉINJECTÉ COMME CONSIGNE DE CLÔTURE FORCÉE.
   *
   * Le modèle ignorait tout du cap : il continuait d'agir jusqu'à ce que la boucle meure sur
   * « Cap d'itérations (N) atteint sans réponse finale », en jetant le texte déjà dit. On le
   * PRÉVIENT à la dernière itération pour qu'il règle/rapporte l'erreur en cours et conclue.
   * Injectée une seule fois par index : `grantRecoveryIteration` peut relever le cap APRÈS,
   * auquel cas la nouvelle dernière itération reçoit sa propre consigne.
   */
  /**
   * BUDGET DU TOUR ANNONCE A MI-PARCOURS, PAS SEULEMENT AU DERNIER APPEL.
   *
   * Le modele n'apprenait son cap qu'a `iterationLimit - 1` : a cet instant il ne peut plus
   * changer de methode, seulement CONSTATER. Mesure le 2026-09-03 : douze iterations
   * depensees une par une en lecture (un `read_file` par appel), la seule ecriture tentee au
   * douzieme — et refusee. L'utilisateur a recu un diagnostic la ou il demandait un correctif,
   * alors que le levier existait des le premier appel : plusieurs commandes tiennent dans UN
   * SEUL message et ne coutent qu'un appel.
   *
   * On annonce donc le RESTE a mi-parcours, en NOMMANT ce levier. Jamais sur la derniere
   * iteration, qui porte deja sa propre consigne de cloture. Si `grantRecoveryIteration` releve
   * le cap ensuite, la nouvelle moitie recoit sa propre annonce : le budget a change, le modele
   * doit le savoir.
   */
  if (i > 0 && i < etat.iterationLimit - 1 && i === Math.floor(etat.iterationLimit / 2)) {
    consignes.push(
      `SYSTÈME — BUDGET DU TOUR : appel ${i + 1} sur ${etat.iterationLimit}, il en reste ` +
        `${etat.iterationLimit - i - 1}. Si la tâche demandée n'est pas encore ENGAGÉE, change de ` +
        'méthode maintenant : plusieurs commandes tiennent dans UN SEUL message et ne coûtent ' +
        "qu'un appel — groupe tes lectures, ou délègue-les. Au dernier appel il ne restera plus " +
        'qu’à constater ce qui n’a pas été fait.'
    )
  }
  if (i === etat.iterationLimit - 1 && etat.consigneClotureInjectee !== i) {
    etat.consigneClotureInjectee = i
    consignes.push(
      `SYSTÈME — DERNIÈRE ITÉRATION DE CE TOUR (${i + 1}/${etat.iterationLimit}) : c'est ton dernier ` +
        "appel. N'émets plus de commande : une action de plus fait mourir le tour sans réponse. RÈGLE ou RAPPORTE " +
        "l'erreur en cours (ce qui a échoué, sa cause, l'état réel laissé), puis CONCLUS en " +
        'clair. Un tour sans conclusion écrite est perdu pour l’utilisateur.'
    )
  }
  return consignes
}

/** Les deux segments d'une question refusée : poussés dans le fil, que la relance ait lieu ou non. */
export const CONSIGNES_QUESTION_REFUSEE: readonly string[] = [
  `TOI: ${REJECTED_QUESTION_MARKER}`,
  'SYSTÈME: question refusée — aucun motif de blocage autorisé et vérifiable. ' +
    'Continue de façon autonome avec une hypothèse raisonnable, sans solliciter l’utilisateur.'
]

/** Question refusée : l'itération est rejouée UNE fois, ses segments déjà poussés dans le fil. */
export function relanceQuestionRefusee(etat: EtatDuTour): Relance | undefined {
  if (etat.invalidQuestionRecoveryAvailable) {
    etat.invalidQuestionRecoveryAvailable = false
    return { motif: 'invalid-question', consignes: [] }
  }
  return undefined
}

/** Un `<cmd>` cassé et zéro commande valide : le bloc est réinjecté, la main rendue aux commandes. */
export function relanceCommandeIllisible(
  etat: EtatDuTour,
  blocsIllisibles: Array<Extract<OrderedPilotToken, { kind: 'invalid' }>>,
  texteProvider: string
): Relance | undefined {
  if (blocsIllisibles.length && etat.commandeIllisibleRecoveryAvailable) {
    etat.commandeIllisibleRecoveryAvailable = false
    return {
      motif: 'commande-illisible',
      consignes: [
        `TOI: ${texteProvider}`,
        'SYSTÈME: ton bloc <cmd> est INEXPLOITABLE (' +
          blocsIllisibles.map((bloc) => bloc.reason).join(' ; ') +
          ') — AUCUNE action n’a été exécutée, la demande n’est donc PAS satisfaite, malgré ce ' +
          'que ton texte annonce. Vérifie que le JSON est COMPLET (accolades équilibrées, ' +
          'guillemets échappés) et RÉ-ÉMETS MAINTENANT la commande au format exact ' +
          '<cmd>{"name":"...","args":{...}}</cmd>. N’annonce rien : agis.'
      ]
    }
  }
  return undefined
}

// Le tour a AGI mais n'a rien dit : on redemande la conclusion plutot que de livrer des
// etiquettes nues. Borne a une relance pour ne jamais boucler.
export function relanceTourMuet(etat: EtatDuTour): Relance | undefined {
  if (!etat.anySpokenText && etat.anyActionExecuted && etat.conclusionRecoveryAvailable) {
    etat.relanceDeFormeUtilisee = true
    etat.conclusionRecoveryAvailable = false
    return {
      motif: 'muted-turn',
      consignes: [
        'SYSTÈME: tu as agi mais tu n’as rien dit — l’utilisateur ne voit que des étiquettes ' +
          'd’action, il ne peut pas savoir ce qui a été fait. Conclus MAINTENANT en clair, SANS ' +
          'aucune commande : ce que tu as fait, ce que cela a produit (résultats/exit codes ' +
          'observés), et ce qui reste. Si une action a échoué, dis-le explicitement.'
      ]
    }
  }
  return undefined
}

/*
 * L'AGENT DIT NE PAS AVOIR UN OUTIL QU'IL A.
 *
 * Mesure du 20/08 sur une conversation reelle : « `edit_file` n'existe pas dans le catalogue
 * reellement disponible de cette session », puis huit tours a reclamer des droits shell dont
 * il n'avait pas besoin, 13,15 $, zero ligne ecrite. `directReadOnly` vaut `false` en dur :
 * un tour pilote par l'utilisateur recoit TOUJOURS le catalogue complet.
 *
 * C'est la plus falsifiable des trois relances de cette famille — le catalogue est connu du
 * code qui vient de l'envoyer — donc elle passe la premiere.
 */
export function relanceOutilPretenduAbsent(tour: ContexteDuTour): Relance | undefined {
  const { etat, catalog } = tour
  if (!etat.relanceDeFormeUtilisee && etat.outilAbsentRecoveryAvailable) {
    const faussementAbsents = outilsFaussementAbsents(
      etat.visibleTextThisTurn,
      catalog.map((commande) => commande.name)
    )
    if (faussementAbsents.length) {
      etat.outilAbsentRecoveryAvailable = false
      etat.relanceDeFormeUtilisee = true
      return {
        motif: 'outil-pretendu-absent',
        consignes: [correctionOutilsPresents(faussementAbsents)]
      }
    }
    /*
     * DEUXIEME FORME : l'agent ne nie aucun outil, il nie l'ACCES a une conversation. Mesure du
     * 21/08 : « Le scout n'existe dans mon contexte qu'a travers le tableau du frame », alors
     * que `conversation_read` etait la et que sa description interdit deja cette reponse, mot
     * pour mot. Meme verrou : une seule relance de forme par tour.
     */
    const conversationLisible = conversationPretendueInaccessible(
      etat.visibleTextThisTurn,
      catalog.map((commande) => commande.name)
    )
    if (conversationLisible) {
      etat.outilAbsentRecoveryAvailable = false
      etat.relanceDeFormeUtilisee = true
      return {
        motif: 'outil-pretendu-absent',
        consignes: [correctionConversationLisible(conversationLisible)]
      }
    }
  }
  return undefined
}

/**
 * IL PARLE SANS AGIR — miroir du tour muet, decouvert le 2026-08-15.
 *
 * Demande : « ranges moi mes conversations dans des sous categories adequates ». Reponse
 * recue, marquee `completed` : « Je vais d'abord identifier… », « Je cible maintenant… »,
 * et ZERO action. Rien n'a ete range. Les cinq gardes precedentes exigent toutes
 * `anyActionExecuted` : aucune ne pouvait voir un tour qui n'agit pas du tout.
 */
export function relanceAnnonceSansAction(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee, latestUserMessage } = tour
  if (
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.annonceSansActionRecoveryAvailable &&
    exigeAgirPasAnnoncer(
      latestUserMessage,
      etat.visibleTextThisTurn,
      etat.anyActionExecuted || etat.actionNativeCeTour
    )
  ) {
    etat.annonceSansActionRecoveryAvailable = false
    etat.relanceDeFormeUtilisee = true
    return {
      motif: 'annonce-sans-action',
      consignes: [
        'SYSTÈME: tu as ANNONCÉ ce que tu allais faire, sans rien faire — aucune commande n’a ' +
          'été exécutée, donc la demande n’est PAS satisfaite. AGIS maintenant : émets les ' +
          'commandes nécessaires, puis rends compte de ce qu’elles ont réellement produit. Si ' +
          'tu ne peux pas agir, dis-le explicitement et pourquoi — ne décris jamais un plan au ' +
          'futur comme s’il tenait lieu de résultat.'
      ]
    }
  }
  return undefined
}

/*
 * CORRIGE, PUIS POURSUIS — passe AVANT l'aveu d'echec, et c'est deliberé.
 *
 * `exigeDireLEchec` obtient un constat honnete mais ordonne de reformuler « SANS aucune
 * commande » : elle FIGE le tour sur son echec. Celle-ci est la seule relance de la famille
 * qui REND la main aux commandes — l'agent repart de l'erreur reelle, la corrige, et termine
 * la tache. Si la reprise echoue a son tour, l'aveu d'echec reste en second rideau.
 */
export function relanceCorrectionApresEchec(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.reprisesApresEchecRestantes > 0 &&
    exigeCorrigerEtPoursuivre(
      etat.echecDeLaDerniereIteration || etat.commandesEnEchecNonRattrape.size > 0,
      etat.visibleTextThisTurn
    )
  ) {
    etat.reprisesApresEchecRestantes -= 1
    /*
     * Le depot impose « UNE SEULE relance de forme par tour, toutes gardes confondues ». La
     * reprise d'ACTION en est une exception ASSUMEE : elle rend la main aux commandes, ce
     * qu'aucune relance de forme ne fait, et la brider reviendrait a re-figer le tour sur son
     * echec — le defaut d'origine. L'ESCALADE, elle, signifie « tu tournes en rond » : a ce
     * stade plus rien ne doit se debloquer derriere, sinon on empile des appels payants sur un
     * tour deja en difficulte (audit du 2026-08-21).
     */
    if (etat.dernierEchecEstUnRejeu) etat.relanceDeFormeUtilisee = true
    return {
      motif: 'correction-apres-echec',
      consignes: [
        consigneApresEchec(
          etat.dernierEchecEstUnRejeu ? [etat.derniereSignatureDEchec] : [],
          etat.derniereSignatureDEchec
        )
      ]
    }
  }
  return undefined
}

/**
 * UNE ACTION A ECHOUE ET LA REPONSE N'EN DIT RIEN. Trouve : dernier
 * `edit_file` en `ok:false`, et le texte lu se termine par « ✅ Fait ». Un bloc de cloture
 * rendu obligatoire sans exigence d'honnetete produit un faux vert qui RASSURE.
 */
export function relanceEchecTaise(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.echecTuRecoveryAvailable &&
    exigeDireLEchec(etat.anyActionFailed, etat.visibleTextThisTurn)
  ) {
    etat.relanceDeFormeUtilisee = true
    etat.echecTuRecoveryAvailable = false
    // D2 : la reponse reformulee REMPLACE celle qui taisait l'echec (fluxAffichesCetteIteration).
    return {
      motif: 'echec-taise',
      consignes: [
        'SYSTÈME: au moins une de tes actions a ÉCHOUÉ et ta réponse n’en dit rien. Reformule ' +
          'MAINTENANT, SANS aucune commande : dis EXPLICITEMENT laquelle a échoué et ce que ' +
          'cela empêche. N’écris « Fait » que pour ce qui a RÉELLEMENT abouti — un « ✅ Fait » ' +
          'posé sur un échec est pire que pas de conclusion du tout, parce qu’il rassure à tort. ' +
          'Ta nouvelle réponse REMPLACE la précédente à l’écran : écris-la en entier.'
      ],
      remplace: true
    }
  }
  return undefined
}

// Geste d'écran rendu à l'utilisateur alors que le bureau était piloté (tour c4e319ca).
// fix-ok: ne dépend PAS de relanceDeFormeUtilisee — dans le tour c4e319ca la relance
// « échec tu » part d'abord et éteignait cette garde ; son propre drapeau la borne à 1.
export function relanceGesteRendu(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    exigerExperienceSoignee &&
    etat.gesteRenduRecoveryAvailable &&
    exigeFaireLeGeste(etat.visibleTextThisTurn, etat.bureauUtilise)
  ) {
    etat.gesteRenduRecoveryAvailable = false
    etat.relanceDeFormeUtilisee = true
    return { motif: 'geste-rendu', consignes: [RELANCE_FAIRE_LE_GESTE] }
  }
  return undefined
}

/*
 * DU CODE ÉCRIT SANS PREUVE RETENUE. Une seule fois, et jamais bloquant : si
 * l'agent ne fait rien de la relance, le tour finit normalement et le Board dit vrai. Un tour
 * de fond n'a personne devant lui pour le coût d'un appel de plus.
 * fix-ok: rouge resté en place sans aucune relance, mesuré du 29/10 au 01/11 sur 139 demandes
 * qui ont écrit du code par leurs Edit/Write : 92 finies sur un test rouge, 7 sans aucun test.
 * Faits lus dans `executionEvidence`, seul canal relu à l'identique après un redémarrage.
 */
export function relancePreuveAbsente(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee, sendLimits, workspaceDuTour, recoveredProviderCall } = tour
  const preuveManquante =
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.preuveAbsenteRecoveryAvailable &&
    !sendLimits?.tourDeFond
      ? preuveManquanteDuTour({
          dossier: workspaceDuTour,
          traces: etat.tracesDuTour,
          verifications: etat.verificationsDuTour,
          orchestrationLancee: etat.orchestrationLanceeCeTour,
          verifyRefuse: etat.verifyRefuseCeTour,
          captureRegardee: etat.captureRegardeeCeTour,
          tourEntierVu: (recoveredProviderCall?.iteration ?? 0) === 0
        })
      : undefined
  if (preuveManquante) {
    etat.preuveAbsenteRecoveryAvailable = false
    etat.relanceDeFormeUtilisee = true
    // La réponse relancée REMPLACE celle-ci, comme ses sœurs : une clôture « Fait » resterait
    // sinon affichée au-dessus du rouge que la relance vient de nommer.
    return {
      motif: 'preuve-absente',
      consignes: [relanceDePreuveManquante(preuveManquante, workspaceDuTour)],
      remplace: true
    }
  }
  return undefined
}

/*
 * LA PROMESSE DE COMPTE-RENDU — passe AVANT le bloc visuel, et c'est deliberé : elle porte
 * un TRAVAIL potentiellement perdu (run non recolté), l'autre ne porte qu'un rendu cassé.
 */
export function relancePreuvePromise(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.preuvePromiseRecoveryAvailable &&
    exigePreuveAvantDePromettre(etat.visibleTextThisTurn, etat.anyActionExecuted)
  ) {
    etat.preuvePromiseRecoveryAvailable = false
    etat.relanceDeFormeUtilisee = true
    // D2 : le compte-rendu REMPLACE la promesse — sinon elle reste affichee, dementie juste dessous.
    return {
      motif: 'preuve-promise',
      consignes: [RELANCE_PREUVE_AVANT_DE_PROMETTRE],
      remplace: true
    }
  }
  return undefined
}

/** Un bloc visuel ouvert et jamais fermé : il est ré-émis, et remplace le bloc cassé. */
export function relanceBlocVisuelNonFerme(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.blocVisuelRecoveryAvailable &&
    blocVisuelNonFerme(etat.visibleTextThisTurn)
  ) {
    etat.blocVisuelRecoveryAvailable = false
    etat.relanceDeFormeUtilisee = true
    // D2 : le bloc re-emis REMPLACE le bloc casse, affiche en code brut jusque-la.
    return {
      motif: 'bloc-visuel-non-ferme',
      consignes: [RELANCE_BLOC_VISUEL_NON_FERME],
      remplace: true
    }
  }
  return undefined
}

/**
 * PAS DE CONCLUSION — le tour a agi, mais l'utilisateur ne lit ni ce qui a ete fait, ni la
 * suite. MESURE le 2026-08-15 : 39 conversations de sonde sur 39 finissaient ainsi.
 * Verdict de l'utilisateur : « toutes tes sondes sont des echecs ». Bornee a une relance,
 * comme ses jumelles, et armee seulement si le tour a REELLEMENT agi.
 */
export function relanceConclusionAbsente(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.conclusionFormatRecoveryAvailable &&
    exigeUneConclusion(etat.anyActionExecuted, etat.visibleTextThisTurn)
  ) {
    etat.relanceDeFormeUtilisee = true
    etat.conclusionFormatRecoveryAvailable = false
    // D2 : la reponse reformulee REMPLACE celle-ci dans le fil (voir fluxAffichesCetteIteration).
    return { motif: 'conclusion-absente', consignes: [RELANCE_CONCLUSION_ABSENTE], remplace: true }
  }
  return undefined
}

// Passe APRÈS la conclusion : c'est la réponse finale qu'on corrige, et une seule fois.
export function relanceCheminsIncomplets(tour: ContexteDuTour): Relance | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.cheminsCompletsRecoveryAvailable &&
    cheminsRelatifsCites(etat.visibleTextThisTurn).length
  ) {
    etat.cheminsCompletsRecoveryAvailable = false
    etat.relanceDeFormeUtilisee = true
    // D2 : la réponse aux chemins complets REMPLACE celle-ci dans le fil.
    return {
      motif: 'chemin-incomplet',
      consignes: [relanceCheminsComplets(cheminsRelatifsCites(etat.visibleTextThisTurn))],
      remplace: true
    }
  }
  return undefined
}

/** Une question posée sans rien avoir lu : relancée une fois (deux sites dans chat()). */
export function relanceQuestionSansLecture(etat: EtatDuTour): Relance | undefined {
  if (
    etat.questionSansLectureRecoveryAvailable &&
    questionPoseeSansAvoirLu(etat.questionPoseeCeTour, etat.anyReadExecuted)
  ) {
    etat.questionSansLectureRecoveryAvailable = false
    return { motif: 'question-sans-lecture', consignes: [RELANCE_QUESTION_SANS_LECTURE] }
  }
  return undefined
}

/**
 * UN CHIFFRE DONNE SANS AVOIR RIEN LU — le symetrique du tour muet, et aussi trompeur.
 *
 * MESURE en pilotant l'app le 2026-08-15, sur deux series de 10 sondes a verite terrain :
 * 19 reussites sur 20, et l'UNIQUE echec repond en 3 secondes — trop vite pour avoir liste
 * quoi que ce soit. La question identique avait reussi en 8 s dans la meme serie : ce n'est
 * donc pas une capacite manquante mais une VARIANCE, l'agent devinant au lieu d'appeler.
 *
 * Le prompt l'interdit deja en toutes lettres (« RÈGLE ABSOLUE — si la question demande un
 * NOMBRE… tu appelles une commande de lecture AVANT de repondre »). Il a quand meme devine.
 * Ce depot connait la lecon, elle est ecrite au-dessus pour le tour muet : un correctif
 * DECLARATIF ne garantit rien, seule une relance MECANIQUE tient.
 *
 * Bornee a une fois, comme sa jumelle, et strictement additive : elle ne peut que demander
 * une verification, jamais modifier une reponse deja verifiee.
 */
export function relanceChiffreNonVerifie(tour: ContexteDuTour): Relance | undefined {
  const { etat, latestUserMessage, history } = tour
  if (
    etat.chiffreNonVerifieRecoveryAvailable &&
    exigeUnChiffreVerifie(
      latestUserMessage,
      etat.visibleTextThisTurn,
      etat.anyReadExecuted || etat.sortieDeCommandeObservee,
      // Une réponse recollée dans son message n'est pas SA demande de compte.
      history.filter((message) => message.role === 'assistant').map((message) => message.content)
    )
  ) {
    etat.chiffreNonVerifieRecoveryAvailable = false
    // D2 : la reponse verifiee REMPLACE celle-ci dans le fil — d'ou la consigne de la redonner
    // EN ENTIER (« corrige-toi » supposait une premiere reponse restee affichee).
    return {
      motif: 'chiffre-non-verifie',
      consignes: [RELANCE_CHIFFRE_NON_VERIFIE],
      remplace: true
    }
  }
  return undefined
}

/*
 * RACCOURCI `remember` — texte livré + dépôt de mémoire dans le même message. Ses trois contrôles
 * ne rejouent pas l'itération tout de suite : ils accordent la rallonge (motif rendu à chat()) et
 * laissent leur consigne dans l'état, poussée après les résultats par `consignesDifferees`.
 */

/*
 * LE RACCOURCI NE DOIT PAS AVALER LA GARDE DE CLOTURE.
 *
 * Mesure (2026-09-01) : « j'ai pas eu de bloc de fin ». `exigeUneConclusion` vit dans
 * la branche SANS commande (plus haut) ; ce `return` la rendait INATTEIGNABLE des qu'un tour
 * finit par « texte + remember » — le cas le plus courant d'un tour de kaizen, qui depose
 * justement sa lecon en dernier. Le tour se cloturait sur une phrase d'intention, sans ✅ Fait
 * et sans reste a faire. On rend la parole UNE fois, pour la seule cloture ; l'economie voulue
 * (ne pas repayer une generation pour commenter un refus) reste entiere quand le texte livre
 * conclut deja.
 */
export function relanceClotureApresRemember(
  tour: ContexteDuTour,
  onlyAuxiliaryRemember: boolean,
  spoken: string
): MotifDeRallonge | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    onlyAuxiliaryRemember &&
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.conclusionFormatRecoveryAvailable &&
    exigeUneConclusion(true, spoken)
  ) {
    etat.relanceDeFormeUtilisee = true
    etat.conclusionFormatRecoveryAvailable = false
    etat.consigneClotureApresRemember = true
    return 'conclusion-absente'
  }
  return undefined
}

/** Dépôt `remember` refusé : la main est rendue aux commandes, une fois, avec le motif exact. */
export function relanceRepriseRemember(
  etat: EtatDuTour,
  onlyAuxiliaryRemember: boolean
): MotifDeRallonge | undefined {
  if (
    onlyAuxiliaryRemember &&
    etat.refusRememberAuxiliaire &&
    etat.repriseRememberRefuseDisponible
  ) {
    // REFUS REPARABLE : on ne clot pas, on rend la main aux commandes (voir
    // `repriseRememberRefuseDisponible`). La consigne part au bout de l'iteration, avec les
    // RESULTATS reels — le modele lit donc le motif exact, pas un resume.
    etat.repriseRememberRefuseDisponible = false
    etat.consigneRepriseRemember =
      'SYSTÈME: ton dépôt de mémoire a été REFUSÉ (' +
      etat.refusRememberAuxiliaire +
      ') — RIEN n’a été écrit, malgré ce que ton texte annonce. Corrige la CAUSE du refus dans ' +
      'les arguments (portée du projet ou « global », type parmi lesson/decision/preference/' +
      'domain, source tracée) et RÉ-ÉMETS `remember` MAINTENANT. Si le refus n’est pas ' +
      'réparable, dis-le explicitement dans ta clôture au lieu de le taire. REPRENDS aussi ta ' +
      'conclusion EN ENTIER dans ce nouveau message : lui seul sera affiché à l’utilisateur, le ' +
      'texte précédent ne sera pas conservé.'
    return 'correction-apres-echec'
  }
  return undefined
}

// Même raccourci, même risque que la clôture ci-dessus : un tour qui finit par retenir une
// leçon échapperait sinon au contrôle des chemins.
export function relanceCheminsApresRemember(
  tour: ContexteDuTour,
  onlyAuxiliaryRemember: boolean,
  spoken: string
): MotifDeRallonge | undefined {
  const { etat, exigerExperienceSoignee } = tour
  if (
    onlyAuxiliaryRemember &&
    exigerExperienceSoignee &&
    !etat.relanceDeFormeUtilisee &&
    etat.cheminsCompletsRecoveryAvailable &&
    cheminsRelatifsCites(spoken).length
  ) {
    etat.cheminsCompletsRecoveryAvailable = false
    etat.relanceDeFormeUtilisee = true
    etat.consigneCheminsApresRemember = relanceCheminsComplets(cheminsRelatifsCites(spoken))
    return 'chemin-incomplet'
  }
  return undefined
}

/** Consignes laissées par le raccourci `remember`, poussées APRÈS les résultats de l'itération. */
export function consignesDifferees(
  etat: EtatDuTour
): Array<{ consigne: string; remplace: boolean }> {
  const differees: Array<{ consigne: string; remplace: boolean }> = []
  if (etat.consigneClotureApresRemember) {
    etat.consigneClotureApresRemember = false
    // D2 : meme relance, meme remplacement — la carte `remember` reste, seul le texte part.
    differees.push({ consigne: RELANCE_CONCLUSION_ABSENTE, remplace: true })
  }
  if (etat.consigneCheminsApresRemember) {
    differees.push({ consigne: etat.consigneCheminsApresRemember, remplace: true })
    etat.consigneCheminsApresRemember = undefined
  }
  if (etat.consigneRepriseRemember) {
    differees.push({ consigne: etat.consigneRepriseRemember, remplace: false })
    etat.consigneRepriseRemember = undefined
  }
  return differees
}
