import { describe, expect, it } from 'vitest'
import { parseFileRef, resolveFileRef } from './file-ref'

describe('parseFileRef — une cible de lien markdown est-elle un fichier ?', () => {
  it('reconnaît un chemin relatif avec ligne', () => {
    expect(parseFileRef('src/main/orchestrator.ts:80')).toEqual({
      path: 'src/main/orchestrator.ts',
      line: 80
    })
  })
  it('reconnaît un chemin relatif sans ligne', () => {
    expect(parseFileRef('src/main/orchestrator.ts')).toEqual({
      path: 'src/main/orchestrator.ts',
      line: undefined
    })
  })
  it('reconnaît un chemin Windows absolu', () => {
    expect(parseFileRef('C:/Amitel/Autowin OS/src/main/index.ts:12')).toEqual({
      path: 'C:/Amitel/Autowin OS/src/main/index.ts',
      line: 12
    })
  })
  // Entrées qui doivent faire ÉCHOUER une implémentation trop permissive.
  it.each([
    'https://exemple.fr/a.ts',
    'mailto:x@y.fr',
    '#ancre',
    'src/main/',
    'une phrase sans extension',
    'file:///etc/passwd',
    'javascript:alert(1)'
  ])('refuse %s', (cible) => {
    expect(parseFileRef(cible)).toBeNull()
  })
})

describe('resolveFileRef — résolution bornée à la racine', () => {
  const root = 'C:/repo'
  it('résout un chemin relatif sous la racine', () => {
    expect(resolveFileRef(root, 'src/a.ts')).toBe('C:/repo/src/a.ts')
  })
  it('refuse une évasion par ..', () => {
    expect(resolveFileRef(root, '../../secret.txt')).toBeNull()
  })
  it('refuse un absolu hors racine', () => {
    expect(resolveFileRef(root, 'D:/ailleurs/a.ts')).toBeNull()
  })
  it('accepte un absolu DANS la racine', () => {
    expect(resolveFileRef(root, 'C:/repo/src/a.ts')).toBe('C:/repo/src/a.ts')
  })
})
