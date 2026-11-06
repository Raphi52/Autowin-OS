// État mutable d'un tour de chat : les drapeaux, compteurs et registres que la boucle d'itérations
// de AgentPilot.chat() partage avec ses closures. Sortis tels quels de chat() — noms, valeurs
// initiales et commentaires — (conv-1580, lot 3) : chat() les lit et les écrit sous `etat.<nom>`,
// et les modules voisins prennent cet objet en paramètre au lieu de capturer une soixantaine de `let`.
import type { EtatPrompt } from '../chat/etat-diff'
import type { ExecutionEvidence, Message } from '../providers/types'
import { chargerMurs } from '../runs/murs-store'
import type { TurnUsage } from './evenements'

export interface EtatDuTour {
  timingWritten: boolean
  // Autorite du tour : une demande utilisateur ne peut ouvrir qu'un run. Une reparation ou reprise
  // appartient au controleur du run courant ; un second run exige un nouveau message utilisateur.
  orchestrationIssued: boolean
  /**
   * L'ISSUE de l'orchestration jouee dans ce tour, gardee pour la joindre au `done` FINAL.
   *
   * Le tour n'est plus clos mecaniquement sur cette issue (le modele redige desormais la cloture),
   * mais la comptabilite en aval — persistance du texte de cloture, cout, tracabilite — lit
   * `done.outcome`. La perdre en rendant la parole au modele aurait casse ces consommateurs sans
   * qu'aucun texte affiche ne le montre.
   */
  orchestrationOutcome: Record<string, unknown> | undefined
  /**
   * Le REFUS d'un `remember` auxiliaire, garde pour ne pas etre avale par la cloture muette.
   *
   * `onlyAuxiliaryRemember` clot le tour sans rendre la main au modele — economie voulue. Mais
   * il jetait AUSSI l'issue du depot : un refus deterministe (type inconnu, source invalide,
   * Brain injoignable) disparaissait, et le modele venait d'ecrire « je retiens ca ». Vecu le
   * 31/08 (conv-1569) : deux tentatives, aucun retour, l'utilisateur constate « ca a pas marche »
   * alors que rien dans le fil ne le disait. On ne repaie pas une generation : on AJOUTE la
   * verite au texte deja livre.
   */
  refusRememberAuxiliaire: string | undefined
  /** Un `remember` accepté ou une note de mémoire écrite CE tour : une « Leçon : » est retenue. */
  depotMemoireCeTour: boolean
  /** Le raccourci `remember` a AVALE la garde de cloture : une relance est due (voir plus bas). */
  consigneClotureApresRemember: boolean
  /** Texte + `remember` avec un chemin relatif : la réponse est refaite (conv-1335). */
  consigneCheminsApresRemember: string | undefined
  /**
   * UN DEPOT REFUSE SE CORRIGE, il ne se CONSTATE pas. Bornee a une reprise.
   *
   * Mesure conv-49 (2026-09-01, capture de l'utilisateur) : `remember` refuse pour « portee
   * manquante », tour CLOS sur « ⚠️ Memoire NON deposee ». Le motif partait a l'utilisateur mais
   * JAMAIS au modele, qui ne pouvait donc pas ajouter la portee manquante — un refus pourtant
   * reparable en un seul argument. Verdict de l'utilisateur : « il doit se rendre compte quand ca
   * foire et corriger avant de passer a la suite ». On rend la main aux commandes UNE fois ; si la
   * reprise echoue a son tour, la cloture dit le refus comme avant.
   */
  repriseRememberRefuseDisponible: boolean
  /** La consigne de reprise du depot refuse, poussee au bout de l'iteration. */
  consigneRepriseRemember: string | undefined
  /**
   * Le compte-rendu AUTORITATIF de cette orchestration, garde comme REPLI.
   *
   * Contrepartie indispensable de la parole rendue au modele : un modele qui n'ecrit rien — ou qui
   * s'obstine a redemander une orchestration, refusee par `orchestrationIssued` — brulait les
   * iterations jusqu'a « Cap d'iterations atteint sans reponse finale », et l'utilisateur perdait le
   * compte-rendu qu'il avait AVANT ce changement, au prix d'un run complet. Le modele a la parole ;
   * il n'a pas le pouvoir de faire disparaitre le resultat.
   */
  compteRenduOrchestration: string | undefined
  /**
   * La session VIVANTE du tour : elle avance d'itération en itération.
   *
   * `resumeSessionId` décrit l'état AU DÉBUT du tour et sert à décider de l'amputation du prompt ;
   * il doit rester figé pour ça. Mais l'appel, lui, doit reprendre la dernière session réellement
   * ouverte — sinon la 2e itération repart à blanc (voir le bloc d'options plus bas).
   */
  sessionEnCours: string | undefined
  /**
   * Compte Claude qui a ouvert `sessionEnCours` (conv-1063). Une session CLI vit dans le dossier
   * de SON compte : dès que le compte actif diffère — bascule à la main pendant le tour, ou rotation
   * après un quota épuisé —, la reprendre rend « No conversation found » et le tour meurt.
   */
  compteDeSession: string | undefined
  /** Comptes dont le quota est tombé PENDANT ce tour : jamais de rejeu vers l'un d'eux. */
  readonly comptesEpuisesCeTour: Set<string>
  /**
   * REPLI APRES UN REFUS DU FILTRE DE SECURITE (`deciderRepliApresRefus`) : joue UNE fois par tour.
   * Le modele voisin reste celui du tour une fois choisi : le message refuse est desormais dans la
   * session, revenir au modele qui l'a refuse a l'iteration suivante rejouerait le meme refus.
   */
  repliApresRefusTente: boolean
  modeleApresRefus: string | undefined
  // Combien de segments de `convo` ont DÉJÀ été expédiés dans ce tour (voir la construction du
  // message plus bas) : au-delà, la session reprise les porte déjà.
  segmentsDejaEnvoyes: number
  /**
   * Les blocs d'ouverture de `convo` sont-ils encore ceux d'une REPRISE (historique absent, diff
   * d'état) ? Ils ne se reconstruisent qu'une fois par tour, et `blocsInitiaux` suit leur nombre
   * pour que cette reconstruction remplace exactement eux, jamais un échange intra-tour.
   */
  blocsInitiauxAmputes: boolean
  blocsInitiaux: number

