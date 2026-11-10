/**
 * LA MASCOTTE DU BUREAU — « Bille · pastille » (2026-10-25).
 *
 * Choix de l'utilisateur sur maquettes (/draft, trois tours) : « une mascotte sur le bureau
 * Windows, qui te prévient même quand l'app est réduite » -> « Orbe · Sentinelle » -> « Orbe
 * inspiré de l'anneau multicolor » -> « mix 2 et 3 » -> « Implémenter la 5 · Bille · pastille ».
 *
 * Ce qui a été retenu :
 * - une BILLE aux couleurs de l'anneau du logo (`assets/autowin-logo-anneau.png`, 12 couleurs
 *   relevées au pixel tous les 30°), avec un reflet de verre ;
 * - un HALO autour d'elle qui dit l'état : pointillés qui tournent (au travail), or qui bat (un fil
 *   t'attend), rouge (un tour a échoué), rien au calme ; c'est un grand glyphe
 *   de runes (`glypheDuHalo`), même code de couleurs ;
 * - une PASTILLE au coin qui compte : les agents au travail, ou les fils qui t'attendent ; « ! »
 *   sur un échec ;
 * - « Sentinelle » : dans le coin, juste au-dessus de l'horloge, et les cartes de fin de tour
 *   sortent à sa gauche (`zoneDesCartes`) ; elle se glisse ailleurs et les cartes
 *   la suivent.
 *
 * Depuis le 2026-10-28, la bille est un PERSONNAGE (`mascotte-personnage.ts`) : visage,
 * chapeau de magicien, bras qui lancent des sorts, et la pastille devient le chiffre qui brille dans
 * l'étoile du chapeau. La fenêtre grandit d'autant ; seule la bille (et sa croix) prend les clics.
 *
 * Ce module ne connaît pas Electron (même découpe que `notification-popup.ts`) : l'état, la page,
 * le placement et la lecture des clics sont testés sans fenêtre. La fenêtre vit dans
 * `mascotte-fenetre.ts`.
 */
import {
  CENTRE_BILLE,
  cssDuPersonnage,
  glypheDuHalo,
  HAUTEUR_MASCOTTE,
  LARGEUR_MASCOTTE,
  reglesDeLAccueil,
  reglesDuPersonnage,
  svgDuPersonnage,
  visageDeLaBille
} from './mascotte-personnage'
import {
  MACHINE_ATTENTE,
  MACHINE_CALME,
  MACHINE_PROBLEME,
  MACHINE_TRAVAIL
} from './mascotte-machine-images'
import {
  PANDA1_CALME,
  PANDA1_TRAVAIL,
  PANDA2_CALME,
  PANDA2_TRAVAIL,
  PANDA3_CALME,
  PANDA3_TRAVAIL
} from './mascotte-panda-images'
import type { StyleMascotte, StylePanda } from './mascotte-reglage'
import { LARGEUR_POPUP, MARGE_CARTE, type Rect, type ZoneDesCartes } from '../app/notification-popup'
import {
  contenuDeNotificationDeFinDeTour,
  type FinDeTourPourNotification
} from '../app/notification-fin-de-tour'

/**
 * La fenêtre (transparente) : la bille au milieu du personnage, qui déborde de tous côtés
 * (chapeau, bras, sorts, pantins). Elle était un carré de 80 px avant le personnage.
 */
export { HAUTEUR_MASCOTTE, LARGEUR_MASCOTTE }
/** Diamètre du halo (`.ob` et `.h` de la page) : le bord visible de la bille. */
const TAILLE_HALO = 64
/** Le carré du halo dans la fenêtre, centré sur la bille. */
export const HALO_DANS_LA_FENETRE = {
  x: CENTRE_BILLE.x - TAILLE_HALO / 2,
  y: CENTRE_BILLE.y - TAILLE_HALO / 2,
  taille: TAILLE_HALO
} as const
/**
 * Bande transparente sur les CÔTÉS de la fenêtre, hors du dessin (les notes et les runes s'arrêtent
 * à 11 px du bord) : les cartes s'y collent, au ras du personnage.
 */
export const RETRAIT_COTE = 10
/** Distance au coin de la zone de travail (au-dessus de la barre des tâches, pas dessous). */
const MARGE_MASCOTTE = 6
/** La croix de fermeture, dans la fenêtre : en haut à droite du halo. */
const CROIX = { x: CENTRE_BILLE.x + 20, y: CENTRE_BILLE.y - 40, taille: 18 } as const

/**
 * LA GÉOMÉTRIE DE CHAQUE STYLE (2026-10-29, « choix de mascotte soit magicien soit
 * basique ») : le magicien vit dans sa grande fenêtre (chapeau, bras, sorts) ; la bille basique
 * reprend la fenêtre d'avant, un carré de 80 px, le halo de 64 au milieu et la croix au
 * coin haut-droit de son cadre de 68 px (`.m`). Tout ce qui place, colle les cartes ou lit les clics
 * passe par elle.
 */
export type GeometrieMascotte = {
  largeur: number
  hauteur: number
  /** Le centre de la bille dans la fenêtre. */
  centre: { x: number; y: number }
  /** Bande transparente des CÔTÉS de la fenêtre : les cartes s'y collent. */
  retraitCote: number
  /** La croix de fermeture, dans la fenêtre. */
  croix: { x: number; y: number; taille: number }
}
/** Les trois pandas partagent la fenêtre de la machine : mêmes cartes, mêmes clics. */
const GEOMETRIE_PANDA: GeometrieMascotte = {
  largeur: 124,
  hauteur: 136,
  centre: { x: 62, y: 76 },
  retraitCote: 8,
  croix: { x: 94, y: 22, taille: 18 }
}
const GEOMETRIES: Record<StyleMascotte, GeometrieMascotte> = {
  magicien: {
    largeur: LARGEUR_MASCOTTE,
    hauteur: HAUTEUR_MASCOTTE,
    centre: CENTRE_BILLE,
    retraitCote: RETRAIT_COTE,
    croix: CROIX
  },
  basique: {
    largeur: 80,
    hauteur: 80,
    centre: { x: 40, y: 40 },
    retraitCote: (80 - TAILLE_HALO) / 2,
    croix: { x: 56, y: 6, taille: 18 }
  },
  // La machine : 104x125 px (agrandie 1,3 fois), posée au bas d'une fenêtre de 124x136 où tiennent sa bulle,
  // ses étincelles et ses paillettes ; le centre est celui de son corps, la croix en haut à droite.
  machine: {
    largeur: 124,
    hauteur: 136,
    centre: { x: 62, y: 76 },
    retraitCote: 8,
    croix: { x: 94, y: 22, taille: 18 }
  },
  // Les trois pandas : même cadre de 104x125 px et même fenêtre que la machine.
  panda1: GEOMETRIE_PANDA,
  panda2: GEOMETRIE_PANDA,
  panda3: GEOMETRIE_PANDA
}
export function geometrieMascotte(style: StyleMascotte = 'magicien'): GeometrieMascotte {
  return GEOMETRIES[style]
}

/**
 * Le pointeur (relatif au coin de la fenêtre) est-il sur la bille ou sa croix ? Partout ailleurs —
 * chapeau, bras, sorts, vide —, la fenêtre laisse passer les clics vers le bureau :
 * le personnage déborde largement de la bille, il ne doit pas cacher ce qu'il y a dessous.
 */
export function pointSurLaBille(
  point: { x: number; y: number },
  style: StyleMascotte = 'magicien'
): boolean {
  const { centre, croix } = geometrieMascotte(style)
  const rayon = TAILLE_HALO / 2 + 2
  if (Math.hypot(point.x - centre.x, point.y - centre.y) <= rayon) return true
  return (
    point.x >= croix.x &&
    point.x <= croix.x + croix.taille &&
    point.y >= croix.y &&
    point.y <= croix.y + croix.taille
  )
}

/** Les quatre états des maquettes : Calme, Au travail, Pour toi, Problème. */
export type NomEtatMascotte = 'calme' | 'travail' | 'attente' | 'probleme'

export type EtatMascotte = {
  etat: NomEtatMascotte
  /** Le texte de la pastille (le compte, de 1 à 99, ou « ! ») ; `null` = pas de pastille. */
  pastille: string | null
  /** Le fil qu'un clic sur la bille ouvre ; `null` = ouvrir Autowin, simplement. */
  fil: string | null
}

