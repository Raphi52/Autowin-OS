/**
 * Jarvis : l'écoute continue et le monitoring des conversations, en fonctions PURES.
 *
 * Le micro et le rendu vivent dans le widget ; ici il n'y a que des décisions. C'est là que se
 * trouvent les défauts : un moteur de reconnaissance vocale rend encore des résultats APRÈS l'ordre
 * d'arrêt (dernier segment mis en file), donc la question « cette parole compte-t-elle ? » ne peut
 * pas dépendre de l'état du micro — elle dépend de l'interrupteur du widget, et de lui seul.
 */

import { NOM_JARVIS_DEFAUT } from './jarvis-nom'

export interface JarvisCommande {
  id: string
  texte: string
  le: number
}

/**
 * DEUX FAÇONS D'ÉCOUTER, et une seule des deux parle à Jarvis.
 *  - `jarvis` : le mot d'éveil arme un ordre, qui part vers un run.
 *  - `enregistrement` : on garde le texte dicté, RIEN ne part. Le mot « Jarvis » prononcé pendant
 *    une réunion ne doit alors ni biper ni lancer quoi que ce soit.
 */
export type ModeEcoute = 'jarvis' | 'enregistrement'

export interface JarvisEcoute {
  /** L'interrupteur du widget. Aucune parole ne compte quand il est à false. */
  active: boolean
  /** Ce que l'écoute en cours FAIT du texte entendu. */
  mode: ModeEcoute
  /** Le segment en cours de dictée, non figé. Purement affiché. */
  partiel: string
  /** Les paroles figées, la plus récente en tête. */
  commandes: JarvisCommande[]
  /** Le mot d'éveil a été entendu : la prochaine phrase est un ordre, même dite après une pause. */
  eveille: boolean
  /** Verrou par phrase : le moteur republie le partiel à chaque mot, on ne bipe qu'une fois. */
  eveilAnnonce: boolean
  /**
   * QUAND l'éveil a été entendu. C'est la date de PÉREMPTION de `eveille`.
   *
   * DÉFAUT VÉCU le 2026-09-02 : l'éveil n'expirait JAMAIS. Dire le nom sans ordre derrière armait
   * l'assistant pour toujours ; la phrase figée SUIVANTE — n'importe laquelle, même dix minutes
   * plus tard, même un bout du nom mal transcrit ou la voix de l'assistant reprise par le micro —
   * partait comme ORDRE et ouvrait une conversation payante que personne n'avait demandée.
   * L'éveil est donc une FENÊTRE, pas un état permanent.
   */
  eveilleLe: number
  /**
   * LE DERNIER ORDRE RÉELLEMENT PARTI, et quand. C'est le verrou contre le DOUBLE ENVOI.
   *
   * DÉFAUT VÉCU le 2026-09-01 (conv-71) : la phrase « rend la widget de Jarvis futuriste et ultra
   * stylé. » dite UNE fois a produit DEUX messages à 0,8 s d'écart, donc deux tours de modèle
   * PAYANTS. Les moteurs de reconnaissance republient un segment déjà figé (whisper.cpp quand le
   * silence est recoupé, `webkitSpeechRecognition` quand `resultIndex` rejoue la liste) : l'éveil
   * et l'extraction sont alors parfaitement corrects DEUX fois de suite. La garde ne peut donc pas
   * vivre dans le widget, elle vit ICI, dans l'état de la session vocale.
   */
  dernierOrdre: string | null
  /** Horodatage du dernier ordre parti (voir `dernierOrdre`). */
  dernierOrdreLe: number
}

/**
 * Fenêtre pendant laquelle un ordre IDENTIQUE est tenu pour le MÊME, donc ignoré. Calibrée sur le
 * défaut mesuré (0,8 s entre les deux copies) avec une marge large ; au-delà, répéter volontairement
 * un ordre (« relance ») reste possible.
 */
export const FENETRE_ORDRE_REPETE_MS = 5_000

/**
 * Combien de temps l'éveil reste armé sans ordre derrière. Assez long pour dire le nom, attendre le
 * bip et formuler (« Jarvis… » … « ouvre le task manager »), trop court pour qu'une phrase de
 * bureau prononcée plus tard passe pour un ordre.
 */
