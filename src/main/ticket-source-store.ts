import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_TICKET_SOURCE,
  parseTicketSourceProfile,
  type TicketSourceProfile
} from '../shared/tickets'

const MAX_FILE_BYTES = 256_000

export class TicketSourceStoreCorruptionError extends Error {
  readonly code = 'TICKET_SOURCE_STORE_CORRUPT' as const

  constructor(
    readonly path: string,
    cause: unknown
  ) {
    super('Profils de sources Tickets corrompus ou invalides.', { cause })
    this.name = 'TicketSourceStoreCorruptionError'
  }
}

function parseProfiles(value: unknown): TicketSourceProfile[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Liste de profils invalide')
  const parsed = value.map((profile) => {
    const result = parseTicketSourceProfile(profile)
    if (!result) throw new Error('Profil Tickets invalide')
    return result
  })
  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) {
    throw new Error('Identifiants de profils dupliqu?s')
  }
  return parsed
}

export class TicketSourceStore {
  constructor(private readonly path: string) {}

  list(): TicketSourceProfile[] {
    if (!existsSync(this.path)) return [{ ...DEFAULT_TICKET_SOURCE }]
    try {
      const raw = readFileSync(this.path)
      if (raw.byteLength > MAX_FILE_BYTES) throw new Error('Fichier de profils trop volumineux')
      const profiles = parseProfiles(JSON.parse(raw.toString('utf8')))
      return profiles.some(({ id }) => id === DEFAULT_TICKET_SOURCE.id)
        ? profiles
        : [{ ...DEFAULT_TICKET_SOURCE }, ...profiles]
    } catch (cause) {
      throw new TicketSourceStoreCorruptionError(this.path, cause)
    }
  }

  save(value: unknown): TicketSourceProfile[] {
    const profile = parseTicketSourceProfile(value)
    if (!profile) throw new Error('Profil Tickets invalide')
    const current = this.list()
    const index = current.findIndex(({ id }) => id === profile.id)
    const next =
      index < 0
        ? [...current, profile]
        : current.map((candidate, candidateIndex) =>
            candidateIndex === index ? profile : candidate
          )
    this.write(next)
    return next
  }

  remove(id: string): TicketSourceProfile[] {
    if (id === DEFAULT_TICKET_SOURCE.id) throw new Error('La source Tickets initiale est requise')
    const next = this.list().filter((profile) => profile.id !== id)
    this.write(next)
    return next
  }

  private write(profiles: TicketSourceProfile[]): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify(parseProfiles(profiles), null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(temporary, this.path)
  }
}
