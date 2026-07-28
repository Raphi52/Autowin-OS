import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAutoClose, saveAutoClose } from './autoclose-store'

const dirs: string[] = []
afterEach(() => {
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

  it('un contenu inattendu ne vaut pas « activé »', () => {
    const path = tempFile()
    writeFileSync(path, JSON.stringify({ enabled: 'oui' }))
    expect(loadAutoClose(path)).toBe(false)
  })
})
