/**
 * Jarvis : l'écoute continue et le monitoring des conversations, en fonctions PURES.
 *
 * Le micro et le rendu vivent dans le widget ; ici il n'y a que des décisions. C'est là que se
 * trouvent les défauts : un moteur de reconnaissance vocale rend encore des résultats APRÈS l'ordre
 * d'arrêt (dernier segment mis en file), donc la question « cette parole compte-t-elle ? » ne peut
 * pas dépendre de l'état du micro — elle dépend de l'interrupteur du widget, et de lui seul.
 */

export interface JarvisCommande {
  id: string
  texte: string
  le: number
}

export interface JarvisEcoute {
  /** L'interrupteur du widget. Aucune parole ne compte quand il est à false. */
  active: boolean
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
  partiel: '',
  commandes: [],
  eveille: false,
  eveilAnnonce: false
}

/**
 * Allume ou coupe l'écoute. Couper VIDE le partiel : une phrase inachevée affichée alors que le
 * micro est éteint ferait croire que Jarvis écoute encore. L'historique figé, lui, reste.
 */
export function basculerEcoute(etat: JarvisEcoute, le: number): JarvisEcoute {
  void le
  return etat.active
    ? { ...etat, active: false, partiel: '', eveille: false, eveilAnnonce: false }
    : { ...etat, active: true, eveille: false, eveilAnnonce: false }
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
 */
const EVEIL = /\bjarv[a-zà-öø-ÿ]{0,3}\b/iu

export function extraireCommandeEveil(texte: string): string | null {
  const correspondance = EVEIL.exec(texte)
  if (!correspondance) return null
  const suite = texte
    .slice(correspondance.index + correspondance[0].length)
    .replace(/^[\s,.:;!?—-]+/u, '')
    .trim()
  return suite === '' ? null : suite
}

/** Le mot d'éveil est-il présent, même sans ordre derrière ? */
export function contientEveil(texte: string): boolean {
  return EVEIL.test(texte)
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
  parole: { texte: string; final: boolean; le: number }
): ReactionParole {
  if (!etat.active) return { etat, bip: false, ordre: null }
  const eveilIci = contientEveil(parole.texte)
  const bip = eveilIci && !etat.eveilAnnonce
  let suivant = appliquerParole(etat, parole)
  if (bip) suivant = { ...suivant, eveille: true, eveilAnnonce: true }
  if (!parole.final) return { etat: suivant, bip, ordre: null }

  const ordre = eveilIci
    ? extraireCommandeEveil(parole.texte)
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
