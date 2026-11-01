/**
 * LA MASCOTTE DU BUREAU — « Bille · pastille » (conv-1145, 2026-10-25).
 *
 * Choix de l'utilisateur sur maquettes (/draft, trois tours) : « une mascotte sur le bureau
 * Windows, qui te prévient même quand l'app est réduite » -> « Orbe · Sentinelle » -> « Orbe
 * inspiré de l'anneau multicolor » -> « mix 2 et 3 » -> « Implémenter la 5 · Bille · pastille ».
 *
 * Ce qui a été retenu :
 * - une BILLE aux couleurs de l'anneau du logo (`assets/autowin-logo-anneau.png`, 12 couleurs
 *   relevées au pixel tous les 30°), avec un reflet de verre ;
 * - un HALO autour d'elle qui dit l'état : pointillés qui tournent (au travail), or qui bat (un fil
 *   t'attend), rouge (un tour a échoué), rien au calme ; depuis conv-1227, c'est un grand glyphe
 *   de runes (`glypheDuHalo`), même code de couleurs ;
 * - une PASTILLE au coin qui compte : les agents au travail, ou les fils qui t'attendent ; « ! »
 *   sur un échec ;
 * - « Sentinelle » : dans le coin, juste au-dessus de l'horloge, et les cartes de fin de tour
 *   sortent à sa gauche (`zoneDesCartes`) ; depuis conv-1142, elle se glisse ailleurs et les cartes
 *   la suivent.
 *
 * Depuis conv-1227 (2026-10-28), la bille est un PERSONNAGE (`mascotte-personnage.ts`) : visage,
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
import type { StyleMascotte } from './mascotte-reglage'
import { LARGEUR_POPUP, MARGE_CARTE, type Rect, type ZoneDesCartes } from './notification-popup'
import {
  contenuDeNotificationDeFinDeTour,
  type FinDeTourPourNotification
} from './notification-fin-de-tour'

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
 * à 11 px du bord) : les cartes s'y collent, au ras du personnage (conv-1195, conv-1227).
 */
export const RETRAIT_COTE = 10
/** Distance au coin de la zone de travail (au-dessus de la barre des tâches, pas dessous). */
const MARGE_MASCOTTE = 6
/** La croix de fermeture, dans la fenêtre : en haut à droite du halo. */
const CROIX = { x: CENTRE_BILLE.x + 20, y: CENTRE_BILLE.y - 40, taille: 18 } as const

/**
 * LA GÉOMÉTRIE DE CHAQUE STYLE (conv-1249, 2026-10-29, « choix de mascotte soit magicien soit
 * basique ») : le magicien vit dans sa grande fenêtre (chapeau, bras, sorts) ; la bille basique
 * reprend la fenêtre d'avant conv-1227, un carré de 80 px, le halo de 64 au milieu et la croix au
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
  }
}
export function geometrieMascotte(style: StyleMascotte = 'magicien'): GeometrieMascotte {
  return GEOMETRIES[style]
}

/**
 * Le pointeur (relatif au coin de la fenêtre) est-il sur la bille ou sa croix ? Partout ailleurs —
 * chapeau, bras, sorts, vide —, la fenêtre laisse passer les clics vers le bureau (conv-1227) :
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
 * Le VRAI compte, jusqu'à 99 (conv-1270, « affiche le vrai nombre sur le chapeau jusqu'à 99 au lieu
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
 * LES CARTES SORTENT DE LA BILLE, LÀ OÙ ELLE EST (conv-1142, 2026-10-26, demande : « fais sortir les
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
 * CARTES COLLÉES AU HALO (conv-1195, 2026-10-28, demande : « j'aimerais que les notifs et la
 * mascotte soient snap ensemble ») : la carte était posée à `MARGE_CARTE` (12 px) de la FENÊTRE de
 * la bille, elle-même transparente sur 8 px autour du halo — 20 px de vide visible.
 * La carte touche maintenant le halo, et son bas (ou son haut, pile qui descend) est au niveau du
 * sien. Elle empiète donc sur la bande transparente de la fenêtre de la bille, jamais sur le halo :
 * le glisser, lu sur `.ob` seul (`PRELOAD_MASCOTTE`), reste entier.
 *
 * AU RAS DU PERSONNAGE (conv-1227) : depuis qu'elle a des bras, des sorts et des feux follets qui
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
 * LE LISERÉ ARC-EN-CIEL des cartes de fin de tour quand la mascotte est affichée (conv-1145,
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
 * LE NOMBRE AU MILIEU DE LA BILLE (conv-1142, 2026-10-26, demande : « je veux que le nombre soit
 * au milieu du cercle ») : la pastille `.n` était au coin bas-droit, elle a été centrée sur la bille.
 *
 * LE PERSONNAGE (conv-1227, 2026-10-28, « implémente le 2 ») : le nombre est maintenant le CHIFFRE
 * qui brille dans l'étoile du chapeau, dessiné avec tout le personnage (`svgDuPersonnage`) par-dessus
 * la bille ; le visage est peint sur la bille (`visageDeLaBille`). Le survol grossit tout le
 * personnage (`scale`), le saut de « pour toi » le soulève (`translate`) : deux propriétés
 * distinctes, qui se composent au lieu de s'écraser.
 */
