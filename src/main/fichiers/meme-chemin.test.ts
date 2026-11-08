import { resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formeDuChemin, memeCheminSurDisque } from './meme-chemin'

const windows = process.platform === 'win32'

describe('memeCheminSurDisque', () => {
  it('reconnaît le même dossier malgré un séparateur final', () => {
    expect(memeCheminSurDisque('D:\\AutoWinOS\\', 'D:\\AutoWinOS')).toBe(true)
  })

  it('reconnaît un chemin relatif et sa forme absolue', () => {
    expect(memeCheminSurDisque('./src', resolve('src'))).toBe(true)
  })

  // Entrée qui fait échouer une comparaison du texte brut (sans `resolve`), comme l'ancienne copie
  // de src/main/ipc/chat.ts : deux écritures du même dossier que seul le disque sait rapprocher.
  it('résout les segments « .. » avant de comparer', () => {
    expect(memeCheminSurDisque(`${resolve('src')}${sep}..`, resolve('.'))).toBe(true)
  })

  it('distingue deux dossiers dont l’un prolonge le nom de l’autre', () => {
    expect(memeCheminSurDisque('D:\\AutoWinOS2', 'D:\\AutoWinOS')).toBe(false)
  })

  it.runIf(windows)('ignore la casse et le sens des barres sous Windows', () => {
    expect(memeCheminSurDisque('d:/autowinos/src', 'D:\\AutoWinOS\\src\\')).toBe(true)
  })

  // Un Brain partagé se règle en dossier réseau, écrit indifféremment avec `/` ou `\`.
  it.runIf(windows)('reconnaît un dossier réseau écrit avec des barres différentes', () => {
    expect(memeCheminSurDisque('//serveur/partage/Brain/', '\\\\serveur\\partage\\Brain')).toBe(
      true
    )
    expect(memeCheminSurDisque('//serveur/partage/Brain', '\\\\serveur\\partage\\Autre')).toBe(
      false
    )
  })

  it.runIf(!windows)('respecte la casse hors Windows', () => {
    expect(memeCheminSurDisque('/tmp/Depot', '/tmp/depot')).toBe(false)
  })
})

describe('formeDuChemin', () => {
  it('rend une forme sans séparateur final', () => {
    expect(formeDuChemin('D:\\AutoWinOS\\')).not.toMatch(/[\\/]$/u)
  })
})