export type EntreesMascotte = {
  /** Réponses de chat en cours, préparation comprise (`ActiveChatTurns.inFlightConversations`). */
  toursEnCours: number
  /** Runs en cours, tels que l'interface les envoie (`os:presence`). */
  runsActifs: number
  /** Fils dont la fin de tour attend l'utilisateur, du plus ancien au plus récent. */
  filsEnAttente: readonly string[]
  /** Fils dont le dernier tour a échoué sans que l'utilisateur l'ait vu, même ordre. */
  filsEnEchec: readonly string[]
}

/**
 * Le VRAI compte, jusqu'à 99 (« affiche le vrai nombre sur le chapeau jusqu'à 99 au lieu
 * de 9+ ») : il était « 9+ » au-delà de 9. La pastille tient deux caractères (22 px dans la bille
 * basique, deux chiffres côte à côte sur le chapeau) : au-delà de 99, elle reste à 99.
 */
function compte(n: number): string {
  return String(Math.min(n, 99))
}

/**
 * L'ÉTAT À MONTRER. Le plus grave l'emporte, comme le rond de verre du fil
 * (`anneau-activite-calcul.ts`, `exceptionDuGroupe`) : un échec avant un fil qui attend, un fil qui
 * attend avant le travail en cours. Le clic ouvre le fil le plus RÉCENT de l'état montré.
 */
export function etatDeLaMascotte(entrees: EntreesMascotte): EtatMascotte {
  const echec = entrees.filsEnEchec.at(-1)
  if (echec !== undefined) return { etat: 'probleme', pastille: '!', fil: echec }
  const attente = entrees.filsEnAttente.at(-1)
  if (attente !== undefined)
    return { etat: 'attente', pastille: compte(entrees.filsEnAttente.length), fil: attente }
  const agents =
    Math.max(0, Math.floor(entrees.toursEnCours || 0)) +
    Math.max(0, Math.floor(entrees.runsActifs || 0))
  if (agents > 0) return { etat: 'travail', pastille: compte(agents), fil: null }
  return { etat: 'calme', pastille: null, fil: null }
}

/** L'issue d'un tour fini, telle que la mascotte la retient. */
export type IssueDeTour = 'prete' | 'echec'

/**
 * La MÊME décision que la carte de fin de tour (`contenuDeNotificationDeFinDeTour`) : un tour
 * arrêté, un tour de fond, ou un tour fini sous les yeux de l'utilisateur ne l'attend pas. Une
 * seule règle pour les deux : la bille ne dit jamais « pour toi » quand aucune carte n'a sonné.
 */
export function issuePourLaMascotte(
  fin: FinDeTourPourNotification & { tourDeFond?: boolean },
  autowinRegardee: boolean
): IssueDeTour | null {
  return (
    contenuDeNotificationDeFinDeTour({
      ...fin,
      fenetreRegardee: autowinRegardee,
      instanceDeTest: false,
      tourDeFond: fin.tourDeFond === true
    })?.issue ?? null
  )
}

/**
 * Ce que la mascotte retient entre deux fins de tour. Un fil n'est qu'à UNE place (sa dernière
 * issue l'emporte) ; tout s'efface quand l'utilisateur regarde Autowin, comme les cartes
 * (`index.ts`, `browser-window-focus` -> `toutFermer`).
 */
export function creerSuiviMascotte(): {
  finDeTour: (conversationId: string, issue: IssueDeTour) => void
  regarde: () => void
  filsEnAttente: () => readonly string[]
  filsEnEchec: () => readonly string[]
} {
  let attente: string[] = []
  let echec: string[] = []
  return {
    finDeTour: (conversationId, issue) => {
      attente = attente.filter((id) => id !== conversationId)
      echec = echec.filter((id) => id !== conversationId)
      if (issue === 'echec') echec.push(conversationId)
      else attente.push(conversationId)
    },
    regarde: () => {
      attente = []
      echec = []
    },
    filsEnAttente: () => attente,
    filsEnEchec: () => echec
  }
}

/** La fenêtre : en bas à droite de la zone de travail, donc juste au-dessus de l'horloge. */
export function placerMascotte(zone: Rect, style: StyleMascotte = 'magicien'): Rect {
  const { largeur, hauteur } = geometrieMascotte(style)
  return {
    x: zone.x + zone.width - MARGE_MASCOTTE - largeur,
    y: zone.y + zone.height - MARGE_MASCOTTE - hauteur,
    width: largeur,
    height: hauteur
  }
}

/**
 * LES CARTES SORTENT DE LA BILLE, LÀ OÙ ELLE EST (2026-10-26, demande : « fais sortir les
 * cartes de fin de tour à côté de la mascotte là où je l'ai déplacée, au lieu de garder libre le
 * coin de l'horloge »). Avant, la zone des cartes perdait seulement la colonne du coin d'origine :
 * une bille glissée ailleurs laissait les cartes au coin de l'horloge.
 *
 * `fenetre` est la fenêtre de la mascotte, `zone` la zone de travail de SON écran :
 * - côté : à GAUCHE de la bille si une carte y tient, sinon à droite (bille près du bord gauche) ;
 *   aucune ne tient (écran très étroit) : le côté le plus large ;
 * - sens : bille dans la moitié BASSE de l'écran, la pile part du bas de la bille et monte ; dans
 *   la moitié haute, elle part du haut de la bille et descend.
 *
 * CARTES COLLÉES AU HALO (2026-10-28, demande : « j'aimerais que les notifs et la
 * mascotte soient snap ensemble ») : la carte était posée à `MARGE_CARTE` (12 px) de la FENÊTRE de
 * la bille, elle-même transparente sur 8 px autour du halo — 20 px de vide visible.
 * La carte touche maintenant le halo, et son bas (ou son haut, pile qui descend) est au niveau du
 * sien. Elle empiète donc sur la bande transparente de la fenêtre de la bille, jamais sur le halo :
 * le glisser, lu sur `.ob` seul (`PRELOAD_MASCOTTE`), reste entier.
 *
 * AU RAS DU PERSONNAGE : depuis qu'elle a des bras, des sorts et des feux follets qui
 * débordent du halo, une carte collée au halo cachait tout un côté du personnage. Elle touche donc
 * le bord du DESSIN (`RETRAIT_COTE`) ; son bas (ou son haut) reste au niveau de celui du halo.
 */
export function zoneDesCartes(
  fenetre: Rect,
  zone: Rect,
  style: StyleMascotte = 'magicien'
): ZoneDesCartes {
  const { centre, retraitCote } = geometrieMascotte(style)
  const droiteZone = zone.x + zone.width
  const basZone = zone.y + zone.height
  const dessin = {
    gauche: fenetre.x + retraitCote,
    droite: fenetre.x + fenetre.width - retraitCote
  }
  const halo = {
    haut: fenetre.y + centre.y - TAILLE_HALO / 2,
    bas: fenetre.y + centre.y + TAILLE_HALO / 2
  }
  const placeAGauche = dessin.gauche - zone.x
  const placeADroite = droiteZone - dessin.droite
  const besoin = LARGEUR_POPUP
  const aGauche = placeAGauche >= besoin || (placeADroite < besoin && placeAGauche >= placeADroite)
  // `disposerPopups` écarte la carte de `MARGE_CARTE` du bord de sa zone : la zone dépasse le dessin
  // d'autant, pour que la carte arrive pile sur lui.
  const horizontal: Pick<ZoneDesCartes, 'x' | 'width' | 'bord'> = aGauche
    ? { x: zone.x, width: Math.max(0, placeAGauche + MARGE_CARTE), bord: 'droite' }
    : {
        x: dessin.droite - MARGE_CARTE,
        width: Math.max(0, placeADroite + MARGE_CARTE),
        bord: 'gauche'
      }
  const enBas = fenetre.y + centre.y >= zone.y + zone.height / 2
  if (enBas) {
    const bas = Math.min(basZone, halo.bas + MARGE_CARTE)
    return { ...horizontal, y: zone.y, height: Math.max(0, bas - zone.y), sens: 'haut' }
  }
  const haut = Math.max(zone.y, halo.haut - MARGE_CARTE)
  return { ...horizontal, y: haut, height: Math.max(0, basZone - haut), sens: 'bas' }
}

/** Les 12 couleurs de l'anneau du logo, relevées au pixel tous les 30° (du bleu en haut). */
const COULEURS_ANNEAU = [
  '#2f91c7',
  '#467ffa',
  '#7574fb',
  '#a868f9',
  '#cb60bd',
  '#ee5883',
  '#fe6b54',
  '#fc9a31',
  '#f9c512',
  '#9fba35',
  '#42b059',
  '#20a289'
]

