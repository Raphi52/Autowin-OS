/*
 * PAGE INTERACTIVE DU FIL (bloc ```html-interactif, conv-1292, 2026-10-29) — ce que le fil envoie
 * au cadre isole avec le HTML : la feuille de base et le theme courant.
 *
 * Le cadre a une origine opaque : ni les feuilles de l'app ni ses variables CSS ne le traversent.
 * Sans cette feuille, une page interactive serait du texte noir sur blanc au milieu d'un fil sombre,
 * et les classes `aw-*` que le modele connait (src/shared/classes-pages-html.ts) ne peindraient
 * rien. Les regles reprennent celles de `.md-html` (ChatView.css) ; `page-interactive.test.ts`
 * verifie que chaque classe de la liste y est definie.
 *
 * Sorti du composant : un fichier qui exporte un composant ET des valeurs casse le rechargement a
 * chaud de React (regle react-refresh/only-export-components).
 */

import {
  NOM_PAGE_INTERACTIVE,
  NOM_PAGE_SCENE_3D,
  TYPE_MESSAGE_SCENE_3D
} from '../../../shared/scene-3d'
import {
  ecrireStockageDurable,
  lireStockageDurableBorne,
  stockageDurableDisponible
} from './page-stockage-durable'

/**
 * La page nomme-t-elle le moteur 3D ? Meme regle que l'amorce (`lancerPage`, amorce.js), qui
 * n'evalue three.js que dans ce cas.
 */
export function pageUtiliseLeMoteur3d(html: string): boolean {
  return /\b(?:THREE|OrbitControls)\b/u.test(html)
}

/**
 * La page isolee qui recoit ce HTML (conv-1304, 2026-10-30). Une page sans 3D part dans
 * `page-interactive.html`, qui ne porte PAS le moteur three.js : chaque cadre telechargeait sinon
 * ~750 Ko de moteur pour rien. Une page qui le nomme part dans `scene-3d.html`, comme une scene.
 */
export function pageIsoleePour(html: string): string {
  return pageUtiliseLeMoteur3d(html) ? NOM_PAGE_SCENE_3D : NOM_PAGE_INTERACTIVE
}

/**
 * Le bac a sable du cadre. `allow-forms` (conv-1304, 2026-10-30) : sans lui, Chromium n'emet meme
 * pas l'evenement `submit` — un `<form onsubmit="...">` de calculateur ne reagissait a rien (banc
 * `.autowin-tmp/conv-1304/banc-motifs.html` : « Blocked form submission »). L'envoi lui-meme reste
 * impossible : la politique de la page porte `form-action 'none'`, et le filtre de navigation de la
 * fenetre refuse toute navigation ulterieure du cadre. Toujours sans `allow-same-origin`,
 * `allow-popups` ni `allow-modals`. L'apercu (scripts/html-interactif-apercu) lit cette constante.
 */
export const SANDBOX_PAGE_INTERACTIVE = 'allow-scripts allow-forms'

/** Hauteur du cadre avant la premiere mesure : petite, pour qu'une page courte ne laisse pas de vide. */
export const HAUTEUR_INITIALE_PAGE = 48

/** Bornes de ce que la page peut demander au fil (memes valeurs que l'amorce). */
export const MAX_TEXTE_COPIE = 1_000_000
export const MAX_STOCKAGE_PAGE = 2_000_000
/**
 * Longueur maximale d'un message qu'une page pose dans la saisie (bouton de choix, conv-1304). Plus
 * large que le libelle d'un bouton du ```html-render (LONGUEUR_MAX_PROMPT, 300) : la page peut
 * composer un message a partir de ses reglages, et l'utilisateur le relit avant de l'envoyer.
 */
export const MAX_TEXTE_SAISIE = 4000
/** Le moteur three.js fait ~750 Ko : la borne laisse de la marge, pas un mur a chaque mise a jour. */
const MAX_RESSOURCE = 4_000_000
const MAX_MESSAGE = 2000

