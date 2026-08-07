import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { AUTOWIN_APP_DATA_DIR, legacyAppDataDirName } from '../shared/app-identity'

/**
 * Dossier unique à ignorer par git et à supprimer pour ne rien laisser : c'est la SEULE racine que
 * l'app écrit désormais hors de son code. Préfixé d'un point pour ne pas encombrer la vue du projet.
 */
const PORTABLE_APP_DATA_DIR = '.autowin-data'

const FILE_STORES = [
  'auth.json',
  'roles.json',
  'conversations.json',
  'scheduled-tasks.json',
  'agent-topology.json',
  'provider-state.json'
]
const DIRECTORY_STORES = ['activity', 'runs', 'trace']
const migratedBases = new Set<string>()
let configuredBase: string | undefined

export type MigrationStatus = 'copied' | 'source-missing' | 'target-kept' | 'failed'

export interface MigrationOutcome {
  store: string
  status: MigrationStatus
  errorCode?: string
}

export interface MigrationReport {
  copied: number
  outcomes: MigrationOutcome[]
}

function appDataBase(): string {
  return (
    configuredBase ??
    process.env.APPDATA ??
    join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming')
  )
}

/** Fixe la racine de TOUS les stores du processus (conversation, artefacts, traces, tâches…). */
export function configureAutowinAppDataBase(base: string | undefined): void {
  configuredBase = base
}

export function autowinAppDataRoot(base = appDataBase()): string {
  return join(base, AUTOWIN_APP_DATA_DIR)
}

export function legacyAppDataRoot(base = appDataBase()): string {
  return join(base, legacyAppDataDirName())
}

function boundedErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && /^[A-Z0-9_-]{1,32}$/.test(code) ? code : 'UNKNOWN'
}

function copyFileIfMissing(source: string, target: string, store: string): MigrationOutcome {
  if (!existsSync(source)) return { store, status: 'source-missing' }
  if (existsSync(target)) return { store, status: 'target-kept' }
  const temporary = `${target}.autowin-migration-${process.pid}-${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, temporary, constants.COPYFILE_EXCL)
    // Le hard-link publie le fichier complet de facon atomique et echoue si
    // une autre instance a cree la cible entre-temps. Aucun overwrite possible.
    linkSync(temporary, target)
    return { store, status: 'copied' }
  } catch (error) {
    if (existsSync(target)) return { store, status: 'target-kept' }
    return { store, status: 'failed', errorCode: boundedErrorCode(error) }
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true })
  }
}

function copyDirectoryIfMissing(source: string, target: string, store: string): MigrationOutcome[] {
  if (!existsSync(source)) return [{ store, status: 'source-missing' }]
  try {
    if (!statSync(source).isDirectory()) {
      return [{ store, status: 'failed', errorCode: 'SOURCE_NOT_DIRECTORY' }]
    }
    if (existsSync(target) && !statSync(target).isDirectory()) {
      return [{ store, status: 'target-kept' }]
    }
    const outcomes: MigrationOutcome[] = []
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      const relativeStore = `${store}/${entry.name}`
      if (entry.isDirectory()) {
        outcomes.push(...copyDirectoryIfMissing(sourcePath, targetPath, relativeStore))
      } else if (entry.isFile()) {
        outcomes.push(copyFileIfMissing(sourcePath, targetPath, relativeStore))
      }
    }
    return outcomes
  } catch (error) {
    return [{ store, status: 'failed', errorCode: boundedErrorCode(error) }]
  }
}

export function migrateLegacyAppDataDetailed(base = appDataBase()): MigrationReport {
  const legacy = legacyAppDataRoot(base)
  if (!existsSync(legacy)) return { copied: 0, outcomes: [] }
  const target = autowinAppDataRoot(base)
  const outcomes: MigrationOutcome[] = []
  for (const name of FILE_STORES) {
    outcomes.push(copyFileIfMissing(join(legacy, name), join(target, name), name))
  }
  for (const name of DIRECTORY_STORES) {
    outcomes.push(...copyDirectoryIfMissing(join(legacy, name), join(target, name), name))
  }
  return { copied: outcomes.filter((outcome) => outcome.status === 'copied').length, outcomes }
}

export function migrateLegacyAppData(base = appDataBase()): number {
  return migrateLegacyAppDataDetailed(base).copied
}

export function ensureAutowinAppData(base = appDataBase()): string {
  const target = createAutowinAppDataRoot(base)
  if (!migratedBases.has(base)) {
    const report = migrateLegacyAppDataDetailed(base)
    const failures = report.outcomes.filter((outcome) => outcome.status === 'failed')
    if (report.copied > 0) {
      console.info(`[Autowin migration] ${report.copied} store(s) copied`)
    }
    for (const failure of failures.slice(0, 10)) {
      console.warn(
        `[Autowin migration] ${failure.store}: failed (${failure.errorCode ?? 'UNKNOWN'})`
      )
    }
    if (failures.length > 10) {
      console.warn(`[Autowin migration] ${failures.length - 10} additional failure(s)`)
    }
    migratedBases.add(base)
  }
  return target
}

export function createAutowinAppDataRoot(base = appDataBase()): string {
  const target = autowinAppDataRoot(base)
  mkdirSync(target, { recursive: true })
  return target
}

/**
 * Base de stockage PORTABLE : tout ce que l'app écrit vit à côté d'elle.
 *
 * Mesuré le 2026-08-07 : supprimer le dossier du projet laissait 1,8 Go dans `%APPDATA%\autowin-os`
 * (conversations, runs, worktrees, cache). Une app qu'on désinstalle en effaçant son dossier ne doit
 * rien semer ailleurs sur la machine.
 *
 * En PACKAGÉ, viser `app.getAppPath()` serait une faute : ce chemin pointe DANS l'archive asar, où
 * aucune écriture n'est possible. Le dossier de l'exécutable est le seul emplacement inscriptible et
 * voisin — c'est la convention des applications portables.
 *
 * Ne concerne QUE ce que l'app produit. Les lectures d'autres produits (transcripts Claude Code,
 * jeton AmitelBrain, installation codex, skills) restent à leur place : les rediriger casserait
 * l'app sans rien nettoyer.
 */
export function portableAppDataBase(
  appPath: string,
  executableDir: string,
  isPackaged: boolean
): string {
  return join(isPackaged ? executableDir : appPath, PORTABLE_APP_DATA_DIR)
}

export function resolveAutowinAppDataBase(
  defaultBase: string,
  isPackaged: boolean,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const isolatedRoot = environment.AUTOWIN_TEST_APP_DATA_ROOT
  return !isPackaged &&
    environment.AUTOWIN_ISOLATED_TEST_INSTANCE === '1' &&
    isolatedRoot &&
    isAbsolute(isolatedRoot)
    ? isolatedRoot
    : defaultBase
}
