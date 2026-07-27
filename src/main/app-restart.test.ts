import { describe, expect, it, vi } from 'vitest'
import { restartApplication, type RestartableApp } from './app-restart'

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
