/**
 * ASCENSEUR DU FIL À CRANS — la logique, hors du composant.
 *
 * Demande conv-1114 (2026-10-23) : « une scroll bar dans les convs sophistiquées avec snappoints
 * pour mes messages », arrêtée par /draft sur « 1 · Dépli en place » : au repos une barre fine de
 * 18 px avec un cran par message de l'utilisateur ; dès la molette, elle se déplie en carte du fil
 * de 72 px ; la vue s'AIMANTE sur ses messages.
 *
 * Fichier séparé du composant pour la même raison que `chat-mesure-messages.ts` : un module de
 * composant qui exporte aussi des fonctions casse le rafraîchissement à chaud.
 */

/** Écart entre le haut de la vue et le haut de ta bulle quand la vue est aimantée. */
export const MARGE_AIMANT = 10
/** Marge haute et basse de la piste dans la barre : les crans extrêmes restent visibles. */
export const MARGE_PISTE = 12
/** Hauteur minimale de la poignée, pour qu'elle reste saisissable dans un très long fil. */
const POIGNEE_MIN = 20
/** Distance sur la piste (px) sous laquelle le pointeur vise un cran. */
const TOLERANCE_SURVOL = 6

/** Un message du fil, mesuré dans le CONTENU du conteneur de défilement. */
export type Repere = {
  haut: number
  hauteur: number
  role: 'user' | 'assistant'
  /** Rang parmi TES messages (1 = le premier du fil). 0 pour une réponse de l'agent. */
  numero: number
  heure: string
  texte: string
}

export type Geometrie = { scrollTop: number; clientHeight: number; scrollHeight: number }

const borner = (valeur: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, valeur))

const maxDefilement = (geo: Geometrie): number => Math.max(0, geo.scrollHeight - geo.clientHeight)

/** `scrollTop` qui pose ce message à `MARGE_AIMANT` du haut de la vue, borné au fil. */
export function hautDeVuePour(repere: Pick<Repere, 'haut'>, geo: Geometrie): number {
  return Math.round(borner(repere.haut - MARGE_AIMANT, 0, maxDefilement(geo)))
}

/**
 * Cible de l'aimant : la position calée sur le message le plus proche, s'il est à moins de `seuil`
 * px de la vue courante. `null` quand rien n'est assez proche OU que la vue est déjà calée (sinon
 * chaque fin de défilement relancerait une animation pour rien).
 */
export function cibleAimant(
  geo: Geometrie,
  crans: readonly Repere[],
  seuil: number
): number | null {
  let meilleure: number | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const cran of crans) {
    const cible = hautDeVuePour(cran, geo)
    const ecart = Math.abs(cible - geo.scrollTop)
    if (ecart < distance) {
      distance = ecart
      meilleure = cible
    }
  }
  if (meilleure === null || distance <= 1 || distance > seuil) return null
  return meilleure
}

/**
 * Seuil de l'aimant après la MOLETTE : 15 % de la vue, plafonné à 72 px. Au-delà, on lit une
 * longue réponse au milieu, et la vue ne doit pas être tirée ailleurs.
 */
export function seuilMolette(clientHeight: number): number {
  return Math.min(72, Math.round(clientHeight * 0.15))
}

/**
 * Ce coup de molette va-t-il faire défiler le fil ? Non en BUTÉE : tout en haut vers le haut, tout
 * en bas vers le bas (à 1 px près, `scrollTop` est fractionnaire). Demande conv-1114 : en butée, la
 * carte ne doit pas s'ouvrir quand on continue de tourner la molette.
 */
export function moletteFaitDefiler(deltaY: number, geo: Geometrie): boolean {
  if (deltaY < 0) return geo.scrollTop > 0.5
  if (deltaY > 0) return geo.scrollTop < maxDefilement(geo) - 1
  return false
}

