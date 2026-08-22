/**
 * ASSEMBLAGE DU MESSAGE D'UN TOUR DE CHAT — extrait pour être VÉRIFIABLE.
 *
 * Ce qui vit ici y vit pour une raison précise : tout contenu qui DÉPEND du tour (état de l'app, contexte
 * récupéré, écho de mémoire) doit voyager dans le MESSAGE et jamais dans le prompt système. Mesuré le
 * 2026-07-28 : tant qu'un contenu variable était concaténé au système, `cache_read` valait 0 sur 100 % des
 * appels — ~16 k de cache réécrits à chaque tour pour répondre une phrase.
 *
 * L'extraction est née d'un défaut d'AUDIT, pas d'un goût pour l'abstraction : la présence de l'écho de
 * mémoire n'était prouvée que par un test qui LISAIT le source (`toContain('sessionMemoryBlock')`). Un tel
 * test survit à un câblage cassé. Ici l'invariant se teste sur la sortie réelle de la fonction.
 */

export interface TurnMessageParts {
  /** État courant de l'app, sérialisé. */
  snapshot: unknown
  /** Bloc de connaissance récupérée (Brain + graphe), déjà mis en forme. Peut être vide. */
  brainContext: string
  /** Écho des faits retenus dans ce fil. Peut être vide. */
  memoryEcho: string
  /**
   * Corps de la skill invoquée en tête du message (`/remake …`), déjà mis en forme. Vide sinon.
   *
   * Ici et non dans le `system`, pour la raison qui gouverne tout ce fichier : ce contenu APPARAÎT et
   * DISPARAÎT selon le tour, donc le mettre dans le préfixe le réécrirait à chaque invocation et tuerait
   * le cache. Conséquence voulue : le coût d'une skill n'est payé que quand elle est demandée.
   */
  skillBody?: string
  /** Le fil complet, utilisé quand aucune session CLI n'est reprise. */
  history: ReadonlyArray<{ role: string; content: string }>
  /** Renseigné quand une session CLI existante est reprise : le modèle connaît déjà l'historique. */
  resumeSessionId?: string
  /** Dernier message utilisateur — le seul renvoyé quand la session est reprise. */
  lastUserMessage?: string
  /**
   * Compte-rendu d'un tour que le modèle n'a JAMAIS vu, à réinjecter quand la session est reprise.
   *
   * Constaté par l'utilisateur le 2026-08-14, dans son fil : « je vois bien qu'un `orchestrate` a été
   * lancé dans cette conversation, mais la trace fournie ne contient ni son `runId`, ni ses phases, ni
   * son résultat ». La route `explicit-skill` d'`agent-pilot` exécute l'orchestration ELLE-MÊME puis
   * rend la main AVANT tout appel au modèle : la bulle affichée est rédigée par du code. Le tour
   * suivant reprenant la session CLI et n'envoyant que le dernier message, ce tour est absent de son
   * transcript — et on lui AFFIRMAIT pourtant qu'il connaissait déjà l'historique.
   *
   * C'est le cas frère de « RESUME FANTÔME » (`agent-pilot`, mesuré le 2026-08-04 : 0 appel réellement
   * repris, 31 prompts amputés) : ne jamais prétendre au modèle qu'il sait ce qu'on ne peut pas garantir.
   */
  compteRenduNonVu?: string
  /** Ce tour REPREND un tour coupe net pour laisser passer le dernier message utilisateur. */
  tourCoupePourCeMessage?: boolean
}

/**
 * Borne l'historique sans laisser une réponse assistant privée de sa question en tête.
 *
 * Un tour entrant contient normalement `2n + 1` messages (les paires précédentes, puis la nouvelle
 * question). Une tranche paire comme `slice(-40)` commence alors par la dernière réponse du tour
 * écarté. On conserve la même borne puis on réaligne uniquement le début sur le prochain utilisateur.
 */
