import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type JsonDecoder<T> = (value: unknown) => T | undefined

export interface DurableJsonWriteOptions {
  decodePrevious?: JsonDecoder<unknown>
}

export class DurableJsonError extends Error {
  constructor(
    message: string,
    readonly path: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DurableJsonError'
  }
}

function decodeFile<T>(path: string, decode: JsonDecoder<T>): T | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    return decode(parsed)
  } catch {
    return undefined
  }
}

function temporaryPath(path: string): string {
  return `${path}.${process.pid}.${randomUUID()}.tmp`
}

/**
 * Lit le primaire puis sa dernière version valide. Une récupération restaure aussi le primaire :
 * l'écriture suivante ne pourra donc jamais faire tourner le fichier corrompu vers le backup.
 */
export function readDurableJson<T>(path: string, decode: JsonDecoder<T>): T | undefined {
  const backup = `${path}.bak`
  if (existsSync(path)) {
    const primary = decodeFile(path, decode)
    if (primary !== undefined) return primary
  }

  if (existsSync(backup)) {
    const recovered = decodeFile(backup, decode)
    if (recovered !== undefined) {
      const temporary = temporaryPath(path)
      try {
        mkdirSync(dirname(path), { recursive: true })
        copyFileSync(backup, temporary)
        rmSync(path, { force: true })
        renameSync(temporary, path)
        return recovered
      } catch (error) {
        rmSync(temporary, { force: true })
        throw new DurableJsonError(
          `Impossible de restaurer la dernière version valide de ${path}.`,
          path,
          { cause: error }
        )
      }
    }
  }

  if (!existsSync(path) && !existsSync(backup)) return undefined
  throw new DurableJsonError(`Fichier JSON corrompu ou invalide : ${path}.`, path)
}

/**
 * Publie un JSON par fichier temporaire. Le primaire précédent ne devient backup que s'il est
 * validé par le domaine ; une corruption ne peut donc pas écraser la dernière copie saine.
 */
export function writeDurableJson<T>(
  path: string,
  value: T,
  decode: JsonDecoder<T>,
  options: DurableJsonWriteOptions = {}
): void {
  const backup = `${path}.bak`
  const temporary = temporaryPath(path)
  let previousWasValid = false
  let createdInitialBackup = false
  let createdBackupFromPrevious = false
  let invalidPreviousTemporary: string | undefined
  let invalidBackupTemporary: string | undefined
  let primaryExisted = false
  let backupExisted = false
  let backupWasValid = false
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8')
    if (decodeFile(temporary, decode) === undefined) {
      throw new DurableJsonError(`La nouvelle valeur JSON est invalide : ${path}.`, path)
    }

    primaryExisted = existsSync(path)
    backupExisted = existsSync(backup)
    backupWasValid =
      backupExisted && decodeFile(backup, options.decodePrevious ?? decode) !== undefined

    if (primaryExisted) {
      previousWasValid = decodeFile(path, options.decodePrevious ?? decode) !== undefined
      if (previousWasValid) {
        createdBackupFromPrevious = !backupExisted
        copyFileSync(path, backup)
      } else if (!backupWasValid) {
        invalidPreviousTemporary = temporaryPath(path)
        copyFileSync(path, invalidPreviousTemporary)
        if (backupExisted) {
          invalidBackupTemporary = temporaryPath(backup)
          copyFileSync(backup, invalidBackupTemporary)
        }
        copyFileSync(temporary, backup)
        createdInitialBackup = true
      }
      rmSync(path, { force: true })
    } else if (!backupWasValid) {
      if (backupExisted) {
        invalidBackupTemporary = temporaryPath(backup)
        copyFileSync(backup, invalidBackupTemporary)
      }
      copyFileSync(temporary, backup)
      createdInitialBackup = true
    }
    renameSync(temporary, path)
    if (invalidPreviousTemporary) {
      try {
        rmSync(invalidPreviousTemporary, { force: true })
      } catch {
        // La publication est déjà durable ; ce résidu temporaire n'affecte pas la valeur publiée.
      }
    }
    if (invalidBackupTemporary) {
      try {
        rmSync(invalidBackupTemporary, { force: true })
      } catch {
        // Même garantie : le backup publié est déjà valide.
      }
    }
  } catch (error) {
    rmSync(temporary, { force: true })
    let restoredInvalidPrimary = false
    if (!existsSync(path) && invalidPreviousTemporary && existsSync(invalidPreviousTemporary)) {
      try {
        copyFileSync(invalidPreviousTemporary, path)
        restoredInvalidPrimary = true
      } catch {
        // Le nouveau backup valide reste récupérable si le rollback physique échoue.
      }
    }
    if (
      invalidBackupTemporary &&
      existsSync(invalidBackupTemporary) &&
      (!primaryExisted || existsSync(path))
    ) {
      try {
        copyFileSync(invalidBackupTemporary, backup)
      } catch {
        // Sans rollback complet, le nouveau backup valide reste la dernière copie récupérable.
      }
    }
    if (invalidPreviousTemporary) {
      try {
        rmSync(invalidPreviousTemporary, { force: true })
      } catch {
        // L'erreur principale reste prioritaire.
      }
    }
    if (invalidBackupTemporary) {
      try {
        rmSync(invalidBackupTemporary, { force: true })
      } catch {
        // L'erreur principale reste prioritaire.
      }
    }
    if (
      createdInitialBackup &&
      !backupExisted &&
      (!primaryExisted ? !existsSync(path) : existsSync(path) || restoredInvalidPrimary)
    ) {
      rmSync(backup, { force: true })
    }
    let restoredPrimary = false
    if (!existsSync(path) && previousWasValid && existsSync(backup)) {
      try {
        copyFileSync(backup, path)
        restoredPrimary = true
      } catch {
        // L'erreur principale reste la cause utile ; le backup demeure disponible au prochain read.
      }
    }
    if (restoredPrimary && createdBackupFromPrevious) rmSync(backup, { force: true })
    if (error instanceof DurableJsonError) throw error
    throw new DurableJsonError(`Impossible d'écrire ${path}.`, path, { cause: error })
  }
}
