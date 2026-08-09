import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { loadAutoClose, saveAutoClose } from './autoclose-store'
import { AutowinOS } from './os'

const dirs: string[] = []
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-autoclose-store-'))
  dirs.push(dir)
  return join(dir, 'autoclose.json')
}

describe('persistance de l’interrupteur de clôture automatique', () => {
  it('survit à un redémarrage : ce qui est activé reste activé', () => {
    const path = tempFile()
    saveAutoClose(true, path)
    expect(loadAutoClose(path)).toBe(true)
  })

  it('une désactivation est persistée elle aussi', () => {
    const path = tempFile()
    saveAutoClose(true, path)
    saveAutoClose(false, path)
    expect(loadAutoClose(path)).toBe(false)
  })

  it('jamais réglé ⇒ OFF (une machine ne se met pas à publier toute seule)', () => {
    expect(loadAutoClose(tempFile())).toBe(false)
  })

  it('fichier corrompu ⇒ OFF, pas une exception ni une publication', () => {
    const path = tempFile()
    writeFileSync(path, '{ ceci n’est pas du json')
    expect(loadAutoClose(path)).toBe(false)
  })

  it('un fichier écrit avec un BOM reste lisible (Notepad, PowerShell)', () => {
    const path = tempFile()
    // Constaté en vrai : le réglage était bon, le BOM faisait échouer JSON.parse, et l'app
    // retombait silencieusement à OFF.
    writeFileSync(path, '﻿' + JSON.stringify({ enabled: true }), 'utf8')
    expect(loadAutoClose(path)).toBe(true)
  })

  it('un contenu inattendu ne vaut pas « activé »', () => {
    const path = tempFile()
    writeFileSync(path, JSON.stringify({ enabled: 'oui' }))
    expect(loadAutoClose(path)).toBe(false)
  })

  it('signale une écriture impossible au lieu de promettre une persistance', () => {
    const path = tempFile()
    mkdirSync(path)

    expect(saveAutoClose(true, path)).toBe(false)
    expect(loadAutoClose(path)).toBe(false)
  })

  it('conserve l’état mémoire précédent quand la persistance échoue', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-autoclose-os-'))
    dirs.push(base)
    configureAutowinAppDataBase(base)
    mkdirSync(join(base, 'autowin-os', 'autoclose.json'), { recursive: true })
    const os = Object.create(AutowinOS.prototype) as {
      autoClose: boolean
      setAutoClose(enabled: boolean): void
      getAutoClose(): { enabled: boolean }
    }
    os.autoClose = false

    expect(() => os.setAutoClose(true)).toThrow(/persister/)
    expect(os.getAutoClose().enabled).toBe(false)
  })
})
