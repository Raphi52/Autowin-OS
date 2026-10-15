import { flushSync } from 'react-dom'

/**
 * LE PASSAGE ANIME D'UNE VUE A L'AUTRE (conv-981, 2026-10-15) : la page se fond d'une vue a l'autre,
 * et le surlignage du menu GLISSE vers l'onglet choisi (`document.startViewTransition`, Chromium 111+,
 * donc Electron). Chaque vue passait de `display:none` a `flex` d'un coup (app-shell.css).
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

type DocumentDeVue = {
  documentElement: { classList: { add(classe: string): unknown; remove(classe: string): unknown } }
  startViewTransition?: (rappel: () => void) => { finished: Promise<unknown> }
}

/** Transitions en vol : la classe reste posee jusqu'a la fin de la DERNIERE (clics rapides). */
let enVol = 0

/**
 * Applique la bascule de vue, animee quand c'est possible. Sans l'API (happy-dom, tests) ou vers
 * l'onglet deja actif : bascule directe, sans transition. `appliquer` s'execute dans `flushSync` : la
 * nouvelle vue doit etre dans le DOM quand le navigateur en prend l'image.
 */
export function basculerVue(doc: DocumentDeVue, memeVue: boolean, appliquer: () => void): void {
  if (memeVue || typeof doc.startViewTransition !== 'function') {
    appliquer()
    return
  }
  enVol += 1
  doc.documentElement.classList.add(CLASSE_TRANSITION_DE_VUE)
  const transition = doc.startViewTransition(() => flushSync(appliquer))
  // Une transition sautee (un clic plus recent) ou en echec rejette `finished` : la vue est quand
  // meme appliquee, seule l'animation manque. La classe, elle, ne doit jamais rester posee.
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      enVol -= 1
      if (enVol === 0) doc.documentElement.classList.remove(CLASSE_TRANSITION_DE_VUE)
    })
}