/**
 * LE LISERÉ ARC-EN-CIEL des cartes de fin de tour quand la mascotte est affichée (
 * demande : « le liseré arc-en-ciel de la maquette 5 […] sans toucher aux couleurs du thème »).
 *
 * Seul le BORD change : `.cadre` est le calque de 2 px qui entoure la carte
 * (`notification-popup.ts`, `cssDePopup`) ; son dégradé de thème est remplacé par l'anneau du
 * logo, en ligne de gauche à droite comme sur la maquette. Le fond, le texte, l'icône et les
 * boutons gardent les couleurs du thème. La règle arrive APRÈS la feuille de la page : à poids
 * égal, elle l'emporte (une `<style>` en ligne, que la politique de contenu de la carte autorise).
 */
export function avecLisereArcEnCiel(html: string): string {
  const regle = `<style>.cadre{background-image:linear-gradient(90deg,${COULEURS_ANNEAU.join(',')},${COULEURS_ANNEAU[0]})}</style>`
  return html.includes('</head>') ? html.replace('</head>', `${regle}</head>`) : html
}

/** L'anneau du logo, du bleu en haut (0°) au vert-bleu (330°). */
const ANNEAU =
  'conic-gradient(#2f91c7 0deg,#467ffa 30deg,#7574fb 60deg,#a868f9 90deg,#cb60bd 120deg,#ee5883 150deg,#fe6b54 180deg,#fc9a31 210deg,#f9c512 240deg,#9fba35 270deg,#42b059 300deg,#20a289 330deg,#2f91c7 360deg)'

/**
 * LA PAGE, fixe : tous les calques y sont, l'état les allume par une feuille de style AJOUTÉE
 * (`cssDeLEtat`, posée par `webContents.insertCSS`). AUCUN script dans la page, et sa politique de
 * contenu les interdit : seul le préchargement (`PRELOAD_MASCOTTE`) écoute le pointeur.
 * La croix est un lien vers un fragment, lu par le processus principal sur la navigation interne,
 * comme les cartes (`notification-popup-fenetre.ts`).
 *
 * LE NOMBRE AU MILIEU DE LA BILLE (2026-10-26, demande : « je veux que le nombre soit
 * au milieu du cercle ») : la pastille `.n` était au coin bas-droit, elle a été centrée sur la bille.
 *
 * LE PERSONNAGE (2026-10-28, « implémente le 2 ») : le nombre est maintenant le CHIFFRE
 * qui brille dans l'étoile du chapeau, dessiné avec tout le personnage (`svgDuPersonnage`) par-dessus
 * la bille ; le visage est peint sur la bille (`visageDeLaBille`). Le survol grossit tout le
 * personnage (`scale`), le saut de « pour toi » le soulève (`translate`) : deux propriétés
 * distinctes, qui se composent au lieu de s'écraser.
 */
