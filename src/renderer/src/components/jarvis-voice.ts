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
}

/** Au-delà, l'historique parlé n'est plus lu — il ne sert qu'à vérifier ce que Jarvis a entendu. */
const MAX_COMMANDES = 40

export const ecouteInitiale: JarvisEcoute = {
  active: false,
  mode: 'jarvis',
  partiel: '',
  commandes: [],
  eveille: false,
  eveilAnnonce: false
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
export const FENETRE_DIRECT_MS = 10 * 60_000
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
 * Un mot du nom, ecrit en motif : apostrophe toleree apres la premiere lettre, et — pour le mot
 * qui TERMINE l'appel — fin libre a trois lettres pres. Un mot de moins de 3 lettres ne tolere
 * rien : « Al » elargi reveillerait l'assistant sur « allo », « alors », « aller ».
 */
function motifMot(mot: string, finLibre: boolean): string {
  if (mot.length < 3) return mot
  const prefixe = mot.slice(0, 4)
  return `${prefixe[0]}['’]?${prefixe.slice(1)}${finLibre ? TOLERANCE_FIN : ''}`
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
export function motifEveil(nom: string = NOM_JARVIS_DEFAUT): RegExp {
  const mots = motsNom(nom).length > 0 ? motsNom(nom) : motsNom(NOM_JARVIS_DEFAUT)
  const cle = mots.join(' ')
  const enCache = CACHE_EVEIL.get(cle)
  if (enCache) return enCache
  // Le nom ENTIER : les mots peuvent arriver colles, espaces, ou lies par un trait d'union ou une
  // apostrophe, selon ce que le moteur decide d'ecrire. Seul le DERNIER mot a la fin libre.
  const complet = mots
    .map((mot, index) => motifMot(mot, index === mots.length - 1))
    .join("[\\s'’-]*")
  // Le RACCOURCI : on appelle « Jean-Pierre » en disant « Jean ». Reserve aux mots d'au moins
  // quatre lettres — sur « Mon Ami », un eveil sur « mon » partirait a chaque phrase.
  const raccourcis = mots.length > 1 ? mots.filter((mot) => mot.length >= 4) : []
  const alternatives = [complet, ...raccourcis.map((mot) => motifMot(mot, true))]
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
  if (bip) suivant = { ...suivant, eveille: true, eveilAnnonce: true }
  if (!parole.final) return { etat: suivant, bip, ordre: null }

  const ordre = eveilIci
    ? extraireCommandeEveil(parole.texte, nom)
    : etat.eveille
      ? parole.texte.trim() || null
      : null
  return {
    etat: {
      ...suivant,
      eveilAnnonce: false,
      eveille: ordre === null && (eveilIci || etat.eveille)
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
export function messageErreurMoteur(code: string): string {
  if (code === 'network') {
    return 'Le moteur de reconnaissance de Chromium est injoignable dans cette fenêtre (erreur « network ») : installez l’écoute hors ligne ci-dessous.'
  }
  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'micro-indisponible') {
    return 'Micro indisponible : autorisez le microphone pour Autowin OS, puis réactivez l’écoute.'
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
