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
 *   t'attend), rouge (un tour a échoué), rien au calme ;
 * - une PASTILLE au coin qui compte : les agents au travail, ou les fils qui t'attendent ; « ! »
 *   sur un échec ;
 * - « Sentinelle » : dans le coin, juste au-dessus de l'horloge, et les cartes de fin de tour
 *   sortent à sa gauche (`zoneDesCartes`) ; depuis conv-1142, elle se glisse ailleurs et les cartes
 *   la suivent.
 *
 * Ce module ne connaît pas Electron (même découpe que `notification-popup.ts`) : l'état, la page,
 * le placement et la lecture des clics sont testés sans fenêtre. La fenêtre vit dans
 * `mascotte-fenetre.ts`.
 */
import { LARGEUR_POPUP, MARGE_CARTE, type Rect, type ZoneDesCartes } from './notification-popup'
import {
  contenuDeNotificationDeFinDeTour,
  type FinDeTourPourNotification
} from './notification-fin-de-tour'

/** Côté de la fenêtre (carrée, transparente) : la bille, son halo et la pastille qui déborde. */
export const TAILLE_MASCOTTE = 80
/** Distance au coin de la zone de travail (au-dessus de la barre des tâches, pas dessous). */
const MARGE_MASCOTTE = 6

/** Les quatre états des maquettes : Calme, Au travail, Pour toi, Problème. */
export type NomEtatMascotte = 'calme' | 'travail' | 'attente' | 'probleme'

export type EtatMascotte = {
  etat: NomEtatMascotte
  /** Le texte de la pastille (chiffre, « 9+ » ou « ! ») ; `null` = pas de pastille. */
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

/** Une pastille de 22 px tient deux caractères : au-delà de 9, « 9+ ». */
function compte(n: number): string {
  return n > 9 ? '9+' : String(n)
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
export function placerMascotte(zone: Rect): Rect {
  return {
    x: zone.x + zone.width - MARGE_MASCOTTE - TAILLE_MASCOTTE,
    y: zone.y + zone.height - MARGE_MASCOTTE - TAILLE_MASCOTTE,
    width: TAILLE_MASCOTTE,
    height: TAILLE_MASCOTTE
  }
}

/**
 * LES CARTES SORTENT DE LA BILLE, LÀ OÙ ELLE EST (conv-1142, 2026-10-26, demande : « fais sortir les
 * cartes de fin de tour à côté de la mascotte là où je l'ai déplacée, au lieu de garder libre le
 * coin de l'horloge »). Avant, la zone des cartes perdait seulement la colonne du coin d'origine :
 * une bille glissée ailleurs laissait les cartes au coin de l'horloge.
 *
 * `bille` est la fenêtre de la mascotte, `zone` la zone de travail de SON écran :
 * - côté : à GAUCHE de la bille si une carte y tient, sinon à droite (bille près du bord gauche) ;
 *   aucune ne tient (écran très étroit) : le côté le plus large ;
 * - sens : bille dans la moitié BASSE de l'écran, la pile part du bas de la bille et monte ; dans
 *   la moitié haute, elle part du haut de la bille et descend.
 * Au coin d'origine, le résultat est la zone d'avant : cartes à gauche, posées sur le bas de l'écran.
 */
export function zoneDesCartes(bille: Rect, zone: Rect): ZoneDesCartes {
  const droiteZone = zone.x + zone.width
  const basZone = zone.y + zone.height
  const droiteBille = bille.x + bille.width
  const placeAGauche = bille.x - zone.x
  const placeADroite = droiteZone - droiteBille
  const besoin = LARGEUR_POPUP + MARGE_CARTE
  const aGauche = placeAGauche >= besoin || (placeADroite < besoin && placeAGauche >= placeADroite)
  const horizontal: Pick<ZoneDesCartes, 'x' | 'width' | 'bord'> = aGauche
    ? { x: zone.x, width: Math.max(0, placeAGauche), bord: 'droite' }
    : { x: droiteBille, width: Math.max(0, placeADroite), bord: 'gauche' }
  const enBas = bille.y + bille.height / 2 >= zone.y + zone.height / 2
  if (enBas) {
    const bas = Math.min(basZone, bille.y + bille.height + MARGE_CARTE)
    return { ...horizontal, y: zone.y, height: Math.max(0, bas - zone.y), sens: 'haut' }
  }
  const haut = Math.max(zone.y, bille.y - MARGE_CARTE)
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
 * au milieu du cercle ») : la pastille `.n` était au coin bas-droit, elle est centrée sur la bille,
 * un peu plus grande (26 px) et cerclée de sombre pour rester lisible sur le reflet clair du centre.
 */
export function htmlDeMascotte(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Autowin — mascotte</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{display:grid;place-items:center;font-family:ui-monospace,Consolas,monospace;user-select:none}
.m{display:grid;place-items:center;width:68px;height:68px}
.m>*{grid-area:1/1}
.ob{display:grid;place-items:center;width:64px;height:64px;cursor:pointer;touch-action:none;transition:transform .2s}
.ob:active{cursor:grabbing}
.m:hover .ob{transform:scale(1.06)}
.ob>*{grid-area:1/1;border-radius:50%;transform:rotate(0deg)}
.h{display:none;width:64px;height:64px;overflow:visible;border-radius:0}
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
  principale: Rect
): Rect {
  if (position) {
    const cx = position.x + TAILLE_MASCOTTE / 2
    const cy = position.y + TAILLE_MASCOTTE / 2
    const zone = zones.find(
      (z) => cx >= z.x && cx < z.x + z.width && cy >= z.y && cy < z.y + z.height
    )
    if (zone) {
      const borne = (v: number, min: number, max: number): number =>
        Math.min(Math.max(v, min), Math.max(min, max))
      return {
        x: borne(position.x, zone.x, zone.x + zone.width - TAILLE_MASCOTTE),
        y: borne(position.y, zone.y, zone.y + zone.height - TAILLE_MASCOTTE),
        width: TAILLE_MASCOTTE,
        height: TAILLE_MASCOTTE
      }
    }
  }
  return placerMascotte(principale)
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
 * et « ! » (`etatDeLaMascotte`) : rien d'autre n'entre dans la chaîne CSS de `content`.
 *
 * Chaque sélecteur est préfixé par `body ` : une feuille posée par `insertCSS` passe AVANT celles de
 * la page à poids égal. Constaté le 2026-10-25 en capture de la vraie fenêtre (conv-1145) : la
 * rotation, absente de la page, s'appliquait ; `.h{display:block}` et `.n{display:grid}` perdaient
 * contre le `display:none` de la page, et ni halo ni pastille ne s'allumaient.
 */
export function cssDeLEtat(etat: EtatMascotte): string {
  const regles: Array<[string, string]> = []
  const pastille = etat.pastille && /^[0-9+!]{1,2}$/u.test(etat.pastille) ? etat.pastille : null
  if (pastille) regles.push(['.n', 'display:grid'], ['.n::after', `content:"${pastille}"`])
  switch (etat.etat) {
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
    .map(([selecteurs, declarations]) => {
      const prefixes = selecteurs.split(',').map((s) => `body ${s.trim()}`)
      return `${prefixes.join(',')}{${declarations}}`
    })
    .join('\n')
}
