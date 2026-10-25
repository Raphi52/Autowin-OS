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
 * - « Sentinelle » : fixe dans le coin, juste au-dessus de l'horloge, et les cartes de fin de tour
 *   sortent à sa gauche (`zoneDesCartes`).
 *
 * Ce module ne connaît pas Electron (même découpe que `notification-popup.ts`) : l'état, la page,
 * le placement et la lecture des clics sont testés sans fenêtre. La fenêtre vit dans
 * `mascotte-fenetre.ts`.
 */
import type { Rect } from './notification-popup'
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
 * La zone où se posent les cartes de fin de tour quand la mascotte est là : la même, amputée de la
 * colonne de la mascotte. Les cartes « sortent d'elle », à sa gauche, au lieu de la recouvrir.
 */
export function zoneDesCartes(zone: Rect): Rect {
  return { ...zone, width: Math.max(0, zone.width - TAILLE_MASCOTTE - MARGE_MASCOTTE) }
}

/** L'anneau du logo, du bleu en haut (0°) au vert-bleu (330°). */
const ANNEAU =
  'conic-gradient(#2f91c7 0deg,#467ffa 30deg,#7574fb 60deg,#a868f9 90deg,#cb60bd 120deg,#ee5883 150deg,#fe6b54 180deg,#fc9a31 210deg,#f9c512 240deg,#9fba35 270deg,#42b059 300deg,#20a289 330deg,#2f91c7 360deg)'

/**
 * LA PAGE, fixe : tous les calques y sont, l'état les allume par une feuille de style AJOUTÉE
 * (`cssDeLEtat`, posée par `webContents.insertCSS`). Aucun script : la page n'a accès à rien.
 * Le clic est un lien vers un fragment, lu par le processus principal sur la navigation interne,
 * comme les cartes (`notification-popup-fenetre.ts`). DEUX liens alternent (`#o1`, `#o2`) : un
 * second clic sur le MÊME fragment ne navigue plus, donc ne se verrait pas.
 */
export function htmlDeMascotte(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Autowin — mascotte</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{display:grid;place-items:center;font-family:ui-monospace,Consolas,monospace;user-select:none}
.m{display:grid;place-items:center;width:68px;height:68px}
.m>*{grid-area:1/1}
.ob{display:grid;place-items:center;width:64px;height:64px;transition:transform .2s}
.m:hover .ob{transform:scale(1.06)}
.ob>*{grid-area:1/1;border-radius:50%;transform:rotate(0deg)}
.h{display:none;width:64px;height:64px;overflow:visible;border-radius:0}
.h circle{fill:none;stroke-width:2}
.bw,.bk,.bl{width:52px;height:52px}
.bw{background:radial-gradient(circle,#fff9 0,#fff2 42%,#fff0 62%),${ANNEAU}}
.bl{background:radial-gradient(circle at 32% 26%,#fffffff2 0,#fff5 13%,#fff0 28%),radial-gradient(circle,#0a0c1e00 56%,#0a0c1e80)}
.bk{display:none;background:radial-gradient(circle,#e5534b59,#e5534bbf)}
.n{display:none;place-items:center;justify-self:end;align-self:end;width:22px;height:22px;margin:0 -3px -3px 0;font-weight:700;font-size:12px;line-height:1;color:#fff;box-shadow:0 0 0 2px #10131ccc}
.z{display:none;justify-self:end;align-self:start;margin:-2px -2px 0 0;font-weight:700;font-size:16px;line-height:1;color:#9aa3b5;border-radius:0;animation:oz 2.4s infinite}
a{display:none;position:relative;z-index:1;width:64px;height:64px;border-radius:50%;cursor:pointer}
@keyframes ot{to{transform:rotate(360deg)}}
@keyframes ob{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes oz{0%{opacity:0;transform:none}50%{opacity:1}100%{opacity:0;transform:translate(4px,-6px)}}
</style></head><body><div class="m"><i class="ob"><svg class="h" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19"/></svg><i class="bw"></i><i class="bk"></i><i class="bl"></i><i class="n"></i><i class="z">z</i></i><a class="l1" href="#o1" title="Autowin"></a><a class="l2" href="#o2" title="Autowin"></a></div></body></html>`
}

/** Le lien qui reçoit le prochain clic : 1 (`#o1`) ou 2 (`#o2`). */
export type LienActif = 1 | 2

/**
 * La feuille de l'ÉTAT, ajoutée par-dessus la page. La pastille n'accepte que des chiffres, « + »
 * et « ! » (`etatDeLaMascotte`) : rien d'autre n'entre dans la chaîne CSS de `content`.
 *
 * Chaque sélecteur est préfixé par `body ` : une feuille posée par `insertCSS` passe AVANT celles de
 * la page à poids égal. Constaté le 2026-10-25 en capture de la vraie fenêtre (conv-1145) : la
 * rotation, absente de la page, s'appliquait ; `.h{display:block}` et `.n{display:grid}` perdaient
 * contre le `display:none` de la page, et ni halo ni pastille ne s'allumaient.
 */
export function cssDeLEtat(etat: EtatMascotte, lien: LienActif): string {
  const regles: Array<[string, string]> = [[`.l${lien}`, 'display:block']]
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

/** Le lien cliqué, lu sur l'adresse de la navigation interne ; `null` = pas un clic de bille. */
export function lienDuFragment(url: string): LienActif | null {
  const fragment = /#(o[12])$/u.exec(url)?.[1]
  if (fragment === 'o1') return 1
  if (fragment === 'o2') return 2
  return null
}