/**
 * Durée du glissement vers une cible (ms) : bref pour un recalage de l'aimant, plus long pour un
 * grand saut, plafonné pour qu'un clic sur un cran lointain ne traîne pas.
 */
export function dureeGlisse(ecart: number): number {
  return Math.round(Math.min(420, 160 + Math.abs(ecart) * 0.06))
}

/**
 * Position du glissement après `ecoule` ms sur `duree` (décélération cubique). La vue glisse
 * elle-même, image par image : `scrollTo({ behavior: 'smooth' })` sautait d'un coup sur ce poste,
 * qui a la réduction des animations active (sonde conv-1114 : 4 668 -> 4 618 px en une image).
 */
export function positionGlissee(
  depart: number,
  ecart: number,
  ecoule: number,
  duree: number
): number {
  const p = duree > 0 ? Math.min(1, Math.max(0, ecoule / duree)) : 1
  return depart + ecart * (1 - Math.pow(1 - p, 3))
}

/** Message sur lequel la vue est exactement calée (pour allumer son cran), sinon `null`. */
export function cranCale(geo: Geometrie, crans: readonly Repere[]): Repere | null {
  return crans.find((cran) => Math.abs(hautDeVuePour(cran, geo) - geo.scrollTop) <= 2) ?? null
}

/**
 * Message « à l'écran » : le dernier dont le haut est passé au-dessus de la ligne d'aimant ; en
 * haut du fil, avant toute ligne passée, le premier visible.
 */
export function cranCourant(geo: Geometrie, crans: readonly Repere[]): Repere | null {
  const ligne = geo.scrollTop + MARGE_AIMANT + 1
  let courant: Repere | null = null
  for (const cran of crans) {
    if (cran.haut <= ligne) courant = cran
    else break
  }
  if (courant) return courant
  const premier = crans[0]
  return premier && premier.haut < geo.scrollTop + geo.clientHeight ? premier : null
}

const longueurPiste = (hauteurBarre: number): number => Math.max(1, hauteurBarre - 2 * MARGE_PISTE)

/** Position sur la piste (px dans la barre) d'un point du fil. */
export function versPiste(y: number, scrollHeight: number, hauteurBarre: number): number {
  if (scrollHeight <= 0) return MARGE_PISTE
  return MARGE_PISTE + (y / scrollHeight) * longueurPiste(hauteurBarre)
}

/** Point du fil sous une position de la piste, borné au fil. */
export function depuisPiste(yPiste: number, scrollHeight: number, hauteurBarre: number): number {
  const fraction = (yPiste - MARGE_PISTE) / longueurPiste(hauteurBarre)
  return borner(fraction * scrollHeight, 0, scrollHeight)
}

/**
 * La poignée (barre fine) ou le cadre (carte) : la VUE rapportée à la piste. Avec une hauteur
 * minimale, la course se fait sur `piste − hauteur`, sinon la poignée sortirait de la piste en bas.
 */
export function poignee(geo: Geometrie, hauteurBarre: number): { haut: number; hauteur: number } {
  const piste = longueurPiste(hauteurBarre)
  const hauteur =
    geo.scrollHeight > 0
      ? Math.max(POIGNEE_MIN, Math.min(piste, (geo.clientHeight / geo.scrollHeight) * piste))
      : piste
  const max = maxDefilement(geo)
  const fraction = max > 0 ? borner(geo.scrollTop / max, 0, 1) : 0
  return {
    haut: Math.round(MARGE_PISTE + fraction * (piste - hauteur)),
    hauteur: Math.round(hauteur)
  }
}

/** `scrollTop` après un glisser de la poignée de `dyPiste` px depuis `depart`. */
export function scrollTopApresGlisse(
  depart: number,
  dyPiste: number,
  geo: Geometrie,
  hauteurBarre: number
): number {
  const max = maxDefilement(geo)
  const course = longueurPiste(hauteurBarre) - poignee(geo, hauteurBarre).hauteur
  if (course <= 0 || max <= 0) return borner(depart, 0, max)
  return Math.round(borner(depart + (dyPiste / course) * max, 0, max))
}

