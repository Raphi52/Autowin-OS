import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { portCdp, urlCiblesCdp } from './cdp-port.mjs'

const aNettoyer = []
afterEach(() => {
  delete process.env.AUTOWIN_DATA_DIR
  delete process.env.AUTOWIN_CDP_PORT
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

/** Un dossier de donnees qui porte un `DevToolsActivePort`, comme l'app en ecrit un. */
function donneesAvecPort(valeur) {
  const racine = mkdtempSync(join(tmpdir(), 'cdp-port-'))
  aNettoyer.push(racine)
  mkdirSync(racine, { recursive: true })
  if (valeur !== null) writeFileSync(join(racine, 'DevToolsActivePort'), `${valeur}\n/devtools/x\n`)
  process.env.AUTOWIN_DATA_DIR = racine
  return racine
}

describe('cdp-port — joindre l_instance REELLE', () => {
  it('lit le port que l_application a ecrit', () => {
    donneesAvecPort(9225)
    expect(portCdp([], {})).toBe(9225)
  })

  it('--port passe devant tout', () => {
    donneesAvecPort(9225)
    process.env.AUTOWIN_CDP_PORT = '9999'
    expect(portCdp(['node', 'sonde.mjs', '--port', '9300'], process.env)).toBe(9300)
  })

  it('AUTOWIN_CDP_PORT passe devant le fichier', () => {
    donneesAvecPort(9225)
    expect(portCdp([], { AUTOWIN_CDP_PORT: '9400' })).toBe(9400)
  })

  /*
   * Le repli garde l'ancien defaut : une sonde appelee comme avant, sur une machine sans instance
   * ouverte, doit se comporter comme avant — sinon le portage casse des appels qui marchaient.
   */
  it('refuse au lieu de viser 9223 quand rien n_est connu', () => {
    donneesAvecPort(null)
    expect(() => portCdp([], {})).toThrow(/Aucune instance a piloter/)
  })

  it('refuse aussi sur un fichier illisible, au lieu de rendre NaN', () => {
    const racine = donneesAvecPort(null)
    writeFileSync(join(racine, 'DevToolsActivePort'), 'pas-un-port\n')
    expect(() => portCdp([], {})).toThrow(/Aucune instance a piloter/)
  })

  it('construit l_URL du catalogue de cibles sur ce port', () => {
    expect(urlCiblesCdp(9225)).toBe('http://127.0.0.1:9225/json')
  })
})
