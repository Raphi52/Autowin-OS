// Reproduction TS pure, model-agnostic, du "stop-gate" du kit autowin.
// Fonction pure évaluant si une clôture "done/green" est légitime.

/** Une case de Definition-of-Done. */
export interface DodItem {
  /** La case est cochée. */
  checked: boolean
  /** La case a un contenu réel (une DoD vide/non applicable ne bloque jamais). */
  hasContent: boolean
  /**
   * Libellé de la case, pour que le refus NOMME ce qui manque au lieu de le compter. Optionnel : les
   * appelants qui ne le fournissent pas gardent le message compté, plutôt qu'un nom inventé.
   */
  label?: string
}

/** État de clôture soumis à évaluation. */
export interface ClosureState {
  status: 'open' | 'red' | 'green' | 'degraded-closed'
  dod: DodItem[]
  /** Code de sortie du signal de vérification (test/build/script), s'il existe. */
  signalExitCode?: number
  /**
   * Les travaux NOMMES que le run n'a pas livres : sous-taches en echec, ou sautees en cascade parce
   * qu'une dependance a echoue, et jamais reprises depuis.
   *
   * Mesure du 2026-08-22 : un run dont la sous-tache `A` echouait et dont `C` etait sautee se
   * cloturait `valid: true`, `gateBlocked: false`, ZERO raison. `failedTasks` et `skippedTasks`
   * etaient calcules, accumules avec soin, retournes dans le resultat — et lus par AUCUN
   * consommateur de production. Le gate est le seul endroit qui decide de bloquer : c'est donc ici
   * que l'information devait entrer, plutot que dans une troisieme machinerie de reprise.
   *
   * Cette liste ne contient que ce qui reste EN ATTENTE : une sous-tache rejouee avec succes en sort,
   * sinon la boucle de reparation ne pourrait jamais rendre la main.
   */
  travauxNonLivres?: string[]
}

/**
 * Le refus qu'un nouveau passage de BUILD ne peut pas lever.
 *
 * FORMULATION : ces motifs s'affichent dans le fil de conversation, donc ils sont écrits pour
 * l'utilisateur, pas pour le moteur. Demandé le 20/08 apres conv-1334 (« Statut "red" : la clôture a
 * été refusée en amont. / DoD non tenue : … — je comprends même pas ce que ça veut dire »). Ni
 * `red`, ni « clôture », ni « DoD » : le vocabulaire interne reste dans le code.
 *
 * Il ne parle pas du livrable : le RUN est rouge en amont, et rien de ce que build produira ne
 * changera ce statut. Toutes les autres raisons (DoD non tenue, signal rouge) sont au contraire
 * exactement ce qu'une réparation adresse.
 */
export const CLOSURE_UPSTREAM_REFUSAL =
  "Échec déjà déclaré : ce travail s'est lui-même terminé en échec, ce contrôle ne fait que le relayer."

/**
 * Faut-il ARRÊTER la boucle de réparation plutôt que de payer un passage de plus ?
 *
 * Mesuré dans `conv-1242` le 2026-08-15 : trois passages `build` (73 s, 60 s, puis un troisième),
 * chacun suivi du MÊME refus mot pour mot — « Statut "red" : la clôture a été refusée en amont ».
 * Plus de deux minutes de calcul brûlées, puis abandon. Chaque tour de boucle rejoue un build
 * complet, toutes les phases post-build et un panel de juge : ce n'est pas un retry bon marché.
 *
 * La règle tient les DEUX intentions, et c'est tout l'enjeu de sa forme :
 * - un motif identique ne suffit PAS à conclure (une dépendance ou une preuve peut être devenue
 *   disponible entre deux passages) — donc on ne coupe pas sur la seule répétition ;
 * - un refus dont AUCUNE raison n'est réparable par build ne peut pas évoluer par un rejeu — donc
 *   le répéter est une dépense sans contrepartie.
 *
 * On coupe à l'intersection : refus IDENTIQUE **et** entièrement hors de portée de build. Un refus
 * mixte (amont + DoD non cochée) reste rejoué : la DoD, elle, est réparable.
 */
export function doitArreterLaReparation(
  motifsCourants: readonly string[],
  motifsPrecedents: readonly string[]
): boolean {
  if (motifsCourants.length === 0) return false
  const identique =
    motifsCourants.length === motifsPrecedents.length &&
    motifsCourants.every((motif, index) => motif === motifsPrecedents[index])
  if (!identique) return false
  return motifsCourants.every((motif) => motif === CLOSURE_UPSTREAM_REFUSAL || horsPorteeDeBuild(motif))
}