export function htmlDeMascotte(style: StyleMascotte = 'magicien'): string {
  if (style === 'basique') return htmlDeLaBilleBasique()
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
 * LA BILLE BASIQUE (conv-1249, 2026-10-29) : la page d'avant le personnage, telle que conv-1142 l'a
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

/** Les règles d'état de la bille basique : celles d'avant conv-1227, inchangées. */
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
 * FERMER LA BILLE (conv-1142, 2026-10-26, demande : « je veux pouvoir déplacer la mascotte et la
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
 * CHANGER DE STYLE SANS DÉPLACER LA BILLE (conv-1249) : la place gardée est le coin de la FENÊTRE,
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
 * GLISSER-DÉPOSER LA BILLE ENTIÈRE, ET LA CLIQUER (conv-1142, 2026-10-26, demande : « je veux
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
 * et « ! » (`etatDeLaMascotte`) ; depuis le personnage (conv-1227), elle n'entre même plus dans le
 * CSS : elle choisit l'un des chiffres déjà dessinés dans la page (`reglesDuPersonnage`).
 *
 * Chaque sélecteur est préfixé par `body ` : une feuille posée par `insertCSS` passe AVANT celles de
 * la page à poids égal. Constaté le 2026-10-25 en capture de la vraie fenêtre (conv-1145) : la
 * rotation, absente de la page, s'appliquait ; `.h{display:block}` et `.n{display:grid}` perdaient
 * contre le `display:none` de la page, et ni halo ni pastille ne s'allumaient.
 */
export function cssDeLEtat(etat: EtatMascotte, style: StyleMascotte = 'magicien'): string {
  const pastille = etat.pastille && /^[0-9+!]{1,2}$/u.test(etat.pastille) ? etat.pastille : null
  if (style === 'basique') return enFeuille(reglesDeLaBilleBasique(etat.etat, pastille))
  const regles: Array<[string, string]> = reglesDuPersonnage(etat.etat, pastille)
  switch (etat.etat) {
    case 'calme':
      // Opaque au repos aussi (conv-1227, « met la pas transparente au repos ») : l'ancien
      // `.cps{opacity:.55}` rendait le personnage à moitié transparent dès que rien ne tournait.
      regles.push(['.z', 'display:block'])
      break
    // Le halo est un GLYPHE (`glypheDuHalo`, conv-1227) : sa couronne de runes (`.ge`) et son étoile
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
 * LA MÊME MASCOTTE SUR L'ACCUEIL D'UN FIL VIDE (conv-1401, 2026-10-31) : `AnimationAccueilChat` montre
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
  switch (humeur) {
    case 'sommeil':
      return cssDeLEtat({ etat: 'calme', pastille: null, fil: null }, style)
    case 'coucou':
      return cssDeLEtat({ etat: 'attente', pastille: null, fil: null }, style)
    // La bille basique n'a ni bras ni grimoire : son halo qui tourne dit qu'elle est attentive.
    case 'lecture':
      return style === 'basique'
        ? cssDeLEtat({ etat: 'travail', pastille: null, fil: null }, style)
        : enFeuille(reglesDeLAccueil('lecture'))
    case 'eveil':
      return style === 'basique' ? '' : enFeuille(reglesDeLAccueil('eveil'))
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
