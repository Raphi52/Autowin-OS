import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { devLaunchCommand, restartApplication, type RestartableApp } from './app-restart'

function app(isPackaged: boolean): RestartableApp {
  return { isPackaged, getAppPath: () => 'C:/Amitel/Autowin OS', relaunch: vi.fn(), quit: vi.fn() }
}

describe('restartApplication', () => {
  it('en développement relance le bridge et son UI plutôt que Electron directement', () => {
    const target = app(false)
    const launchDev = vi.fn()

    restartApplication(target, launchDev)

    expect(launchDev).toHaveBeenCalledWith('C:/Amitel/Autowin OS')
    expect(target.relaunch).not.toHaveBeenCalled()
    expect(target.quit).toHaveBeenCalledOnce()
  })

  it('en application packagée conserve le relaunch Electron', () => {
    const target = app(true)

    restartApplication(target, vi.fn())

    expect(target.relaunch).toHaveBeenCalledOnce()
    expect(target.quit).toHaveBeenCalledOnce()
  })
})

describe('devLaunchCommand — le chemin RÉEL, celui que les mocks ne testaient pas', () => {
  it('vise le lanceur Python, plus le PowerShell', () => {
    // Le raccourci du bureau et cette relance doivent viser le MÊME script : deux lanceurs pour un
    // seul geste, c'est celui qu'on corrige et celui qu'on oublie.
    const { args } = devLaunchCommand('C:/Amitel/Autowin OS', () => false)

    expect(args[0]).toContain('launch_dev.py')
    expect(args[0]).not.toContain('launch-dev.ps1')
  })

  it('utilise un interpréteur GRAPHIQUE — sinon une console surgit à chaque redémarrage', () => {
    const { interpreter } = devLaunchCommand('C:/Amitel/Autowin OS', () => false)

    expect(interpreter).toMatch(/(pyw|pythonw)(\.exe)?$/)
    expect(interpreter).not.toMatch(/(^|\|\/)(py|python)\.exe$/)
  })

  it('préfère un CPython EMBARQUÉ quand il est livré avec le dépôt', () => {
    // Décision `python-runtime` du Brain : un runtime embarqué ne dépend d'aucune installation.
    const { interpreter } = devLaunchCommand('C:/Amitel/Autowin OS', () => true)

    expect(interpreter).toBe(join('C:/Amitel/Autowin OS', 'resources', 'python', 'pythonw.exe'))
  })
})
