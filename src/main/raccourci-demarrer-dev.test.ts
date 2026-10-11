import { describe, expect, it } from 'vitest'
import {
  aligneRaccourciDemarrerDev,
  cheminIconeVersionnee,
  cheminRaccourciDemarrerDev,
  DEV_TOAST_ACTIVATOR_CLSID,
  dossierIconesVersionnees,
  poserIconeVersionnee,
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

describe('icône à nom versionné (conv-266 : l Explorateur gardait l atome sous le même chemin)', () => {
  const DOSSIER = dossierIconesVersionnees('C:\\Users\\U\\AppData\\Local')
  const enBarresInverses = (c: string): string => c.replace(/\//g, '\\')
  const atome = new Uint8Array([1, 2, 3])
  const anneau = new Uint8Array([4, 5, 6])

  it('vit hors du dépôt, sous LOCALAPPDATA', () => {
    expect(enBarresInverses(DOSSIER)).toBe('C:\\Users\\U\\AppData\\Local\\autowin-os\\icones')
  })

  it('un logo modifié donne un chemin NEUF, le même logo le même chemin', () => {
    const a = cheminIconeVersionnee(ICO, atome, DOSSIER)
    expect(a).not.toBe(cheminIconeVersionnee(ICO, anneau, DOSSIER))
    expect(a).toBe(cheminIconeVersionnee(ICO, new Uint8Array([1, 2, 3]), DOSSIER))
    // Même empreinte que Python (hashlib) et PowerShell (Get-FileHash) : SHA-256, 12 premiers hexa.
    expect(enBarresInverses(a)).toBe(enBarresInverses(DOSSIER) + '\\autowin-os-dev-039058c6f2c0.ico')
  })

  it('pose la copie une seule fois et rend son chemin', () => {
    const fichiers = new Map<string, Uint8Array>([[ICO, anneau]])
    const ecrits: string[] = []
    const entree = {
      source: ICO,
      dossier: DOSSIER,
      existe: (c: string) => fichiers.has(c),
      lire: (c: string) => fichiers.get(c)!,
      ecrire: (c: string, d: Uint8Array) => {
        ecrits.push(c)
        fichiers.set(c, d)
      }
    }
    const cible = poserIconeVersionnee(entree)
    expect(cible).toBe(cheminIconeVersionnee(ICO, anneau, DOSSIER))
    expect(fichiers.get(cible)).toEqual(anneau)
    expect(poserIconeVersionnee(entree)).toBe(cible)
    expect(ecrits).toEqual([cible])
  })

  it('source absente : rendue telle quelle, pour que l alignement dise « icône introuvable »', () => {
    expect(poserIconeVersionnee({ source: ICO, dossier: DOSSIER, existe: () => false, lire: () => anneau, ecrire: () => {} })).toBe(ICO)
  })
})
