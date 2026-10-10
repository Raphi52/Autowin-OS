import { dirname, join } from 'node:path'

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

export function cheminRaccourciDemarrerDev(appData: string): string {
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', NOM_RACCOURCI_ELECTRON_DEV)
}

export function iconeRaccourciDev(racineApp: string, varianteDev: boolean): string {
  return varianteDev
    ? join(racineApp, 'resources', 'autowin-os-dev.ico')
    : join(racineApp, 'build', 'icon.ico')
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
  identite: string
  clsid: string
  icone: string
}): ResultatRaccourciDev {
  const { shell, existe, chemin, executable, identite, clsid, icone } = entree
  if (!existe(icone)) return { etat: 'echec', raison: `icône introuvable : ${icone}` }
  const cwd = dirname(executable)
  if (existe(chemin)) {
    const actuel = shell.readShortcutLink(chemin)
    if (
      memeChemin(actuel.target, executable) &&
      memeChemin(actuel.cwd, cwd) &&
      actuel.appUserModelId === identite &&
      memeClsid(actuel.toastActivatorClsid, clsid) &&
      memeChemin(actuel.icon, icone)
    )
      return { etat: 'deja-aligne' }
  }
  const ok = shell.writeShortcutLink(chemin, 'create', {
    target: executable,
    args: '',
    cwd,
    description: 'Autowin OS (dev)',
    icon: icone,
    iconIndex: 0,
    appUserModelId: identite,
    toastActivatorClsid: clsid
  })
  return ok ? { etat: 'ecrit' } : { etat: 'echec', raison: `écriture refusée : ${chemin}` }
}
