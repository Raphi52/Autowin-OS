/**
 * POPUP « VERRE NACRÉ » — la fin d'un tour en carte au thème d'Autowin (conv-1066, 2026-10-22).
 *
 * Pourquoi : la bulle Windows de fin de tour (`notification-fin-de-tour.ts`) n'est pas stylable.
 * L'utilisateur a demandé « des belles popups de notification en bas à droite », puis a retenu la
 * direction « thème actuel » de la maquette /draft du fil : cadre irisé, pastille « A » en dégradé,
 * faits dans un encart, première suite en bouton dégradé. Couleurs = celles du thème Nébuleuse de
 * verre (`theme-nebuleuse-verre.css` : --violet #3c6eeb, --rose #e63ca0, --gold #ff8cc8).
 *
 * La carte vit dans SA fenêtre : elle ne sonne que quand aucune fenêtre d'Autowin n'est regardée,
 * donc un toast dessiné DANS la fenêtre principale serait invisible au seul moment utile.
 *
 * Ce module ne connaît pas Electron (même découpe que `notification-fin-de-tour.ts`) : la page, la
 * taille, le placement et la pile se testent sans fenêtre ; `notification-popup-fenetre.ts` fournit
 * la vraie fenêtre.
 */
import {
  libelleDeBouton,
  type ContenuNotification,
  type NotificationAffichable
} from './notification-fin-de-tour'

export type Rect = { x: number; y: number; width: number; height: number }

/** Ce qu'un clic dans la carte demande — porté par le fragment de l'adresse (`#ouvrir`…). */
export type ActionPopup = { type: 'ouvrir' } | { type: 'fermer' } | { type: 'suite'; index: number }

/** Largeur de la carte de la maquette (`max-width: 340px`). */
export const LARGEUR_POPUP = 340
/** Distance au bord de la zone de travail (au-dessus de la barre des tâches, pas dessous). */
const MARGE = 12
/** Écart vertical entre deux cartes empilées. */
const ECART = 8
/** Au-delà, la plus ancienne part : une rafale du mode auto ne tapisse pas l'écran. */
const MAX_POPUPS = 4
/** La carte affiche deux lignes de faits au plus, comme la bulle. */
const MAX_LIGNES = 2

/*
 * Hauteurs FIXES en pixels (line-height explicites, lignes sans retour) : la hauteur de la fenêtre
 * se calcule sans mesurer la page, donc sans script. Une fenêtre plus haute que la carte avalerait
 * les clics d'une bande transparente du bureau ; plus basse, elle couperait les boutons.
 */
const H_BORD = 1
const H_PADDING = 12
const H_TETE = 34
const H_FAITS_MARGE = 9
const H_FAITS_PADDING = 7
const H_LIGNE = 18
const H_SUITES_MARGE = 10
const H_BOUTON = 30

function lignesDuCorps(contenu: ContenuNotification): string[] {
  return contenu.body
    .split(/\r?\n/u)
    .filter((ligne) => ligne.trim().length > 0)
    .slice(0, MAX_LIGNES)
}

function suitesAffichees(contenu: ContenuNotification): string[] {
  return contenu.issue === 'echec' ? [] : (contenu.suites ?? []).slice(0, 2)
}

export function hauteurDePopup(contenu: ContenuNotification): number {
  const lignes = Math.max(1, lignesDuCorps(contenu).length)
  const suites = suitesAffichees(contenu).length > 0 ? H_SUITES_MARGE + H_BOUTON : 0
  return (
    2 * H_BORD +
    2 * H_PADDING +
    H_TETE +
    H_FAITS_MARGE +
    2 * H_FAITS_PADDING +
    lignes * H_LIGNE +
    suites
  )
}

