import { createHash } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'

/**
 * ICÔNE DE LA BARRE DES TÂCHES EN DEV — pourquoi ce module existe.
 *
 * Constaté le 2026-10-07 (conv-120) : en dev, la barre des tâches montrait l'atome Electron alors
 * que la fenêtre reçoit l'icône Autowin (`window.ts`). La chaîne :
 * 1. En dev, `electronApp.setAppUserModelId` (@electron-toolkit/utils) remplace notre identité par
 *    `process.execPath` (`node_modules\electron\dist\electron.exe`).
 * 2. Electron (activation des notifications, PR electron/electron#48132) crée lui-même
 *    `Menu Démarrer\Programmes\<nom produit>.lnk` — `Electron.lnk` pour le binaire npm — vers
 *    electron.exe, avec cette identité et SANS icône.
 * 3. La barre des tâches prend l'icône du raccourci qui porte la même identité que la fenêtre.
 *
 * Correction : c'est NOUS qui posons ce raccourci, avec notre icône et les valeurs exactes
 * qu'Electron contrôle (`ExistingShortcutValid` : cible, dossier de travail, identité, CLSID — PAS
 * l'icône). Electron le trouve valide et n'y touche plus. Le CLSID doit être FIXE : sinon Electron
 * en tire un au hasard à chaque lancement et réécrit le raccourci, sans icône.
 * Source : https://github.com/electron/electron/blob/main/shell/browser/notifications/win/windows_toast_activator.cc
 */

/** CLSID fixe de l'activateur de notifications en DEV. */
export const DEV_TOAST_ACTIVATOR_CLSID = '{EE99F304-0AB6-4863-955C-5C8E00F0868D}'

/** Electron nomme son raccourci `<nom produit>.lnk` ; un autre nom créerait un doublon d'identité. */
const NOM_RACCOURCI_ELECTRON_DEV = 'Electron.lnk'

export interface DetailsRaccourci {
  target: string
  args?: string
  cwd?: string
  description?: string
  icon?: string
  iconIndex?: number
  appUserModelId?: string
  toastActivatorClsid?: string
}

export interface ShellRaccourci {
  readShortcutLink(chemin: string): DetailsRaccourci
  writeShortcutLink(
    chemin: string,
    operation: 'create' | 'update' | 'replace',
    details: DetailsRaccourci
  ): boolean
}

/** Dossier et nom de produit de l'EXE DE DEV — mêmes valeurs que scripts/electron_dev.py. */
export const DOSSIER_EXE_DEV = 'electron-dev'
export const PRODUIT_EXE_DEV = 'Autowin OS Dev'

/**
 * Electron nomme ce raccourci d'après le NOM DE PRODUIT de l'exe (`GetApplicationName`,
 * windows_toast_activator.cc) : « Electron » pour le binaire npm — preuve sur ce poste, l'app appelle
 * `app.setName('Autowin OS')` et le raccourci s'appelle pourtant `Electron.lnk`. Le lanceur fait
 * tourner l'app sur l'EXE DE DEV (scripts/electron_dev.py, conv-266), produit « Autowin OS Dev ». Il
 * garde le nom `electron.exe` (Electron en tire `app.isPackaged`) : c'est son DOSSIER qui le
 * reconnaît. Un autre nom que celui d'Electron créerait un doublon d'identité.
 */
export function cheminRaccourciDemarrerDev(appData: string, executable?: string): string {
  const exeDeDev = executable !== undefined && basename(dirname(executable)) === DOSSIER_EXE_DEV
  const nom = exeDeDev ? `${PRODUIT_EXE_DEV}.lnk` : NOM_RACCOURCI_ELECTRON_DEV
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', nom)
}