export function boundedTurnHistory<T extends { role: 'user' | 'assistant' }>(
  history: readonly T[],
  maxMessages = 40
): T[] {
  if (!Number.isInteger(maxMessages) || maxMessages <= 0) return []
  const tail = history.slice(-maxMessages)
  const firstUser = tail.findIndex((message) => message.role === 'user')
  return firstUser < 0 ? [] : tail.slice(firstUser)
}

/**
 * Variante pour une continuation dont le dernier `user` est une instruction transport interne.
 * Le dernier vrai prompt humain reste l'ancre de permissions/RAG, même s'il tombe hors de la borne.
 */
export function boundedContinuationHistory<T extends { role: 'user' | 'assistant' }>(
  history: readonly T[],
  maxMessages = 40
): { history: T[]; routingUserMessage?: T } {
  const priorMessages = history.slice(0, -1)
  const routingUserMessage = [...priorMessages].reverse().find((message) => message.role === 'user')
  const bounded = boundedTurnHistory(history, maxMessages)
  if (!routingUserMessage || !Number.isInteger(maxMessages) || maxMessages <= 0)
    return { history: bounded, routingUserMessage }
  if (bounded.includes(routingUserMessage)) return { history: bounded, routingUserMessage }
  if (maxMessages === 1) return { history: [routingUserMessage], routingUserMessage }

  return {
    history: [routingUserMessage, ...history.slice(-(maxMessages - 1))],
    routingUserMessage
  }
}

/**
 * Rend les entrées du message, dans l'ordre, sans aucune entrée vide.
 *
 * Une entrée vide (pas de contexte récupéré, pas d'écho) laisserait un trou de deux sauts de ligne dans
 * le prompt final : on filtre, on ne laisse pas le hasard décider.
 */
export function buildTurnMessages(parts: TurnMessageParts): string[] {
  const nonVu = parts.compteRenduNonVu?.trim()
  const entries = parts.resumeSessionId
    ? [
        `ÉTAT DE L'APP:\n${JSON.stringify(parts.snapshot)}`,
        parts.brainContext,
        parts.memoryEcho,
        parts.skillBody ?? '',
        // La phrase CHANGE quand un tour manque : garder « tu connais déjà l'historique » au-dessus
        // d'un tour jamais vu serait conserver le mensonge tout en ajoutant le remède.
        nonVu
          ? `Suite de NOTRE conversation en cours. Ta session en contient l'historique, À UNE EXCEPTION : le tour ci-dessous a été exécuté par l'application SANS passer par toi, il est donc absent de ta session. Traite-le comme un fait établi de cette conversation.\n\nTOI (tour exécuté par l'app, hors de ta session):\n${nonVu}`
          : `Suite de NOTRE conversation en cours (tu en connais déjà l'historique par ta session : ne le redemande pas).`,
        `UTILISATEUR: ${parts.lastUserMessage ?? ''}`
      ]
    : [
        `ÉTAT DE L'APP:\n${JSON.stringify(parts.snapshot)}`,
        parts.brainContext,
        parts.memoryEcho,
        parts.skillBody ?? '',
        ...parts.history.map((m) => `${m.role === 'user' ? 'UTILISATEUR' : 'TOI'}: ${m.content}`)
      ]
  return entries.filter((entry) => entry.trim().length > 0)
}

/**
 * La question exige-t-elle un chiffre VÉRIFIÉ, et la réponse en avance-t-elle un sans avoir lu ?
 *
 * MESURÉ le 2026-08-15 sur deux séries de 10 sondes à vérité terrain : 19 réussites sur 20, et
 * l'unique échec répond en 3 secondes — trop vite pour avoir listé quoi que ce soit. La même question
 * avait réussi en 8 s dans la même série : c'est une VARIANCE, l'agent devinant au lieu d'appeler.
 *
 * Le prompt l'interdit déjà en toutes lettres et n'a pas suffi. Ce prédicat arme la relance
 * MÉCANIQUE, seule à tenir — la leçon que ce dépôt a déjà payée sur le tour muet.
 *
 * Prudent par construction : il ne se déclenche que si les TROIS conditions tiennent — la question
 * réclame un compte, la réponse contient un nombre, et aucune lecture n'a eu lieu. Un faux positif
 * coûterait une itération inutile ; on préfère le faux négatif.
 */