/**
 * Signe de vie (conv-1304, 2026-10-30) : le fil interroge la page qu'il montre. Une page en boucle
 * infinie ne repond plus, et rien ne le disait : elle restait figee, sans message. Le seuil laisse
 * passer un calcul de quelques secondes ; un retour de reponse efface l'avis.
 */
export const PERIODE_SIGNE_DE_VIE_MS = 2000
export const SEUIL_PAGE_FIGEE_MS = 6000
/** La page a ce delai pour rendre de quoi l'enregistrer. */
export const DELAI_RESSOURCES_MS = 4000

/**
 * Un message de la page, LU et borne (conv-1304). La page est du code du modele : tout ce qu'elle
 * envoie est une donnee a valider, jamais un ordre. Le fil (BlocHtmlInteractif.tsx) et l'apercu
 * lisent les messages par cette seule fonction.
 */
export type MessagePage =
  | { etat: 'pret' }
  | { etat: 'lancee' }
  | { etat: 'hauteur'; hauteur: number }
  | { etat: 'erreur' | 'alerte' | 'avertissement'; message: string }
  | { etat: 'stockage'; donnees: Record<string, string> }
  | { etat: 'lien'; href: string }
  | { etat: 'defiler'; y: number }
  | { etat: 'copier'; texte: string; demande: number }
  | { etat: 'prompt'; texte: string }
  | { etat: 'pong' }
  | { etat: 'touchee' }
  | { etat: 'echap' }
  | { etat: 'ressources'; demande: number; moteur: string; graphiques: string }

const texteBorne = (valeur: unknown): string =>
  (valeur === undefined || valeur === null ? '' : String(valeur)).slice(0, MAX_MESSAGE)

export function lireMessagePage(donnees: unknown): MessagePage | null {
  if (!donnees || typeof donnees !== 'object') return null
  const d = donnees as Record<string, unknown>
  if (d.type !== TYPE_MESSAGE_SCENE_3D) return null
  switch (d.etat) {
    case 'pret':
    case 'lancee':
    case 'pong':
    case 'touchee':
    case 'echap':
      return { etat: d.etat }
    case 'ressources':
      return Number.isInteger(d.demande) &&
        typeof d.moteur === 'string' &&
        typeof d.graphiques === 'string' &&
        d.moteur.length + d.graphiques.length <= MAX_RESSOURCE
        ? {
            etat: 'ressources',
            demande: d.demande as number,
            moteur: d.moteur,
            graphiques: d.graphiques
          }
        : null
    case 'hauteur': {
      const hauteur = borneHauteurPage(d.hauteur)
      return hauteur === null ? null : { etat: 'hauteur', hauteur }
    }
    case 'erreur':
    case 'alerte':
    case 'avertissement':
      return { etat: d.etat, message: texteBorne(d.message) }
    case 'stockage': {
      if (!d.donnees || typeof d.donnees !== 'object') return null
      const lu: Record<string, string> = {}
      let taille = 0
      for (const [cle, valeur] of Object.entries(d.donnees as Record<string, unknown>)) {
        if (typeof valeur !== 'string') continue
        taille += cle.length + valeur.length
        if (taille > MAX_STOCKAGE_PAGE) return null
        lu[cle] = valeur
      }
      return { etat: 'stockage', donnees: lu }
    }
    case 'lien': {
      const href = lienOuvrable(d.href)
      return href === null ? null : { etat: 'lien', href }
    }
    case 'defiler':
      return typeof d.y === 'number' && Number.isFinite(d.y) && d.y >= 0
        ? { etat: 'defiler', y: Math.min(d.y, HAUTEUR_MAX_PAGE) }
        : null
    case 'copier':
      return typeof d.texte === 'string' &&
        d.texte.length <= MAX_TEXTE_COPIE &&
        Number.isInteger(d.demande) &&
        (d.demande as number) > 0
        ? { etat: 'copier', texte: d.texte, demande: d.demande as number }
        : null
    case 'prompt': {
      if (typeof d.texte !== 'string') return null
      const texte = d.texte.replace(/\s+/gu, ' ').trim()
      return texte && texte.length <= MAX_TEXTE_SAISIE ? { etat: 'prompt', texte } : null
    }
    default:
      return null
  }
}