/**
 * ARGUMENTS DU RACCOURCI — ce qu'ouvre un clic dessus dans le menu Démarrer.
 *
 * Constaté le 2026-10-15 (conv-954) : le raccourci visait l'exe SANS argument, et un clic ouvrait la
 * page d'accueil d'Electron (`default_app.asar`) au lieu d'Autowin OS. La cible ne peut pas changer
 * (Electron la contrôle), mais pas les arguments : ils désignent `scripts/menu-demarrer-dev.cjs`, que
 * l'application par défaut d'Electron exécute, et qui démarre le lanceur officiel du dépôt.
 */
export const SCRIPT_MENU_DEMARRER_DEV = join('scripts', 'menu-demarrer-dev.cjs')

export function argumentsRaccourciDemarrerDev(racineApp: string): string {
  return `"${join(racineApp, SCRIPT_MENU_DEMARRER_DEV)}"`
}

/**
 * Le DÉPÔT d'un exe de dev, déduit de son emplacement : `<dépôt>\.autowin-data\electron-dev\electron.exe`
 * ou `<dépôt>\node_modules\electron\dist\electron.exe`. Autre emplacement = `undefined`.
 *
 * Les arguments se calculent depuis CE dépôt, jamais depuis `app.getAppPath()` : une instance de test
 * lancée sur une copie de travail temporaire (scripts/autowin-headless.ps1 -AppPath) aurait sinon fait
 * viser au raccourci le script de cette copie, mort avec elle. Cible et script restent dans le même dépôt.
 */
export function racineDepotDeLExeDev(executable: string | undefined): string | undefined {
  if (!executable) return undefined
  const dossier = dirname(executable)
  const nom = (chemin: string): string => basename(chemin).toLowerCase()
  if (nom(dossier) === DOSSIER_EXE_DEV && nom(dirname(dossier)) === '.autowin-data')
    return dirname(dirname(dossier))
  const electron = dirname(dossier)
  if (nom(dossier) === 'dist' && nom(electron) === 'electron' && nom(dirname(electron)) === 'node_modules')
    return dirname(dirname(electron))
  return undefined
}

/** Les deux noms qu'un raccourci de dev peut porter (exe de dev, Electron d'npm). */
export function cheminsRaccourcisDemarrerDev(appData: string): string[] {
  const dossier = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  return [join(dossier, `${PRODUIT_EXE_DEV}.lnk`), join(dossier, NOM_RACCOURCI_ELECTRON_DEV)]
}

export type ResultatArgumentsRaccourci =
  | { etat: 'absent' }
  | { etat: 'autre-depot' }
  | { etat: 'deja-aligne' }
  | { etat: 'ecrit' }
  | { etat: 'echec'; raison: string }

/**
 * L'AUTRE raccourci de dev — celui de l'exe qui ne tourne PAS. Constaté le 2026-10-15 (conv-954) :
 * un poste passé sur l'exe de dev (conv-266) garde l'ancien `Electron.lnk`, avec l'icône Autowin et
 * sans argument ; l'app ne réaligne que le raccourci de l'exe qui tourne, et celui-là continuait
 * d'ouvrir la page d'accueil d'Electron. On n'y écrit que les ARGUMENTS (opération `update`), et
 * seulement s'il vise un exe de CE dépôt : le raccourci d'un autre clone n'est pas le nôtre.
 */
export function aligneArgumentsRaccourciDemarrerDev(entree: {
  shell: ShellRaccourci
  existe: (chemin: string) => boolean
  chemin: string
  racineDepot: string
}): ResultatArgumentsRaccourci {
  const { shell, existe, chemin, racineDepot } = entree
  if (!existe(chemin)) return { etat: 'absent' }
  const actuel = shell.readShortcutLink(chemin)
  const racine = racineDepotDeLExeDev(actuel.target)
  if (racine === undefined || dossierNormalise(racine) !== dossierNormalise(racineDepot))
    return { etat: 'autre-depot' }
  const args = argumentsRaccourciDemarrerDev(racine)
  if (memeChemin(actuel.args, args)) return { etat: 'deja-aligne' }
  // `target` recopié TEL QUEL : le type d'Electron l'exige même pour `update`.
  const ok = shell.writeShortcutLink(chemin, 'update', { target: actuel.target, args })
  return ok ? { etat: 'ecrit' } : { etat: 'echec', raison: `écriture refusée : ${chemin}` }
}