export const FENETRE_EVEIL_MS = 15_000

/** Deux transcriptions de la MÊME phrase ne diffèrent qu'à la ponctuation et la casse près. */
function memeOrdre(a: string, b: string): boolean {
  const nettoyer = (t: string): string =>
    t
      .toLowerCase()
      .replace(/[\s.,;:!?—-]+/gu, ' ')
      .trim()
  return nettoyer(a) === nettoyer(b)
}

/** Au-delà, l'historique parlé n'est plus lu — il ne sert qu'à vérifier ce que Jarvis a entendu. */
const MAX_COMMANDES = 40

export const ecouteInitiale: JarvisEcoute = {
  active: false,
  mode: 'jarvis',
  partiel: '',
  commandes: [],
  eveille: false,
  eveilAnnonce: false,
  eveilleLe: 0,
  dernierOrdre: null,
  dernierOrdreLe: 0
}

/**
 * Allume ou coupe l'écoute, dans le MODE demandé. Couper VIDE le partiel : une phrase inachevée
 * affichée alors que le micro est éteint ferait croire que Jarvis écoute encore. L'historique figé,
 * lui, reste.
 *
 * Un clic sur l'AUTRE mode pendant une écoute ne coupe pas : il BASCULE. Sinon il faudrait deux
 * clics pour passer de l'ordre à l'enregistrement, et le premier laisserait un micro ouvert.
 */
export function basculerEcoute(
  etat: JarvisEcoute,
  le: number,
  mode: ModeEcoute = 'jarvis'
): JarvisEcoute {
  void le
  if (etat.active && etat.mode === mode) {
    return { ...etat, active: false, partiel: '', eveille: false, eveilAnnonce: false }
  }
  return { ...etat, active: true, mode, partiel: '', eveille: false, eveilAnnonce: false }
}

export function appliquerParole(
  etat: JarvisEcoute,
  parole: { texte: string; final: boolean; le: number }
): JarvisEcoute {
  if (!etat.active) return etat
  const texte = parole.texte.trim()
  if (!parole.final) return { ...etat, partiel: texte }
  if (texte === '') return { ...etat, partiel: '' }
  return {
    ...etat,
    partiel: '',
    commandes: [
      { id: `${parole.le}-${etat.commandes.length}`, texte, le: parole.le },
      ...etat.commandes
    ].slice(0, MAX_COMMANDES)
  }
}

export type StatutTour = 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface SommaireDirect {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  lastAssistantStatus?: StatutTour
}

export interface ConversationDirecte {
  id: string
  titre: string
  enCours: boolean
  updatedAt: number
  messageCount: number
}

/** Fenêtre de fraîcheur d'une conversation TERMINÉE : au-delà, ce n'est plus « en direct ». */
const FENETRE_DIRECT_MS = 10 * 60_000
const MAX_DIRECT = 6

export function conversationsEnDirect(
  sommaires: readonly SommaireDirect[],
  now: number,
  fenetreMs: number = FENETRE_DIRECT_MS
): ConversationDirecte[] {
  return sommaires
    .filter((s) => s.lastAssistantStatus === 'streaming' || now - s.updatedAt <= fenetreMs)
    .map((s) => ({
      id: s.id,
      titre: s.title,
      enCours: s.lastAssistantStatus === 'streaming',
      updatedAt: s.updatedAt,
      messageCount: s.messageCount
    }))
    .sort((a, b) => Number(b.enCours) - Number(a.enCours) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_DIRECT)
}

export interface EvenementDirect {
  conversationId: string
  titre: string
  genre: 'message' | 'fin'
  le: number
}

/**
 * Ce qui a BOUGÉ entre deux relevés. Un compteur de messages qui monte = un tour de plus ; un
 * `streaming` qui ne l'est plus = un tour fini. Deux relevés identiques ne produisent RIEN, sinon le
 * fil déroulerait le même événement à chaque rafraîchissement.
 */