/**
 * Le libelle que porte une case non cochee quand le juge a lui-meme VALIDE (voir
 * `dodDuVerdict` dans `../objections-juge.ts`). Un nouveau passage de build ne peut pas le lever :
 * le juge n'a rien refuse, le blocage vient d'ailleurs.
 *
 * fix-ok: conv-540 tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f — 4 appels du juge (ts 09:44:57.329,
 * 09:48:05.122, 09:51:14.024, 09:53:28.437) tous VALIDE 72-74, rejoues jusqu'au plafond de
 * 42 appels provider ; le tour meurt sans rien rendre a l'utilisateur.
 */
export const MOTIF_RESERVES_VERDICT_VALIDE = 'Reserves du juge sur un verdict VALIDE'

function horsPorteeDeBuild(motif: string): boolean {
  return motif.includes(MOTIF_RESERVES_VERDICT_VALIDE)
}

/**
 * Le PLAFOND DUR des réparations : la seule source, lue par la boucle ET par le devis.
 *
 * Il laisse volontairement de la marge au-delà des réparations provisionnées, parce que c'est tout
 * l'objet du chantier : un run dont le refus CHANGE à chaque passage progresse, et l'arrêter parce
 * qu'un compteur est arrivé au bout était le reproche d'origine.
 *
 * Il reste FINI, et ce n'est pas de la prudence décorative : `spendEnforcement` vaut `metering-only`
 * par défaut, donc le budget ne bloque rien. Sans ce plafond, plus rien n'arrêterait un run qui
 * reformule indéfiniment son refus.
 *
 * POURQUOI UNE FONCTION PARTAGÉE plutôt qu'un calcul recopié de chaque côté : le défaut que ce
 * chantier corrige était précisément deux mécaniques lisant le même budget sans le savoir — 5 à 7
 * passages `build` là où le profil en annonçait 2 ou 3, et un devis qui sous-provisionnait d'autant.
 * Relever le plafond sans le dire au devis recréerait ce défaut à l'identique.
 */
export function plafondDurReparations(reparationsAccordees: number): number {
  const accordees = Math.max(0, Math.floor(reparationsAccordees))
  /**
   * ZÉRO ACCORDÉ ⇒ ZÉRO PLAFOND. Un plafond BORNE un run autorisé à réparer, il n'accorde rien.
   *
   * Ma première version posait un plancher de 2, et NEUF tests existants l'ont refusée à raison : ce
   * plancher détruisait trois décisions délibérées — le régime jetable (`maxRecoveries: 0`), un graphe
   * SANS arête rouge (« aucune réparation ne se déclenche »), et le mode bloquant (« aucune reprise
   * automatique sans un nouveau tour humain »). Accorder deux passages là où la politique en refusait
   * zéro n'était pas une marge de progrès : c'était contourner la politique.
   */
  if (accordees === 0) return 0
  /**
   * LARGE ET NON BLOQUANT (choix utilisateur du 2026-08-28) : le facteur 2 coupait des runs qui
   * PROGRESSAIENT encore — du temps et de l'argent perdus a relancer a la main. Le vrai arret est
   * le refus IDENTIQUE hors de portee de build (`doitArreterLaReparation`) : c'est lui qui doit
   * mordre, pas un compteur. Le plafond reste FINI (le budget ne bloque pas par defaut) mais assez
   * haut pour ne jamais etre la raison d'un arret en pratique.
   */
  return Math.max(24, accordees * 12)
}

/**
 * Faut-il ARRÊTER de réparer — et si oui, pour quelle raison DITE ?
 *
 * Rend `undefined` pour continuer, ou le MOTIF de l'arrêt. Le motif n'est pas décoratif : la boucle
 * avait trois sorties dont une, l'épuisement du compte, était SILENCIEUSE. Un run rendait donc
 * « bloqué » sans dire s'il avait renoncé faute de progrès ou faute de tours — deux causes qui
 * n'envoient pas chercher au même endroit.
 *
 * LE RENVERSEMENT : le PROGRÈS décide, le compte devient un garde-fou de dernier ressort.
 *  - un refus qui CHANGE d'un passage à l'autre est un progrès : on continue, même au-delà du nombre
 *    de réparations accordées. C'est précisément ce qu'un compte fixe empêchait ;
 *  - un refus IDENTIQUE et entièrement hors de portée de `build` ne peut pas évoluer : on s'arrête
 *    au premier constat (mesuré conv-1242 : trois passages, le même refus mot pour mot, deux minutes
 *    brûlées). Cette règle vit dans `doitArreterLaReparation` et n'est pas rejouée ici ;
 *  - le plafond DUR reste, parce que le budget ne bloque pas par défaut : sans lui, plus rien
 *    n'arrêterait un run qui reformule indéfiniment son refus.
 */
