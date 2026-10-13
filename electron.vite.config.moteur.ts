import config from './electron.vite.config'

/**
 * LE MOTEUR SEUL — processus principal + preload, sans l'interface.
 *
 * Sert à `src/main/relance-auto-moteur.ts` : en développement, l'app recompile le moteur dans un
 * dossier temporaire pour savoir, AVANT de se relancer, si le code modifié compile et s'il diffère
 * vraiment de celui qui tourne. electron-vite ne construit que les cibles présentes dans la
 * configuration (main → preload → renderer) : sans `renderer`, la compilation prend ~3 s au lieu
 * d'une minute, et elle ne touche jamais `out/`, que le processus en service lit encore.
 *
 * Elle REPREND la configuration réelle au lieu de la recopier : une option ajoutée à
 * `electron.vite.config.ts` vaut ici aussi, sans seconde copie qui dériverait.
 */
const complete = config as { main?: unknown; preload?: unknown }

export default { main: complete.main, preload: complete.preload }