export function iconeRaccourciDev(racineApp: string, varianteDev: boolean): string {
  return varianteDev
    ? join(racineApp, 'resources', 'autowin-os-dev.ico')
    : join(racineApp, 'build', 'icon.ico')
}

/**
 * ICÔNE À NOM VERSIONNÉ — pourquoi le raccourci ne vise plus `resources/autowin-os-dev.ico` lui-même.
 *
 * Mesuré le 2026-10-11 (conv-266) : le logo anneau avait été écrit SOUS LE MÊME CHEMIN que l'ancien
 * atome. L'Explorateur range ses icônes par chemin : le Bureau, capturé par PrintWindow, dessinait
 * toujours l'atome, et ni `SHChangeNotify(UPDATEITEM)` ni `SHUpdateImage` ne l'ont fait changer. Le
 * même raccourci pointé vers un NOUVEAU chemin a montré l'anneau aussitôt. Le raccourci vise donc une
 * copie dont le nom porte l'empreinte du contenu : un logo modifié = un chemin neuf = une image relue.
 *
 * Même règle dans `scripts/logo_anneau.py` (`icone_versionnee`) et `scripts/create-dev-shortcut.ps1` :
 * `%LOCALAPPDATA%\autowin-os\icones\<nom>-<12 premiers hexa du SHA-256>.ico`. Hors du dépôt, pour
 * qu'une copie de travail supprimée n'emporte pas l'icône du raccourci.
 */
export function dossierIconesVersionnees(localAppData: string): string {
  return join(localAppData, 'autowin-os', 'icones')
}

export function cheminIconeVersionnee(source: string, contenu: Uint8Array, dossier: string): string {
  const empreinte = createHash('sha256').update(contenu).digest('hex').slice(0, 12)
  const extension = extname(source)
  return join(dossier, `${basename(source, extension)}-${empreinte}${extension}`)
}

/** Pose la copie versionnée si elle manque et rend son chemin ; source absente = rendue telle quelle. */
export function poserIconeVersionnee(entree: {
  source: string
  dossier: string
  existe: (chemin: string) => boolean
  lire: (chemin: string) => Uint8Array
  ecrire: (chemin: string, contenu: Uint8Array) => void
}): string {
  const { source, dossier, existe, lire, ecrire } = entree
  if (!existe(source)) return source
  const contenu = lire(source)
  const cible = cheminIconeVersionnee(source, contenu, dossier)
  if (!existe(cible)) ecrire(cible, contenu)
  return cible
}

const memeChemin = (a: string | undefined, b: string): boolean =>
  (a ?? '').toLowerCase() === b.toLowerCase()
const memeClsid = (a: string | undefined, b: string): boolean =>
  (a ?? '').replace(/[{}]/g, '').toLowerCase() === b.replace(/[{}]/g, '').toLowerCase()

export type ResultatRaccourciDev =
  | { etat: 'deja-aligne' }
  | { etat: 'ecrit' }
  | { etat: 'echec'; raison: string }

