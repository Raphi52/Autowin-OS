import {
  AUTOWIN_STORAGE_SUFFIXES,
  autowinStorageKey,
  legacyStorageKey
} from '../../shared/app-identity'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const MIGRATED_STORAGE_SUFFIXES = AUTOWIN_STORAGE_SUFFIXES
export { autowinStorageKey }

export function readMigratedStorageValue(storage: StorageLike, suffix: string): string | null {
  const targetKey = autowinStorageKey(suffix)
  const current = storage.getItem(targetKey)
  if (current !== null) return current
  const legacy = storage.getItem(legacyStorageKey(suffix))
  if (legacy !== null) storage.setItem(targetKey, legacy)
  return legacy
}

export function migrateAutowinStorage(storage: StorageLike): number {
  let migrated = 0
  for (const suffix of MIGRATED_STORAGE_SUFFIXES) {
    const targetKey = autowinStorageKey(suffix)
    if (storage.getItem(targetKey) !== null) continue
    if (readMigratedStorageValue(storage, suffix) !== null) migrated += 1
  }
  return migrated
}

export function importMigratedStorage(
  storage: StorageLike,
  values: Partial<Record<(typeof MIGRATED_STORAGE_SUFFIXES)[number], string>>
): number {
  let migrated = 0
  for (const suffix of MIGRATED_STORAGE_SUFFIXES) {
    const value = values[suffix]
    if (value === undefined) continue
    const targetKey = autowinStorageKey(suffix)
    if (storage.getItem(targetKey) !== null) continue
    storage.setItem(targetKey, value)
    migrated += 1
  }
  return migrated
}
