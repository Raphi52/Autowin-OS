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
