import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../shared/tickets'
import { TicketSourceStore, TicketSourceStoreCorruptionError } from './ticket-source-store'

const roots: string[] = []
function storePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-ticket-sources-'))
  roots.push(root)
  return join(root, 'sources.json')
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('profils de sources Tickets', () => {
  it("n'impose aucune source par défaut et persiste seulement des profils non secrets", () => {
    const path = storePath()
    const store = new TicketSourceStore(path)

    expect(store.list()).toEqual([])
    const github = {
      id: 'github:openai:codex',
      label: 'openai/codex',
      provider: 'github' as const,
      owner: 'openai',
      repository: 'codex'
    }
    expect(store.save(github)).toEqual([github])
    expect(readFileSync(path, 'utf8')).not.toContain('token')
    expect(new TicketSourceStore(path).list()).toEqual([github])
    expect(store.save(DEFAULT_TICKET_SOURCE)).toEqual([github, DEFAULT_TICKET_SOURCE])
    expect(store.remove(DEFAULT_TICKET_SOURCE.id)).toEqual([github])
  })

  it('refuse un profil qui contient un token', () => {
    const store = new TicketSourceStore(storePath())
    expect(() =>
      store.save({
        ...DEFAULT_TICKET_SOURCE,
        token: 'secret'
      } as never)
    ).toThrow(/profil.*invalide/i)
  })

  it('échoue fermé sur un fichier corrompu', () => {
    const path = storePath()
    writeFileSync(path, '{', 'utf8')
    expect(() => new TicketSourceStore(path).list()).toThrow(TicketSourceStoreCorruptionError)
  })
})
