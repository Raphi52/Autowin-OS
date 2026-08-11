import { openSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/** Frontière I/O unique des notes indexées, injectable dans les tests de lecture froide. */
export function readVaultNoteSync(path: string): string {
  return readFileSync(path, 'utf8')
}

/** Ouvre une note canonique ; frontière I/O injectable pour tester les courses de chemins. */
export function openVaultNoteDescriptor(path: string): number {
  return openSync(path, 'r')
}

export function readVaultNote(path: string): Promise<string> {
  return readFile(path, 'utf8')
}
