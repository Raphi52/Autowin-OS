import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProfileStore, type AutowinProfile } from './profile-store'

const profil = (id: string): AutowinProfile =>
  ({
    schema: 'autowin.profile/v1',
    id,
    name: `Profil ${id}`,
    updatedAt: '2026-11-12T00:00:00.000Z',
    topology: {},
    roles: {}
  }) as unknown as AutowinProfile

let dossier: string
let chemin: string

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'profile-store-'))
  chemin = join(dossier, 'profiles.json')
})
afterEach(() => rmSync(dossier, { recursive: true, force: true }))

describe('supprimer un profil enregistré', () => {
  it('retire le seul profil nommé, sur disque, et garde les autres dans leur ordre', () => {
    const store = new ProfileStore(chemin)
    store.save(profil('a'))
    store.save(profil('b'))
    store.save(profil('c'))

    const reste = store.remove('b')

    expect(reste.map((p) => p.id)).toEqual(['c', 'a'])
    // Relu depuis le fichier, pas depuis la valeur rendue : c'est le disque qui doit avoir changé.
    const relu = JSON.parse(readFileSync(chemin, 'utf8')) as AutowinProfile[]
    expect(relu.map((p) => p.id)).toEqual(['c', 'a'])
    expect(new ProfileStore(chemin).list().map((p) => p.id)).toEqual(['c', 'a'])
  })

  it('un id inconnu ne change rien et ne lève pas', () => {
    const store = new ProfileStore(chemin)
    store.save(profil('a'))
    expect(store.remove('inconnu').map((p) => p.id)).toEqual(['a'])
    expect(store.list().map((p) => p.id)).toEqual(['a'])
  })

  it('sans fichier, supprimer ne crée pas de fichier vide', () => {
    const store = new ProfileStore(chemin)
    expect(store.remove('a')).toEqual([])
    expect(() => readFileSync(chemin)).toThrow()
  })
})