export function aligneRaccourciDemarrerDev(entree: {
  shell: ShellRaccourci
  existe: (chemin: string) => boolean
  chemin: string
  executable: string
  /** Ce que l'exe reçoit au clic : `argumentsRaccourciDemarrerDev`. Vide = page d'accueil d'Electron. */
  args: string
  identite: string
  clsid: string
  icone: string
}): ResultatRaccourciDev {
  const { shell, existe, chemin, executable, args, identite, clsid, icone } = entree
  if (!existe(icone)) return { etat: 'echec', raison: `icône introuvable : ${icone}` }
  const cwd = dirname(executable)
  if (existe(chemin)) {
    const actuel = shell.readShortcutLink(chemin)
    if (
      memeChemin(actuel.target, executable) &&
      memeChemin(actuel.args, args) &&
      memeChemin(actuel.cwd, cwd) &&
      actuel.appUserModelId === identite &&
      memeClsid(actuel.toastActivatorClsid, clsid) &&
      memeChemin(actuel.icon, icone)
    )
      return { etat: 'deja-aligne' }
  }
  const ok = shell.writeShortcutLink(chemin, 'create', {
    target: executable,
    args,
    cwd,
    description: 'Autowin OS (dev)',
    icon: icone,
    iconIndex: 0,
    appUserModelId: identite,
    toastActivatorClsid: clsid
  })
  return ok ? { etat: 'ecrit' } : { etat: 'echec', raison: `écriture refusée : ${chemin}` }
}

/**
 * RACCOURCI DU BUREAU — pourquoi l'app le réaligne elle-même.
 *
 * Constaté le 2026-10-13 (conv-930) : un collègue avait fait la mise à jour et gardait l'ancien logo
 * sur son Bureau. Ce raccourci est posé UNE fois, à la main, par `scripts/create-dev-shortcut.ps1`,
 * et jusqu'au 2026-10-11 il visait `resources\autowin-os-dev.ico` sous un chemin FIXE : la mise à
 * jour en remplace le contenu, l'Explorateur garde l'image du chemin (cf. `cheminIconeVersionnee`).
 * Aucune mise à jour ne pouvait donc le corriger. Au démarrage, l'app le repointe vers la copie à
 * nom versionné — un logo modifié arrive alors chez chacun avec la mise à jour suivante (un `.ico`
 * changé relance l'app, `updateEffectFor`).
 *
 * Bornes : seulement le raccourci de CE dépôt (son dossier de travail, champ posé par toutes les
 * versions du script depuis 2026-07-19), seulement son ICÔNE (opération `update` : Electron ne touche
 * que les champs fournis), et JAMAIS de création — un Bureau sans raccourci reste sans raccourci.
 */
export const NOM_RACCOURCI_BUREAU_DEV = 'Autowin OS Dev.lnk'

export function cheminRaccourciBureauDev(bureau: string): string {
  return join(bureau, NOM_RACCOURCI_BUREAU_DEV)
}

const dossierNormalise = (chemin: string | undefined): string =>
  (chemin ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

export type ResultatRaccourciBureau =
  | { etat: 'absent' }
  | { etat: 'autre-depot' }
  | { etat: 'deja-aligne' }
  | { etat: 'ecrit' }
  | { etat: 'echec'; raison: string }

export function aligneIconeRaccourciBureauDev(entree: {
  shell: ShellRaccourci
  existe: (chemin: string) => boolean
  chemin: string
  racineDepot: string
  icone: string
}): ResultatRaccourciBureau {
  const { shell, existe, chemin, racineDepot, icone } = entree
  if (!existe(chemin)) return { etat: 'absent' }
  if (!existe(icone)) return { etat: 'echec', raison: `icône introuvable : ${icone}` }
  const actuel = shell.readShortcutLink(chemin)
  if (dossierNormalise(actuel.cwd) !== dossierNormalise(racineDepot)) return { etat: 'autre-depot' }
  if (memeChemin(actuel.icon, icone)) return { etat: 'deja-aligne' }
  // `target` recopié TEL QUEL : le type d'Electron l'exige même pour `update`. Le reste du raccourci
  // (arguments, dossier, description) n'est pas fourni, donc pas touché.
  const ok = shell.writeShortcutLink(chemin, 'update', { target: actuel.target, icon: icone, iconIndex: 0 })
  return ok ? { etat: 'ecrit' } : { etat: 'echec', raison: `écriture refusée : ${chemin}` }
}