export function exigeUnChiffreVerifie(
  question: string | undefined,
  reponse: string,
  lectureEffectuee: boolean
): boolean {
  if (lectureEffectuee) return false
  const q = (question ?? '').toLowerCase()
  const demandeUnCompte =
    /\bcombien\b/.test(q) ||
    /\bnombre\b/.test(q) ||
    /\bcompte[rz]?\b/.test(q) ||
    /\bliste[rz]?\b/.test(q) ||
    /\binventaire\b/.test(q)
  if (!demandeUnCompte) return false
  /*
    AUCUN chiffre n'est exigé dans la réponse, et c'est une CORRECTION mesurée.

    Première version : la relance ne mordait que si la réponse contenait un nombre — l'agent qui
    devine. Relevé du 2026-08-15 après ce correctif : encore 9/10, et l'échec (`conv-1205`) répondait
    « Je vais vérifier directement le dossier `src/main` » — une ANNONCE, sans chiffre, sans action,
    le tour se terminant là. La garde ne pouvait pas mordre : elle cherchait un nombre absent.

    La règle juste est plus simple et couvre les TROIS façons de ne pas répondre — deviner un
    chiffre, annoncer sans faire, refuser. Le déclencheur est l'ABSENCE DE LECTURE sur une question
    qui en réclame une, jamais la forme de la phrase. Une réponse vide reste écartée : elle relève de
    la garde du tour muet, sa jumelle.
  */
  return reponse.trim().length > 0
}

/**
 * Le tour a AGI mais sa réponse ne CONCLUT pas — l'utilisateur ne sait ni où il en est, ni la suite.
 *
 * MESURÉ le 2026-08-15 : sur 39 conversations de sonde, **39** finissaient sans bloc de clôture.
 * Verdict de l'utilisateur : « pour moi toutes tes sondes sont des échecs, y'en a pas une qui a fini
 * avec le bloc fait / à faire — c'est pas du tout l'expérience utilisateur que je veux offrir ».
 * Les scores d'exactitude (10/10, 8/8) étaient des faux verts : ils ne jugeaient que le chiffre.
 *
 * La garde ne s'arme QUE si le tour a exécuté au moins une action : une réponse conversationnelle
 * courte n'a pas à porter de cérémonie, et l'imposer partout produirait le défaut inverse — du
 * remplissage sur trois mots.
 */
export function exigeUneConclusion(aAgi: boolean, reponse: string): boolean {
  if (!aAgi) return false
  const texte = (reponse ?? '').trim()
  if (!texte) return false // le tour muet a sa propre garde, plus ancienne
  const annonceCeQuiEstFait = /✅|\bfait\b/i.test(texte)
  const annonceLaSuite = /(reste à faire|à faire|recommand|prochaine étape)/i.test(texte)
  return !(annonceCeQuiEstFait && annonceLaSuite)
}

/**
 * Une action a ÉCHOUÉ mais la réponse annonce « Fait » sans le dire — le mensonge le plus coûteux.
 *
 * TROUVÉ le 2026-08-15 dans une conversation de l'utilisateur (`conv-1178`, statut `cancelled`) : sa
 * dernière action est un `edit_file` avec `ok: false`, et le texte qu'il lit se termine par
 * « ### ✅ Fait — Le défaut reste confirmé… ». L'échec n'existe que dans `parts[].ok = false`,
 * invisible à la lecture.
 *
 * C'est le revers exact de la garde précédente : rendre le bloc de clôture OBLIGATOIRE sans exiger
 * qu'il dise la vérité produit un « ✅ Fait » posé sur un échec — pire que pas de bloc du tout,
 * parce qu'il RASSURE. La forme ne vaut que si le fond est honnête.
 */