export function htmlDeMascotte(style: StyleMascotte = 'magicien'): string {
  if (style === 'basique') return htmlDeLaBilleBasique()
  if (style === 'machine') return htmlDeLaMachine()
  if (estUnStylePanda(style)) return htmlDuPanda(style)
  const cx = CENTRE_BILLE.x
  const cy = CENTRE_BILLE.y
  const halo = HALO_DANS_LA_FENETRE
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Autowin — mascotte</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{font-family:ui-monospace,Consolas,monospace;user-select:none}
.m{position:relative;width:${LARGEUR_MASCOTTE}px;height:${HAUTEUR_MASCOTTE}px}
.cps{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:${cx}px ${cy}px;transition:scale .2s}
.m:has(.ob:hover) .cps{scale:1.04}
.ob{position:absolute;left:${halo.x}px;top:${halo.y}px;display:grid;place-items:center;width:${TAILLE_HALO}px;height:${TAILLE_HALO}px;cursor:pointer;touch-action:none}
.ob:active{cursor:grabbing}
.ob>*{grid-area:1/1;border-radius:50%;transform:rotate(0deg)}
.h{display:none;width:${TAILLE_HALO}px;height:${TAILLE_HALO}px;overflow:visible;border-radius:0}
.h *{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
.h .gn{fill:currentColor;stroke:none}
.h .ge,.h .gi{transform-origin:${TAILLE_HALO / 2}px ${TAILLE_HALO / 2}px}
.bw,.bk,.bl,.y{width:52px;height:52px}
.bw{background:radial-gradient(circle,#fff9 0,#fff2 42%,#fff0 62%),${ANNEAU}}
.bl{background:radial-gradient(circle at 32% 26%,#fffffff2 0,#fff5 13%,#fff0 28%),radial-gradient(circle,#0a0c1e00 56%,#0a0c1e80)}
.bk{display:none;background:radial-gradient(circle,#e5534b59,#e5534bbf)}
.y{overflow:visible;border-radius:0}
.z{display:none;position:absolute;left:${cx + 18}px;top:${cy - 40}px;font-weight:700;font-size:16px;line-height:1;color:#9aa3b5;animation:oz 2.4s infinite}
.f{position:absolute;z-index:2;left:${CROIX.x}px;top:${CROIX.y}px;display:grid;place-items:center;width:${CROIX.taille}px;height:${CROIX.taille}px;border-radius:50%;background:#10131ce6;box-shadow:0 0 0 1px #ffffff38;color:#c9d1e3;font-size:13px;line-height:1;text-decoration:none;cursor:pointer;opacity:0;transition:opacity .2s .4s}
.m:has(.ob:hover) .f,.f:hover{opacity:1;transition-delay:0s}
.m:has(.ob:hover) .z{visibility:hidden}
@keyframes ot{to{transform:rotate(360deg)}}
@keyframes ob{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes oz{0%{opacity:0;transform:none}50%{opacity:1}100%{opacity:0;transform:translate(4px,-6px)}}
@keyframes ho{40%{translate:0 -5px}60%{translate:0 0}}
${cssDuPersonnage()}
</style></head><body><div class="m"><div class="cps"><i class="ob" title="Ouvrir Autowin — glisser pour la déplacer"><svg class="h" viewBox="0 0 ${TAILLE_HALO} ${TAILLE_HALO}">${glypheDuHalo()}</svg><i class="bw"></i><i class="bk"></i><i class="bl"></i>${visageDeLaBille()}</i>${svgDuPersonnage()}</div><i class="z">z</i><a class="f" href="#${FRAGMENT_FERMER}" title="Fermer la mascotte (pour la rouvrir : Réglages · Interface)">×</a></div></body></html>`
}

/**
 * LA BILLE BASIQUE (2026-10-29) : la page d'avant le personnage, telle qu'un fil l'a
 * laissée — la bille, son halo en cercle et le nombre au milieu (`.n`), sans visage ni chapeau.
 * Mêmes noms de calques que le magicien là où ils existent (`.ob`, `.h`, `.bw`, `.bk`, `.bl`, `.z`,
 * `.f`) : le préchargement et la croix marchent pareil.
 */
function htmlDeLaBilleBasique(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Autowin — mascotte</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{display:grid;place-items:center;font-family:ui-monospace,Consolas,monospace;user-select:none}
.m{display:grid;place-items:center;width:68px;height:68px}
.m>*{grid-area:1/1}
.ob{display:grid;place-items:center;width:${TAILLE_HALO}px;height:${TAILLE_HALO}px;cursor:pointer;touch-action:none;transition:transform .2s}
.ob:active{cursor:grabbing}
.m:hover .ob{transform:scale(1.06)}
.ob>*{grid-area:1/1;border-radius:50%;transform:rotate(0deg)}
.h{display:none;width:${TAILLE_HALO}px;height:${TAILLE_HALO}px;overflow:visible;border-radius:0}
.h circle{fill:none;stroke-width:2}
.bw,.bk,.bl{width:52px;height:52px}
.bw{background:radial-gradient(circle,#fff9 0,#fff2 42%,#fff0 62%),${ANNEAU}}
.bl{background:radial-gradient(circle at 32% 26%,#fffffff2 0,#fff5 13%,#fff0 28%),radial-gradient(circle,#0a0c1e00 56%,#0a0c1e80)}
.bk{display:none;background:radial-gradient(circle,#e5534b59,#e5534bbf)}
.n{display:none;place-items:center;justify-self:center;align-self:center;width:26px;height:26px;margin:0;font-weight:700;font-size:13px;line-height:1;color:#fff;box-shadow:0 0 0 2px #10131c99}
.z{display:none;justify-self:end;align-self:start;margin:-2px -2px 0 0;font-weight:700;font-size:16px;line-height:1;color:#9aa3b5;border-radius:0;animation:oz 2.4s infinite}
.f{position:relative;z-index:2;display:grid;place-items:center;justify-self:end;align-self:start;width:18px;height:18px;border-radius:50%;background:#10131ce6;box-shadow:0 0 0 1px #ffffff38;color:#c9d1e3;font-size:13px;line-height:1;text-decoration:none;cursor:pointer;opacity:0;transition:opacity .2s .4s}
.m:hover .f{opacity:1;transition-delay:0s}
.m:hover .z{visibility:hidden}
@keyframes ot{to{transform:rotate(360deg)}}
@keyframes ob{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes oz{0%{opacity:0;transform:none}50%{opacity:1}100%{opacity:0;transform:translate(4px,-6px)}}
</style></head><body><div class="m"><i class="ob" title="Ouvrir Autowin — glisser pour la déplacer"><svg class="h" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19"/></svg><i class="bw"></i><i class="bk"></i><i class="bl"></i><i class="n"></i><i class="z">z</i></i><a class="f" href="#${FRAGMENT_FERMER}" title="Fermer la mascotte (pour la rouvrir : Réglages · Interface)">×</a></div></body></html>`
}

/**
 * LA MACHINE (2026-10-29, « fais de cette machine la mascotte : 1 au repos, 3 au travail,
 * 4 en erreur, 2 quand le travail est fini… rajoute des effets ») : la petite machine de NieR,
 * modelée en three.js puis rendue en planches de 16 images (`mascotte-machine-images.ts`), rejouées
 * ici en CSS — la page n'admet aucun script. Chaque état a sa planche : au repos elle somnole (yeux
 * mi-clos qui respirent), au travail elle visse (étincelles), quand un fil attend elle salue (bulle
 * ✓ et paillettes dorées), en échec elle tremble et fume (bulle « ! », lueur rouge au sol). Mêmes
 * calques que les autres styles (`.ob`, `.h`, `.bw`, `.n`, `.z`, `.f`) : préchargement, croix et
 * nombre marchent pareil.
 */
function htmlDeLaMachine(): string {
  const etincelles = [0, 1, 2, 3, 4, 5].map((i) => `<i class="et" style="--i:${i}"></i>`).join('')
  const paillettes = [0, 1, 2, 3, 4, 5, 6].map((i) => `<i class="pl" style="--i:${i}"></i>`).join('')
  const donnees = [0, 1, 2, 3].map((i) => `<i class="q" style="--i:${i}"></i>`).join('')
  const fragments = [0, 1, 2, 3, 4].map((i) => `<i class="g" style="--i:${i}"></i>`).join('')
  const poussieres = [0, 1, 2].map((i) => `<i class="pa" style="--i:${i}"></i>`).join('')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>Autowin — mascotte</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{font-family:ui-monospace,Consolas,monospace;user-select:none}
:root{--calme:url("${MACHINE_CALME}");--travail:url("${MACHINE_TRAVAIL}");--attente:url("${MACHINE_ATTENTE}");--probleme:url("${MACHINE_PROBLEME}")}
.m{position:relative;width:124px;height:136px}
.m i,.m a{position:absolute;font-style:normal}
.sh,.ob,.bw{display:block}
.sh{left:24px;top:118px;width:76px;height:14px;border-radius:50%;background:radial-gradient(closest-side,#000a,#0000);animation:so 3.2s ease-in-out infinite}
.ob::after{content:"";display:none;position:absolute;inset:0;background:linear-gradient(180deg,#0000 0,#8ff0ff00 40%,#8ff0ff8c 50%,#8ff0ff00 60%,#0000 100%) 0 0/100% 300% no-repeat,repeating-linear-gradient(0deg,#8ff0ff1f 0 1px,#0000 1px 3px);-webkit-mask:var(--travail) 0 0/1664px 125px no-repeat;mask:var(--travail) 0 0/1664px 125px no-repeat;mix-blend-mode:screen;animation:sp 1.2s steps(16) infinite,hs 2.2s linear infinite}
.y{left:0;top:125px;width:124px;text-align:center;font-size:7px;font-weight:700;letter-spacing:.35em;color:#bdb79c;opacity:.75;text-shadow:0 0 3px currentColor}
.h{display:none;position:absolute;left:2px;top:58px;width:120px;height:120px;transform:scaleY(.3);color:#ffcf7a;overflow:visible;filter:drop-shadow(0 0 3px currentColor)}
.h *{fill:none;stroke:currentColor;stroke-linecap:round}
.h .gn{fill:currentColor;stroke:none}
.h .ge,.h .gi{transform-origin:60px 60px}
.h .ge{animation:rt 9s linear infinite}
.h .gi{animation:rt 6s linear infinite reverse}
.h .gf{fill:currentColor;stroke:none;opacity:.18}
.g{display:none;width:6px;height:9px;left:calc(20px + var(--i) * 17px);top:112px;border:1px solid currentColor;border-radius:1px;box-shadow:0 0 4px currentColor;opacity:0;animation:g 3s calc(var(--i) * .5s) ease-out infinite}
.g::after{content:"";position:absolute;left:1px;top:3px;width:2px;height:1px;background:currentColor}
.r{display:none;left:12px;top:74px;width:100px;height:100px;border-radius:50%;border:2px solid currentColor;transform:scaleY(.24);opacity:0;animation:rp 1.6s ease-out infinite}
.q{display:none;width:3px;height:3px;background:currentColor;box-shadow:0 0 4px currentColor;left:calc(26px + var(--i) * 22px);top:118px;opacity:0;animation:q 1.8s calc(var(--i) * .45s) linear infinite}
.ob{left:10px;top:4px;width:104px;height:125px;cursor:pointer;touch-action:none;transition:scale .2s;transform-origin:50% 100%}
.ob:active{cursor:grabbing}
.m:hover .ob{scale:1.06}
.bw{inset:0;background:var(--calme) 0 0/1664px 125px no-repeat;animation:sp 3.2s steps(16) infinite}
.n{display:none;place-items:center;left:2px;top:34px;min-width:26px;height:18px;padding:0 4px;box-sizing:border-box;font-weight:700;font-size:11px;letter-spacing:.08em;line-height:1;color:#ffcf7a;text-shadow:0 0 4px #ffcf7a;background:#14120ee6;box-shadow:inset 0 0 0 1px #ffcf7a99;clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)}
.n::after{position:static}
.z{display:none;left:90px;top:26px;font-weight:700;font-size:19px;text-shadow:0 0 4px #e4dfc9;line-height:1;color:#bdb79c;animation:oz 2.4s infinite}
.z::after{content:"z";position:absolute;left:9px;top:-9px;font-size:11px;animation:oz 2.4s 1.2s infinite;opacity:0}
.pa{display:none;width:4px;height:4px;box-shadow:0 0 4px #e4dfc9;border-radius:50%;background:#e4dfc9;left:calc(22px + var(--i) * 38px);top:110px;opacity:0;animation:pa 5s calc(var(--i) * 1.6s) ease-in-out infinite}
.et{display:none;width:5px;height:5px;border-radius:50%;background:#ffd27a;box-shadow:0 0 6px 2px #ff9a2e;left:96px;top:100px;opacity:0;animation:et .6s calc(var(--i) * .1s) ease-out infinite}
.bu{display:none;place-items:center;left:88px;top:2px;width:26px;height:26px;border-radius:50%;font-weight:700;font-size:16px;line-height:1;background:#e4dfc9;color:#14120e;box-shadow:0 0 0 1.5px #4e4b42,0 0 10px 2px currentColor;animation:bu 1.6s ease-in-out infinite}
.pl{display:none;width:7px;height:7px;left:58px;top:40px;background:#ffdf8a;filter:drop-shadow(0 0 3px #ffb02e);clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);opacity:0;animation:pl 1.8s calc(var(--i) * .26s) ease-out infinite}
.f{z-index:2;display:grid;place-items:center;left:94px;top:22px;width:18px;height:18px;border-radius:50%;background:#14120ee6;box-shadow:0 0 0 1px #e4dfc95c;color:#e4dfc9;font-size:13px;line-height:1;text-decoration:none;cursor:pointer;opacity:0;transition:opacity .2s .4s}
.m:hover .f{opacity:1;transition-delay:0s}
.m:hover .z,.m:hover .bu{visibility:hidden}
@keyframes sp{to{background-position:-1664px 0}}
@keyframes so{50%{transform:scaleX(.92);opacity:.8}}
@keyframes ob{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes od{0%,100%{opacity:.14}50%{opacity:.3}}
@keyframes ow{0%,100%{opacity:.85}50%{opacity:1}}
@keyframes oz{0%{opacity:0;transform:none}50%{opacity:1}100%{opacity:0;transform:translate(4px,-8px)}}
@keyframes pa{0%{opacity:0;transform:none}30%{opacity:.6}100%{opacity:0;transform:translate(calc((var(--i) - 1) * 6px),-60px)}}
@keyframes et{0%{opacity:1;transform:none}100%{opacity:0;transform:rotate(calc(var(--i) * 60deg - 150deg)) translateX(24px)}}
@keyframes bu{50%{transform:translateY(-3px)}}
@keyframes pl{0%{opacity:0;transform:none}20%{opacity:1}100%{opacity:0;transform:rotate(calc(var(--i) * 51deg)) translateX(56px) rotate(90deg) scale(1.6)}}
@keyframes tr{25%{translate:-1px 0}75%{translate:1px 0}}
@keyframes rt{to{transform:rotate(360deg)}}
@keyframes g{0%{opacity:0;transform:none}20%{opacity:.9}100%{opacity:0;transform:translateY(-64px) rotate(calc((var(--i) - 2) * 40deg))}}
@keyframes hs{0%{background-position:0 100%,0 0}100%{background-position:0 0,0 0}}
@keyframes rp{0%{opacity:.9;transform:scaleY(.24) scale(.6)}100%{opacity:0;transform:scaleY(.24) scale(1.25)}}
@keyframes q{0%{opacity:0;transform:none}15%{opacity:1}100%{opacity:0;transform:translateY(-70px) rotate(90deg)}}
</style></head><body><div class="m"><i class="sh"></i><svg class="h" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" class="gf"/><g class="ge"><circle cx="60" cy="60" r="50" stroke-width="1.6"/><circle cx="60" cy="60" r="38" stroke-width="1"/><line x1="110.0" y1="60.0" x2="114.0" y2="60.0" stroke-width="1.2"/><line x1="109.6" y1="66.5" x2="111.6" y2="66.8" stroke-width="1.2"/><line x1="108.3" y1="72.9" x2="110.2" y2="73.5" stroke-width="1.2"/><line x1="106.2" y1="79.1" x2="109.9" y2="80.7" stroke-width="1.2"/><line x1="103.3" y1="85.0" x2="105.0" y2="86.0" stroke-width="1.2"/><line x1="99.7" y1="90.4" x2="101.3" y2="91.7" stroke-width="1.2"/><line x1="95.4" y1="95.4" x2="98.2" y2="98.2" stroke-width="1.2"/><line x1="90.4" y1="99.7" x2="91.7" y2="101.3" stroke-width="1.2"/><line x1="85.0" y1="103.3" x2="86.0" y2="105.0" stroke-width="1.2"/><line x1="79.1" y1="106.2" x2="80.7" y2="109.9" stroke-width="1.2"/><line x1="72.9" y1="108.3" x2="73.5" y2="110.2" stroke-width="1.2"/><line x1="66.5" y1="109.6" x2="66.8" y2="111.6" stroke-width="1.2"/><line x1="60.0" y1="110.0" x2="60.0" y2="114.0" stroke-width="1.2"/><line x1="53.5" y1="109.6" x2="53.2" y2="111.6" stroke-width="1.2"/><line x1="47.1" y1="108.3" x2="46.5" y2="110.2" stroke-width="1.2"/><line x1="40.9" y1="106.2" x2="39.3" y2="109.9" stroke-width="1.2"/><line x1="35.0" y1="103.3" x2="34.0" y2="105.0" stroke-width="1.2"/><line x1="29.6" y1="99.7" x2="28.3" y2="101.3" stroke-width="1.2"/><line x1="24.6" y1="95.4" x2="21.8" y2="98.2" stroke-width="1.2"/><line x1="20.3" y1="90.4" x2="18.7" y2="91.7" stroke-width="1.2"/><line x1="16.7" y1="85.0" x2="15.0" y2="86.0" stroke-width="1.2"/><line x1="13.8" y1="79.1" x2="10.1" y2="80.7" stroke-width="1.2"/><line x1="11.7" y1="72.9" x2="9.8" y2="73.5" stroke-width="1.2"/><line x1="10.4" y1="66.5" x2="8.4" y2="66.8" stroke-width="1.2"/><line x1="10.0" y1="60.0" x2="6.0" y2="60.0" stroke-width="1.2"/><line x1="10.4" y1="53.5" x2="8.4" y2="53.2" stroke-width="1.2"/><line x1="11.7" y1="47.1" x2="9.8" y2="46.5" stroke-width="1.2"/><line x1="13.8" y1="40.9" x2="10.1" y2="39.3" stroke-width="1.2"/><line x1="16.7" y1="35.0" x2="15.0" y2="34.0" stroke-width="1.2"/><line x1="20.3" y1="29.6" x2="18.7" y2="28.3" stroke-width="1.2"/><line x1="24.6" y1="24.6" x2="21.8" y2="21.8" stroke-width="1.2"/><line x1="29.6" y1="20.3" x2="28.3" y2="18.7" stroke-width="1.2"/><line x1="35.0" y1="16.7" x2="34.0" y2="15.0" stroke-width="1.2"/><line x1="40.9" y1="13.8" x2="39.3" y2="10.1" stroke-width="1.2"/><line x1="47.1" y1="11.7" x2="46.5" y2="9.8" stroke-width="1.2"/><line x1="53.5" y1="10.4" x2="53.2" y2="8.4" stroke-width="1.2"/><line x1="60.0" y1="10.0" x2="60.0" y2="6.0" stroke-width="1.2"/><line x1="66.5" y1="10.4" x2="66.8" y2="8.4" stroke-width="1.2"/><line x1="72.9" y1="11.7" x2="73.5" y2="9.8" stroke-width="1.2"/><line x1="79.1" y1="13.8" x2="80.7" y2="10.1" stroke-width="1.2"/><line x1="85.0" y1="16.7" x2="86.0" y2="15.0" stroke-width="1.2"/><line x1="90.4" y1="20.3" x2="91.7" y2="18.7" stroke-width="1.2"/><line x1="95.4" y1="24.6" x2="98.2" y2="21.8" stroke-width="1.2"/><line x1="99.7" y1="29.6" x2="101.3" y2="28.3" stroke-width="1.2"/><line x1="103.3" y1="35.0" x2="105.0" y2="34.0" stroke-width="1.2"/><line x1="106.2" y1="40.9" x2="109.9" y2="39.3" stroke-width="1.2"/><line x1="108.3" y1="47.1" x2="110.2" y2="46.5" stroke-width="1.2"/><line x1="109.6" y1="53.5" x2="111.6" y2="53.2" stroke-width="1.2"/><rect x="102.4" y="58.4" width="3.2" height="3.2" class="gn" transform="rotate(45 104.0 60.0)"/><rect x="99.1" y="75.2" width="3.2" height="3.2" class="gn" transform="rotate(68 100.7 76.8)"/><rect x="89.5" y="89.5" width="3.2" height="3.2" class="gn" transform="rotate(90 91.1 91.1)"/><rect x="75.2" y="99.1" width="3.2" height="3.2" class="gn" transform="rotate(112 76.8 100.7)"/><rect x="58.4" y="102.4" width="3.2" height="3.2" class="gn" transform="rotate(135 60.0 104.0)"/><rect x="41.6" y="99.1" width="3.2" height="3.2" class="gn" transform="rotate(158 43.2 100.7)"/><rect x="27.3" y="89.5" width="3.2" height="3.2" class="gn" transform="rotate(180 28.9 91.1)"/><rect x="17.7" y="75.2" width="3.2" height="3.2" class="gn" transform="rotate(202 19.3 76.8)"/><rect x="14.4" y="58.4" width="3.2" height="3.2" class="gn" transform="rotate(225 16.0 60.0)"/><rect x="17.7" y="41.6" width="3.2" height="3.2" class="gn" transform="rotate(248 19.3 43.2)"/><rect x="27.3" y="27.3" width="3.2" height="3.2" class="gn" transform="rotate(270 28.9 28.9)"/><rect x="41.6" y="17.7" width="3.2" height="3.2" class="gn" transform="rotate(292 43.2 19.3)"/><rect x="58.4" y="14.4" width="3.2" height="3.2" class="gn" transform="rotate(315 60.0 16.0)"/><rect x="75.2" y="17.7" width="3.2" height="3.2" class="gn" transform="rotate(338 76.8 19.3)"/><rect x="89.5" y="27.3" width="3.2" height="3.2" class="gn" transform="rotate(360 91.1 28.9)"/><rect x="99.1" y="41.6" width="3.2" height="3.2" class="gn" transform="rotate(382 100.7 43.2)"/></g><g class="gi"><polygon points="94.0,60.0 60.0,94.0 26.0,60.0 60.0,26.0" stroke-width="1.4"/><polygon points="84.0,84.0 36.0,84.0 36.0,36.0 84.0,36.0" stroke-width="1.4"/><circle cx="60" cy="60" r="20" stroke-width="1" stroke-dasharray="3 3"/><polygon points="60.0,46.0 72.1,67.0 47.9,67.0" stroke-width="1.2"/><polygon points="60.0,74.0 47.9,53.0 72.1,53.0" stroke-width="1.2"/><circle cx="60" cy="60" r="3" class="gn"/></g></svg>${fragments}<i class="r"></i><i class="y">YoRHa</i>${donnees}${poussieres}<i class="ob" title="Ouvrir Autowin — glisser pour la déplacer"><i class="bw"></i></i>${etincelles}${paillettes}<i class="bu"></i><i class="n"></i><i class="z">z</i><a class="f" href="#${FRAGMENT_FERMER}" title="Fermer la mascotte (pour la rouvrir : Réglages · Interface)">×</a></div></body></html>`
}

/** Les règles d'état de la machine : une planche par état, et ses effets. */
function reglesDeLaMachine(etat: NomEtatMascotte, pastille: string | null): Array<[string, string]> {
  const regles: Array<[string, string]> = []
  if (pastille) regles.push(['.n', 'display:grid'], ['.n::after', `content:"${pastille}"`])
  switch (etat) {
    case 'calme':
      regles.push(['.z', 'display:block'], ['.pa', 'display:block'], ['.g', 'display:block;color:#bdb79c;animation-duration:5s'], ['.h', 'display:block;color:#bdb79c;filter:none;animation:od 4.8s ease-in-out infinite'], ['.h .ge', 'animation-duration:18s'], ['.h .gi', 'animation-duration:12s'], ['.h .gf', 'opacity:.06'], ['.y', 'opacity:.3;text-shadow:none'])
      break
    case 'travail':
      regles.push(
        ['.bw', 'background-image:var(--travail);animation:sp 1.2s steps(16) infinite'],
        ['.et', 'display:block'],
        ['.q', 'display:block;color:#ffb347'],
        ['.g', 'display:block;color:#ffb347'],
        ['.h .ge', 'animation-duration:3s'],
        ['.h .gi', 'animation-duration:2s'],
        ['.ob::after', 'display:block'],
        ['.h', 'display:block;color:#ffc46a;filter:drop-shadow(0 0 1px #fff8) drop-shadow(0 0 5px currentColor) drop-shadow(0 0 11px currentColor);animation:ow 1.2s ease-in-out infinite'],
        ['.h .gf', 'opacity:.12'],
        ['.y', 'color:#ffc46a;opacity:1;text-shadow:0 0 4px currentColor,0 0 9px currentColor']
      )
      break
    case 'attente':
      regles.push(
        ['.bw', 'background-image:var(--attente);animation:sp 2.4s steps(16) infinite'],
        ['.pl', 'display:block'],
        ['.bu', 'display:grid'],
        ['.bu::after', 'content:"✓"'],
        ['.h', 'display:block;color:#ffcf7a;animation:ob 1.6s ease-in-out infinite'],
        ['.r', 'display:block;color:#ffcf7a'],
        ['.y', 'color:#ffcf7a'],
        ['.q', 'display:block;color:#ffdf8a'],
        ['.g', 'display:block;color:#ffdf8a'],
        ['.n', 'color:#14120e;text-shadow:none;background:#ffcf7a']
      )
      break
    case 'probleme':
      regles.push(
        ['.bw', 'background-image:var(--probleme);animation:sp 1.6s steps(16) infinite'],
        ['.bu', 'display:grid;background:#b5503f;color:#fff;animation:tr .15s linear infinite'],
        ['.bu::after', 'content:"!"'],
        ['.h', 'display:block;color:#ff3b26;animation:ob .6s steps(2) infinite'],
        ['.r', 'display:block;color:#ff3b26;animation-duration:.8s'],
        ['.y', 'color:#ff6a50'],
        ['.h .ge', 'animation:rt 1.2s steps(6) infinite'],
        ['.n', 'color:#ff6a50;text-shadow:0 0 4px #ff3b26;box-shadow:inset 0 0 0 1px #ff6a50']
      )
      break
  }
  return regles
}

/** Les planches de chaque panda, au repos et au travail (`scripts/mascotte-panda-3d.py`). */
const PLANCHES_PANDA: Record<StylePanda, { calme: string; travail: string }> = {
  panda1: { calme: PANDA1_CALME, travail: PANDA1_TRAVAIL },
  panda2: { calme: PANDA2_CALME, travail: PANDA2_TRAVAIL },
  panda3: { calme: PANDA3_CALME, travail: PANDA3_TRAVAIL }
}

/** Vrai pour les trois pandas, dont les planches sont la table ci-dessus. */
function estUnStylePanda(style: StyleMascotte): style is StylePanda {
  return Object.prototype.hasOwnProperty.call(PLANCHES_PANDA, style)
}

/**
 * LES TROIS PANDAS 3D (`scripts/mascotte-panda-3d.py`, Blender) : pour chacun, deux planches de 16 images
 * de 104 x 125 px, au repos et au travail. La fenêtre n'admet aucun script : la planche tourne en CSS, par
 * `steps(16)`, comme la machine. Mêmes accroches que la machine (`.ob`, `.n`, `.z`, `.bu`, `.f`).
 */
function htmlDuPanda(style: StylePanda): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>Autowin — mascotte</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{font-family:ui-monospace,Consolas,monospace;user-select:none}
:root{--calme:url("${PLANCHES_PANDA[style].calme}");--travail:url("${PLANCHES_PANDA[style].travail}")}
.m{position:relative;width:124px;height:136px}
.m i,.m a{position:absolute;font-style:normal}
.sh{left:24px;top:118px;width:76px;height:14px;border-radius:50%;background:radial-gradient(closest-side,#000a,#0000);animation:so 3.2s ease-in-out infinite}
.ob{left:10px;top:4px;width:104px;height:125px;cursor:pointer;touch-action:none;transition:scale .2s;transform-origin:50% 100%}
.ob:active{cursor:grabbing}
.m:hover .ob{scale:1.06}
.bw{inset:0;background:var(--calme) 0 0/1664px 125px no-repeat;animation:sp 3.2s steps(16) infinite}
.n{display:none;place-items:center;left:2px;top:34px;min-width:26px;height:18px;padding:0 4px;box-sizing:border-box;font-weight:700;font-size:11px;letter-spacing:.08em;line-height:1;color:#ffcf7a;text-shadow:0 0 4px #ffcf7a;background:#14120ee6;box-shadow:inset 0 0 0 1px #ffcf7a99;clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)}
.n::after{position:static}
.z{display:none;left:90px;top:26px;font-weight:700;font-size:19px;text-shadow:0 0 4px #e4dfc9;line-height:1;color:#bdb79c;animation:oz 2.4s infinite}
.z::after{content:"z";position:absolute;left:9px;top:-9px;font-size:11px;animation:oz 2.4s 1.2s infinite;opacity:0}
.bu{display:none;place-items:center;left:88px;top:2px;width:26px;height:26px;border-radius:50%;font-weight:700;font-size:16px;line-height:1;background:#e4dfc9;color:#14120e;box-shadow:0 0 0 1.5px #4e4b42,0 0 10px 2px currentColor;animation:bu 1.6s ease-in-out infinite}
.f{z-index:2;display:grid;place-items:center;left:94px;top:22px;width:18px;height:18px;border-radius:50%;background:#14120ee6;box-shadow:0 0 0 1px #e4dfc95c;color:#e4dfc9;font-size:13px;line-height:1;text-decoration:none;cursor:pointer;opacity:0;transition:opacity .2s .4s}
.m:hover .f{opacity:1;transition-delay:0s}
.m:hover .z,.m:hover .bu{visibility:hidden}
@keyframes sp{to{background-position:-1664px 0}}
@keyframes so{50%{transform:scaleX(.92);opacity:.8}}
@keyframes oz{0%{opacity:0;transform:none}50%{opacity:1}100%{opacity:0;transform:translate(4px,-8px)}}
@keyframes bu{50%{transform:translateY(-3px)}}
@keyframes tr{25%{translate:-1px 0}75%{translate:1px 0}}
</style></head><body><div class="m"><i class="sh"></i><i class="ob" title="Ouvrir Autowin — glisser pour la déplacer"><i class="bw"></i></i><i class="n"></i><i class="z">z</i><i class="bu"></i><a class="f" href="#${FRAGMENT_FERMER}" title="Fermer la mascotte (pour la rouvrir : Réglages · Interface)">×</a></div></body></html>`
}

/**
 * Les règles d'état du panda : sa planche (repos ou travail), sa vitesse, une lueur ou un tremblement,
 * la bulle (✓ quand il attend, ! en cas d'échec) et la pastille du compte. Au repos et en attente, c'est
 * la même planche : la différence se lit dans le mouvement, pas dans un autre dessin.
 */
function reglesDuPanda(etat: NomEtatMascotte, pastille: string | null): Array<[string, string]> {
  const regles: Array<[string, string]> = []
  if (pastille) regles.push(['.n', 'display:grid'], ['.n::after', `content:"${pastille}"`])
  switch (etat) {
    case 'calme':
      regles.push(['.z', 'display:block'], ['.bw', 'filter:saturate(.7) brightness(.92)'])
      break
    case 'travail':
      regles.push(
        [
          '.bw',
          'background-image:var(--travail);animation:sp 1.2s steps(16) infinite;filter:drop-shadow(0 0 3px #ffb347) drop-shadow(0 0 8px #ffb34799)'
        ],
        ['.sh', 'animation-duration:1.2s']
      )
      break
    case 'attente':
      regles.push(['.bu', 'display:grid'], ['.bu::after', 'content:"✓"'])
      break
    case 'probleme':
      regles.push(
        [
          '.bw',
          'animation:sp 1.6s steps(16) infinite,tr .15s linear infinite;filter:drop-shadow(0 0 3px #ff3b26) drop-shadow(0 0 9px #ff3b2699)'
        ],
        ['.bu', 'display:grid;background:#b5503f;color:#fff'],
        ['.bu::after', 'content:"!"']
      )
      break
  }
  return regles
}

/** Les règles d'état de la bille basique : celles d'avant, inchangées. */
function reglesDeLaBilleBasique(
  etat: NomEtatMascotte,
  pastille: string | null
): Array<[string, string]> {
  const regles: Array<[string, string]> = []
  if (pastille) regles.push(['.n', 'display:grid'], ['.n::after', `content:"${pastille}"`])
  switch (etat) {
    case 'calme':
      regles.push(['.bw,.bl', 'opacity:.5'], ['.z', 'display:block'])
      break
    case 'travail':
      regles.push(
        ['.h', 'display:block;animation:ot 4s linear infinite'],
        ['.h circle', 'stroke:#8d98bd;stroke-dasharray:3 4'],
        ['.bw', 'animation:ot 5s linear infinite'],
        ['.n', 'background:linear-gradient(135deg,#467ffa,#a868f9)']
      )
      break
    case 'attente':
      regles.push(
        ['.h', 'display:block;animation:ob 1.4s infinite'],
        ['.h circle', 'stroke:#f0c75e;stroke-width:2.6'],
        ['.n', 'background:#f0c75e;color:#1b1f2a']
      )
      break
    case 'probleme':
      regles.push(
        ['.h', 'display:block'],
        ['.h circle', 'stroke:#e5534b;stroke-width:2.6'],
        ['.bw', 'filter:grayscale(1)'],
        ['.bk', 'display:block'],
        ['.n', 'background:#e5534b']
      )
      break
  }
  return regles
}

/**
 * FERMER LA BILLE (2026-10-26, demande : « je veux pouvoir déplacer la mascotte et la
 * fermer ») : au survol, une CROIX en haut à droite, lien vers `#fermer`. Elle reste 0,4 s après la
 * sortie du survol, le temps d'y arriver en biais.
 */
const FRAGMENT_FERMER = 'fermer'

/** Le clic sur la croix, lu sur l'adresse de la navigation interne. */
export function estLaFermeture(url: string): boolean {
  return new RegExp(`#${FRAGMENT_FERMER}$`, 'u').test(url)
}

/** Une place gardée : le coin haut-gauche de la fenêtre, en pixels d'écran. */
export type PositionMascotte = { x: number; y: number }

/**
 * La place où l'utilisateur a laissé la bille, si elle est encore sur un écran : son CENTRE doit
 * tomber dans une zone de travail, puis elle y est ramenée entière. Sinon (écran débranché,
 * résolution changée, rien de gardé), le coin d'origine au-dessus de l'horloge.
 */
export function placerMascotteGardee(
  position: PositionMascotte | null,
  zones: readonly Rect[],
  principale: Rect,
  style: StyleMascotte = 'magicien'
): Rect {
  const { largeur, hauteur, centre } = geometrieMascotte(style)
  if (position) {
    // Le centre de la BILLE, pas de la fenêtre : c'est elle que l'utilisateur a posée.
    const cx = position.x + centre.x
    const cy = position.y + centre.y
    const zone = zones.find(
      (z) => cx >= z.x && cx < z.x + z.width && cy >= z.y && cy < z.y + z.height
    )
    if (zone) {
      const borne = (v: number, min: number, max: number): number =>
        Math.min(Math.max(v, min), Math.max(min, max))
      return {
        x: borne(position.x, zone.x, zone.x + zone.width - largeur),
        y: borne(position.y, zone.y, zone.y + zone.height - hauteur),
        width: largeur,
        height: hauteur
      }
    }
  }
  return placerMascotte(principale, style)
}

/**
 * CHANGER DE STYLE SANS DÉPLACER LA BILLE : la place gardée est le coin de la FENÊTRE,
 * et les deux styles n'ont ni la même fenêtre ni la bille au même endroit dedans. Le coin est donc
 * recalculé pour que le centre de la bille reste au même point de l'écran.
 */
export function positionPourLeStyle(
  position: PositionMascotte,
  avant: StyleMascotte,
  apres: StyleMascotte
): PositionMascotte {
  const de = geometrieMascotte(avant).centre
  const vers = geometrieMascotte(apres).centre
  return { x: position.x + de.x - vers.x, y: position.y + de.y - vers.y }
}

/**
 * GLISSER-DÉPOSER LA BILLE ENTIÈRE, ET LA CLIQUER (2026-10-26, demande : « je veux
 * pouvoir la drag & drop […] et que ça m'ouvre autowin quand je click dessus »).
 *
 * Pourquoi pas `-webkit-app-region: drag` sur la bille : Windows la traite alors comme une barre de
 * titre, et AUCUN clic n'arrive plus à la page — glisser OU cliquer, jamais les deux. Le tour
 * précédent avait donc réservé le glisser à une petite poignée ; l'utilisateur veut la bille.
 *
 * Ici, la page ne fait que signaler ses gestes (appui, bouge, lâche) par un préchargement minimal,
 * avec la position du pointeur à l'écran (`screenX`/`screenY`, dans les mêmes pixels que
 * `setBounds`). Le moteur tranche : pas plus de `SEUIL_GLISSER_PX` dans chaque sens entre l'appui
 * et le lâcher = un CLIC (le seuil de glisser par défaut de Windows, SM_CXDRAG), au-delà = un
 * GLISSER, et la fenêtre suit le pointeur jusqu'au lâcher. La position vient de l'événement et non
 * de `screen.getCursorScreenPoint` : c'est la même valeur sous une vraie souris, mais seule celle
 * de l'événement suit un glisser rejoué par messages dans un bureau caché — la preuve du 2026-10-26.
 */
export const CANAL_GESTE_MASCOTTE = 'mascotte:geste'
export const SEUIL_GLISSER_PX = 4

export type GesteMascotte = 'appui' | 'bouge' | 'lache' | 'annule'

export type PointEcran = { x: number; y: number }

/** Le geste reçu de la page et sa position ; tout le reste est ignoré. */
export function gesteDeMascotte(
  brut: unknown,
  x: unknown,
  y: unknown
): { geste: GesteMascotte; curseur: PointEcran } | null {
  const geste =
    brut === 'appui' || brut === 'bouge' || brut === 'lache' || brut === 'annule' ? brut : null
  if (!geste || typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { geste, curseur: { x, y } }
}
export type FinDeGeste = { type: 'clic' } | { type: 'pose'; position: PositionMascotte }

/**
 * La décision clic / glisser, sans fenêtre. `annule` (pointeur perdu) n'ouvre jamais Autowin, mais
 * pose la bille là où le glisser l'avait menée.
 */
export function creerGlisserMascotte(seuil: number = SEUIL_GLISSER_PX): {
  appui: (curseur: PointEcran, fenetre: PointEcran) => void
  bouge: (curseur: PointEcran) => PositionMascotte | null
  lache: (curseur: PointEcran) => FinDeGeste | null
  annule: (curseur: PointEcran) => FinDeGeste | null
} {
  let depart: { curseur: PointEcran; fenetre: PointEcran } | null = null
  let glisse = false
  const bouge = (curseur: PointEcran): PositionMascotte | null => {
    if (!depart) return null
    const dx = curseur.x - depart.curseur.x
    const dy = curseur.y - depart.curseur.y
    if (!glisse && (Math.abs(dx) > seuil || Math.abs(dy) > seuil)) glisse = true
    return glisse
      ? { x: Math.round(depart.fenetre.x + dx), y: Math.round(depart.fenetre.y + dy) }
      : null
  }
  const finir = (curseur: PointEcran, clicPermis: boolean): FinDeGeste | null => {
    if (!depart) return null
    const position = bouge(curseur)
    depart = null
    glisse = false
    if (position) return { type: 'pose', position }
    return clicPermis ? { type: 'clic' } : null
  }
  return {
    appui: (curseur, fenetre) => {
      depart = { curseur, fenetre }
      glisse = false
    },
    bouge,
    lache: (curseur) => finir(curseur, true),
    annule: (curseur) => finir(curseur, false)
  }
}

/**
 * LE PRÉCHARGEMENT de la fenêtre de la bille : il écoute le pointeur sur la bille (pas sur la croix)
 * et n'envoie au moteur que le NOM du geste et la position du pointeur, sur un seul canal. Il tourne dans le monde isolé, en
 * bac à sable : il n'expose rien à la page. Écrit en JavaScript (pas compilé) parce qu'il est
 * posé à côté de la page, dans le dossier temporaire, comme elle.
 * La capture du pointeur garde le lâcher même si le curseur sort de la bille pendant le glisser.
 */
export const PRELOAD_MASCOTTE = `'use strict'
const { ipcRenderer } = require('electron')
const envoyer = (geste, e) =>
  ipcRenderer.send(${JSON.stringify(CANAL_GESTE_MASCOTTE)}, geste, e.screenX, e.screenY)
let pointeur = null
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !(e.target instanceof Element) || !e.target.closest('.ob')) return
  pointeur = e.pointerId
  try { e.target.setPointerCapture(e.pointerId) } catch {}
  e.preventDefault()
  envoyer('appui', e)
}, true)
window.addEventListener('pointermove', (e) => {
  if (pointeur === null || e.pointerId !== pointeur) return
  if ((e.buttons & 1) === 0) { pointeur = null; envoyer('lache', e); return }
  envoyer('bouge', e)
}, true)
window.addEventListener('pointerup', (e) => {
  if (pointeur === null || e.pointerId !== pointeur) return
  pointeur = null
  envoyer('lache', e)
}, true)
for (const type of ['pointercancel', 'lostpointercapture']) {
  window.addEventListener(type, (e) => {
    if (pointeur === null || e.pointerId !== pointeur) return
    pointeur = null
    envoyer('annule', e)
  }, true)
}
`

/**
 * La feuille de l'ÉTAT, ajoutée par-dessus la page. La pastille n'accepte que des chiffres, « + »
 * et « ! » (`etatDeLaMascotte`) ; depuis le personnage, elle n'entre même plus dans le
 * CSS : elle choisit l'un des chiffres déjà dessinés dans la page (`reglesDuPersonnage`).
 *
 * Chaque sélecteur est préfixé par `body ` : une feuille posée par `insertCSS` passe AVANT celles de
 * la page à poids égal. Constaté le 2026-10-25 en capture de la vraie fenêtre : la
 * rotation, absente de la page, s'appliquait ; `.h{display:block}` et `.n{display:grid}` perdaient
 * contre le `display:none` de la page, et ni halo ni pastille ne s'allumaient.
 */
export function cssDeLEtat(etat: EtatMascotte, style: StyleMascotte = 'magicien'): string {
  const pastille = etat.pastille && /^[0-9+!]{1,2}$/u.test(etat.pastille) ? etat.pastille : null
  if (style === 'basique') return enFeuille(reglesDeLaBilleBasique(etat.etat, pastille))
  if (style === 'machine') return enFeuille(reglesDeLaMachine(etat.etat, pastille))
  if (estUnStylePanda(style)) return enFeuille(reglesDuPanda(etat.etat, pastille))
  const regles: Array<[string, string]> = reglesDuPersonnage(etat.etat, pastille)
  switch (etat.etat) {
    case 'calme':
      // Opaque au repos aussi (« met la pas transparente au repos ») : l'ancien
      // `.cps{opacity:.55}` rendait le personnage à moitié transparent dès que rien ne tournait.
      regles.push(['.z', 'display:block'])
      break
    // Le halo est un GLYPHE (`glypheDuHalo`) : sa couronne de runes (`.ge`) et son étoile
    // (`.gi`) tournent en sens contraires ; l'état choisit couleur, lueur et vitesse.
    case 'travail':
      regles.push(
        [
          '.h',
          'display:block;color:#cfe8ff;filter:drop-shadow(0 0 1.2px #7fc4ff) drop-shadow(0 0 3px #3d8bff)'
        ],
        ['.h .ge', 'animation:ot 14s linear infinite'],
        ['.h .gi', 'animation:ot 9s linear infinite reverse'],
        ['.h .gp', 'animation:ob 2.2s ease-in-out infinite'],
        ['.bw', 'animation:ot 5s linear infinite']
      )
      break
    case 'attente':
      regles.push(
        [
          '.h',
          'display:block;color:#f0c75e;filter:drop-shadow(0 0 1.5px #f0c75e) drop-shadow(0 0 3px #ffb02e)'
        ],
        ['.h .ge', 'animation:ot 24s linear infinite'],
        ['.h .gi', 'animation:ot 16s linear infinite reverse'],
        ['.h .gp', 'animation:ob 1.4s infinite'],
        ['.cps', 'animation:ho 1.1s ease-in-out infinite']
      )
      break
    case 'probleme':
      // Immobile et rouge ; ses runes grésillent, comme un sort cassé.
      regles.push(
        ['.h', 'display:block;color:#e5534b;filter:drop-shadow(0 0 1.5px #e5534b)'],
        ['.h .gp', 'animation:ob .9s steps(2) infinite'],
        ['.bw', 'filter:grayscale(1)'],
        ['.bk', 'display:block']
      )
      break
  }
  return enFeuille(regles)
}

export const HUMEURS_ACCUEIL = ['coucou', 'eveil', 'lecture', 'sommeil'] as const
export type HumeurAccueil = (typeof HUMEURS_ACCUEIL)[number]

/**
 * LA MÊME MASCOTTE SUR L'ACCUEIL D'UN FIL VIDE (2026-10-31) : `AnimationAccueilChat` montre
 * la vraie page (`htmlDeMascotte`) et lui pose cette feuille, dans le style choisi en Settings.
 * Dormir, c'est son état calme ; faire coucou, ses bras levés de « pour toi », sans chiffre. Dès
 * qu'un agent tourne, elle travaille avec le vrai compte, même si l'utilisateur ne bouge plus :
 * l'endormir là ferait disparaître le chiffre au moment où il dit quelque chose.
 */
export function cssDeLAccueil(
  humeur: HumeurAccueil,
  agents: number,
  style: StyleMascotte = 'magicien'
): string {
  if (agents > 0) return cssDeLEtat({ etat: 'travail', pastille: compte(agents), fil: null }, style)
  // Ni la bille basique ni le panda n'ont le grimoire du magicien : leurs règles d'accueil sont celles de la bille.
  const sansGrimoire = style === 'basique' || estUnStylePanda(style)
  switch (humeur) {
    case 'sommeil':
      return cssDeLEtat({ etat: 'calme', pastille: null, fil: null }, style)
    case 'coucou':
      return cssDeLEtat({ etat: 'attente', pastille: null, fil: null }, style)
    // La bille basique n'a ni bras ni grimoire : son halo qui tourne dit qu'elle est attentive.
    case 'lecture':
      return sansGrimoire
        ? cssDeLEtat({ etat: 'travail', pastille: null, fil: null }, style)
        : enFeuille(reglesDeLAccueil('lecture'))
    case 'eveil':
      return sansGrimoire ? '' : enFeuille(reglesDeLAccueil('eveil'))
  }
}

/** Chaque sélecteur préfixé par `body ` (voir `cssDeLEtat`). */
function enFeuille(regles: ReadonlyArray<readonly [string, string]>): string {
  return regles
    .map(([selecteurs, declarations]) => {
      const prefixes = selecteurs.split(',').map((s) => `body ${s.trim()}`)
      return `${prefixes.join(',')}{${declarations}}`
    })
    .join('\n')
}
