import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { creerIndexStore } from './json-index-store'

const estTexte = (v: unknown): v is string => typeof v === 'string' && !!v
const store = creerIndexStore<string>('essai-index.json', estTexte)

let base = ''
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'jis-'))
  return () => rmSync(base, { recursive: true, force: true })
})

describe('le socle commun des index JSON sur disque', () => {
  it('ecrit puis relit', () => {
    store.ecrire({ a: 'un' }, base)
    expect(store.lire(base)).toEqual({ a: 'un' })
  })

  it('un fichier absent vaut un index vide', () => {
    expect(store.lire(base)).toEqual({})
  })

  it('FAIL-OPEN : un JSON invalide vaut un index vide, jamais une exception', () => {
    writeFileSync(store.chemin(base), '{ pas du json', 'utf8')
    expect(store.lire(base)).toEqual({})
  })

  it('FAIL-OPEN : une racine qui n’est pas un objet vaut un index vide', () => {
    writeFileSync(store.chemin(base), '[1,2,3]', 'utf8')
    expect(store.lire(base)).toEqual({})
  })

  it('UNE seule entree malformee invalide TOUT l’index — choix assume', () => {
    // Un index a moitie valide inviterait a s'appuyer sur une donnee douteuse ; le repli est sur.
    writeFileSync(store.chemin(base), '{"bon":"oui","mauvais":42}', 'utf8')
    expect(store.lire(base)).toEqual({})
  })

  it('l’ecriture est atomique : aucun fichier temporaire ne survit', () => {
    store.ecrire({ a: 'un' }, base)
    expect(() => readFileSync(`${store.chemin(base)}.tmp`, 'utf8')).toThrow()
  })

  it('oublier une cle laisse les autres intactes', () => {
    store.ecrire({ a: 'un', b: 'deux' }, base)
    store.oublier('a', base)
    expect(store.lire(base)).toEqual({ b: 'deux' })
  })

  it('oublier la DERNIERE cle supprime le fichier', () => {
    store.ecrire({ a: 'un' }, base)
    store.oublier('a', base)
    expect(() => readFileSync(store.chemin(base), 'utf8')).toThrow()
  })

  it('oublier une cle inconnue n’est pas une erreur', () => {
    expect(() => store.oublier('jamais-vue', base)).not.toThrow()
  })
})