  // Coût cumulé du tour (toutes les itérations LLM du même message utilisateur). `derniereEntree`
  // n'est PAS cumulée : voir `TurnUsage`.
  readonly usage: TurnUsage & { costUsd: number }

  iterationLimit: number
  invalidQuestionRecoveryAvailable: boolean
  /**
   * TOUR MUET — un tour qui n'a produit que des etiquettes d'action est inexploitable.
   *
   * Constate sur conv-76 (2026-07-29) : trois messages assistant de 40 a 64 caracteres, contenant
   * uniquement « [a execute edit_file] [a execute verify] ». L'utilisateur ne pouvait pas savoir ce
   * qui avait ete fait — il a cru que les sous-agents ne se lançaient plus alors que 18 appels
   * avaient tourne pour 10,05 $. Le prompt demande deja de conclure ; le modele ne le fait pas
   * toujours. On le rend donc MECANIQUE : si le tour se termine sans un mot alors qu'il a AGI, on
   * redemande explicitement la conclusion. Une seule fois, comme la reprise de question invalide.
   */
  anyActionExecuted: boolean
  /**
   * Un outil NATIF qui agit (Write, Edit, Bash non lecteur) a tourne dans ce tour. Separe de
   * `anyActionExecuted` a dessein : il ne sert qu'au garde « annonce sans action » (fausse alerte
   * du 2026-09-22, conv-782), sans changer les autres gardes fondes sur les `<cmd>` Autowin.
   */
  actionNativeCeTour: boolean
  /** Le modele a emis `<cmd>` dans ce tour (lu ou non) — sert au repli de cloture. */
  cmdEmisCeTour: boolean
  /**
   * A-t-il parle A UN MOMENT du tour ? La question porte sur le TOUR ENTIER, pas sur la derniere
   * iteration : un tour « Avant. <action> Apres. » suivi d'une reponse vide a deja tout dit, le
   * relancer serait du bavardage paye. (Bug attrape par agent-pilot.streaming.test.ts.)
   */
  anySpokenText: boolean
  conclusionRecoveryAvailable: boolean
  /** Une LECTURE a-t-elle eu lieu ? Un chiffre sans lecture est une supposition, pas une reponse. */
  anyReadExecuted: boolean
  /**
   * Un `run` ou un `verify` a-t-il VRAIMENT tourne (`commandeAObserveLeReel`) ? Compte comme une
   * lecture pour la SEULE garde « chiffre non verifie » (conv-267) : la garde « question sans
   * lecture » garde son critere, qui n'etait pas en cause.
   */
  sortieDeCommandeObservee: boolean
  /**
   * Artefacts DEJA publies dans le fil pendant ce tour, par identifiant.
   *
   * Un artefact arrive deux fois : une premiere en direct (flux du provider, a sa place
   * chronologique) puis une seconde dans le resultat final du meme appel. L'identifiant est
   * deterministe (empreinte du contenu), donc cet ensemble suffit a n'en afficher qu'un.
   */
  readonly artefactsDejaEmis: Set<string>
  /**
   * VIDÉO LIVRÉE = VIDÉO MONTRÉE (conv-253, constat conv-260) : une vidéo citée dans la réponse et
   * écrite depuis ce début de tour arrive dans le lecteur du fil, sans `show_video`. L'ensemble
   * retient celles déjà montrées (par la commande ou ici) pour n'en afficher qu'un lecteur.
   */
  readonly debutDuTourMs: number
  readonly videosDejaMontrees: Set<string>
  /**
   * Une QUESTION a-t-elle ete posee ce tour ? Mesure (conv-1399) : une question a
   * quatre options posee sans avoir lu un seul fichier, dont une option DEJA implementee et
   * committee. L'utilisateur a attendu pour une reponse qui etait a portee de lecture.
   */
  questionPoseeCeTour: boolean
  /** La question posée est celle des deux lectures : aucune relance « question sans lecture ». */
  questionDesLecturesPosee: boolean
  /**
   * La reponse que l'utilisateur a envoyee PENDANT que le tour posait sa question. Non vide = la
   * question est deja repondue : on ne la repose pas et on ne clot pas le tour sur elle.
   */
  reponseTardiveAUneQuestion: string | undefined
  questionSansLectureRecoveryAvailable: boolean
  /** Dernier texte visible du tour, pour juger s'il avance un nombre non verifie. */
  visibleTextThisTurn: string
  // Index de l'itération pour laquelle la consigne de clôture forcée a déjà été injectée.
  consigneClotureInjectee: number
  chiffreNonVerifieRecoveryAvailable: boolean
  conclusionFormatRecoveryAvailable: boolean
  /**
   * UNE SEULE relance de FORME par tour, toutes gardes confondues.
   *
   * Sans ce verrou commun, elles s'enchainent : le tour muet est relance, sa reponse n'a pas encore
   * de bloc de cloture, la garde suivante repart, puis celle de l'echec tu — trois iterations
   * payantes pour un seul tour, et une sortie qui ne ressemble plus a rien. Constate le 2026-08-15 :
   * quatre fichiers de tests d'`agent-pilot` sont tombes d'un coup pour cette raison.
   *
   * Chaque garde reste bornee a une fois par elle-meme ; ce verrou borne l'ENSEMBLE.
   */
  relanceDeFormeUtilisee: boolean
  /** Une action de CE tour a-t-elle echoue ? Un « Fait » pose dessus serait un mensonge. */
  anyActionFailed: boolean
  /*
   * L'echec de la DERNIERE iteration, distinct de `anyActionFailed` qui cumule tout le tour.
   * Une commande plantee puis rejouee avec succes doit desarmer la reprise : c'est exactement
   * le comportement qu'on veut encourager, pas un motif de relance.
   */
  echecDeLaDerniereIteration: boolean
  /*
   * LES ECHECS ENCORE NON REPARES, par nom de commande. Demande de l'utilisateur du 2026-08-22 :
   * « toutes les actions avec erreur captees en cours de run et corrigees avant la fin du tour ».
   *
   * `echecDeLaDerniereIteration` ne suffisait pas : remis a plat a chaque iteration, il laissait un
   * echec enjambe a l'iteration 2 sortir du champ de la correction des l'iteration 3. Cet echec
   * tombait alors dans l'aveu, qui reformule « SANS aucune commande » — capte, mais explicitement
   * NON corrige.
   *
   * Le suivi se fait par NOM DE COMMANDE et non par signature : une signature agrege le nom ET le
   * texte d'erreur, donc un succes ulterieur ne peut jamais s'y apparier. C'est aussi exactement
   * l'intention deja ecrite pour le drapeau jumeau — « une commande plantee puis rejouee avec
   * succes doit desarmer la reprise » — simplement tenue sur tout le tour au lieu d'une iteration.
   */
  readonly commandesEnEchecNonRattrape: Set<string>
  /*
   * LE LIEN DE REPRISE. Pour chaque cible encore en echec, l'`actionId` de l'action QUI A ECHOUE.
   * Quand une action reussit sur la MEME clef (nom + argument identifiant, cf. `cleDEchec`), le
   * resultat emis porte `retryOf` = cet identifiant : le journal montre alors explicitement quel
   * echec a ete rattrape, au lieu de laisser deviner par voisinage.
   */
  readonly actionIdParEchec: Map<string, string>
  /*
   * AUTO-KAIZEN EN COURS DE TOUR. Le registre des murs deja rencontres : sans lui, corriger-et-
   * poursuivre autorise le pire des retours — rejouer la meme commande, remanger le meme mur, et
   * bruler les iterations dans un trou de lapin. DEUX reprises au plus : la correction, puis UNE
   * escalade qui interdit la repetition et exige de capitaliser la lecon.
   *
   * FILET, non exerce par les tests, et c'est dit exprès : mesure du 2026-08-21, en portant ce
   * compteur a 99 le nombre de reprises observe ne bouge pas — le verrou d'escalade (mur repete)
   * ou le flux lui-meme (murs distincts) borne toujours en premier. Il est garde comme garde-fou
   * d'un chemin non enumere, pas presente comme le mecanisme de bornage.
   */
  reprisesApresEchecRestantes: number
  /*
   * RALLONGES DE DIRECTIVE TARDIVE — BORNEES. Une directive arrivee pendant l'appel provider
   * merite bien une iteration de plus : c'est l'utilisateur qui parle, et sa phrase doit pouvoir
   * etre traitee dans le tour. Mais l'incrément etait le SEUL des 13 motifs de rallonge sans
   * garde : un appelant qui fixe une borne finie (`policy.maxIterations`, un harnais de test)
   * pouvait la voir reculer indefiniment, puisque le cap grandit exactement aussi vite que la
   * boucle avance. En production le defaut est invisible — `CAP_ITERATIONS_TOUR` vaut l'infini
   * depuis le 2026-09-04, donc `+ 1` n'y change rien — mais une borne qui ne borne pas n'est pas
   * une borne. Au-dela du budget, la directive est TOUJOURS injectee dans la conversation : seule
   * la rallonge du cap s'arrete. On ne perd donc aucune parole de l'utilisateur.
   */
  rallongesDirectiveTardiveRestantes: number
  /*
   * AMORCE depuis le disque : sans elle le registre mourait a la frontiere du tour, et l'agent
   * remangeait le meme mur au tour suivant en croyant le decouvrir. `chargerMurs` est fail-open —
   * un cache illisible vaut « aucun mur connu », jamais une exception dans le tour.
   */
  readonly signaturesDEchecVues: string[]
  derniereSignatureDEchec: string
  dernierEchecEstUnRejeu: boolean
  echecTuRecoveryAvailable: boolean
  /** Une seule relance pour un outil faussement declare absent : au-dela, on n'insiste pas. */
  outilAbsentRecoveryAvailable: boolean
  annonceSansActionRecoveryAvailable: boolean
  /** Une clôture qui promet un compte-rendu futur : relance UNE fois, jamais plus. */
  preuvePromiseRecoveryAvailable: boolean
  gesteRenduRecoveryAvailable: boolean
  bureauUtilise: boolean
  /**
   * LES FAITS DE LA RELANCE DE PREUVE (conv-1423) : ils ne viennent ni du texte ni des battements
   * d'outils, perdus au redémarrage, mais des traces de chaque appel, que le journal relu rend à
   * l'identique. Un tour repris à une itération > 0 a perdu les précédentes (`tourEntierVu`).
   */
  readonly tracesDuTour: ExecutionEvidence[]
  readonly verificationsDuTour: { commande: string; ok: boolean; at: number }[]
  orchestrationLanceeCeTour: boolean
  verifyRefuseCeTour: boolean
  captureRegardeeCeTour: boolean
  preuveAbsenteRecoveryAvailable: boolean
  /*
   * OUTILS DIRECTS DU MODELE (`chat-mcp.ts`) — etat de l'iteration COURANTE.
   *
   * Les appels directs ont lieu PENDANT l'envoi ; la boucle des `<cmd>` vient apres. On retient
   * donc ce qu'ils ont execute (pour ne pas rejouer un `<cmd>` identique de la meme reponse, y
   * compris d'une tentative precedente du meme envoi) et s'ils ont echoue (la boucle des `<cmd>`
   * remet ces drapeaux a plat : elle doit reporter ceux des appels directs, pas les effacer).
   */
  executesParCanalNatif: Set<string>
  echecNatifCetteIteration: boolean
  /*
   * Les echecs directs de CETTE iteration encore NON rattrapes, par nom + cible (`cleDEchec`).
   * Un tour d'outils directs tient en UN envoi : le modele y voit chaque resultat et rejoue sur
   * place. Lever le drapeau au premier rouge sans jamais le baisser au vert relancait « ta
   * derniere action a ECHOUE » apres une reparation deja faite (conv-302, 2026-10-17, tour
   * 1201313c : typecheck rouge puis vert dans la meme reponse). Le drapeau suit donc ce registre.
   */
  readonly echecsNatifsNonRattrapes: Set<string>
  rejeuNatifCetteIteration: boolean
  iterationNatif: number
  appelNatifIndex: number
  /*
   * L'APPEL EN COURS A-T-IL ÉCRIT DEPUIS SON DERNIER GESTE (outil direct, image) ? Une relance qui
   * refait la conclusion n'efface que ce dernier passage ; s'il est vide, elle n'efface rien — le
   * texte d'avant est le récit du travail, pas la conclusion (conv-1401, 2026-10-31).
   */
  gesteDansLAppel: boolean
  texteApresLeDernierGeste: boolean
  readonly replisNatifsDits: Set<string>
  /** Une fence ```html-render laissée ouverte : relance UNE fois, jamais plus. */
  blocVisuelRecoveryAvailable: boolean
  /** Un chemin relatif cité à l'utilisateur : relance UNE fois, jamais plus (conv-1335). */
  cheminsCompletsRecoveryAvailable: boolean
  /**
   * BLOC `<cmd>` INEXPLOITABLE ET AUCUNE COMMANDE VALIDE — le TOUR PARASITE.
   *
   * Mesure sur `conv-1472` (2026-08-27, tour `c73fd638`) : le modele emet
   * `<cmd>{"name":"orchestrate","args":{...}` — une accolade fermante MANQUANTE. Le parseur en fait
   * bien un token `invalid`, mais le signalement (evenement visible + reinjection) vivait
   * EXCLUSIVEMENT dans la boucle d'execution, gardee par `hasCommand` qui ne compte QUE les tokens
   * `command`. Resultat : le bloc brut s'affichait tel quel, RIEN n'etait execute, aucune relance
   * n'etait armee, et le tour se cloturait sur « Je lance la fusion en build. » — l'utilisateur
   * devait retaper « go ». Une relance MECANIQUE, bornee a une fois, rend la main aux commandes.
   */
  commandeIllisibleRecoveryAvailable: boolean
  commandAttachments: NonNullable<Message['attachments']>
  // L'etat ENTIER part deja dans le premier message du tour : les iterations suivantes n'en
  // repoussent que le DELTA (voir `etat-diff.ts`).
  dernierEtatEnvoye: EtatPrompt
}

