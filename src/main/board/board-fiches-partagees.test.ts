/**
 * LES RUN.md DES COLLÈGUES SUR LE PARTAGE : « je dois pouvoir consulter les run.md de mes
 * collègues dans le board ». ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : une fiche recopiée deux fois sans
 * avoir bougé ; un nom de fiche qui sort du dossier ; une lecture qui suit `..` hors du poste visé.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copierLesFiches } from './board-dossier'
import { lireFicheDUnCollegue } from './board-collegues'

const dossiers: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'fiches-partagees-'))
  dossiers.push(d)
  return d
}
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('copierLesFiches', () => {
  it('recopie un RUN.md, puis seulement quand il a bougé, et ignore un nom qui sortirait', async () => {
    const source = tmp()
    const cible = tmp()
    mkdirSync(join(source, 'conv-1', 'slug-a'), { recursive: true })
    const fiche = join(source, 'conv-1', 'slug-a', 'RUN.md')
    writeFileSync(fiche, 'v1')
    const copiees = new Map<string, number>()
    const noms = ['conv-1/slug-a/RUN.md', '../hors/RUN.md', 'conv-9/absent/RUN.md']
    expect(await copierLesFiches(noms, source, cible, copiees)).toBe(1)
    const copie = join(cible, 'fiches', 'conv-1', 'slug-a', 'RUN.md')
    expect(readFileSync(copie, 'utf8')).toBe('v1')
    expect(await copierLesFiches(noms, source, cible, copiees)).toBe(0)
    writeFileSync(fiche, 'v2')
    utimesSync(fiche, new Date(), new Date(Date.now() + 5000))
    expect(await copierLesFiches(noms, source, cible, copiees)).toBe(1)
    expect(readFileSync(copie, 'utf8')).toBe('v2')
  })
})

describe('lireFicheDUnCollegue', () => {
  it('lit la fiche recopiée du poste, refuse tout chemin qui en sortirait', async () => {
    const partage = tmp()
    mkdirSync(join(partage, 'collegue', 'fiches', 'conv-2', 'slug-b'), { recursive: true })
    writeFileSync(join(partage, 'collegue', 'fiches', 'conv-2', 'slug-b', 'RUN.md'), 'contenu')
    writeFileSync(join(partage, 'secret.txt'), 'non')
    expect(await lireFicheDUnCollegue(partage, 'collegue', 'conv-2/slug-b/RUN.md')).toBe('contenu')
    expect(await lireFicheDUnCollegue(partage, 'collegue', 'conv-2/absent/RUN.md')).toBeNull()
    expect(await lireFicheDUnCollegue(partage, '..', 'conv-2/slug-b/RUN.md')).toBeNull()
    expect(await lireFicheDUnCollegue(partage, 'collegue', '../../secret.txt')).toBeNull()
    expect(await lireFicheDUnCollegue(partage, 'a/b', 'conv-2/slug-b/RUN.md')).toBeNull()
    expect(await lireFicheDUnCollegue(partage, 42, 'conv-2/slug-b/RUN.md')).toBeNull()
  })
})