export function evenementsDirects(
  avant: readonly SommaireDirect[],
  apres: readonly SommaireDirect[],
  le: number
): EvenementDirect[] {
  const index = new Map(avant.map((s) => [s.id, s]))
  const evenements: EvenementDirect[] = []
  for (const s of apres) {
    const precedent = index.get(s.id)
    if (!precedent) continue
    if (s.messageCount > precedent.messageCount) {
      evenements.push({ conversationId: s.id, titre: s.title, genre: 'message', le })
    } else if (
      precedent.lastAssistantStatus === 'streaming' &&
      s.lastAssistantStatus !== 'streaming'
    ) {
      evenements.push({ conversationId: s.id, titre: s.title, genre: 'fin', le })
    }
  }
  return evenements
}

/**
 * Le MOT D'ÉVEIL. Un micro continu entend tout — les appels téléphoniques, les collègues, la radio.
 * Rien ne part vers un run tant que « Jarvis » n'a pas été prononcé : c'est la seule garde entre une
 * pièce bruyante et une exécution réelle. Ce qui suit le mot est l'ordre ; l'éveil seul n'en est pas
 * un, sinon un « jarvis ? » enverrait une commande vide.
 *
 * LE NOM, TEL QU'IL REVIENT DES MOTEURS. Mesure réelle du 2026-08-31 : la CLI whisper.cpp
 * (small-q5_1) a transcrit la phrase prononcée « Jarvis, ouvre le task manager » en
 * « jarvie, ouvre le task manager. ». AUCUN moteur ne rend un nom propre au caractère près —
 * exiger `jarvis` exactement laissait Jarvis MUET alors qu'il avait parfaitement entendu, ce qui se
 * lit exactement comme le défaut signalé : « il n'entend pas quand je dis son nom ».
 *
 * La tolérance est BORNÉE, pas ouverte : le mot doit commencer par `jarv` et ne pas porter plus de
 * trois lettres derrière. `jarvis`, `jarvie`, `jarvi`, `jarviss`, `jarvice`, `jarvys` réveillent ;
 * `java`, `jardin`, `service`, `harvest`, `jars` ne réveillent RIEN. Le mot d'éveil reste la seule
 * garde entre une pièce bruyante et une exécution réelle : l'élargir davantage la retirerait.
 *
 * L'APOSTROPHE. Deuxième mesure du 2026-08-31, même CLI : la même phrase rendue à deux niveaux
 * d'entrée donne « Jarvie, ouvre le gestionnaire de tâche. » à niveau normal, et
 * « J'arvie, ouvre le jeu. » à −18 dB. Or `\bjarv` exige `jarv` d'un seul bloc : dans `J'arvie`, la
 * frontière de mot tombe APRÈS l'apostrophe, donc le moteur avait entendu le nom et l'éveil ne
 * partait pas quand même. Whisper place volontiers une apostrophe française devant une syllabe
 * qu'il n'attache pas — c'est un artefact d'orthographe, pas un mot différent.
 *
 * Ce que cette tolérance ne rattrape PAS, et il faut le savoir : `J'arrivée` (mesuré sur le même
 * segment faible) reste hors d'atteinte, parce qu'il n'y a plus de `arv` du tout. Aucune regex ne
 * répare un segment trop faible pour être entendu ; c'est le niveau d'entrée qu'il faut corriger,
 * pas le motif.
 */
const TOLERANCE_FIN = '[a-zà-öø-ÿ]{0,3}'

/**
 * Ce qui peut SEPARER deux mots d'un nom compose, tel que le moteur l'ecrit.
 *
 * DEFAUT VECU le 2026-09-02 (conv-113), assistant nomme « Machin Bidule » : whisper ponctue tout
 * seul (« Machin, bidule », « Machin. Bidule »). Le separateur n'admettait que l'espace, le trait
 * d'union et l'apostrophe, donc le nom ENTIER ne correspondait plus ; seul le raccourci « machin »
 * reveillait, et le reste du NOM — « bidule » — repartait comme ORDRE : dire son nom ouvrait une
 * conversation et payait un appel modele pour rien. La ponctuation courante est donc admise ENTRE
 * les mots du nom, et elle reste BORNEE a de la ponctuation : aucune lettre ne passe, donc un vrai
 * mot glisse entre les deux morceaux ne peut pas etre avale.
 */