/**
 * Au bout de combien de refus IDENTIQUES d'affilée un refus est-il tenu pour figé ?
 *
 * Deux : le premier retour à l'identique peut encore venir d'une preuve indisponible sur le coup, le
 * second montre que rien ne bouge. Mesuré sur conv-470 (tour 52fbe05f-0086-4806-8f07-c8762e8caa35) :
 * 4 réparations, 4 refus identiques, donc 2 passages économisés par cette borne.
 */
const REFUS_FIGE_SEUIL = 2

/**
 * Ce refus est-il le MEME que le precedent, mot pour mot ?
 *
 * Exportee parce que la boucle de reparation en a besoin pour compter les repetitions : recopier la
 * comparaison dans l'orchestrateur en ferait un MIROIR, que ce depot a deja paye une fois.
 */
/**
 * fix-ok: conv-540 tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 — 16 reparations payees parce que le
 * motif « Promis mais pas fait » RECOPIE les objections du juge, reformulees a chaque passage : la
 * comparaison mot pour mot ne voyait jamais deux refus identiques, le compteur de refus fige ne
 * mordait jamais. On compare donc le motif SANS sa citation.
 *
 * Seule la partie entre guillemets francais est retiree : c'est la ou vit le texte recopie (extrait
 * de verdict, nom de fichier cite). Le motif lui-meme — ce qui est reproche — reste compare en
 * entier, donc un refus qui CHANGE reellement continue de relancer la reparation.
 */
/**
 * Replie chaque citation de PREMIER niveau en «…», en suivant la profondeur des guillemets.
 *
 * fix-ok: conv-540 tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 — le repli precedent allait du
 * PREMIER « au DERNIER » (/«[\s\S]*»/), donc il avalait aussi le texte situe ENTRE deux
 * citations : « Fichier « a.ts » manquant et regle « X » violee » et la meme phrase avec
 * « present » devenaient identiques, et la boucle de reparation pouvait etre coupee sur un refus
 * qui avait reellement change. On suit desormais la profondeur : ce qui est HORS citation reste
 * compare en entier, ce qui est DEDANS (y compris ses guillemets imbriques) compte pour «…».
 */
function replierCitations(motif: string): string {
  let sortie = ''
  let profondeur = 0
  for (const caractere of motif) {
    if (caractere === '«') {
      if (profondeur === 0) sortie += '«…»'
      profondeur += 1
      continue
    }
    if (caractere === '»') {
      if (profondeur > 0) {
        profondeur -= 1
        continue
      }
    }
    if (profondeur === 0) sortie += caractere
  }
  return sortie
}

