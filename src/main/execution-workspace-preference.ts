import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  AUTOWIN_APP_DATA_DIR,
  AUTOWIN_WORKSPACE_ENV,
  AUTOWIN_WORKSPACE_ORIGIN_ENV
} from '../shared/app-identity'

/**
 * Le dossier de travail CHOISI depuis l'interface — le dépôt sur lequel les runs s'exécutent.
 *
 * Volontairement stocké HORS de la racine de données portable : cette racine est elle-même dérivée
 * du dossier de travail courant. Y ranger la préférence la rendrait invisible dès qu'elle change
 * de dossier (on la chercherait dans le nouveau dépôt, où elle n'a jamais été écrite).
 */
function preferenceBase(): string {
  return process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming')
}

export function executionWorkspacePreferenceFile(base = preferenceBase()): string {
  return join(base, AUTOWIN_APP_DATA_DIR, 'execution-workspace.json')
}

/** Rend le chemin choisi s'il existe ENCORE sur disque, sinon `undefined` (repli inchangé). */
export function readExecutionWorkspacePreference(
  file = executionWorkspacePreferenceFile()
): string | undefined {
  try {
    if (!existsSync(file)) return undefined
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const workspace = (parsed as { workspace?: unknown } | null)?.workspace
    if (typeof workspace !== 'string' || workspace.trim() === '') return undefined
    const absolute = resolve(workspace)
    return existsSync(absolute) ? absolute : undefined
  } catch {
    // Fichier illisible ou JSON cassé : on ne bloque jamais le démarrage pour une préférence.
    return undefined
  }
}

export function writeExecutionWorkspacePreference(
  workspace: string,
  file = executionWorkspacePreferenceFile()
): string {
  const absolute = resolve(workspace)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ workspace: absolute }, null, 2)}\n`, 'utf8')
  return absolute
}

export function clearExecutionWorkspacePreference(file = executionWorkspacePreferenceFile()): void {
  if (existsSync(file)) rmSync(file, { force: true })
}

/**
 * La valeur de `AUTOWIN_OS_WORKSPACE` telle qu'elle EXISTAIT au lancement du processus.
 *
 * Capturée à l'import, donc AVANT que l'OS n'y republie le dossier résolu (`os.ts`, construction).
 * C'est le seul moment où l'on peut encore distinguer « un lanceur externe impose un dépôt » de
 * « c'est nous qui l'avons écrite ». Après, les deux cas sont indiscernables.
 */
const ENV_AU_LANCEMENT = process.env[AUTOWIN_WORKSPACE_ENV]
/** Vrai quand cette valeur est notre propre republication, transmise par le processus précédent. */
const ENV_VIENT_DE_NOUS = process.env[AUTOWIN_WORKSPACE_ORIGIN_ENV] === 'resolved'

/**
 * Ce que doit devenir la variable d'environnement du dossier de travail AU MOMENT du redémarrage.
 *
 * LE DÉFAUT QUE CECI CORRIGE : au démarrage, l'OS republie le dossier résolu dans
 * `AUTOWIN_OS_WORKSPACE` (`os.ts`), et le redémarrage transmet l'environnement du processus courant
 * au suivant (`app-restart.ts`, `env: { ...process.env }` ; idem pour `app.relaunch()`). Or cette
 * variable passe DEVANT le choix persisté dans `resolveExecutionWorkspace`. Conséquence : après
 * avoir choisi un autre dossier dans les Réglages, l'app redémarrait sur l'ANCIEN — le réglage
 * semblait ignoré, sans rien pour l'expliquer.
 *
 * `garder` = ne rien changer (un lanceur externe impose un dépôt, il reste prioritaire),
 * `poser` = écrire le choix, `retirer` = supprimer la variable pour que le prochain démarrage
 * REDÉTECTE au lieu de repartir sur le dossier qu'on vient d'abandonner.
 */
export type ConsigneEnvRelance =
  | { action: 'garder' }
  | { action: 'poser'; valeur: string }
  | { action: 'retirer' }

export function envPourRelance(entree: {
  envAuLancement?: string
  /** L'environnement portait-il NOTRE marqueur ? Alors ce n'est pas une consigne extérieure. */
  envVientDeNous?: boolean
  choisi?: string
}): ConsigneEnvRelance {
  const impose = entree.envAuLancement
  if (impose && impose.trim() !== '' && !entree.envVientDeNous) return { action: 'garder' }
  const choisi = entree.choisi
  if (!choisi || choisi.trim() === '') return { action: 'retirer' }
  return { action: 'poser', valeur: resolve(choisi) }
}

/** Applique la consigne à l'environnement du processus — à n'appeler QUE juste avant la relance. */
export function alignerEnvPourRelance(
  consigne: ConsigneEnvRelance = envPourRelance({
    envAuLancement: ENV_AU_LANCEMENT,
    envVientDeNous: ENV_VIENT_DE_NOUS,
    choisi: readExecutionWorkspacePreference()
  })
): ConsigneEnvRelance {
  if (consigne.action === 'poser') process.env[AUTOWIN_WORKSPACE_ENV] = consigne.valeur
  else if (consigne.action === 'retirer') delete process.env[AUTOWIN_WORKSPACE_ENV]
  return consigne
}
