import { join, resolve } from 'node:path'
import { AUTOWIN_OWN_BRAIN_STATE_DIR } from './brain-paths'
import { lireBrainReglage } from './brain-reglage'

/**
 * OÙ VIT LE BRAIN PERSO — module LÉGER, sorti de `brain-perso.ts` (conv-1233, 2026-10-28).
 *
 * Le processus qui lit le graphe de la vue Knowledge (`viz/brain-worker.ts`) doit savoir quelle
 * racine perso il a le droit d'ouvrir. `brain-perso.ts` tire avec lui le lancement du serveur, la
 * curation et la réindexation (processus enfants) : ce module-ci ne lit que le réglage.
 */

/** Dossier du Brain perso cloné depuis un dépôt quand aucun chemin n'est donné. */
export function defaultBrainPersoRoot(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim() || '.'
  return join(base, AUTOWIN_OWN_BRAIN_STATE_DIR, 'perso')
}

/** Racine du Brain perso, ou `undefined` : aucun Brain perso réglé. */
export function racineBrainPerso(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const reglage = lireBrainReglage(env, 'perso')
  return reglage.chemin ?? (reglage.depot ? defaultBrainPersoRoot(env) : undefined)
}

/** Forme comparable d'un chemin Windows : absolu, séparateurs unifiés, sans casse ni `/` final. */
function cheminComparable(chemin: string): string {
  return resolve(chemin)
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

/**
 * Le chemin désigne-t-il la racine du Brain perso ? Comparaison textuelle seulement (aucun accès
 * disque) : elle sert à CHOISIR la portée (sans filtre de projet, serveur perso), jamais à
 * autoriser une lecture — l'autorisation reste celle de `viz/fs-brains.ts`.
 */
export function estRacineBrainPerso(chemin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const racine = racineBrainPerso(env)
  if (!racine || !chemin.trim()) return false
  return cheminComparable(chemin) === cheminComparable(racine)
}