function motifSansCitation(motif: string): string {
  return (
    replierCitations(motif)
      // fix-ok: conv-540 tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 — 20 reparations payees : les
      // objections du juge recopiees dans « Promis mais pas fait » contiennent ELLES-MEMES des
      // guillemets francais (« pas corrige » puis « corrige »). La paire la plus courte s'arretait
      // donc au premier » interieur, et tout le texte suivant restait compare mot pour mot alors
      // qu'il est reformule a chaque passage. Le repli se fait desormais par profondeur
      // (replierCitations) ; le texte HORS citation reste compare en entier.
      .replace(/«[^»]*»/g, '«…»')
      // fix-ok: conv-540 tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 — neutraliser le TEXTE des
      // citations ne suffisait pas : « Promis mais pas fait » JOINT toutes les objections du juge,
      // et le juge n'en rend pas le meme NOMBRE d'un passage a l'autre (6, puis 8, puis 7 sur ce
      // tour). La liste normalisee restait donc de longueur variable et le compteur de refus fige ne
      // mordait toujours pas. Une suite de citations compte pour une seule.
      .replace(/«…»(?:[\s,;]*«…»)+/g, '«…»')
      // fix-ok: conv-540 tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 — le refus fix-gate NOMME le
      // nombre d'editions du fichier (« 4 edits » a la reparation 2, « 6 edits » a la reparation 3),
      // et ce nombre est incremente par la boucle de reparation ELLE-MEME a chaque passage. Le meme
      // refus ne pouvait donc jamais etre reconnu comme identique. Le fichier reproche, lui, reste
      // compare en entier : deux fichiers differents restent deux refus differents.
      .replace(/\b\d+ [ée]dits?\b/g, 'N edits')
      /**
       * fix-ok: mesure du 2026-09-17 sur `activity/*.jsonl` (336 controles depuis le 13/09) — le
       * motif « Promis mais pas fait » a DEUX formulations pour le meme blocage (voir `evaluateClosure` :
       * les libelles cites quand ils existent, sinon le COMPTE « N point(s) »). La boucle de
       * reparation fait osciller les deux d'un passage a l'autre, donc `memeRefus` ne reconnaissait
       * pas un refus pourtant FIGE, et le seul frein restant etait le plafond dur de 24 passages.
       * Sur les 188 paires de refus consecutifs mesurees, 88 seulement etaient reconnues ; en
       * ramenant les deux formulations a une seule, 135 le sont. Le contenu etait DEJA neutralise
       * par le repli des citations ci-dessus : cette ligne n'efface aucune distinction qui
       * subsistait, elle aligne la forme « compte » sur la forme « libelles ».
       */
      .replace(/Promis mais pas fait :[^;]*/g, 'Promis mais pas fait')
      .trim()
  )
}

export function memeRefus(
  motifsCourants: readonly string[],
  motifsPrecedents: readonly string[]
): boolean {
  if (motifsPrecedents.length === 0) return false
  return (
    motifsCourants.length === motifsPrecedents.length &&
    motifsCourants.every(
      (motif, index) => motifSansCitation(motif) === motifSansCitation(motifsPrecedents[index])
    )
  )
}

export function arretDeLaReparation(entree: {
  /** Nombre de réparations DÉJÀ tentées. */
  tentative: number
  /** Ce que la politique de dépense accordait — désormais indicatif, plus décisif. */
  reparationsAccordees: number
  /** Le garde-fou de dernier ressort. Zéro interdit toute réparation. */
  plafondDur: number
  motifsCourants: readonly string[]
  motifsPrecedents: readonly string[]
  /**
   * Combien de fois DE SUITE ce refus est-il revenu mot pour mot, celui-ci compris ?
   *
   * Défaut vécu conv-470, tour `52fbe05f-0086-4806-8f07-c8762e8caa35` : quatre passages de
   * réparation pour un refus MIXTE strictement identique (échec amont + une promesse portant sur un
   * fichier que la demande ne nommait pas). `doitArreterLaReparation` ne mord pas sur un refus mixte,
   * à raison au premier constat ; mais un refus qui se répète à l'identique a fait la preuve qu'il est
   * FIGÉ, et chaque tour de boucle paie un build complet et un panel de juge.
   *
   * Absent (ancien appelant) = aucune répétition connue : comportement inchangé.
   */
  refusIdentiquesConsecutifs?: number
  /**
   * Le code du gate REELLEMENT execute est-il plus vieux que sa source ?
   *
   * Defaut vecu conv-539, tour `82a4f5d1-d92f-4d73-9f6f-cac70db65ecb` : 14 reparations refusees
   * d'affilee. L'application jugeait avec `out/main/index.js` date de 11:06 pendant que les
   * correctifs etaient commites de 11:11 a 11:31. Aucune edition de la source ne pouvait faire
   * bouger ce refus, et la boucle brulait un build + un panel de juge par passage sans jamais le
   * dire. Absent = aucune mesure : comportement inchange.
   */
  bundlePerime?: { bundleMs: number; sourceMs: number; demarrageMs?: number; bundle: string }
  /**
   * JUSQU'AU VERT (conv-844, 2026-09-24, choix utilisateur : « que ça s'arrête que quand y a plus
   * de défauts »). Ni plafond dur, ni arrêt sur refus répété : seul le code PÉRIMÉ arrête encore,
   * car aucune réparation ne peut alors changer le verdict.
   */
  jusquAuVert?: boolean
}): string | undefined {
  const b = entree.bundlePerime
  // fix-ok: conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb — comparer le bundle a la seule
  // SOURCE laissait un angle mort : recompile en cours de tour (11:46) il redevenait « a jour »
  // alors que le processus, lance a 11:06, executait toujours l'ancien code en memoire. Le refus
  // ne bougeait pas et la mesure se taisait (constat du juge, reparation 17).
  if (b && b.demarrageMs !== undefined && b.bundleMs > b.demarrageMs) {
    return `Réparation interrompue : ${b.bundle} a été recompilé après le démarrage — l'application exécute encore l'ancien code. Relancer l'application avant de rejouer.`
  }
  if (b && b.sourceMs > b.bundleMs) {
    return `Réparation interrompue : le code exécuté est périmé — ${b.bundle} est plus ancien que la source du contrôle. Recompiler et relancer l'application avant de rejouer.`
  }
  if (entree.jusquAuVert) return undefined
  if (entree.tentative >= entree.plafondDur) {
    return `Réparation interrompue : plafond dur de ${entree.plafondDur} passage(s) atteint (réparations accordées : ${entree.reparationsAccordees}).`
  }
  const repetitions = entree.refusIdentiquesConsecutifs ?? 0
  // conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb : un refus fix-gate se lève par UNE ligne
  // `fix-ok:` que le build peut écrire ; il garde un passage de plus avant d'être déclaré figé.
  // Seulement si TOUS les motifs sont réparables ainsi (le relais d'échec amont excepté) : un refus
  // mixte ne gagne pas de passage (objection du juge, réparation 2 du même tour).
  const motifsPropres = entree.motifsCourants.filter((m) => m !== CLOSURE_UPSTREAM_REFUSAL)
  const seuil = motifsPropres.length > 0 && motifsPropres.every((m) => m.includes('fix-gate'))
    ? REFUS_FIGE_SEUIL + 1
    : REFUS_FIGE_SEUIL
  if (repetitions >= seuil) {
    return `Réparation interrompue : le même refus est revenu ${repetitions} fois de suite, rejouer ne le fait plus bouger.`
  }
  if (doitArreterLaReparation(entree.motifsCourants, entree.motifsPrecedents)) {
    return 'Réparation interrompue : refus identique et hors de portée de build, rejouer ne peut rien changer.'
  }
  return undefined
}

