import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { AUTOWIN_APP_DATA_DIR } from '../shared/app-identity'

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