const SEPARATEUR_NOM = "[\\s'’,.;:!?-]*"

/**
 * Le nom, ramene a des MOTS de lettres simples : « Jarvis » et « jarvis » sont le meme mot d'eveil,
 * et « Jean-Pierre » comme « Jean Pierre » donnent les deux memes mots.
 *
 * On garde TOUS les mots, plus seulement le premier : un nom compose dont on ne retenait que le
 * debut rendait l'assistant sourd a la moitie de son propre nom.
 */
function motsNom(nom: string): string[] {
  return (nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter((mot) => mot.length > 0)
}

/**
 * Un mot du nom, ecrit en motif : apostrophe toleree apres la premiere lettre, et fin libre a trois
 * lettres pres. Un mot de moins de 3 lettres ne tolere rien : « Al » elargi reveillerait
 * l'assistant sur « allo », « alors », « aller ».
 *
 * LA FIN LIBRE VAUT POUR CHAQUE MOT, pas seulement le dernier. Defaut vecu le 2026-09-02
 * (conv-108/109), assistant nomme « Machin bidule » : un mot NON final n'etait garde que sur ses
 * 4 premieres lettres SANS tolerance, donc `mach` devait etre suivi d'un separateur et
 * « machin bidule » ne correspondait JAMAIS au nom entier. Seul le raccourci « machin »
 * reveillait, et le reste du NOM — « bidule » — repartait comme ORDRE : dire son nom lancait une
 * tache appelee « bidule ». Le nom entier est essaye AVANT les raccourcis, donc il gagne.
 * La tolerance reste BORNEE (4 lettres exigees, 3 libres au plus) : la garde contre une piece
 * bruyante ne bouge pas.
 */
function motifMot(mot: string): string {
  if (mot.length < 3) return mot
  const prefixe = mot.slice(0, 4)
  return `${prefixe[0]}['’]?${prefixe.slice(1)}${TOLERANCE_FIN}`
}

const CACHE_EVEIL = new Map<string, RegExp>()

/**
 * Le motif d'eveil POUR LE NOM CHOISI.
 *
 * Le motif etait ecrit en dur sur « jarv » : renommer l'assistant changeait l'etiquette et RIEN
 * d'autre — il continuait de n'obeir qu'a « Jarvis » et restait sourd a son nouveau nom. Le motif
 * se construit donc a partir du nom regle, en gardant exactement les deux tolerances mesurees le
 * 2026-08-31 sur whisper.cpp, qui ne dependent pas du nom :
 *  - la FIN est libre a trois lettres pres (« jarvie », « jarviss ») : aucun moteur ne rend un nom
 *    propre au caractere pres ;
 *  - une APOSTROPHE peut s'inserer apres la premiere lettre (« J'arvie ») : artefact d'orthographe
 *    francaise, pas un autre mot.
 * La tolerance reste BORNEE : on exige les 4 premieres lettres du nom (ou le nom entier s'il est
 * plus court). Un nom de moins de 3 lettres ne tolere plus rien du tout — « Al » elargi de trois
 * lettres reveillerait l'assistant sur « allo », « alors », « aller ».
 */
function motifEveil(nom: string = NOM_JARVIS_DEFAUT): RegExp {
  const mots = motsNom(nom).length > 0 ? motsNom(nom) : motsNom(NOM_JARVIS_DEFAUT)
  const cle = mots.join(' ')
  const enCache = CACHE_EVEIL.get(cle)
  if (enCache) return enCache
  // Le nom ENTIER, essaye EN PREMIER : l'alternance retient la premiere branche qui reussit, donc
  // le nom complet l'emporte sur le raccourci et ne laisse aucun reste a prendre pour un ordre.
  // Les mots peuvent arriver colles, espaces, ou lies par un trait d'union ou une apostrophe,
  // selon ce que le moteur decide d'ecrire ; CHACUN garde sa fin libre a trois lettres pres.
  const complet = mots.map((mot) => motifMot(mot)).join(SEPARATEUR_NOM)
  // Le RACCOURCI : on appelle « Jean-Pierre » en disant « Jean ». Reserve aux mots d'au moins
  // quatre lettres — sur « Mon Ami », un eveil sur « mon » partirait a chaque phrase.
  const raccourcis = mots.length > 1 ? mots.filter((mot) => mot.length >= 4) : []
  const alternatives = [complet, ...raccourcis.map((mot) => motifMot(mot))]
  const motif = new RegExp('\\b(?:' + alternatives.join('|') + ')\\b', 'iu')
  CACHE_EVEIL.set(cle, motif)
  return motif
}

export function extraireCommandeEveil(texte: string, nom?: string): string | null {
  const correspondance = motifEveil(nom).exec(texte)
  if (!correspondance) return null
  const suite = texte
    .slice(correspondance.index + correspondance[0].length)
    .replace(/^[\s,.:;!?—-]+/u, '')
    .trim()
  return suite === '' ? null : suite
}

/** Le mot d'eveil est-il present, meme sans ordre derriere ? */
export function contientEveil(texte: string, nom?: string): boolean {
  return motifEveil(nom).test(texte)
}

export interface ReactionParole {
  etat: JarvisEcoute
  /** Il faut faire entendre l'accusé de réception : Jarvis vient de reconnaître son nom. */
  bip: boolean
  /** L'ordre à exécuter, s'il y en a un dans cette phrase. */
  ordre: string | null
}

/**
 * Ce que Jarvis FAIT d'une parole. Séparé de `appliquerParole` (qui ne gère que l'affichage)
 * parce que deux défauts réels vivent ici :
 *  - l'ordre pouvait arriver dans une phrase SÉPARÉE de l'éveil (« Jarvis. » … « ouvre le chat »).
 *    L'ancien code exigeait une seule phrase et restait muet : « il ne m'entend pas ».
 *  - sans accusé sonore, rien ne dit à l'utilisateur QUAND il peut parler. Le bip part sur le
 *    PARTIEL, dès le mot reconnu, une seule fois par phrase.
 */
export function reagirAParole(
  etat: JarvisEcoute,
  parole: { texte: string; final: boolean; le: number },
  nom?: string
): ReactionParole {
  if (!etat.active) return { etat, bip: false, ordre: null }
  // ENREGISTREMENT : on garde le texte, et c'est TOUT. Ni bip, ni ordre — même si le mot d'éveil
  // est prononcé. C'est la seule chose qui distingue « je note ce qui se dit » de « j'obéis ».
  if (etat.mode === 'enregistrement') {
    return { etat: appliquerParole(etat, parole), bip: false, ordre: null }
  }
  const eveilIci = contientEveil(parole.texte, nom)
  const bip = eveilIci && !etat.eveilAnnonce
  let suivant = appliquerParole(etat, parole)
  if (bip) suivant = { ...suivant, eveille: true, eveilAnnonce: true, eveilleLe: parole.le }
  // L'ÉVEIL PÉRIME. Passé la fenêtre, l'assistant est rendormi : la phrase en cours n'est plus un
  // ordre, elle n'est qu'une phrase.
  const eveilValide = etat.eveille && parole.le - etat.eveilleLe < FENETRE_EVEIL_MS
  if (!parole.final) return { etat: suivant, bip, ordre: null }

  const entendu = eveilIci
    ? extraireCommandeEveil(parole.texte, nom)
    : eveilValide
      ? parole.texte.trim() || null
      : null
  // REPUBLICATION : le même ordre redit dans la fenêtre est le MÊME ordre, pas un second. On le
  // laisse tomber SANS toucher au verrou : sinon deux copies suivies d'une troisième rouvriraient
  // la porte, et l'utilisateur paierait le tour qu'il n'a jamais demandé.
  const repete =
    entendu !== null &&
    etat.dernierOrdre !== null &&
    parole.le - etat.dernierOrdreLe < FENETRE_ORDRE_REPETE_MS &&
    memeOrdre(entendu, etat.dernierOrdre)
  const ordre = repete ? null : entendu
  return {
    etat: {
      ...suivant,
      eveilAnnonce: false,
      eveille: ordre === null && !repete && (eveilIci || eveilValide),
      eveilleLe: eveilIci ? parole.le : etat.eveilleLe,
      ...(ordre !== null ? { dernierOrdre: ordre, dernierOrdreLe: parole.le } : {})
    },
    bip,
    ordre
  }
}

/**
 * CE QUE L'UTILISATEUR DOIT LIRE quand l'ecoute s'arrete. Un code brut (« network ») ne dit rien ;
 * pire, `network` a longtemps ete rendu SILENCIEUX, si bien que le widget affichait « ecoute en
 * cours » sur un moteur mort. Chaque code nomme donc sa cause ET la sortie.
 */
/**
 * CETTE ERREUR SE RATTRAPE-T-ELLE EN RELANCANT LE MICRO ? C'est ce qui decide de l'affichage du
 * bouton « Réessayer le micro » : le proposer sur `network` (moteur Chromium injoignable) ou sur
 * un echec d'envoi ferait cliquer dans le vide.
 */
export function erreurRattrapableParMicro(code: string): boolean {
  return (
    code === 'not-allowed' ||
    code === 'service-not-allowed' ||
    code === 'micro-refuse' ||
    code === 'micro-absent' ||
    code === 'micro-occupe' ||
    code === 'micro-introuvable' ||
    code === 'micro-indisponible'
  )
}

/**
 * L'AUTORISATION WINDOWS PEUT-ELLE ETRE EN CAUSE ? Seul ce cas justifie d'ouvrir la page
 * « Microphone » des reglages : sur « aucun micro branche », y envoyer l'utilisateur lui ferait
 * regler un parametre deja bon — exactement le defaut du 2026-09-03. Le code generique y reste
 * parce que la cause n'y est PAS etablie.
 */
export function erreurDAutorisationMicro(code: string): boolean {
  return (
    code === 'not-allowed' ||
    code === 'service-not-allowed' ||
    code === 'micro-refuse' ||
    code === 'micro-indisponible'
  )
}

export function messageErreurMoteur(code: string): string {
  if (code === 'network') {
    return 'Le moteur de reconnaissance de Chromium est injoignable dans cette fenêtre (erreur « network ») : installez l’écoute hors ligne ci-dessous.'
  }
  // CINQ CAUSES, CINQ SORTIES. Une seule phrase pour toutes envoyait l'utilisateur chercher une
  // autorisation Windows deja accordee (mesure du 2026-09-03) : ici chaque cause nomme LE geste
  // qui la leve, et le bouton « Réessayer le micro » du widget est a cote de la phrase.
  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'micro-refuse') {
    return 'Micro refusé pour Autowin OS : autorisez le microphone dans Windows (Confidentialité → Microphone), puis réessayez.'
  }
  if (code === 'micro-absent') {
    return 'Aucun micro disponible sur cette machine : branchez un micro ou un casque, puis réessayez. En session à distance, le micro n’arrive que si la redirection audio est activée côté client.'
  }
  if (code === 'micro-occupe') {
    return 'Le micro est déjà pris par une autre application (visio, enregistreur) : libérez-le, puis réessayez.'
  }
  if (code === 'micro-introuvable') {
    return 'Le micro choisi dans « Paramètres audio » n’existe plus : choisissez-en un autre, puis réessayez.'
  }
  if (code === 'micro-indisponible') {
    return 'Micro indisponible : l’entrée audio n’a pas pu s’ouvrir. Vérifiez le micro choisi dans « Paramètres audio », puis réessayez.'
  }
  if (code === 'transcription-impossible') {
    return 'La reconnaissance locale n’a pas pu transcrire : réinstallez l’écoute hors ligne.'
  }
  return `Reconnaissance vocale interrompue : ${code}`
}

