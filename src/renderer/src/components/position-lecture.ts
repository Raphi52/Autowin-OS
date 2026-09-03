/**
 * MEMOIRE de la position de lecture, PAR conversation.
 *
 * Demande utilisateur du 2026-08-30 : « quand je switch de conversation et que je reviens, des fois
 * ça me remonte le fil pas du tout là où j'en étais ». L'ouverture visait TOUJOURS le bas
 * (`scrollChatToBottom`), et aucune position n'était retenue : revenir sur une conversation qu'on
 * lisait au milieu perdait l'endroit.
 *
 * Règle de conception : on ne mémorise QUE le fait d'être remonté dans le fil. Un lecteur collé au
 * bas n'a pas de « position » — son intention est de suivre la queue, et la mémoriser figerait le
 * fil sur un bas périmé au tour suivant. D'où l'effacement explicite en bas de fil.
 *
 * `localStorage`, comme `derniere-conversation.ts` : préférence d'affichage locale, hors des données
 * partagées d'une conversation.
 */
import { isChatNearBottom } from './chat-view-model'

export const CLE_POSITION_LECTURE = 'autowin.chat.positionLecture'

export type PositionLecture = {
  /** Décalage vertical en px, ancré depuis le HAUT. REPLI seulement : voir `ancre`. */
  top: number
  /** Hauteur totale au moment de la mémorisation, pour diagnostiquer un fil raccourci. */
  hauteur: number
  /**
   * ANCRE STRUCTURELLE : rang du message affiché en haut du champ de lecture, et décalage en px
   * entre le haut de CE message et le haut du champ.
   *
   * Le px absolu ne suffit pas — défaut rapporté le 2026-08-30 : « c'est quand l'agent a écrit
   * entre temps ». Un tour écrit pendant l'absence change la HAUTEUR du contenu situé AU-DESSUS du
   * point de lecture (cartes d'activité repliées à la relecture, blocs rendus autrement qu'en
   * cours de stream) : le même `scrollTop` ne désigne alors plus le même message. Le rang, lui,
   * survit à l'ajout de messages EN FIN de fil, qui est le seul ajout possible.
   */
  ancre?: { index: number; decalage: number }
}

/** Métriques minimales d'un message rendu : son haut, relatif au conteneur de défilement. */
export type AncrageMessage = { offsetTop: number }

type Carte = Record<string, PositionLecture>

function lireCarte(): Carte {
  try {
    const brut = window.localStorage.getItem(CLE_POSITION_LECTURE)
    if (!brut) return {}
    const parse: unknown = JSON.parse(brut)
    if (!parse || typeof parse !== 'object' || Array.isArray(parse)) return {}
    return parse as Carte
  } catch {
    // Stockage indisponible OU contenu corrompu : la reprise est un confort, pas un invariant.
    return {}
  }
}

function ecrireCarte(carte: Carte): void {
  try {
    window.localStorage.setItem(CLE_POSITION_LECTURE, JSON.stringify(carte))
  } catch {
    // idem : jamais casser une navigation pour une préférence.
  }
}

/** Retient la position courante, ou l'OUBLIE si le lecteur est collé au bas. */
export function memoriserPositionLecture(
  conversationId: string,
  metrics: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>,
  messages?: readonly AncrageMessage[]
): void {
  if (!conversationId) return
  if (isChatNearBottom(metrics)) {
    oublierPositionLecture(conversationId)
    return
  }
  const carte = lireCarte()
  const ancre = ancrerSurMessage(metrics.scrollTop, messages)
  carte[conversationId] = {
    top: Math.round(metrics.scrollTop),
    hauteur: Math.round(metrics.scrollHeight),
    ...(ancre ? { ancre } : {})
  }
  ecrireCarte(carte)
}

/**
 * Dernier message dont le HAUT est encore au-dessus de la ligne de lecture : c'est celui que l'œil
 * a en haut d'écran. On garde son rang plus le décalage, pour reposer l'œil au même endroit même
 * si les hauteurs du fil ont bougé entre-temps.
 */
function ancrerSurMessage(
  scrollTop: number,
  messages?: readonly AncrageMessage[]
): { index: number; decalage: number } | undefined {
  if (!messages || messages.length === 0) return undefined
  let index = -1
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].offsetTop <= scrollTop + 1) index = i
    else break
  }
  if (index < 0) return undefined
  return { index, decalage: Math.round(scrollTop - messages[index].offsetTop) }
}

export function positionLectureMemorisee(conversationId: string): PositionLecture | undefined {
  const entree = lireCarte()[conversationId]
  if (!entree || typeof entree.top !== 'number' || !Number.isFinite(entree.top)) return undefined
  if (entree.top <= 0) return undefined
  const ancre = entree.ancre
  const ancreValide =
    !!ancre &&
    Number.isFinite(ancre.index) &&
    ancre.index >= 0 &&
    Number.isFinite(ancre.decalage)
  return {
    top: entree.top,
    hauteur: Number(entree.hauteur) || 0,
    ...(ancreValide ? { ancre: { index: ancre.index, decalage: ancre.decalage } } : {})
  }
}

export function oublierPositionLecture(conversationId: string): void {
  const carte = lireCarte()
  if (!(conversationId in carte)) return
  delete carte[conversationId]
  ecrireCarte(carte)
}

type ScrollableChat = Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'> & {
  scrollTo(options: ScrollToOptions): void
  isConnected?: boolean
}

/**
 * Replace le fil sur `position` et l'Y MAINTIENT pendant les frames de rendu.
 *
 * Un unique `scrollTop = top` ne tient pas : le markdown, les images et les cartes d'activité se
 * rendent APRÈS, et le navigateur repose le fil en haut (défaut déjà mesuré pour la descente, cf.
 * `scrollChatToBottom`). On ré-applique donc la cible à chaque frame tant que la position n'est pas
 * tenue, en clampant sur les bornes réelles (fil raccourci depuis la mémorisation).
 *
 * Garde : si le lecteur bouge LUI-MÊME alors que la cible était déjà tenue, on lui rend la main.
 */
export function restaurerPositionLecture(
  element: ScrollableChat,
  position: PositionLecture,
  schedule: (callback: () => void) => void = requestAnimationFrame,
  maxFrames = 20,
  onSettled?: (landed: boolean) => void,
  /** Relit les messages RENDUS à chaque frame : leurs hauteurs bougent pendant le rendu. */
  lireMessages?: () => readonly AncrageMessage[]
): void {
  let frames = 0
  let tenueDepuis = 0
  const brute = (): number => {
    const ancre = position.ancre
    if (!ancre || !lireMessages) return position.top
    const vise = lireMessages()[ancre.index]
    // Fil raccourci (message supprimé, fil tronqué) : on retombe sur le px, faute de mieux.
    if (!vise) return position.top
    return vise.offsetTop + ancre.decalage
  }
  const cible = (): number =>
    Math.max(0, Math.min(brute(), element.scrollHeight - element.clientHeight))
  const step = (): void => {
    if (element.isConnected === false) return
    const but = cible()
    const ecart = Math.abs(element.scrollTop - but)
    if (ecart <= 4) {
      tenueDepuis += 1
    } else if (tenueDepuis >= 2) {
      // La cible avait été tenue puis quittée sans re-rendu : c'est un geste de lecture.
      onSettled?.(true)
      return
    } else {
      element.scrollTo({ top: but, behavior: 'auto' })
      tenueDepuis = 0
    }
    frames += 1
    if (frames >= maxFrames || tenueDepuis >= 3)
      onSettled?.(Math.abs(element.scrollTop - cible()) <= 4)
    else schedule(step)
  }
  step()
}
