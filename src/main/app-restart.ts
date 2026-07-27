import { spawn } from 'node:child_process'
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
export function restartApplication(app: RestartableApp, launchDev: DevLauncher = launchDevelopmentUi): void {
  if (app.isPackaged) app.relaunch()
  else launchDev(app.getAppPath())
  app.quit()
}

function launchDevelopmentUi(projectRoot: string): void {
  const script = join(projectRoot, 'scripts', 'launch-dev.ps1')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProjectRoot', projectRoot],
    { detached: true, stdio: 'ignore', windowsHide: true }
  )
  child.unref()
}