/**
 * CE QUE JARVIS DIT À VOIX HAUTE — et surtout QUAND IL SE TAIT.
 *
 * Jusqu'ici Jarvis entendait mais ne répondait jamais : l'utilisateur parlait, un bip confirmait,
 * puis plus rien jusqu'à ce qu'il retourne lire l'écran. La réponse parlée est ce qui manque pour
 * ne plus avoir à regarder.
 *
 * Deux gardes, et elles ne sont pas décoratives :
 *  - micro coupé => MUET. Un moteur rend encore des résultats après l'ordre d'arrêt ; une phrase
 *    parlée déclenchée par ce résidu ferait parler Jarvis tout seul, écoute éteinte.
 *  - mode enregistrement => MUET. C'est la définition même du mode : on note ce qui se dit dans la
 *    pièce, Jarvis n'y intervient pas. Une voix qui commente pendant une réunion est le pire défaut
 *    possible ici — même garde que le bip, au même endroit.
 */
export type GenreParole = 'ordre' | 'fin' | 'erreur'

export interface EvenementParle {
  genre: GenreParole
  /** Le titre de la conversation concernée, quand il y en a un. Jamais lu tel quel : voir plus bas. */
  sujet?: string
}

/** Au-delà, un titre lu à voix haute devient une tirade : on le coupe. */
const MAX_SUJET = 48