/** Ce qui décide combien de fois on rejoue après un refus, et pourquoi on n'en accorde aucune. */
export interface ReparationsAutorisees {
  reparations: number
  /** Renseigné dès que le compte est ZÉRO : un plafond qui mord doit se DIRE, jamais se subir. */
  motif?: string
}

/**
 * Combien de réparations ce run a-t-il le droit de payer ?
 *
 * DEUX DÉFAUTS CORRIGÉS ICI, mesurés le 2026-08-20 sur la formule qui vivait en ligne dans
 * l'orchestrateur (`!enforceSpend && isMutationTask(task) ? … : 0`) :
 *
 * 1. Une tâche NON-MUTATION n'obtenait AUCUNE réparation. Or le gate peut parfaitement refuser un
 *    run d'analyse pour « analyse absente du livrable » ou « DoD non cochée » — deux motifs qu'un
 *    nouveau passage répare. Le contrat racine adapte DÉJÀ ses exigences à un run en lecture seule
 *    (il ne lui demande pas de preuve de mutation) : lui refuser en plus la réparation était une
 *    double peine sans motif. La nature de la tâche ne dit donc plus si l'on peut réparer.
 * 2. Sous budget BLOQUANT, le compte tombait à zéro EN SILENCE. La politique est défendable — pas de
 *    nouvelle dépense sans un tour humain — mais un plafond qui mord sans se nommer envoie chercher
 *    la cause ailleurs. Il porte désormais son motif, destiné à la trace du run.
 *
 * Fonction PURE et extraite : la politique de relance se teste sans rejouer un run, et un test n'a
 * plus besoin de recopier la formule pour la vérifier — il appellerait alors son propre miroir.
 */
export function reparationsAutorisees(entree: {
  /** La tâche mute-t-elle ? Conservé pour la TRACE et le devis, il ne décide plus du droit. */
  mutation: boolean
  /** Le budget refuse-t-il toute dépense supplémentaire sans un nouveau tour humain ? */
  budgetBloquant: boolean
  /** Le `maxTraversals` de l'arête de retour du graphe, quand un graphe pilote. */
  retoursDuGraphe?: number
  /** Le plafond du devis, quand aucun graphe ne pilote. */
  retoursDuDevis?: number
}): ReparationsAutorisees {
  if (entree.budgetBloquant) {
    return {
      reparations: 0,
      motif:
        'aucune réparation : le budget est en mode bloquant, une nouvelle dépense demande un nouveau tour humain'
    }
  }
  const source = entree.retoursDuGraphe ?? entree.retoursDuDevis
  if (source === undefined) {
    return {
      reparations: 0,
      motif:
        "aucune réparation : ni le graphe ni le plan d'exécution ne déclarent de retour possible"
    }
  }
  const reparations = Math.max(0, Math.floor(source))
  if (reparations === 0) {
    return { reparations: 0, motif: 'aucune réparation : le plafond déclaré vaut zéro' }
  }
  return { reparations, motif: undefined }
}

