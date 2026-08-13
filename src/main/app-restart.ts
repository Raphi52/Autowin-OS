import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface RestartableApp {
  isPackaged: boolean
  getAppPath(): string
  relaunch(): void
  quit(): void
}

export type DevLauncher = (projectRoot: string) => void

/**
 * Redémarre l'UI réellement servie.
 *
 * En développement, Electron est l'enfant d'electron-vite : `app.relaunch()`
 * contourne ce bridge et peut laisser la nouvelle fenêtre sans serveur renderer.
 * On recrée donc le bridge et son enfant via le lanceur de développement.
 */
export function restartApplication(
  app: RestartableApp,
  launchDev: DevLauncher = launchDevelopmentUi
): void {
  if (app.isPackaged) app.relaunch()
  else launchDev(app.getAppPath())
  app.quit()
}

/**
 * Relance le mode dev par le MEME lanceur que le raccourci du bureau.
 *
 * Deux lanceurs pour un seul geste, c'est un lanceur qui derive de l'autre : celui qu'on corrige et
 * celui qu'on oublie. Le raccourci du bureau vise `pyw.exe scripts/launch_dev.py` — cette relance
 * doit viser le meme script, sinon un redemarrage d'application n'aurait ni la garde de fraicheur,
 * ni le verrou d'instance unique, ni les messages d'erreur visibles.
 *
 * `pythonw`/`pyw` plutot que `python`/`py` : l'interpreteur GRAPHIQUE n'alloue aucune console. Un
 * interpreteur console ferait surgir une fenetre Windows Terminal a chaque redemarrage — le defaut
 * exact que toute cette chaine sert a eviter.
 */
/**
 * La commande, SEPAREE de l'effet, pour qu'elle soit verifiable sans lancer de processus.
 *
 * Les tests de `restartApplication` injectent un faux lanceur : le chemin reel n'y est donc jamais
 * exerce, et deux tests verts ne prouvaient RIEN sur l'interpreteur ni sur le script vise. Cette
 * fonction est le morceau qu'on peut interroger.
 */
export function devLaunchCommand(
  projectRoot: string,
  embeddedExists: (path: string) => boolean = existsSync
): { interpreter: string; args: string[] } {
  const embarque = join(projectRoot, 'resources', 'python', 'pythonw.exe')
  return {
    // L'embarque d'abord (decision `python-runtime`), sinon le lanceur officiel resolu par le PATH.
    interpreter: embeddedExists(embarque) ? embarque : 'pyw.exe',
    args: [join(projectRoot, 'scripts', 'launch_dev.py')]
  }
}

function launchDevelopmentUi(projectRoot: string): void {
  const { interpreter, args } = devLaunchCommand(projectRoot)
  const child = spawn(interpreter, args, {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}