/**
 * AUTO-KAIZEN EN COURS DE TOUR : la MEME erreur ne doit pas se rejouer.
 *
 * Corriger-et-poursuivre est l'etage tactique ; sans memoire, il autorise le pire des retours —
 * l'agent rejoue la commande a l'identique, remange le meme mur, et brule ses iterations dans un
 * trou de lapin optimiste. Chaque echec laisse donc une SIGNATURE, et la deuxieme rencontre du
 * meme mur change la consigne au lieu de la repeter.
 *
 * La signature normalise ce qui varie sans changer le mur — casse, chemins, nombres — et garde ce
 * qui le distingue : l'outil et la nature de l'erreur. Deux `ENOENT` sur deux fichiers sont LE meme
 * mur ; un `ENOENT` et un `EACCES` ne le sont pas.
 */
export function signatureDEchec(nom: string, erreur: string): string {
  const noyau = (erreur ?? '')
    .toLowerCase()
    .replace(/[a-z]:\\[^\s'"]*/g, '<chemin>')
    .replace(/\/[^\s'"]*\//g, '<chemin>')
    // Un chemin Windows contient des ESPACES (`C:\Amitel\Autowin OS\...`) : la regle de chemin
    // s'arrete au premier, laissant le nom de fichier — qui est justement ce qui varie d'une
    // occurrence a l'autre du MEME mur. On le neutralise donc a part.
    .replace(/[^\s'"\/]*\.[a-z0-9]{1,5}\b/g, '<fichier>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
  /*
   * On tronque par les DEUX bouts, jamais par la fin seule. Trouve par l'audit du 2026-08-21 : deux
   * erreurs authentiquement differentes partageant un long prefixe commun (« Erreur reseau ... motif:
   * ECONNRESET » vs « ... ETIMEDOUT ») fusionnaient en une seule signature — une coupure transitoire
   * et une panne de destination devenaient LE MEME mur, donc « interdit de rejouer » sur un
   * diagnostic faux. Le suffixe est justement la ou vit le discriminant.
   */
  const borne =
    noyau.length <= 80 ? noyau : `${noyau.slice(0, 40)}…${noyau.slice(-40)}`
  return `${nom}::${borne}`
}

/**
 * La consigne de reprise, ESCALADEE quand le mur a deja ete rencontre dans ce tour.
 *
 * Premiere rencontre : remonter a la cause et poursuivre. Deuxieme : interdire la repetition,
 * exiger un chemin DIFFERENT, et surtout CAPITALISER via `remember` — c'est la seule moitie qui
 * survit au tour, donc la seule qui transforme une correction en apprentissage.
 */
export function consigneApresEchec(dejaRencontres: readonly string[], signature: string): string {
  const rejoue = dejaRencontres.includes(signature)
  if (!rejoue) {
    return (
      'SYSTÈME: ta dernière action a ÉCHOUÉ et tu t’arrêtes sur ce constat — la demande n’est ' +
      'donc PAS satisfaite. Tu as le droit d’ÉMETTRE DES COMMANDES maintenant : relis le message ' +
      'd’erreur exact ci-dessus, identifie la CAUSE (pas le symptôme), corrige-la, puis REPRENDS ' +
      'la tâche là où elle s’est interrompue et va jusqu’au bout. Ne te contente pas de réessayer ' +
      'à l’identique. Si et seulement si la reprise est hors de ta portée — droits, autorisation, ' +
      'dépendance externe — dis lequel de ces murs te bloque, précisément.'
    )
  }
  return (
    'SYSTÈME: tu as DÉJÀ rencontré exactement cette erreur dans ce tour, et ta correction ne l’a ' +
    'pas levée — tu tournes en rond. INTERDIT de rejouer la même approche. Change de chemin : ' +
    'remonte d’un cran (vérifie ce que tu CROIS vrai — le fichier existe-t-il vraiment, la ' +
    'commande est-elle la bonne, l’hypothèse de départ tient-elle ?) et attaque autrement. Puis, ' +
    'AVANT de conclure, appelle `remember` pour enregistrer la leçon apprise sur ce mur, afin de ' +
    'ne pas le rejouer au prochain tour. Si aucun autre chemin n’existe, dis-le et nomme le mur.'
  )
}

/**
 * IL VOIT SON ERREUR, LA RACONTE — ET ABANDONNE LA TÂCHE.
 *
 * La garde jumelle `exigeDireLEchec` a un revers coûteux : sa relance ordonne de reformuler
 * « SANS aucune commande ». Elle obtient donc un aveu HONNÊTE, mais elle INTERDIT la reprise —
 * l'agent constate proprement son échec et rend la main, la demande non satisfaite. Dire l'échec
 * était le premier étage ; le corriger puis poursuivre est celui qui manquait.
 *
 * Le discriminant est l'échec de la DERNIÈRE itération, pas l'échec cumulé du tour : une commande
 * qui a planté puis été rejouée avec succès ne doit plus rien réclamer, sinon la garde harcèle un
 * tour qui s'est déjà rattrapé tout seul — exactement ce qu'on veut encourager.
 *
 * Elle se tait quand la reprise dépend RÉELLEMENT de l'humain (autorisation, droits, arbitrage) :
 * relancer un agent contre un mur externe brûle des itérations sans rien produire.
 */
export function exigeCorrigerEtPoursuivre(
  echecNonCorrige: boolean,
  reponse: string
): boolean {
  if (!echecNonCorrige) return false
  const texte = (reponse ?? '').trim()
  if (!texte) return false // le tour muet a sa propre garde
  /*
   * Trois formes de mur, et AUCUNE n'est une simple co-occurrence de mot-cle. L'audit du 2026-08-21
   * a montre les deux erreurs symetriques de la version precedente : « le fichier de configuration
   * n'AUTORISE pas ce caractere » desarmait la garde alors que la cause etait parfaitement
   * corrigeable (l'agent pouvait abandonner sans etre relance, exactement le defaut a supprimer) ;
   * et a l'inverse un agent qui declarait correctement la tache hors de sa portee, sans employer un
   * mot de la liste, se faisait relancer deux fois puis accuser de tourner en rond.
   */
  const demandeExpliciteALHumain =
    /(il me faut|j[’']ai besoin d|n[ée]cessite|requiert|exige)[^.]{0,40}(autoris|accord|droits?|feu vert|validation|mot de passe|identifiant)/i.test(
      texte
    )
  const questionSuspensive =
    texte.includes('?') && /(dois-je|veux-tu|confirmes?-tu|souhaites?-tu|faut-il|puis-je)/i.test(texte)
  const declareHorsDePortee =
    /(n[’']existe pas|je ne peux pas|impossible|hors de (ma|mon) (port[ée]e|p[ée]rim[èe]tre)|pas dans mon p[ée]rim[èe]tre)/i.test(
      texte
    )
  return !(demandeExpliciteALHumain || questionSuspensive || declareHorsDePortee)
}

/**
 * NIER UN ECHEC N'EST PAS LE NOMMER — et c'est ce que la version precedente confondait.
 *
 * Elle testait la simple PRESENCE d'un mot d'echec, si bien qu'une NEGATION la desarmait : mesure du
 * 2026-08-22, `exigeDireLEchec(true, '✅ Fait — tous les tests passent sans erreur.')` rendait
 * `false`. Une action reellement plantee cloturait donc le tour sans etre ni corrigee ni meme avouee
 * — le faux « Fait » que cette garde existe precisement pour attraper.
 *
 * Deux corrections, toutes deux sur la CAUSE (« presence du mot » au lieu de « aveu de son propre
 * echec ») :
 *  - les occurrences NIEES sont retirees avant le test, chirurgicalement : une reponse qui nomme un
 *    echec ET nie ailleurs (« l'edition a echoue, en revanche la suite passe sans erreur ») garde son
 *    aveu et n'est pas relancee ;
 *  - la comparaison se fait sans accents, sinon « a echoue » ecrit sans accent n'etait pas reconnu et
 *    un agent parfaitement honnete se faisait harceler.
 */
function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Les tournures qui NIENT un echec, donc n'en avouent aucun. */
const NEGATIONS_DECHEC =
  /(sans|aucune?|pas d[’']|nulle|z[ée]ro|0)\s+(erreurs?|[ée]checs?|probl[èe]mes?|souci)/gi

export function exigeDireLEchec(uneActionAEchoue: boolean, reponse: string): boolean {
  if (!uneActionAEchoue) return false
  const texte = (reponse ?? '').trim()
  if (!texte) return false // le tour muet a sa propre garde
  // Retire d'abord ce qui NIE un echec : ce qui reste, s'il reste un mot, est un vrai aveu.
  const sansNegations = sansAccents(texte).replace(NEGATIONS_DECHEC, ' ')
  const nommeLEchec = /(echou|erreur|impossible|n[’']a pas (pu|fonctionne)|refus|bloqu)/i.test(
    sansNegations
  )
  return !nommeLEchec
}

/**
 * LE TOUR QUI ANNONCE SANS AGIR — miroir exact du tour muet, et tout aussi trompeur.
 *
 * Vécu par l'utilisateur le 2026-08-15. Demande : « ranges moi mes conversations dans des sous
 * catégories adéquates ». Réponse reçue, marquée `completed` :
 *
 *     « Je vais d'abord identifier le comportement actuel, écrire un test rouge… »
 *     « Je cible maintenant le flux réel de classement… »
 *     ACTIONS: []
 *
 * Zéro action exécutée. Rien n'a été rangé. Le tour a récité son plan au futur puis s'est terminé,
 * en se déclarant réussi.
 *
 * Les cinq gardes posées plus tôt ne pouvaient PAS le voir : toutes exigent `anyActionExecuted`.
 * Le tour muet est « il agit sans parler » ; celui-ci est son miroir — « il parle sans agir ». Même
 * angle mort que le veilleur d'inactivité : on couvrait les mauvaises fins, jamais l'absence de tout.
 *
 * Prudent par construction : il ne mord que si la demande RÉCLAME une action, qu'AUCUNE n'a eu lieu,
 * et que la réponse est au FUTUR. Une réponse à une question ou un refus argumenté passent.
 */
export function exigeAgirPasAnnoncer(
  question: string | undefined,
  reponse: string,
  uneActionAEuLieu: boolean
): boolean {
  if (uneActionAEuLieu) return false
  const texte = (reponse ?? '').trim()
  if (!texte) return false // le tour muet a sa propre garde
  const q = (question ?? '').toLowerCase()
  // Un verbe d'ACTION à l'impératif ou à l'infinitif : l'utilisateur demande un effet, pas un avis.
  const demandeUneAction =
    /\b(range|classe|cr[ée]e|ajoute|modifie|corrige|r[ée]pare|supprime|renomme|impl[ée]mente|fais|lance|applique|configure|installe|d[ée]place)/i.test(
      q
    )
  if (!demandeUneAction) return false
  // La marque du plan récité : « je vais », « je cible maintenant », « je commence par »…
  const annonceAuFutur =
    /\bje (vais|commence|cible|compte|prévois|m[’']apprête)\b/i.test(texte) ||
    /\bje (procède|démarre|attaque) (maintenant|par)\b/i.test(texte)
  return annonceAuFutur
}
