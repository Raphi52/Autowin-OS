import { describe, expect, it } from 'vitest'
import {
  aligneRaccourciDemarrerDev,
  cheminRaccourciDemarrerDev,
  DEV_TOAST_ACTIVATOR_CLSID,
  type DetailsRaccourci,
  type ShellRaccourci
} from './raccourci-demarrer-dev'

const EXE = 'D:\\Autowin\\node_modules\\electron\\dist\\electron.exe'
const ICO = 'D:\\Autowin\\resources\\autowin-os-dev.ico'
const LNK = cheminRaccourciDemarrerDev('C:\\Users\\U\\AppData\\Roaming')

function faux(initial?: DetailsRaccourci) {
  let lnk = initial
  const ecritures: DetailsRaccourci[] = []
  const shell: ShellRaccourci = {
    readShortcutLink: () => lnk!,
    writeShortcutLink: (_c, _o, d) => {
      ecritures.push(d)
      lnk = d
      return true
    }
  }
  const existe = (p: string) => p === ICO || (p === LNK && lnk !== undefined)
  const lancer = () =>
    aligneRaccourciDemarrerDev({ shell, existe, chemin: LNK, executable: EXE, identite: EXE, clsid: DEV_TOAST_ACTIVATOR_CLSID, icone: ICO })
  return { lancer, ecritures }
}

describe('raccourci menu Démarrer en dev', () => {
  it('porte le nom que lui donne Electron', () => {
    expect(LNK.endsWith('Start Menu\\Programs\\Electron.lnk') || LNK.endsWith('Start Menu/Programs/Electron.lnk')).toBe(true)
  })

  it("réécrit le raccourci créé par Electron (sans icône, CLSID aléatoire) avec l'icône Autowin", () => {
    const f = faux({ target: EXE, cwd: 'D:\\Autowin\\node_modules\\electron\\dist', appUserModelId: EXE, toastActivatorClsid: '{3507F640-57DA-4372-978C-8622207ED2BC}', icon: '' })
    expect(f.lancer()).toEqual({ etat: 'ecrit' })
    expect(f.ecritures[0]).toMatchObject({ target: EXE, args: '', icon: ICO, iconIndex: 0, appUserModelId: EXE, toastActivatorClsid: DEV_TOAST_ACTIVATOR_CLSID })
  })

  it("n'écrit plus rien une fois conforme", () => {
    const f = faux()
    expect(f.lancer()).toEqual({ etat: 'ecrit' })
    expect(f.lancer()).toEqual({ etat: 'deja-aligne' })
    expect(f.ecritures).toHaveLength(1)
  })
})
