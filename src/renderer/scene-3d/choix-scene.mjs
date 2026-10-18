/**
 * LE RANG CHOISI DANS UN CARROUSEL /draft, TRANSMIS A SA SCENE 3D (conv-318, 2026-10-17 : « le bloc
 * 3d doit etre dans le bloc draft »).
 *
 * Fichier .mjs, et non TypeScript, parce que trois lecteurs en ont besoin et que deux sont des
 * scripts Node : le fil (`src/renderer/src/components/draft-scene-3d.ts`), le generateur du
 * carrousel (`scripts/draft-carrousel.mjs`) et le controle des scenes (`scripts/scene-3d-apercu.mjs`).
 * Une seule definition : le controle fait tourner la scene avec le MEME prelude que le fil.
 */

/** Classe de la place que le carrousel laisse a sa scene. */
export const CLASSE_PLACE_SCENE = 'dkc-3d'

/**
 * Pose `autowin.choix` et `autowin.surChoix(fn)` dans la page de la scene, AVANT son code. Seul le
 * cadre parent (le fil) peut changer le rang ; `fn` est appelee tout de suite avec le rang courant,
 * puis a chaque changement. Tenu sur UNE ligne, sans saut final : le code du bloc commence sur la
 * meme ligne, et le numero de ligne d'une erreur (« La scène a planté … (ligne N) ») reste juste.
 * `autowin-scene-3d` = TYPE_MESSAGE_SCENE_3D (src/shared/scene-3d.ts) ; un test verifie l'egalite.
 */
export const PRELUDE_CHOIX_SCENE =
  ';(() => { const ecouteurs = []; const autowin = { choix: 1, surChoix(fn) { ' +
  "if (typeof fn !== 'function') return; ecouteurs.push(fn); fn(autowin.choix) } }; " +
  "window.autowin = autowin; window.addEventListener('message', (event) => { " +
  'const donnees = event.data; ' +
  "if (event.source !== window.parent || !donnees || donnees.type !== 'autowin-scene-3d') return; " +
  'const rang = donnees.choix; ' +
  'if (!Number.isInteger(rang) || rang < 1 || rang > 99 || rang === autowin.choix) return; ' +
  'autowin.choix = rang; for (const fn of ecouteurs) fn(rang) }) })(); '

/** Le code que recoit la scene d'un carrousel : le prelude, puis le code du bloc, meme ligne. */
export const codeSceneDuCarrousel = (code) => `${PRELUDE_CHOIX_SCENE}${code}`