/** Seuls http et https s'ouvrent, comme les liens du fil (setWindowOpenHandler de window.ts). */
export function lienOuvrable(href: unknown): string | null {
  if (typeof href !== 'string' || href.length > 4000) return null
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** La reponse du fil a une `demande` de la page (copie). */
export function reponseALaPage(
  demande: number,
  ok: boolean,
  message?: string
): { type: string; reponse: number; ok: boolean; message?: string } {
  return { type: TYPE_MESSAGE_SCENE_3D, reponse: demande, ok, ...(message ? { message } : {}) }
}

/**
 * Le localStorage des pages (conv-1304) : changer de fil demonte la page, y revenir la relance —
 * sans cette memoire, une liste de taches ou un score tenus par la page repartaient de zero.
 * Cle = empreinte du HTML : la meme page retrouve ses donnees, une autre ne les voit pas. Cette
 * Map est la copie de session, bornee aux 60 pages les plus recentes ; le disque garde le reste
 * (page-stockage-durable.ts).
 */
const STOCKAGES = new Map<string, Record<string, string>>()
const MAX_PAGES_STOCKEES = 60

export function empreintePage(html: string): string {
  // cyrb53 : rapide, 53 bits, sans dependance ; une collision ne ferait que partager un stockage.
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < html.length; i += 1) {
    const c = html.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function stockageDeLaPage(cle: string): Record<string, string> | undefined {
  return STOCKAGES.get(cle)
}

/**
 * Le stockage de la page, y compris celui d'une session passee (page-stockage-durable.ts). Le
 * rappel part sans attendre quand rien ne peut venir du disque : le fil envoie alors la page tout
 * de suite.
 */
export function chargerStockageDeLaPage(
  cle: string,
  rappel: (stockage: Record<string, string> | undefined) => void
): void {
  const enMemoire = STOCKAGES.get(cle)
  if (enMemoire || !stockageDurableDisponible()) {
    rappel(enMemoire)
    return
  }
  void lireStockageDurableBorne(cle).then((lu) => {
    if (lu) STOCKAGES.set(cle, lu)
    rappel(lu)
  })
}

export function retenirStockageDeLaPage(cle: string, donnees: Record<string, string>): void {
  void ecrireStockageDurable(cle, donnees)
  STOCKAGES.delete(cle)
  STOCKAGES.set(cle, donnees)
  while (STOCKAGES.size > MAX_PAGES_STOCKEES) {
    const plusAncienne = STOCKAGES.keys().next().value
    if (plusAncienne === undefined) break
    STOCKAGES.delete(plusAncienne)
  }
}

/**
 * Ancre de la page (`<a href="#x">`) : le cadre prend la hauteur de son contenu et ne defile
 * jamais, c'est le conteneur du FIL qui doit amener le point `y` du cadre a l'ecran.
 */
export function defilerLeFilVers(cadre: HTMLElement, y: number): void {
  let conteneur = cadre.parentElement
  while (conteneur) {
    const style = getComputedStyle(conteneur)
    if (/(auto|scroll)/u.test(style.overflowY) && conteneur.scrollHeight > conteneur.clientHeight)
      break
    conteneur = conteneur.parentElement
  }
  const cible = cadre.getBoundingClientRect().top + y
  const haut = conteneur ? conteneur.getBoundingClientRect().top : 0
  ;(conteneur ?? window).scrollBy({ top: cible - haut - 24, behavior: 'smooth' })
}

/** Le clic vient-il d'un vrai geste de l'utilisateur ? Le clic dans le cadre active aussi le fil. */
export function gesteRecentDeLUtilisateur(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation
  return activation?.isActive === true
}

/** Le titre d'une page : ce qui la nomme pour l'utilisateur, dans un message ou un nom de fichier. */
export function titreDePage(html: string): string {
  const sansCode = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/giu, '')
  const motif =
    /<title[^>]*>([\s\S]*?)<\/title>|<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>|<[a-z0-9]+[^>]*\bclass="[^"]*\baw-kicker\b[^"]*"[^>]*>([\s\S]*?)<\//iu
  const trouve = motif.exec(sansCode)
  const brut = trouve ? (trouve[1] ?? trouve[2] ?? trouve[3] ?? '') : ''
  return brut
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&[a-z0-9#]+;/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
}

/** Nom propose a l'enregistrement : le titre, sans ce que Windows refuse dans un nom de fichier. */
export function nomFichierDePage(html: string): string {
  const titre = titreDePage(html)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
  return `${titre || 'page-interactive'}.html`
}

/** La ligne de code qu'une erreur « (ligne N du bloc) » designe, ou null. */
export function extraitDeLErreur(
  html: string,
  message: string
): { ligne: number; code: string } | null {
  const trouve = /ligne (\d+) du bloc/u.exec(message)
  if (!trouve) return null
  const ligne = Number(trouve[1])
  const code = html.split('\n')[ligne - 1]?.trim().slice(0, 160)
  return code ? { ligne, code } : null
}

/** Ligne affichee sous la page : erreur, alerte ou avertissement, avec son compte de repetitions. */
export interface AvisPage {
  ton: 'erreur' | 'alerte' | 'avertissement'
  message: string
  fois: number
}

/** Au plus 4 avis distincts sous la page ; un avis repete augmente son compte au lieu de s'empiler. */
export function ajouterAvis(avis: AvisPage[], nouveau: Omit<AvisPage, 'fois'>): AvisPage[] {
  const deja = avis.findIndex((a) => a.ton === nouveau.ton && a.message === nouveau.message)
  if (deja >= 0) {
    return avis.map((a, rang) => (rang === deja ? { ...a, fois: a.fois + 1 } : a))
  }
  return [...avis, { ...nouveau, fois: 1 }].slice(-4)
}

/** Au-dela, le cadre ne grandit plus : une page qui se mesure en boucle ne peut pas remplir le fil. */
export const HAUTEUR_MAX_PAGE = 4000

export function borneHauteurPage(hauteur: unknown): number | null {
  if (typeof hauteur !== 'number' || !Number.isFinite(hauteur) || hauteur < 0) return null
  return Math.min(HAUTEUR_MAX_PAGE, Math.ceil(hauteur))
}

/**
 * Les jetons du theme lus sur le bloc du fil : ceux de la feuille de base, puis (conv-1304) ceux de
 * l'habit holographique du carrousel /draft (scripts/draft-carrousel.mjs), devenu une page
 * interactive pour un sujet en volume. Sans eux, il retombait sur ses valeurs sombres de repli :
 * fiches noires sous un theme clair.
 */
export const VARIABLES_DU_THEME = [
  '--text',
  '--text-dim',
  '--gold-doux',
  '--gold-clair',
  '--ok',
  '--err',
  '--warn',
  '--mono',
  '--line',
  '--text-faint',
  '--bg-0',
  '--rose',
  '--violet',
  '--nv-degrade',
  '--font'
] as const

export interface ThemePage {
  variables: Record<string, string>
  colorScheme: string
}

/**
 * Le theme tel que le bloc le voit, a l'instant. `--page-*` porte ce que le texte du fil herite
 * sans variable (couleur, police, taille) : la page s'ecrit dans la meme voix que la bulle.
 */
export function lireThemePourPage(element: Element): ThemePage {
  const style = getComputedStyle(element)
  const variables: Record<string, string> = {}
  for (const nom of VARIABLES_DU_THEME) {
    const valeur = style.getPropertyValue(nom).trim()
    if (valeur) variables[nom] = valeur
  }
  if (style.color) variables['--page-texte'] = style.color
  if (style.fontFamily) variables['--page-police'] = style.fontFamily
  if (style.fontSize) variables['--page-taille'] = style.fontSize
  // Un cadre dont le `color-scheme` differe de celui de son hote recoit un fond OPAQUE de Chromium :
  // il doit suivre celui du fil pour rester transparent.
  const colorScheme = getComputedStyle(document.documentElement).colorScheme || 'normal'
  return { variables, colorScheme }
}

/*
 * Les regles de base sont en `:where(...)` ou a une seule classe : une regle ecrite par le modele
 * dans sa page l'emporte. Elles doivent pourtant battre le style des scenes 3D, pose avant elles
 * (`html,body{height:100%;overflow:hidden;background:#05070c}`) : `body` y suffit (meme poids,
 * posee apres), mais la RACINE demande un selecteur plus lourd que `html`. Mesure du banc du
 * 2026-10-29 : en `:where(html...)`, la page restait sur le fond opaque des scenes, et figee a la
 * hauteur du cadre.
 */
export const STYLE_PAGE_INTERACTIVE = [
  // `--page-*` : valeurs de depart, remplacees par celles du fil des qu'il pose son theme (a la main
  // sur la racine, elles passent devant). conv-1304, css-variables-definies.test.ts : une variable
  // sans definition dans les sources est invisible pour le controle des themes.
  'html[data-mode=page]{--page-texte:CanvasText;--page-police:system-ui,sans-serif;--page-taille:14px;height:auto;min-height:0;overflow:visible;background:transparent}',
  ':where(html[data-mode=page]) body{height:auto;min-height:0;overflow:visible;background:transparent;display:flow-root;margin:0;color:var(--page-texte);font-family:var(--page-police);font-size:var(--page-taille);line-height:1.5;overflow-wrap:anywhere}',
  // La page signale ses erreurs au fil, qui les affiche sous le cadre : pas de bandeau dedans.
  'html[data-mode=page] #autowin-scene-3d-erreur{display:none}',
  ':where(html[data-mode=page]) body>:first-child{margin-top:0}',
  ':where(html[data-mode=page]) body>:last-child{margin-bottom:0}',
  ':where(img,video,canvas,svg){max-width:100%}',
  ':where(img,video){height:auto}',
  ':where(table){border-collapse:collapse;max-width:100%}',
  ':where(th,td){padding:6px 10px;border:1px solid var(--line)}',
  ':where(pre){white-space:pre-wrap}',
  ':where(code,kbd,pre,samp){font-family:var(--mono)}',
  ':where(a){color:var(--gold-clair)}',
  ':where(button,input,select,textarea){font:inherit;color:inherit}',
  '.aw-kicker{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-doux)}',
  '.aw-chiffre{font-weight:700;font-variant-numeric:tabular-nums;color:var(--gold-clair)}',
  '.aw-discret{color:var(--text-dim)}',
  '.aw-chip{font-family:var(--mono);font-size:.92em;padding:0 5px;border:1px solid color-mix(in srgb,var(--text) 14%,transparent);border-radius:4px;background-color:color-mix(in srgb,var(--text) 5%,transparent);overflow-wrap:anywhere}',
  '.aw-filet{height:1px;margin:10px 0;border:0;background-image:linear-gradient(90deg,color-mix(in srgb,var(--gold-doux) 55%,transparent),color-mix(in srgb,var(--gold-doux) 6%,transparent))}',
  '.aw-ok{color:var(--ok)}',
  '.aw-ko{color:var(--err)}',
  '.aw-attention{color:var(--warn)}',
  '.aw-grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px 14px}'
].join('\n')
