import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import {
  loadAutoClose,
  loadLastAutoCloseReport,
  saveAutoClose,
  saveLastAutoCloseReport
} from './autoclose-store'
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

/**
 * Vécu le 2026-10-01 (conv-770) : le commit automatique du tour 235b91bd n'a pas publié le correctif
 * du garde Python, et le POURQUOI a disparu au redémarrage de 12:54 — le rapport ne vivait qu'en
 * mémoire (`lastAutoClose`). Plus rien ne disait au panneau, ni au journal, ce qui avait bloqué.
 */
describe('persistance du dernier rapport de publication', () => {
  const rapport = {
    runId: 'conv-770 · tour 235b91bd',
    branch: 'auto/conv-770-235b91bd',
    project: {
      status: 'skipped',
      reason: 'tests-rouges',
      detail: '1 suite rouge, même rejouée seule'
    },
    at: '2026-10-01T09:52:59.000Z',
    source: 'chat',
    exclus: [
      {
        path: 'src/shared/garde-python-crlf.ts',
        motif: 'tests-rouges',
        testsEnEchec: ['x.test.ts']
      }
    ]
  } as const

  it('survit à un redémarrage : le rapport relu est celui qui a été écrit', () => {
    const path = join(dirname(tempFile()), 'autoclose-last.json')
    expect(saveLastAutoCloseReport(rapport as never, path)).toBe(true)
    expect(loadLastAutoCloseReport(path)).toEqual(rapport)
  })

  it('absent, corrompu ou de forme inattendue ⇒ aucun rapport (jamais un faux rapport)', () => {
    const path = join(dirname(tempFile()), 'autoclose-last.json')
    expect(loadLastAutoCloseReport(path)).toBeUndefined()
    writeFileSync(path, '{ pas du json')
    expect(loadLastAutoCloseReport(path)).toBeUndefined()
    writeFileSync(path, JSON.stringify({ runId: 'x', project: 'pushed' }))
    expect(loadLastAutoCloseReport(path)).toBeUndefined()
  })

  it('chaque rapport retenu par l’app est écrit sur disque, et relu au démarrage', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-autoclose-last-'))
    dirs.push(base)
    configureAutowinAppDataBase(base)
    const os = Object.create(AutowinOS.prototype) as { lastAutoClose: unknown }
    os.lastAutoClose = rapport
    expect(loadLastAutoCloseReport(join(base, 'autowin-os', 'autoclose-last.json'))).toEqual(
      rapport
    )
    // Relu au démarrage : la nouvelle instance part du rapport persisté, pas de rien.
    const source = readFileSync(join(__dirname, 'os.ts'), 'utf8')
    expect(source).toMatch(
      /dernierRapport: AutoCloseReport \| undefined = loadLastAutoCloseReport\(\)/
    )
  })
})
