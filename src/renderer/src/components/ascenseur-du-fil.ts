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
  /**
   * L'élément du message dans le fil. Un glissement vers lui relit sa place à chaque image : le
   * texte au-dessus peut se réagencer pendant le trajet (la carte décale le fil, conv-1114).
   */
  element?: HTMLElement
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
 *
 * `sens` : celui de la molette (1 = vers le bas, -1 = vers le haut, 0 = aucun, pour le relâchement
 * de la barre). Avec un sens, seul un message DANS ce sens peut tirer la vue. Sans lui, mesuré le
 * 2026-10-25 (conv-1139, « quand je scroll down ça remonte tout seul ») : un cran vers le bas qui
 * dépassait ton message de moins de 72 px était ramené en arrière sur lui, 4 essais sur 4.
 */
export function cibleAimant(
  geo: Geometrie,
  crans: readonly Repere[],
  seuil: number,
  sens: -1 | 0 | 1 = 0
): number | null {
  let meilleure: number | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const cran of crans) {
    const cible = hautDeVuePour(cran, geo)
    const ecart = cible - geo.scrollTop
    // Déjà calée sur un message : rien à rejouer, quel que soit le sens.
    if (Math.abs(ecart) <= 1) return null
    if (sens !== 0 && Math.sign(ecart) !== sens) continue
    if (Math.abs(ecart) < distance) {
      distance = Math.abs(ecart)
      meilleure = cible
    }
  }
  if (meilleure === null || distance > seuil) return null
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

/**
 * `scrollTop` qui CENTRE le cadre de la vue sur la souris posée à `yPiste` : la barre est un curseur
 * qu'on attrape et qu'on clique n'importe où (demande conv-1114, « la barre doit slider et je dois
 * pouvoir clicker n'importe où dessus »).
 */
export function scrollTopSousPointeur(
  yPiste: number,
  geo: Geometrie,
  hauteurBarre: number
): number {
  const max = maxDefilement(geo)
  const cadre = poignee(geo, hauteurBarre).hauteur
  const course = longueurPiste(hauteurBarre) - cadre
  if (course <= 0 || max <= 0) return 0
  return Math.round(borner((yPiste - MARGE_PISTE - cadre / 2) / course, 0, 1) * max)
}

/**
 * Les crans du curseur : une position glissée s'arrête sur ton message dont la position calée est à
 * moins de `tolerance` px DE PISTE (sous la souris, pas en px de fil : dans un long fil, 1 px de
 * barre vaut des dizaines de px de fil, et un seuil en px de fil ne s'atteindrait jamais).
 */