/**
 * Les valeurs initiales de l'état, dans l'ordre où chat() les déclarait : `Date.now()` puis
 * `chargerMurs` sont évalués dans ce même ordre, après les retours anticipés du tour (question des
 * deux lectures, route sans modèle), comme avant (conv-1580, lot 3).
 */
export function etatInitialDuTour(entree: {
  resumeSessionId: string | undefined
  compteAuDepart: string | undefined
  blocsDuTour: ArrayLike<unknown>
  maxIter: number
  conversationId: string | undefined
  snapshot: EtatPrompt
}): EtatDuTour {
  const { resumeSessionId, compteAuDepart, blocsDuTour, maxIter, conversationId, snapshot } = entree
  return {
    timingWritten: false,
    orchestrationIssued: false,
    orchestrationOutcome: undefined,
    refusRememberAuxiliaire: undefined,
    depotMemoireCeTour: false,
    consigneClotureApresRemember: false,
    consigneCheminsApresRemember: undefined,
    repriseRememberRefuseDisponible: true,
    consigneRepriseRemember: undefined,
    compteRenduOrchestration: undefined,
    sessionEnCours: resumeSessionId,
    compteDeSession: compteAuDepart,
    comptesEpuisesCeTour: new Set<string>(),
    repliApresRefusTente: false,
    modeleApresRefus: undefined,
    segmentsDejaEnvoyes: 0,
    blocsInitiauxAmputes: Boolean(resumeSessionId),
    blocsInitiaux: blocsDuTour.length,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    iterationLimit: maxIter,
    invalidQuestionRecoveryAvailable: true,
    anyActionExecuted: false,
    actionNativeCeTour: false,
    cmdEmisCeTour: false,
    anySpokenText: false,
    conclusionRecoveryAvailable: true,
    anyReadExecuted: false,
    sortieDeCommandeObservee: false,
    artefactsDejaEmis: new Set<string>(),
    debutDuTourMs: Date.now(),
    videosDejaMontrees: new Set<string>(),
    questionPoseeCeTour: false,
    questionDesLecturesPosee: false,
    reponseTardiveAUneQuestion: undefined,
    questionSansLectureRecoveryAvailable: true,
    visibleTextThisTurn: '',
    consigneClotureInjectee: -1,
    chiffreNonVerifieRecoveryAvailable: true,
    conclusionFormatRecoveryAvailable: true,
    relanceDeFormeUtilisee: false,
    anyActionFailed: false,
    echecDeLaDerniereIteration: false,
    commandesEnEchecNonRattrape: new Set<string>(),
    actionIdParEchec: new Map<string, string>(),
    reprisesApresEchecRestantes: 2,
    rallongesDirectiveTardiveRestantes: 3,
    signaturesDEchecVues: conversationId ? chargerMurs(conversationId) : [],
    derniereSignatureDEchec: '',
    dernierEchecEstUnRejeu: false,
    echecTuRecoveryAvailable: true,
    outilAbsentRecoveryAvailable: true,
    annonceSansActionRecoveryAvailable: true,
    preuvePromiseRecoveryAvailable: true,
    gesteRenduRecoveryAvailable: true,
    bureauUtilise: false,
    tracesDuTour: [],
    verificationsDuTour: [],
    orchestrationLanceeCeTour: false,
    verifyRefuseCeTour: false,
    captureRegardeeCeTour: false,
    preuveAbsenteRecoveryAvailable: true,
    executesParCanalNatif: new Set<string>(),
    echecNatifCetteIteration: false,
    echecsNatifsNonRattrapes: new Set<string>(),
    rejeuNatifCetteIteration: false,
    iterationNatif: 0,
    appelNatifIndex: 0,
    gesteDansLAppel: false,
    texteApresLeDernierGeste: false,
    replisNatifsDits: new Set<string>(),
    blocVisuelRecoveryAvailable: true,
    cheminsCompletsRecoveryAvailable: true,
    commandeIllisibleRecoveryAvailable: true,
    commandAttachments: [],
    dernierEtatEnvoye: snapshot
  }
}
