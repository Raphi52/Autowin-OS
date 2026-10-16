import { flushSync } from 'react-dom'

/**
 * LE PASSAGE ANIME D'UNE VUE A L'AUTRE (conv-981, 2026-10-15) : le surlignage du menu GLISSE vers
 * l'onglet choisi (`document.startViewTransition`, Chromium 111+, donc Electron). Chaque vue passait de
 * `display:none` a `flex` d'un coup (app-shell.css). La page se fondait aussi ; depuis le 16/10
 * (conv-987) ce sont ses blocs qui entrent en cascade (`entree-cascade.ts`).
 *
 * Le nom de transition (`view-transition-name`, app-shell.css) n'est pose que PENDANT la transition,
 * par cette classe sur <html> : la spec (css-view-transitions-1, « Rendering Consolidation ») fait en
 * PERMANENCE d'un element nomme un contexte d'empilement et une racine de flou d'arriere-plan — le
 * verre des themes ne flouterait plus le fond de l'application.
 *
 * fix-ok: conv-981 - aucun appel a startViewTransition dans src/renderer avant ce module (grep
 * vide). Fichier ecrit UNE seule fois dans run-52d36e67e4de-1 ; le controle des causes en comptait
 * 3 (meme ecriture sous son chemin complet et son chemin court, plus le releve de fin d'etape).
 */
export const CLASSE_TRANSITION_DE_VUE = 'vue-en-transition'

/**
 * LE CHANGEMENT DE THEME EN CERCLE (conv-981, 2026-10-16) : le nouveau theme s'ouvre en cercle
 * depuis la liste de Settings · Interface (app-shell.css). `appliquerThemeMode` posait `data-theme`
 * d'un coup. Sa PROPRE classe : sous `vue-en-transition`, le cercle toucherait aussi le passage
 * d'une vue a l'autre (`::view-transition-new(root)` vaut pour les deux).
 */
export const CLASSE_TRANSITION_DE_THEME = 'theme-en-transition'

type DocumentDeVue = {
  documentElement: {
    classList: { add(classe: string): unknown; remove(classe: string): unknown }
    style?: { setProperty(nom: string, valeur: string): unknown }
  }
  startViewTransition?: (rappel: () => void) => { finished: Promise<unknown> }
}

/**
 * Transitions en vol, PAR classe : chaque classe reste posee jusqu'a la fin de SA derniere
 * transition (clics rapides). Un compteur commun laisserait la classe du theme posee pendant un
 * passage de vue lance juste apres — et le cercle jouerait sur ce passage.
 */
const enVol = new Map<string, number>()

function transitionSousClasse(doc: DocumentDeVue, classe: string, appliquer: () => void): void {
  if (typeof doc.startViewTransition !== 'function') {
    appliquer()
    return
  }
  enVol.set(classe, (enVol.get(classe) ?? 0) + 1)
  doc.documentElement.classList.add(classe)
  const transition = doc.startViewTransition(() => flushSync(appliquer))
  // Une transition sautee (un clic plus recent) ou en echec rejette `finished` : le changement est
  // quand meme applique, seule l'animation manque. La classe, elle, ne doit jamais rester posee.
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      const reste = (enVol.get(classe) ?? 1) - 1
      if (reste > 0) {
        enVol.set(classe, reste)
        return
      }
      enVol.delete(classe)
      doc.documentElement.classList.remove(classe)
    })
}

/**
 * Applique la bascule de vue, animee quand c'est possible. Sans l'API (happy-dom, tests) ou vers
 * l'onglet deja actif : bascule directe, sans transition. `appliquer` s'execute dans `flushSync` : la
 * nouvelle vue doit etre dans le DOM quand le navigateur en prend l'image.
 */
export function basculerVue(doc: DocumentDeVue, memeVue: boolean, appliquer: () => void): void {
  if (memeVue) {
    appliquer()
    return
  }
  transitionSousClasse(doc, CLASSE_TRANSITION_DE_VUE, appliquer)
}

/** Point de depart du cercle, en pixels de la fenetre (le centre de la liste des themes). */
export type OrigineDuCercle = { x: number; y: number }

/**
 * Le rayon qui couvre TOUTE la fenetre depuis l'origine : la distance au coin le plus eloigne. Un
 * rayon plus court laisserait un coin de l'ancien theme jusqu'a la fin de l'animation.
 */
export function rayonDuCercle(origine: OrigineDuCercle, largeur: number, hauteur: number): number {
  const dx = Math.max(origine.x, largeur - origine.x, 0)
  const dy = Math.max(origine.y, hauteur - origine.y, 0)
  return Math.ceil(Math.hypot(dx, dy))
}

/**
 * Applique le theme choisi, en cercle depuis `origine` quand c'est possible. Meme theme, ou API
 * absente (happy-dom, tests) : application directe, sans transition. Appele par le `onChange` de la
 * liste SEULEMENT : l'effet d'InterfaceView rejoue le theme a CHAQUE ouverture de l'ecran, et le
 * cercle partirait alors sans que personne n'ait rien choisi.
 */
export function basculerTheme(
  doc: DocumentDeVue,
  memeTheme: boolean,
  origine: OrigineDuCercle,
  fenetre: { largeur: number; hauteur: number },
  appliquer: () => void
): void {
  if (memeTheme || typeof doc.startViewTransition !== 'function') {
    appliquer()
    return
  }
  const style = doc.documentElement.style
  style?.setProperty('--theme-cercle-x', `${Math.round(origine.x)}px`)
  style?.setProperty('--theme-cercle-y', `${Math.round(origine.y)}px`)
  style?.setProperty(
    '--theme-cercle-r',
    `${rayonDuCercle(origine, fenetre.largeur, fenetre.hauteur)}px`
  )
  transitionSousClasse(doc, CLASSE_TRANSITION_DE_THEME, appliquer)
}
