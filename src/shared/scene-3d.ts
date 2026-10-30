/**
 * Les deux noms que partagent le fil (`Bloc3D.tsx`), le filtre de navigation de la fenetre
 * (`behaviour-access.ts`) et la page construite (`src/renderer/scene-3d/page-scene-3d.mjs`).
 *
 * La page .mjs ne peut pas importer ce fichier TypeScript (elle est chargee par Node et par la
 * configuration Vite) : elle en garde une copie, et `scene-3d.test.ts` verifie que les deux
 * restent egales.
 */

/** Fichier de la page des scenes 3D, servi a cote de `index.html`. */
export const NOM_PAGE_SCENE_3D = 'scene-3d.html'

/** Champ `type` de chaque message echange entre le fil et la page. */
export const TYPE_MESSAGE_SCENE_3D = 'autowin-scene-3d'

/**
 * Borne d'un bloc ```threejs rendu. Une scene de six planetes avec leurs shaders tient en
 * quelques dizaines de milliers de caracteres ; au-dela, le bloc reste du code lisible.
 */
export const MAX_SCENE_3D_CHARS = 300_000

/**
 * PAGE INTERACTIVE DU FIL (conv-1292, 2026-10-29) — un bloc ```html-interactif est une page HTML
 * dont les scripts TOURNENT, dans le meme cadre isole que les scenes 3D (meme page, meme politique,
 * sans reseau ni acces a l'app). Le ```html-render reste rendu dans la page de l'app, sans script.
 * Nom partage par le decoupage du fil (markdown-blocs.ts) et la consigne du chat.
 */
export const FORME_PAGE_INTERACTIVE = 'html-interactif'

/** Borne d'une page interactive rendue ; au-dela, le bloc reste du code lisible. */
export const MAX_PAGE_INTERACTIVE_CHARS = 300_000

/**
 * Fichier de la page isolee SANS moteur 3D (conv-1304, 2026-10-30), servie a cote de `index.html` :
 * une page ```html-interactif qui ne nomme pas `THREE` y tourne (`pageIsoleePour`,
 * page-interactive.ts) au lieu de telecharger les ~750 Ko de three.js de `scene-3d.html`. Meme
 * amorce, meme politique, meme filtre de navigation (`isSceneFrameUrl`).
 */
export const NOM_PAGE_INTERACTIVE = 'page-interactive.html'