export function aimanterSurPiste(
  scrollTop: number,
  geo: Geometrie,
  crans: readonly Repere[],
  hauteurBarre: number,
  tolerance = 6
): { scrollTop: number; cran: Repere | null } {
  const max = maxDefilement(geo)
  const course = longueurPiste(hauteurBarre) - poignee(geo, hauteurBarre).hauteur
  if (max <= 0 || course <= 0) return { scrollTop, cran: null }
  let meilleur: Repere | null = null
  let distance = tolerance + 0.001
  for (const cran of crans) {
    const ecart = (Math.abs(hautDeVuePour(cran, geo) - scrollTop) / max) * course
    if (ecart < distance) {
      distance = ecart
      meilleur = cran
    }
  }
  return meilleur
    ? { scrollTop: hautDeVuePour(meilleur, geo), cran: meilleur }
    : { scrollTop, cran: null }
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

/**
 * Centres des aperçus de tes messages, carte ouverte (conv-1114 : « pendant que je scroll je veux
 * voir toutes les popups que je vois quand je hover mes msg »). Chaque aperçu (hauteur `hauteur`) se
 * pose en face de son cran (`ancres`, croissantes) ; des aperçus qui se chevaucheraient forment un
 * GROUPE, collé et centré au mieux sur ses crans, borné à [min, max]. `null` s'ils ne tiennent pas.
 */
export function placerEtiquettes(
  ancres: readonly number[],
  hauteur: number,
  min: number,
  max: number
): number[] | null {
  if (ancres.length === 0) return []
  if (ancres.length * hauteur > max - min) return null
  type Groupe = { debut: number; nombre: number; haut: number }
  const hautIdeal = (debut: number, nombre: number): number => {
    let somme = 0
    for (let j = 0; j < nombre; j++) somme += ancres[debut + j] - hauteur / 2 - j * hauteur
    const haut = Math.round(somme / nombre)
    return Math.max(min, Math.min(max - nombre * hauteur, haut))
  }
  const groupes: Groupe[] = []
  ancres.forEach((_, i) => {
    groupes.push({ debut: i, nombre: 1, haut: hautIdeal(i, 1) })
    // Tant que le dernier groupe empiète sur le précédent, ils n'en font plus qu'un.
    while (groupes.length > 1) {
      const dernier = groupes[groupes.length - 1]
      const avant = groupes[groupes.length - 2]
      if (avant.haut + avant.nombre * hauteur <= dernier.haut) break
      groupes.pop()
      avant.nombre += dernier.nombre
      avant.haut = hautIdeal(avant.debut, avant.nombre)
    }
  })
  return groupes.flatMap((g) =>
    Array.from({ length: g.nombre }, (_, j) => g.haut + j * hauteur + hauteur / 2)
  )
}

/**
 * Les aperçus montrés pendant le défilement (conv-1114 : « ça doit afficher que celui d'en bas et
 * celui au-dessus de là où je suis », puis « montre aussi le message d'avant celui que je lis ») :
 * AVANT, ton dernier message passé sous la ligne d'aimant — celui dont tu lis la réponse ; PRÉCÉDENT,
 * celui d'avant ; APRÈS, le suivant. Aux bouts du fil, il en manque.
 */
export function voisinsDeLaVue(
  geo: Geometrie,
  crans: readonly Repere[]
): { precedent: Repere | null; avant: Repere | null; apres: Repere | null } {
  const ligne = geo.scrollTop + MARGE_AIMANT + 1
  let precedent: Repere | null = null
  let avant: Repere | null = null
  let apres: Repere | null = null
  for (const cran of crans) {
    if (cran.haut <= ligne) {
      precedent = avant
      avant = cran
    } else {
      apres = cran
      break
    }
  }
  return { precedent, avant, apres }
}

/** Écart entre le bord gauche de la carte ouverte et le texte qu'elle a poussé. */
export const ECART_CARTE = 8

/**
 * Marge droite du fil pendant que la carte est ouverte : la conversation est DÉCALÉE, pas masquée
 * (conv-1114, « ça doit décaler la conv et pas la masquer »). Le fil n'a que 12 px de marge (mesuré
 * dans l'app à 1 150, 1 400 et 1 800 px) : la décaler par une translation aurait coupé 60 px à
 * gauche ; on lui réserve donc la place de la carte à droite. Une marge déjà assez large ne change
 * pas.
 */
export function reserveDeLaCarte(paddingDroit: number, largeurCarte: number): number {
  const actuel = Number.isFinite(paddingDroit) ? paddingDroit : 0
  return Math.max(actuel, largeurCarte + ECART_CARTE)
}

/**
 * Élément en HAUT de la vue, juste sous la ligne d'aimant : c'est lui qui doit rester immobile à
 * l'écran pendant que le fil se rétrécit ou s'élargit — comme l'ancrage du navigateur, qui ne le
 * fait pas ici (mesuré conv-1114 : sans lui, la ligne lue descendait de 234 px à 1 400 px de large,
 * de 404 px à 1 150). En haut, et non au tiers de la vue : une vue calée sur ta bulle doit le rester.
 * Le bord droit d'abord : tes bulles y sont alignées.
 */
export function elementDeLecture(conteneur: HTMLElement): HTMLElement | null {
  const rc = conteneur.getBoundingClientRect()
  const y = rc.top + MARGE_AIMANT + 14
  if (typeof document.elementFromPoint === 'function') {
    for (const fx of [0.92, 0.7, 0.5, 0.3]) {
      const el = document.elementFromPoint(rc.left + rc.width * fx, y)
      if (el instanceof HTMLElement && el !== conteneur && conteneur.contains(el)) return el
    }
  }
  return (
    Array.from(conteneur.querySelectorAll<HTMLElement>(SELECTEUR_MESSAGES)).find(
      (element) => element.getBoundingClientRect().bottom > y
    ) ?? null
  )
}

/** Haut d'un élément dans le CONTENU du fil : ne bouge pas quand on défile, seulement quand le fil se réagence. */
export function hautDansLeFil(element: HTMLElement, conteneur: HTMLElement): number {
  return (
    element.getBoundingClientRect().top -
    conteneur.getBoundingClientRect().top +
    conteneur.scrollTop
  )
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
 * Le message RETENU après un recalage (clic sur un cran, aimant) l'est-il encore, au moment où la
 * carte s'ouvre ou se referme ? Oui si la vue est toujours calée dessus (à moins d'un pixel), ou si un
 * glissement est en route vers lui. Sinon, la vue a été déplacée par autre chose que la barre.
 *
 * Mesuré le 2026-10-25 (conv-1139, sonde sur le fil réel) : seules la molette et la barre libéraient
 * ce message. Après un PageDown, la carte qui se refermait recalait la vue sur lui : 231 px de recul
 * sur 2 essais, et 2 880 px de saut sur le 3e. Le contrôle porte sur la POSITION et non sur le geste :
 * clavier, recherche dans le fil ou glisser de la barre sont tous couverts, sans liste à tenir.
 */
export function ancreEncoreTenue(
  scrollTop: number,
  hautDeVueDuMessage: number,
  glissementEnCours: boolean
): boolean {
  return glissementEnCours || Math.abs(scrollTop - hautDeVueDuMessage) <= 1
}

/** État de la vue à une image du maintien de la ligne lue (voir `scrollTopDuMaintien`). */
export type ImageDuMaintien = {
  /** Position actuelle, telle que le navigateur la rend (déjà bornée au fil s'il a raccourci). */
  scrollTop: number
  /** `scrollHeight - clientHeight` actuel. */
  max: number
  /** Haut de l'élément lu dans le CONTENU du fil, maintenant puis à l'image précédente. */
  hautLu: number
  hautLuAvant: number
  /** Position laissée à la fin de l'image précédente, et si elle était collée au bas. */
  poseeAvant: number
  auBasAvant: boolean
}

/**
 * Où poser la vue à une image du MAINTIEN de la ligne lue, pendant que le fil change de largeur
 * (la carte s'ouvre ou se replie). `null` = ne rien toucher.
 *
 * Mesuré le 2026-10-25 (conv-1143, « quand je scroll tout en bas ça remonte le scroll », sonde sur
 * conv-1139) : la carte ouverte allongeait le fil de 11 836 px. Vue au bas, au repli, le navigateur
 * ramenait déjà la vue au nouveau bas, puis le maintien lui retirait EN PLUS le rétrécissement du
 * texte au-dessus : vue finie 11 813 px au-dessus du bas, 3 essais sur 3. D'où deux règles :
 *  - collé au bas, le lecteur lit la FIN du fil : elle reste à l'écran, comme pour l'aimant ;
 *  - une vue bornée par le navigateur se compense depuis la place LAISSÉE, pas depuis la place bornée.
 * Une vue qui a REMONTÉ depuis la dernière image vient de la molette du lecteur : elle est respectée.
 */
export function scrollTopDuMaintien(image: ImageDuMaintien): number | null {
  const { scrollTop, max, poseeAvant } = image
  const auBas = scrollTop >= max - 1
  const aRemonte = scrollTop < poseeAvant - 0.5
  if (image.auBasAvant && (auBas || !aRemonte)) return Math.abs(scrollTop - max) >= 0.5 ? max : null
  // Remontée ET posée au bas : seul le navigateur fait ça, quand le fil raccourcit sous la vue.
  const depart = auBas && aRemonte ? poseeAvant : scrollTop
  const cible = Math.max(0, Math.min(max, depart + image.hautLu - image.hautLuAvant))
  return Math.abs(cible - scrollTop) >= 0.5 ? cible : null
}

/**
 * Texte d'un de tes messages pour son aperçu, tel que tu l'as écrit. Un message qui lance une skill
 * s'affiche en bandeau (nom de la skill, puis le reste : ChatMessageRow.tsx) ; lu d'un bloc, il
 * donnait « draftune plus jolie popup » (mesuré dans l'app, conv-1114). On le recompose en
 * « /draft une plus jolie popup ».
 */
function texteDuMessage(element: HTMLElement): string {
  const skill = element.querySelector('.msg-skill-nom')?.textContent?.trim()
  if (skill) {
    const reste = element.querySelector('.msg-skill-texte')?.textContent ?? ''
    return resumerTexte(`/${skill} ${reste}`)
  }
  return resumerTexte(element.querySelector('.msg-body')?.textContent ?? '')
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
      element,
      haut: Math.round(hautDansLeContenu(element, conteneur)),
      hauteur: Math.round(element.offsetHeight),
      role,
      numero: role === 'user' ? numero : 0,
      heure: role === 'user' ? (element.querySelector('.msg-time')?.textContent ?? '').trim() : '',
      texte: role === 'user' ? texteDuMessage(element) : ''
    }
  })
}
