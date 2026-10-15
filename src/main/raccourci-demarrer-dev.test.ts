import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  aligneArgumentsRaccourciDemarrerDev,
  aligneIconeRaccourciBureauDev,
  aligneRaccourciDemarrerDev,
  argumentsRaccourciDemarrerDev,
  cheminsRaccourcisDemarrerDev,
  racineDepotDeLExeDev,
  cheminIconeVersionnee,
  cheminRaccourciBureauDev,
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
const ARGS = argumentsRaccourciDemarrerDev('D:\\Autowin')

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
    aligneRaccourciDemarrerDev({ shell, existe, chemin: LNK, executable: EXE, args: ARGS, identite: EXE, clsid: DEV_TOAST_ACTIVATOR_CLSID, icone: ICO })
  return { lancer, ecritures }
}

describe('raccourci menu Démarrer en dev', () => {
  it('porte le nom que lui donne Electron', () => {
    expect(LNK.endsWith('Start Menu\\Programs\\Electron.lnk') || LNK.endsWith('Start Menu/Programs/Electron.lnk')).toBe(true)
  })

  it("sur l'exe de DEV, porte le nom de son produit (conv-266, scripts/electron_dev.py)", () => {
    // L'exe de dev s'appelle aussi electron.exe (app.isPackaged) : c'est son DOSSIER qui le distingue.
    const dev = cheminRaccourciDemarrerDev('C:\\Users\\U\\AppData\\Roaming', 'D:\\Autowin\\.autowin-data\\electron-dev\\electron.exe')
    expect(dev.replace(/\//g, '\\')).toBe('C:\\Users\\U\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Autowin OS Dev.lnk')
    expect(cheminRaccourciDemarrerDev('C:\\Users\\U\\AppData\\Roaming', EXE)).toBe(LNK)
  })

  it("réécrit le raccourci créé par Electron (sans icône, CLSID aléatoire) avec l'icône Autowin", () => {
    const f = faux({ target: EXE, cwd: 'D:\\Autowin\\node_modules\\electron\\dist', appUserModelId: EXE, toastActivatorClsid: '{3507F640-57DA-4372-978C-8622207ED2BC}', icon: '' })
    expect(f.lancer()).toEqual({ etat: 'ecrit' })
    expect(f.ecritures[0]).toMatchObject({ target: EXE, args: ARGS, icon: ICO, iconIndex: 0, appUserModelId: EXE, toastActivatorClsid: DEV_TOAST_ACTIVATOR_CLSID })
  })

  it("n'écrit plus rien une fois conforme", () => {
    const f = faux()
    expect(f.lancer()).toEqual({ etat: 'ecrit' })
    expect(f.lancer()).toEqual({ etat: 'deja-aligne' })
    expect(f.ecritures).toHaveLength(1)
  })

  // Constaté le 2026-10-15 (conv-954) : l'icône du menu Démarrer ouvrait la page d'accueil
  // d'Electron. Le raccourci était conforme sur tout ce qu'Electron contrôle, mais SANS argument.
  it('réécrit un raccourci conforme pour Electron mais sans argument : il ouvrait Electron nu', () => {
    const f = faux({ target: EXE, args: '', cwd: 'D:\\Autowin\\node_modules\\electron\\dist', appUserModelId: EXE, toastActivatorClsid: DEV_TOAST_ACTIVATOR_CLSID, icon: ICO })
    expect(f.lancer()).toEqual({ etat: 'ecrit' })
    expect(f.ecritures[0]).toMatchObject({ target: EXE, args: ARGS })
  })

  it('les arguments désignent, entre guillemets, le script qui démarre le lanceur officiel', () => {
    expect(ARGS.replace(/\//g, '\\')).toBe('"D:\\Autowin\\scripts\\menu-demarrer-dev.cjs"')
    // Le script existe bien dans CE dépôt : un nom faux redonnerait un clic sans effet.
    expect(existsSync(argumentsRaccourciDemarrerDev(join(__dirname, '..', '..')).slice(1, -1))).toBe(true)
  })
})

describe('menu Démarrer sur les postes des collègues (conv-954)', () => {
  const DEPOT = 'D:\\Autowin'
  const EXE_DEV = 'D:\\Autowin\\.autowin-data\\electron-dev\\electron.exe'
  const [LNK_DEV, LNK_ELECTRON] = cheminsRaccourcisDemarrerDev('C:\\Users\\U\\AppData\\Roaming')

  it("le dépôt se déduit de l'exe, exe de dev comme Electron d'npm ; ailleurs, aucun", () => {
    expect(racineDepotDeLExeDev(EXE_DEV)).toBe(DEPOT)
    expect(racineDepotDeLExeDev(EXE)).toBe(DEPOT)
    expect(racineDepotDeLExeDev('D:\\Autowin\\NODE_MODULES\\Electron\\Dist\\electron.exe')).toBe(DEPOT)
    expect(racineDepotDeLExeDev('C:\\Program Files\\Electron\\electron.exe')).toBeUndefined()
    expect(racineDepotDeLExeDev(undefined)).toBeUndefined()
  })

  it('les deux noms possibles du raccourci, dans le dossier Programmes', () => {
    expect(LNK_DEV.replace(/\//g, '\\')).toBe('C:\\Users\\U\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Autowin OS Dev.lnk')
    expect(LNK_ELECTRON).toBe(LNK)
  })

  function autre(initial: DetailsRaccourci | undefined) {
    let lnk = initial
    const ecritures: { operation: string; details: DetailsRaccourci }[] = []
    const shell: ShellRaccourci = {
      readShortcutLink: () => lnk!,
      writeShortcutLink: (_c, operation, details) => {
        ecritures.push({ operation, details })
        lnk = { ...lnk!, ...details }
        return true
      }
    }
    const lancer = () =>
      aligneArgumentsRaccourciDemarrerDev({ shell, existe: (c) => c === LNK_ELECTRON && lnk !== undefined, chemin: LNK_ELECTRON, racineDepot: DEPOT })
    return { lancer, ecritures }
  }

  it("l'ancien Electron.lnk d'un poste passé sur l'exe de dev reçoit les arguments, rien d'autre", () => {
    const f = autre({ target: EXE, args: '', cwd: 'D:\\Autowin\\node_modules\\electron\\dist', appUserModelId: EXE, icon: ICO })
    expect(f.lancer()).toEqual({ etat: 'ecrit' })
    // `update` avec la cible recopiée : identité, CLSID, icône et dossier ne sont pas fournis, donc intacts.
    expect(f.ecritures).toEqual([{ operation: 'update', details: { target: EXE, args: argumentsRaccourciDemarrerDev(DEPOT) } }])
    expect(f.lancer()).toEqual({ etat: 'deja-aligne' })
    expect(f.ecritures).toHaveLength(1)
  })

  it("le raccourci d'un AUTRE clone, ou d'un exe inconnu, n'est pas touché ; absent reste absent", () => {
    const clone = autre({ target: 'E:\\Clone\\node_modules\\electron\\dist\\electron.exe', args: '' })
    expect(clone.lancer()).toEqual({ etat: 'autre-depot' })
    const inconnu = autre({ target: 'C:\\Program Files\\Electron\\electron.exe', args: '' })
    expect(inconnu.lancer()).toEqual({ etat: 'autre-depot' })
    const absent = autre(undefined)
    expect(absent.lancer()).toEqual({ etat: 'absent' })
    expect([...clone.ecritures, ...inconnu.ecritures, ...absent.ecritures]).toEqual([])
  })

  it("le démarrage tire le script du dépôt de l'EXE, pas de la copie qui tourne, et réaligne l'autre raccourci", () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    expect(source).toContain('const racineExe = racineDepotDeLExeDev(process.execPath)')
    expect(source).toContain('args: racineExe ? argumentsRaccourciDemarrerDev(racineExe)')
    expect(source).not.toContain('argumentsRaccourciDemarrerDev(app.getAppPath())')
    expect(source).toContain('aligneArgumentsRaccourciDemarrerDev({')
  })
})

describe('scripts/menu-demarrer-dev.cjs : le lanceur choisi au clic', () => {
  type Commande = { erreur?: string; interpreteur?: string; arguments?: string[]; dossier?: string }
  const script = createRequire(import.meta.url)('../../scripts/menu-demarrer-dev.cjs') as {
    choisirInterpreteur: (e: { racine: string; chemins: string[]; existe: (c: string) => boolean }) => string | undefined
    commandeLanceur: (e: { racine: string; chemins: string[]; existe: (c: string) => boolean }) => Commande
  }
  const R = 'D:\\Autowin'
  const LANCEUR = join(R, 'scripts', 'launch_dev.py')
  const PYW = join('C:\\Windows', 'pyw.exe')
  const PYTHONW = join('C:\\venv', 'pythonw.exe')

  it('même ordre que create-dev-shortcut.ps1 : Python embarqué, puis pyw.exe, puis pythonw.exe', () => {
    const embarque = join(R, 'resources', 'python', 'pythonw.exe')
    const chemins = ['C:\\venv', 'C:\\Windows']
    expect(script.choisirInterpreteur({ racine: R, chemins, existe: (c) => [embarque, PYW, PYTHONW].includes(c) })).toBe(embarque)
    // pyw.exe gagne même s'il vient APRÈS pythonw.exe dans le PATH (le venv d'un autre produit).
    expect(script.choisirInterpreteur({ racine: R, chemins, existe: (c) => [PYW, PYTHONW].includes(c) })).toBe(PYW)
    expect(script.choisirInterpreteur({ racine: R, chemins, existe: (c) => c === PYTHONW })).toBe(PYTHONW)
  })

  it('lance launch_dev.py depuis la racine du dépôt', () => {
    expect(script.commandeLanceur({ racine: R, chemins: ['C:\\Windows'], existe: (c) => [LANCEUR, PYW].includes(c) })).toEqual({
      interpreteur: PYW,
      arguments: [LANCEUR],
      dossier: R
    })
  })

  it('dit pourquoi il ne peut pas lancer, au lieu de rester muet', () => {
    expect(script.commandeLanceur({ racine: R, chemins: [], existe: (c) => c === LANCEUR }).erreur).toMatch(/pyw\.exe/)
    expect(script.commandeLanceur({ racine: R, chemins: ['C:\\Windows'], existe: (c) => c === PYW }).erreur).toMatch(/launch_dev\.py/)
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

/**
 * RACCOURCI DU BUREAU — demande du 2026-10-13 (conv-930) : un collègue avait fait la mise à jour et
 * gardait l'ancien logo sur son Bureau. Ce raccourci, posé UNE fois par scripts/create-dev-shortcut.ps1,
 * visait jusqu'au 2026-10-11 `resources\autowin-os-dev.ico` sous un chemin FIXE : la mise à jour en
 * change le contenu, l'Explorateur garde l'image du chemin. L'app le réaligne donc au démarrage.
 */
describe('raccourci du Bureau en dev : l icône suit le logo du dépôt', () => {
  const DEPOT = 'D:\\Autowin'
  const BUREAU_LNK = cheminRaccourciBureauDev('C:\\Users\\U\\Desktop')
  const NEUVE = 'C:\\Users\\U\\AppData\\Local\\autowin-os\\icones\\autowin-os-dev-5a8d4006defc.ico'
  // Champs exacts d'un raccourci posé par le script AVANT le 2026-10-11.
  const ANCIEN: DetailsRaccourci = {
    target: 'C:\\Windows\\pyw.exe',
    args: '"D:\\Autowin\\scripts\\launch_dev.py"',
    cwd: DEPOT,
    icon: ICO,
    iconIndex: 0
  }

  function bureau(initial: DetailsRaccourci | undefined, icone = NEUVE) {
    const ecritures: Array<{ operation: string; details: DetailsRaccourci }> = []
    const shell: ShellRaccourci = {
      readShortcutLink: () => initial!,
      writeShortcutLink: (_c, operation, details) => {
        ecritures.push({ operation, details })
        return true
      }
    }
    const existe = (p: string) => p === NEUVE || (p === BUREAU_LNK && initial !== undefined)
    const resultat = aligneIconeRaccourciBureauDev({ shell, existe, chemin: BUREAU_LNK, racineDepot: DEPOT, icone })
    return { resultat, ecritures }
  }

  it('porte le nom que lui donne create-dev-shortcut.ps1', () => {
    expect(BUREAU_LNK.replace(/\//g, '\\')).toBe('C:\\Users\\U\\Desktop\\Autowin OS Dev.lnk')
  })

  it('ancien raccourci du dépôt → seule son icône est réécrite, vers la copie au nom neuf', () => {
    const { resultat, ecritures } = bureau(ANCIEN)
    expect(resultat).toEqual({ etat: 'ecrit' })
    // `update` : Electron ne touche QUE les champs fournis — arguments et dossier restent ceux que le
    // collègue a posés ; la cible est recopiée à l'identique (le type d'Electron l'exige).
    expect(ecritures).toEqual([
      { operation: 'update', details: { target: ANCIEN.target, icon: NEUVE, iconIndex: 0 } }
    ])
  })

  it('reconnaît le dépôt malgré la casse et une barre finale', () => {
    expect(bureau({ ...ANCIEN, cwd: 'd:\\autowin\\' }).resultat).toEqual({ etat: 'ecrit' })
  })

  it('déjà aligné → aucune écriture', () => {
    const { resultat, ecritures } = bureau({ ...ANCIEN, icon: NEUVE })
    expect(resultat).toEqual({ etat: 'deja-aligne' })
    expect(ecritures).toEqual([])
  })

  it('raccourci d un AUTRE clone (ou d une copie de travail) → intact', () => {
    const { resultat, ecritures } = bureau({ ...ANCIEN, cwd: 'E:\\AutreClone' })
    expect(resultat).toEqual({ etat: 'autre-depot' })
    expect(ecritures).toEqual([])
  })

  it('pas de raccourci sur le Bureau → l app n en crée JAMAIS un', () => {
    const { resultat, ecritures } = bureau(undefined)
    expect(resultat).toEqual({ etat: 'absent' })
    expect(ecritures).toEqual([])
  })

  it('icône introuvable → échec nommé, le raccourci reste tel quel', () => {
    const { resultat, ecritures } = bureau(ANCIEN, 'C:\\nulle-part.ico')
    expect(resultat).toEqual({ etat: 'echec', raison: 'icône introuvable : C:\\nulle-part.ico' })
    expect(ecritures).toEqual([])
  })

  it('le démarrage de l app le réaligne réellement (câblage de index.ts)', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    expect(source).toContain('aligneIconeRaccourciBureauDev({')
    expect(source).toContain("cheminRaccourciBureauDev(app.getPath('desktop'))")
  })
})
