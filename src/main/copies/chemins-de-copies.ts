/**
 * Racine unique des copies de tâche : `copies-de-taches\<tâche>`, où la tâche est l'identifiant du
 * fil ou du run. Aujourd'hui deux racines coexistent : `copies-de-fil\<fil>` et
 * `worktrees\<dépôt>\agent__<run>`. Celle-ci est la cible.
 *
 * Ce module calcule seulement où une copie doit vivre. Il ne déplace ni ne crée rien.
 */
import { join } from 'node:path'

export const NOM_RACINE_COPIES_DE_TACHES = 'copies-de-taches'

/* Ni point ni séparateur : un identifiant ne peut ni contenir `..` ni sortir de la racine. */
const IDENTIFIANT_DE_TACHE = /^[A-Za-z0-9_-]{1,128}$/

export function racineDesCopiesDeTaches(dossierDeDonnees: string): string {
  return join(dossierDeDonnees, NOM_RACINE_COPIES_DE_TACHES)
}

/** Le dossier de la copie d'une tâche, ou `null` si son identifiant ne peut pas nommer un dossier. */
export function dossierDeCopieDeTache(racine: string, tache: string): string | null {
  if (!IDENTIFIANT_DE_TACHE.test(tache)) return null
  return join(racine, tache)
}

/** Le nom du dossier d'une copie d'agent, tel que l'état de version 1 l'écrit aujourd'hui. */
export function nomCopieAgentHeritee(runId: string): string {
  return `agent__${runId}`
}