/** Le titre du fil et les suites viennent de l'utilisateur ou du modèle : jamais du HTML brut. */
function echapper(texte: string): string {
  return texte
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

/**
 * LES COULEURS DU THÈME CHOISI (conv-1090, 2026-10-22) — « fais suivre à la carte de fin de tour le
 * thème choisi dans Réglages · Interface (aujourd'hui figée sur les couleurs d'Holographique) ».
 *
 * La carte vit dans SA fenêtre, hors des feuilles de style de l'app : elle ne voit aucun thème.
 * La page de l'app lui envoie donc les jetons CALCULÉS du thème appliqué (`theme-mode.ts`, même
 * chemin que la couleur des boutons de fenêtre) : un thème ajouté demain n'a rien à déclarer ici.
 * Chaque champ = un jeton de `theme.css`, que tous les thèmes définissent.
 */
export type PaletteCarte = {
  /** `--bg-0` : le fond opaque de la page. */
  fond: string
  /** `--text` */
  texte: string
  /** `--text-dim` */
  texteDoux: string
  /** `--accent` : fin du dégradé de la pastille et du bouton principal. */
  accent: string
  /** `--violet` : début de ces dégradés et du cadre (le bleu d'Holographique). */
  accent2: string
  /** `--gold` : le reflet du cadre (le rose clair d'Holographique). */
  accent3: string
  /** `--on-accent` : le texte sur l'accent, tel que le thème le déclare. */
  surAccent: string
  /** `--err` */
  erreur: string
}

const CLES_DE_PALETTE = [
  'fond',
  'texte',
  'texteDoux',
  'accent',
  'accent2',
  'accent3',
  'surAccent',
  'erreur'
] as const

/**
 * Holographique (`theme-nebuleuse-verre.css`, jetons de base), le thème par défaut : c'est la carte
 * validée par le contrôle de conv-1066, et ce qu'affiche une carte avant que la page ait parlé.
 */
export const PALETTE_HOLOGRAPHIQUE: PaletteCarte = {
  fond: '#0a0a0a',
  texte: '#ece8f7',
  texteDoux: '#b9b2d4',
  accent: '#e63ca0',
  accent2: '#3c6eeb',
  accent3: '#ff8cc8',
  surAccent: '#ffffff',
  erreur: '#e8302a'
}

/**
 * Ce qui arrive de la page devient une palette, ou rien. Huit `#rrggbb` ou refus EN BLOC : ces
 * valeurs finissent dans du CSS, et une palette à moitié reçue mêlerait deux thèmes.
 */
export function paletteDeCarte(brut: unknown): PaletteCarte | null {
  if (typeof brut !== 'object' || brut === null) return null
  const source = brut as Record<string, unknown>
  const palette: Partial<Record<keyof PaletteCarte, string>> = {}
  for (const cle of CLES_DE_PALETTE) {
    const valeur = source[cle]
    if (typeof valeur !== 'string' || !/^#[0-9a-fA-F]{6}$/u.test(valeur)) return null
    palette[cle] = valeur.toLowerCase()
  }
  return palette as PaletteCarte
}

const canaux = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** `part` de `a` mêlée à `b` : 0,13 = 13 % de `a` sur 87 % de `b`. */
function meler(a: string, b: string, part: number): string {
  const [ca, cb] = [canaux(a), canaux(b)]
  const melange = ca.map((v, i) =>
    Math.round(cb[i] + (v - cb[i]) * part)
      .toString(16)
      .padStart(2, '0')
  )
  return `#${melange.join('')}`
}

const voile = (hex: string, alpha: number): string => `rgba(${canaux(hex).join(',')},${alpha})`

/** Luminance relative WCAG 2 (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
function luminance(hex: string): number {
  const [r, v, b] = canaux(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * v + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Les couleurs que la page de la carte écrit, tirées de la palette du thème. */
export type CouleursDeCarte = {
  carteHaut: string
  carteBas: string
  texte: string
  sous: string
  faits: string
  faitsFond: string
  faitsSurvol: string
  fermer: string
  fermerSurvol: string
  echec: string
  cadre: string
  degrade: string
  /** Là où se pose le libellé du bouton principal : sa lisibilité se mesure ici. */
  milieuDuDegrade: string
  surAccent: string
  secondFond: string
  secondLisere: string
}

/*
 * Proportions calées sur la maquette « Verre nacré » de conv-1066 (carte #262628 → #1c1c1e,
 * sous-titre #a49fb6, faits #cfcadd, bouton second #2f2f33, reflet du cadre #d9d9d9) : avec les
 * jetons d'Holographique, la carte dérivée retombe à quelques unités près sur la carte validée.
 */
export function couleursDeCarte(p: PaletteCarte): CouleursDeCarte {
  const faits = meler(p.texte, p.texteDoux, 0.5)
  const milieuDuDegrade = meler(p.accent2, p.accent, 0.5)
  /*
   * Le texte déclaré par `--on-accent` n'est pas toujours lisible : Machine à écrire n'en déclare
   * pas et hérite du blanc de `theme.css`, sur un vert phosphore (contraste 1,4). Sous 3:1 au
   * milieu du dégradé, on prend le noir ou le blanc, celui qui s'y lit le mieux.
   */
  const surAccent =
    contraste(p.surAccent, milieuDuDegrade) >= 3
      ? p.surAccent
      : contraste('#000000', milieuDuDegrade) >= contraste('#ffffff', milieuDuDegrade)
        ? '#000000'
        : '#ffffff'
  return {
    carteHaut: meler(p.texte, p.fond, 0.13),
    carteBas: meler(p.texte, p.fond, 0.08),
    texte: p.texte,
    sous: meler(p.texteDoux, p.fond, 0.85),
    faits,
    faitsFond: voile(p.texte, 0.05),
    faitsSurvol: voile(p.texte, 0.08),
    fermer: meler(p.texteDoux, p.fond, 0.7),
    fermerSurvol: voile(p.texte, 0.08),
    echec: meler(p.erreur, p.texte, 0.6),
    cadre: `linear-gradient(100deg,${p.accent2} 0%,${p.accent} 30%,${faits} 55%,${p.accent3} 78%,${p.accent2} 100%)`,
    degrade: `linear-gradient(135deg,${p.accent2},${p.accent})`,
    milieuDuDegrade,
    surAccent,
    secondFond: meler(p.texte, p.fond, 0.17),
    secondLisere: voile(p.texte, 0.1)
  }
}

/*
 * Valeurs reprises de la maquette (`.n3*` du générateur /draft, conv-1066), en pixels fixes là où la
 * hauteur doit se calculer. Le fondu-montée remplace la boucle de démonstration de la maquette ;
 * il s'efface quand Windows demande moins d'animations. Les couleurs viennent du thème (conv-1090).
 */
function cssDePopup(c: CouleursDeCarte): string {
  return `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:transparent;font:13px/1.45 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-user-select:none;user-select:none;cursor:default}
a{color:inherit;text-decoration:none;-webkit-user-drag:none;cursor:pointer}
.cadre{height:100%;padding:${H_BORD}px;border-radius:15px;background-image:${c.cadre};animation:entree .32s cubic-bezier(.2,.8,.2,1) both}
@keyframes entree{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.cadre{animation:none}}
.carte{height:100%;border-radius:14px;padding:${H_PADDING}px;background-image:linear-gradient(180deg,${c.carteHaut},${c.carteBas});color:${c.texte}}
.tete{display:flex;align-items:center;gap:6px;height:${H_TETE}px}
.ouvrir-tete{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:10px;height:100%}
.icone{flex:none;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;line-height:30px;background-image:${c.degrade};color:${c.surAccent}}
.textes{flex:1 1 auto;min-width:0}
.ligne{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.titre{font-weight:600;font-size:13.5px;line-height:18px}
.sous{font-size:11.5px;line-height:16px;color:${c.sous}}
.echec .sous{color:${c.echec}}
.fermer{align-self:flex-start;flex:none;width:22px;height:22px;margin:-4px -4px 0 0;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:16px;line-height:1;color:${c.fermer}}
.fermer:hover{background:${c.fermerSurvol};color:${c.texte}}
.faits{display:block;margin-top:${H_FAITS_MARGE}px;padding:${H_FAITS_PADDING}px 10px;border-radius:9px;font-size:12.5px;line-height:${H_LIGNE}px;background:${c.faitsFond};color:${c.faits}}
.faits:hover{background:${c.faitsSurvol}}
.suites{display:flex;gap:8px;margin-top:${H_SUITES_MARGE}px}
.bouton{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;height:${H_BOUTON}px;padding:0 10px;border-radius:8px;font-size:12px;font-weight:600}
.bouton .ligne{line-height:${H_BOUTON}px}
.principal{background-image:linear-gradient(180deg,rgba(255,255,255,.4),rgba(255,255,255,0) 60%),${c.degrade};color:${c.surAccent}}
.second{background:${c.secondFond};box-shadow:inset 0 0 0 1px ${c.secondLisere}}
.bouton:hover{filter:brightness(1.12)}
`
}

/**
 * La page de la carte. Aucun script : la fenêtre l'interdit (`javascript: false`) et la page aussi
 * (politique de contenu). Les clics sont des liens vers un fragment (`#ouvrir`, `#fermer`,
 * `#suite-N`) que la fenêtre lit sans exécuter quoi que ce soit dans la page.
 */
export function htmlDePopup(
  contenu: ContenuNotification,
  heure: string,
  palette: PaletteCarte = PALETTE_HOLOGRAPHIQUE
): string {
  const echec = contenu.issue === 'echec'
  const etat = echec ? 'Le tour a échoué' : 'Réponse prête'
  const lignes = lignesDuCorps(contenu)
  const faits = (lignes.length > 0 ? lignes : [' '])
    .map((ligne) => `<span class="ligne" title="${echapper(ligne)}">${echapper(ligne)}</span>`)
    .join('')
  const suites = suitesAffichees(contenu)
  const boutons =
    suites.length === 0
      ? ''
      : `<div class="suites">${suites
          .map(
            (suite, index) =>
              `<a class="bouton ${index === 0 ? 'principal' : 'second'}" href="#suite-${index}" title="${echapper(suite)}"><span class="ligne">${echapper(libelleDeBouton(suite))}</span></a>`
          )
          .join('')}</div>`
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Autowin — ${echapper(etat)}</title><style>${cssDePopup(couleursDeCarte(palette))}</style></head>
<body><div class="cadre"><div class="carte${echec ? ' echec' : ''}">
<div class="tete"><a class="ouvrir-tete" href="#ouvrir" title="Ouvrir le fil"><span class="icone">A</span><span class="textes"><span class="ligne titre">${echapper(contenu.fil)}</span><span class="ligne sous">${echapper(etat)} · ${echapper(heure)}</span></span></a><a class="fermer" href="#fermer" title="Fermer">×</a></div>
<a class="faits" href="#ouvrir">${faits}</a>
${boutons}
</div></div></body></html>`
}

/** Le fragment de l'adresse après un clic → l'action demandée ; tout autre fragment = rien. */
export function actionDuFragment(url: string): ActionPopup | null {
  const diese = url.lastIndexOf('#')
  if (diese < 0) return null
  const fragment = url.slice(diese + 1)
  if (fragment === 'ouvrir') return { type: 'ouvrir' }
  if (fragment === 'fermer') return { type: 'fermer' }
  const suite = /^suite-(\d)$/u.exec(fragment)
  return suite ? { type: 'suite', index: Number(suite[1]) } : null
}

/**
 * La zone où empiler les cartes. Par défaut, collées au bord DROIT et empilées du BAS vers le haut,
 * comme Windows 11. Les deux options suivent la mascotte du bureau là où l'utilisateur l'a glissée
 * (conv-1142, 2026-10-26, demande : « fais sortir les cartes de fin de tour à côté de la mascotte là
 * où je l'ai déplacée ») :
 * - `bord: 'gauche'` : collées au bord gauche de la zone (cartes à droite de la bille) ;
 * - `sens: 'bas'` : la plus récente en HAUT de la zone, les plus anciennes descendent (bille posée
 *   en haut de l'écran : une pile qui monterait sortirait de l'écran).
 */
export type ZoneDesCartes = Rect & { bord?: 'droite' | 'gauche'; sens?: 'haut' | 'bas' }

/** Distance entre une carte et le bord de sa zone, exportée pour qui découpe la zone (la mascotte). */
export const MARGE_CARTE = MARGE

/**
 * Place les cartes en bas à droite de la zone de travail (écran sans la barre des tâches). Rang 0 =
 * la plus RÉCENTE, collée au coin ; les plus anciennes montent au-dessus (comme Windows 11). Avec
 * `sens: 'bas'`, le rang 0 est collé en haut et les plus anciennes descendent.
 */
export function disposerPopups(zone: ZoneDesCartes, hauteursDuBasVersLeHaut: number[]): Rect[] {
  const x = zone.bord === 'gauche' ? zone.x + MARGE : zone.x + zone.width - MARGE - LARGEUR_POPUP
  if (zone.sens === 'bas') {
    let haut = zone.y + MARGE
    return hauteursDuBasVersLeHaut.map((height) => {
      const rect = { x, y: haut, width: LARGEUR_POPUP, height }
      haut = rect.y + height + ECART
      return rect
    })
  }
  let bas = zone.y + zone.height - MARGE
  return hauteursDuBasVersLeHaut.map((height) => {
    const rect = { x, y: bas - height, width: LARGEUR_POPUP, height }
    bas = rect.y - ECART
    return rect
  })
}

/** Le strict nécessaire d'une fenêtre de carte : la vraie est dans `notification-popup-fenetre.ts`. */
export type FenetrePopup = {
  placer(rect: Rect): void
  afficher(): void
  fermer(): void
}

export type DependancesPile = {
  /** Zone de travail de l'écran principal, relue à chaque placement (écran changé entre-temps). */
  zone: () => ZoneDesCartes
  heure: () => string
  /** Le thème choisi dans Réglages · Interface, relu à chaque carte (conv-1090). */
  palette?: () => PaletteCarte
  /**
   * La bulle Windows, quand la page d'une carte DÉJÀ rendue au notifieur ne se charge pas : à ce
   * moment, le secours de `index.ts` (sur un `fabriquer` qui jette) ne peut plus jouer (conv-1066).
   */
  secours: (contenu: ContenuNotification) => NotificationAffichable
  ouvrirFenetre: (args: {
    html: string
    rect: Rect
    surAction: (action: ActionPopup) => void
    /** La fenêtre est partie (croix, fermeture système) : la pile la retire et resserre. */
    surFermee: () => void
    /** La page de la carte n'a pas pu se charger (`loadFile` rejeté, donc APRÈS `fabriquer`). */
    surEchec: (erreur: unknown) => void
  }) => FenetrePopup
}

/**
 * La pile des cartes : chaque carte tient le contrat `NotificationAffichable` du notifieur (show,
 * close, click, action), donc la logique de fin de tour (quand sonner, remplacement par fil,
 * envoi d'une suite) ne change pas.
 */
export function creerPileDePopups(deps: DependancesPile): {
  fabriquer: (contenu: ContenuNotification) => NotificationAffichable
  toutFermer: () => void
} {
  type Carte = { hauteur: number; fermer: () => void; fenetre?: FenetrePopup }
  /** Ordre d'arrivée : la dernière est la plus récente, donc la plus basse. */
  const pile: Carte[] = []

  const replacer = (): void => {
    const rects = disposerPopups(
      deps.zone(),
      [...pile].reverse().map((carte) => carte.hauteur)
    )
    ;[...pile].reverse().forEach((carte, rang) => carte.fenetre?.placer(rects[rang]))
  }

  /** Ce qui dépasse (nombre ou hauteur de la zone) part, en commençant par la plus ancienne. */
  const elaguer = (): void => {
    const zone = deps.zone()
    const deborde = (): boolean => {
      const rects = disposerPopups(
        zone,
        [...pile].reverse().map((carte) => carte.hauteur)
      )
      // La plus ancienne est la plus LOIN du point de départ : en haut, ou en bas si la pile descend.
      const loin = rects.at(-1)
      if (loin === undefined) return false
      return zone.sens === 'bas' ? loin.y + loin.height > zone.y + zone.height : loin.y < zone.y
    }
    while (pile.length > 1 && (pile.length > MAX_POPUPS || deborde())) pile[0].fermer()
  }

  // fix-ok: conv-1066 — les éditions de ce fichier suivent chacune une cause mesurée : (1) création
  // du module ; (2) fenêtre créée à `show()` → le secours de `index.ts` ne jouait jamais (test « une
  // fenêtre impossible à créer fait jeter `fabriquer` » rouge si on la remet à `show()`) ; (3-4)
  // `loadFile` rejeté non rattrapé, vrai ERR_FAILED provoqué dans le bureau caché par
  // `protocol.handle('file', () => Response.error())` → `secours` + `passerALaBulle` (« après show() »
  // rouge sans `surEchec: passerALaBulle`, « une carte déjà fermée » rouge sans `if (fermee) return`).
  const fabriquer = (contenu: ContenuNotification): NotificationAffichable => {
    const surClic: Array<() => void> = []
    const surAction: Array<(details: { actionIndex?: number }) => void> = []
    let fermee = false
    const carte: Carte = {
      hauteur: hauteurDePopup(contenu),
      fermer: () => {
        if (fermee) return
        fermee = true
        const rang = pile.indexOf(carte)
        if (rang >= 0) pile.splice(rang, 1)
        carte.fenetre?.fermer()
        replacer()
      }
    }
    const reagir = (action: ActionPopup): void => {
      if (fermee) return
      if (action.type === 'ouvrir') surClic.forEach((ecouteur) => ecouteur())
      if (action.type === 'suite')
        surAction.forEach((ecouteur) => ecouteur({ actionIndex: action.index }))
      carte.fermer()
    }
    let montree = false
    /** La bulle Windows qui a pris la place d'une carte dont la page ne s'est pas chargée. */
    let bulle: NotificationAffichable | undefined
    // Page non chargée : la carte part, la bulle la remplace avec les MÊMES écouteurs (le notifieur
    // les a déjà posés sur la carte). Une carte déjà fermée n'en ouvre aucune : la fermer pendant
    // son chargement fait aussi rejeter `loadFile` (ERR_ABORTED), ce n'est pas un échec.
    const passerALaBulle = (): void => {
      if (fermee) return
      carte.fermer()
      try {
        bulle = deps.secours(contenu)
      } catch {
        // Ni carte ni bulle possible : même filet que le notifieur, la réponse est dans le fil.
        return
      }
      bulle.on('click', () => surClic.forEach((ecouteur) => ecouteur()))
      bulle.on('action', (details) => surAction.forEach((ecouteur) => ecouteur(details)))
      if (montree) bulle.show()
    }
    // La fenêtre se crée ICI, pas à `show()` : une création impossible fait jeter `fabriquer`, et
    // `index.ts` passe alors à la bulle Windows. À `show()`, l'erreur tomberait dans le filet du
    // notifieur, qui l'avale : ni carte ni bulle (défaut trouvé en relecture, conv-1066).
    carte.fenetre = deps.ouvrirFenetre({
      html: htmlDePopup(contenu, deps.heure(), deps.palette?.()),
      rect: disposerPopups(deps.zone(), [carte.hauteur])[0],
      surAction: reagir,
      surFermee: () => carte.fermer(),
      surEchec: passerALaBulle
    })
    return {
      show: () => {
        if (montree) return
        if (bulle) {
          montree = true
          bulle.show()
          return
        }
        if (fermee) return
        montree = true
        pile.push(carte)
        elaguer()
        replacer()
        carte.fenetre?.afficher()
      },
      close: () => (bulle ? bulle.close() : carte.fermer()),
      on: ((
        evenement: 'click' | 'action',
        ecouteur: (details: { actionIndex?: number }) => void
      ) => {
        if (evenement === 'click') surClic.push(ecouteur as () => void)
        else surAction.push(ecouteur)
      }) as NotificationAffichable['on']
    }
  }

  return {
    fabriquer,
    toutFermer: () => [...pile].forEach((carte) => carte.fermer())
  }
}