/** Le cran dont le haut est le plus proche d'un point du fil. */
export function cranLePlusProche(yContenu: number, crans: readonly Repere[]): Repere | null {
  let meilleur: Repere | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const cran of crans) {
    const ecart = Math.abs(cran.haut - yContenu)
    if (ecart < distance) {
      distance = ecart
      meilleur = cran
    }
  }
  return meilleur
}

/** Cran visé par le pointeur sur la piste (aperçu au survol), à `TOLERANCE_SURVOL` px près. */
export function cranSousPointeur(
  yPiste: number,
  crans: readonly Repere[],
  scrollHeight: number,
  hauteurBarre: number
): Repere | null {
  let meilleur: Repere | null = null
  let distance = TOLERANCE_SURVOL + 0.001
  for (const cran of crans) {
    const ecart = Math.abs(versPiste(cran.haut, scrollHeight, hauteurBarre) - yPiste)
    if (ecart < distance) {
      distance = ecart
      meilleur = cran
    }
  }
  return meilleur
}

/** Début d'un message sur une seule ligne, pour l'aperçu. */
export function resumerTexte(texte: string, max = 90): string {
  const ligne = texte.replace(/\s+/g, ' ').trim()
  return ligne.length <= max ? ligne : `${ligne.slice(0, max - 1)}…`
}

/** Les éléments du fil que la barre suit : tes messages et les réponses de l'agent. */
export const SELECTEUR_MESSAGES =
  '[data-origine="message-utilisateur"], [data-origine="reponse-agent"]'

/**
 * Haut d'un élément dans le CONTENU du conteneur de défilement, lu dans la MISE EN PAGE (chaîne des
 * `offsetTop`) et non à l'écran. Les messages entrent avec `.fade-in` (translateY 3 px, theme.css) :
 * mesurée pendant l'animation, la position à l'écran est décalée d'autant, et aucun changement de
 * taille ne vient la corriger ensuite. Mesuré par la sonde conv-1114 : bulle calée à 7 px au lieu
 * de 10 après un clic sur son cran.
 */
export function hautDansLeContenu(element: HTMLElement, conteneur: HTMLElement): number {
  const parentDuConteneur = conteneur.offsetParent
  let y = 0
  let noeud: HTMLElement | null = element
  while (noeud && noeud !== conteneur && noeud !== parentDuConteneur) {
    y += noeud.offsetTop
    noeud = noeud.offsetParent as HTMLElement | null
  }
  // Fil positionné : les offsetTop sont déjà dans son repère. Sinon, on retire sa propre place.
  if (noeud === conteneur) return y
  return y - conteneur.offsetTop - (conteneur.clientTop || 0)
}

/**
 * Mesure les messages RENDUS du fil, dans le repère du contenu. `numeroDepart` = nombre de tes
 * messages pas encore rendus en haut du fil (rendu par tranches, `fil-progressif.ts`) : la
 * numérotation reste celle du fil entier.
 */
export function lireReperes(conteneur: HTMLElement, numeroDepart = 0): Repere[] {
  let numero = numeroDepart
  return Array.from(conteneur.querySelectorAll<HTMLElement>(SELECTEUR_MESSAGES)).map((element) => {
    const role = element.dataset.origine === 'message-utilisateur' ? 'user' : 'assistant'
    if (role === 'user') numero += 1
    return {
      haut: Math.round(hautDansLeContenu(element, conteneur)),
      hauteur: Math.round(element.offsetHeight),
      role,
      numero: role === 'user' ? numero : 0,
      heure: role === 'user' ? (element.querySelector('.msg-time')?.textContent ?? '').trim() : '',
      texte:
        role === 'user' ? resumerTexte(element.querySelector('.msg-body')?.textContent ?? '') : ''
    }
  })
}