function sujetLisible(sujet: string | undefined): string {
  const propre = (sujet ?? '').replace(/\s+/gu, ' ').trim()
  if (propre === '') return ''
  return propre.length <= MAX_SUJET ? propre : `${propre.slice(0, MAX_SUJET).trimEnd()}…`
}

/**
 * La phrase à prononcer, ou `null` s'il ne faut RIEN dire. Fonction pure : c'est ici que les gardes
 * se prouvent sans micro ni haut-parleur.
 */
export function phraseDeJarvis(etat: JarvisEcoute, evenement: EvenementParle): string | null {
  if (!etat.active) return null
  if (etat.mode === 'enregistrement') return null
  const sujet = sujetLisible(evenement.sujet)
  if (evenement.genre === 'ordre') return 'Tout de suite.'
  if (evenement.genre === 'fin') return sujet === '' ? 'C’est fait.' : `C’est fait : ${sujet}.`
  return sujet === '' ? 'Je n’ai pas pu.' : `Je n’ai pas pu : ${sujet}.`
}

/**
 * UNE PHRASE QUE L'ASSISTANT A DITE À VOIX HAUTE, et quand.
 *
 * DÉFAUT VÉCU le 2026-09-02 : le micro reste ouvert pendant que l'assistant parle. « Tout de
 * suite. » et « C'est fait : <titre>. » repartent donc dans la reconnaissance, s'inscrivent comme
 * une parole de l'utilisateur — et, si l'éveil était armé, s'ENVOIENT comme ordre. Fermer le micro
 * pendant qu'il parle n'est PAS la solution : enchaîner un second ordre pendant « Tout de suite. »
 * est légitime et doit passer. On reconnaît donc SA propre phrase, elle seule.
 */
