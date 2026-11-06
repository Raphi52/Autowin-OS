import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { estDansUnDepotGit } from './depot-git'

const temporaires: string[] = []
const dossierTemp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'depot-git-'))
  temporaires.push(d)
  return d
}
afterEach(() => {
  for (const d of temporaires.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('estDansUnDepotGit', () => {
  it('reconnait la racine d un depot', () => {
    const racine = dossierTemp()
    mkdirSync(join(racine, '.git'))
    expect(estDansUnDepotGit(racine)).toBe(true)
  })

  it('reconnait un SOUS-DOSSIER d un depot comme depot', () => {
    const racine = dossierTemp()
    mkdirSync(join(racine, '.git'))
    const sous = join(racine, 'src', 'profond')
    mkdirSync(sous, { recursive: true })
    expect(estDansUnDepotGit(sous)).toBe(true)
  })

  it('reconnait une copie de travail isolee (.git fichier)', () => {
    const racine = dossierTemp()
    writeFileSync(join(racine, '.git'), 'gitdir: ailleurs\n')
    expect(estDansUnDepotGit(racine)).toBe(true)
  })

  it('rend false hors de tout depot', () => {
    const sous = join(dossierTemp(), 'a', 'b')
    mkdirSync(sous, { recursive: true })
    // Le dossier temporaire systeme n'est normalement dans aucun depot.
    expect(estDansUnDepotGit(sous)).toBe(false)
  })
})