/** Résultat de l'évaluation : bloqué ou non, avec toutes les raisons cumulées. */
export interface ClosureEvaluation {
  blocked: boolean
  reasons: string[]
}

/**
 * Évalue si une clôture "done/green" est légitime.
 * - 'degraded-closed' = clôture honnête assumée : jamais bloquée, quel que soit le reste.
 * - Sinon : status open/red bloque, DoD à contenu non cochée bloque, signal rouge bloque.
 */
export function evaluateClosure(state: ClosureState): ClosureEvaluation {
  // Clôture dégradée assumée par l'humain : autorité de clôture externe déjà exercée.
  if (state.status === 'degraded-closed') {
    return { blocked: false, reasons: [] }
  }

  const reasons: string[] = []

  if (state.status === 'open') {
    reasons.push("Travail pas terminé : personne ne l'a déclaré fini, ni réussi ni raté.")
  } else if (state.status === 'red') {
    // NE PAS inventer la cause. Ce message affirmait « un signal de vérification est en échec »
    // alors que le gate ne sait PAS si un signal a tourné : `red` peut venir d'un avis de juge, d'une
    // exception, ou d'un test rouge. Un gate qui nomme une cause qu'il n'a pas vérifiée envoie
    // chercher au mauvais endroit — constaté sur un run où aucun test n'avait tourné.
    reasons.push(CLOSURE_UPSTREAM_REFUSAL)
  }

  const uncheckedContentItems = state.dod.filter((item) => item.hasContent && !item.checked)
  if (uncheckedContentItems.length > 0) {
    // NOMMER, pas compter. « 1 case(s) non cochée(s) » n'est pas actionnable : il faut ouvrir le
    // fichier pour savoir laquelle. Les libellés disponibles sont cités ; sans libellé, on retombe
    // sur le compte plutôt que d'inventer un nom.
    const libelles = uncheckedContentItems
      .map((item) => item.label?.trim())
      .filter((label): label is string => !!label)
    reasons.push(
      libelles.length > 0
        ? `Promis mais pas fait : ${libelles.map((l) => `« ${l} »`).join(', ')}.`
        : `Promis mais pas fait : ${uncheckedContentItems.length} point(s) annoncé(s) au départ ne sont pas faits.`
    )
  }

  const nonLivres = (state.travauxNonLivres ?? []).filter((id) => id.trim().length > 0)
  if (nonLivres.length > 0) {
    // NOMMER, pas compter — la meme regle que pour la DoD juste au-dessus : « 1 sous-tache en echec »
    // n'est pas actionnable, il faut rouvrir la trace pour savoir laquelle.
    reasons.push(
      `Travail annoncé mais pas livré : ${nonLivres.map((id) => `« ${id} »`).join(', ')}.`
    )
  }

  if (state.signalExitCode !== undefined && state.signalExitCode !== 0) {
    reasons.push(
      `Vérification en échec : la commande de contrôle a rendu le code ${state.signalExitCode} (0 = réussi).`
    )
  }

  return { blocked: reasons.length > 0, reasons }
}

/**
 * Le libelle d'un PASSAGE de reparation, pousse dans la trace du run a chaque rejeu.
 *
 * fix-ok: conv-540 tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f — le tour est mort sur « Budget
 * d'appels provider atteint : 42 appels » apres 4 verdicts de juge, et le dossier de preuve ne
 * permettait PAS de dire combien de passages de reparation l'avaient consomme : la boucle ne
 * poussait un motif que lorsqu'elle s'ARRETAIT. Un passage muet est un passage non mesurable ;
 * c'est exactement ce que le juge a reproche au raisonnement « 4 passages -> plafond ».
 */
export function libelleDuPassageDeReparation(rang: number, plafond: number): string {
  const suffixe = rang >= plafond ? ' (dernier autorise)' : ''
  return `Réparation ${rang}/${plafond} — nouveau passage de build${suffixe}.`
}