export interface PhraseDite {
  texte: string
  le: number
}

/** Au-delà, une phrase dite ne peut plus revenir par le micro : ce serait une vraie parole. */
export const FENETRE_ECHO_MS = 6_000

/** Les dernières phrases dites suffisent : deux peuvent se chevaucher (fin de tour + erreur). */
const MAX_DITES = 4

function nettoyerParle(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
}

export function retenirPhraseDite(
  dites: readonly PhraseDite[],
  phrase: string,
  le: number
): PhraseDite[] {
  const propre = nettoyerParle(phrase)
  if (propre === '') return [...dites]
  return [{ texte: propre, le }, ...dites].slice(0, MAX_DITES)
}

/**
 * Ce texte entendu est-il l'assistant qui s'entend lui-même ?
 *
 * La comparaison est par INCLUSION dans les deux sens, sur du texte réduit aux lettres : la
 * reconnaissance rend rarement la phrase entière (« c'est fait », « tout de suite ouvre le »), et
 * elle peut aussi ajouter du bruit autour. Bornée à la fenêtre d'écho et à un texte assez long
 * pour être significatif — un « oui » ne doit pas être avalé sous prétexte que l'assistant l'a dit.
 */
export function estEcho(texte: string, dites: readonly PhraseDite[], now: number): boolean {
  const propre = nettoyerParle(texte)
  if (propre.length < 6) return false
  return dites.some(
    (d) =>
      now - d.le < FENETRE_ECHO_MS &&
      (d.texte.includes(propre) || propre.includes(d.texte))
  )
}
