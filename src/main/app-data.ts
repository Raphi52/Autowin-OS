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

const FILE_STORES = ['auth.json', 'roles.json', 'conversations.json', 'agent-topology.json']
const DIRECTORY_STORES = ['activity', 'runs', 'trace']
const migratedBases = new Set<string>()

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
  return process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming')
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
