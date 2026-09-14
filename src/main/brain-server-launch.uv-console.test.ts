/**
 * LA FENETRE NOIRE DU BRAIN AU DEMARRAGE — cas REEL mesure le 2026-09-14 sur le poste.
 *
 * `pythonw.exe` du venv (PID 30120) avait pour ENFANT un `python.exe` console (PID 17360) portant le
 * meme `brain_server.py` : le relais ecrit par uv est compile en sous-systeme console et rappelle la
 * variante console de l'interpreteur de base. Defaut public : astral-sh/uv#19226 (python.exe et
 * pythonw.exe generes octet pour octet identiques).
 *
 * Ce test fige les deux comportements : on court-circuite le relais UNIQUEMENT pour un venv uv, et un
 * venv standard n'est pas touche.
 */
import { describe, expect, it } from 'vitest'
import { resolveWindowlessInterpreter } from './brain-server-launch'

const VENV = 'C:\\Users\\x\\AppData\\Local\\AmitelBrain\\.venv'
const PYTHON = `${VENV}\\Scripts\\python.exe`
const BASE = 'C:\\Users\\x\\AppData\\Roaming\\uv\\python\\cpython-3.11-windows-x86_64-none'

const CFG_UV = [
  `home = ${BASE}`,
  'implementation = CPython',
  'uv = 0.11.32',
  'version_info = 3.11',
  'include-system-site-packages = false'
].join('\n')

const CFG_STANDARD = [`home = ${BASE}`, 'implementation = CPython', 'version_info = 3.11'].join('\n')

describe('resolveWindowlessInterpreter — la console du venv uv', () => {
  it('vise le pythonw de l’interpreteur de BASE, et rend le site-packages du venv', () => {
    const resolu = resolveWindowlessInterpreter(PYTHON, {
      exists: () => true,
      read: () => CFG_UV
    })
    expect(resolu.bin).toBe(`${BASE}\\pythonw.exe`)
    expect(resolu.venvSitePackages).toBe(`${VENV}\\Lib\\site-packages`)
  })

  it('laisse un venv STANDARD intact : son pythonw local est fiable', () => {
    const resolu = resolveWindowlessInterpreter(PYTHON, {
      exists: () => true,
      read: () => CFG_STANDARD
    })
    expect(resolu.bin).toBe(`${VENV}\\Scripts\\pythonw.exe`)
    expect(resolu.venvSitePackages).toBeUndefined()
  })

  it('ne casse RIEN si le pythonw de base est absent : on garde le relais plutot que rien', () => {
    const resolu = resolveWindowlessInterpreter(PYTHON, {
      exists: (p) => !p.startsWith(BASE),
      read: () => CFG_UV
    })
    expect(resolu.bin).toBe(`${VENV}\\Scripts\\pythonw.exe`)
    expect(resolu.venvSitePackages).toBeUndefined()
  })

  it('ne casse RIEN sans pyvenv.cfg (python hors venv)', () => {
    const resolu = resolveWindowlessInterpreter(PYTHON, {
      exists: (p) => !p.endsWith('pyvenv.cfg'),
      read: () => {
        throw new Error('ne doit pas etre lu')
      }
    })
    expect(resolu.bin).toBe(`${VENV}\\Scripts\\pythonw.exe`)
  })
})
