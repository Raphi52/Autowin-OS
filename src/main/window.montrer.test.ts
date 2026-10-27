/**
 * « Ouvrir Autowin » doit ramener la FENÊTRE PRINCIPALE, jamais une autre fenêtre de l'app
 * (conv-1142, 2026-10-26, demande : « que ça m'ouvre autowin quand je click dessus »).
 *
 * Défaut reproduit ici : `showMainWindow` prenait la PREMIÈRE fenêtre vivante de
 * `BrowserWindow.getAllWindows()`. La mascotte du bureau (et les cartes de fin de tour) y figurent
 * aussi : Autowin fermé dans la barre d'état, ou la bille créée avant la fenêtre principale, le
 * clic « montrait » la bille elle-même — rien ne s'ouvrait.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Options = { title?: string }

const etat = vi.hoisted(() => ({
  fenetres: [] as Array<Record<string, unknown>>,
  construites: [] as Array<{ title?: string }>,
  dossier: ''
}))
etat.dossier = mkdtempSync(join(tmpdir(), 'autowin-window-montrer-'))
afterAll(() => rmSync(etat.dossier, { recursive: true, force: true }))

vi.mock('electron', () => {
  /** Tout appel inconnu rend un objet qui accepte tout : `createWindow` câble beaucoup de choses. */
  const accepteTout = (): unknown =>
    new Proxy(() => undefined, {
      get: (_cible, cle) =>
        cle === 'then' ? undefined : cle === Symbol.toPrimitive ? (): string => '' : accepteTout(),
      apply: () => accepteTout()
    })
  class FausseFenetre {
    detruite = false
    montree = 0
    focus = vi.fn()
    webContents = accepteTout()
    constructor(options: Options = {}) {
      etat.construites.push({ title: options.title })
      etat.fenetres.push(this as unknown as Record<string, unknown>)
      return new Proxy(this, {
        get: (cible, cle) => (cle in cible ? cible[cle as keyof FausseFenetre] : accepteTout())
      })
    }
    static getAllWindows(): unknown[] {
      return etat.fenetres.filter((f) => !(f as unknown as FausseFenetre).detruite)
    }
    isDestroyed(): boolean {
      return this.detruite
    }
    isMinimized(): boolean {
      return false
    }
    show(): void {
      this.montree++
    }
    loadFile(): Promise<void> {
      return Promise.resolve()
    }
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
  }
  const ecran = { workArea: { x: 0, y: 0, width: 1920, height: 1040 }, id: 1, scaleFactor: 1 }
  // `createWindow` écrit l'écran d'attente dans `app.getPath('temp')` : un dossier à part, effacé.
  const app = new Proxy(
    { getPath: (): string => etat.dossier },
    { get: (cible, cle) => (cle in cible ? cible[cle as 'getPath'] : accepteTout()) }
  )
  return {
    app,
    shell: accepteTout(),
    Menu: accepteTout(),
    Tray: accepteTout(),
    desktopCapturer: accepteTout(),
    session: accepteTout(),
    ipcMain: accepteTout(),
    nativeTheme: accepteTout(),
    BrowserWindow: FausseFenetre,
    screen: {
      getPrimaryDisplay: () => ecran,
      getAllDisplays: () => [ecran],
      on: () => undefined
    }
  }
})
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('../../resources/autowin-os-dev.png?asset', () => ({ default: 'dev.png' }))
vi.mock('../../resources/icon.ico?asset', () => ({ default: 'icon.ico' }))
vi.mock('../../resources/autowin-os-dev.ico?asset', () => ({ default: 'dev.ico' }))

const { BrowserWindow } = await import('electron')
const { createWindowing } = await import('./window')
const { ModelQuestionHub } = await import('./model-questions')

function fenetrage(): ReturnType<typeof createWindowing> {
  return createWindowing({
    T0_DEMARRAGE: 0,
    jalonDemarrage: () => undefined,
    automationInstanceMode: { isolated: true, headless: false },
    isolatedTestInstance: true,
    headlessTestInstance: false,
    modelQuestions: new ModelQuestionHub()
  })
}

/** Une fenêtre qui n'est pas la principale : la bille de la mascotte. */
function bille(): { montree: number; focus: ReturnType<typeof vi.fn> } {
  return new BrowserWindow({ title: 'Autowin — mascotte' }) as unknown as {
    montree: number
    focus: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  etat.fenetres.length = 0
  etat.construites.length = 0
})

describe('showMainWindow — ouvrir Autowin depuis la bille', () => {
  it('Autowin fermé dans la barre d’état, la bille seule vivante : la fenêtre principale renaît', () => {
    const { showMainWindow } = fenetrage()
    const mascotte = bille()

    showMainWindow()

    expect(etat.construites.map((f) => f.title)).toEqual(['Autowin — mascotte', 'Autowin OS Test'])
    expect(mascotte.montree).toBe(0)
  })

  it('la bille créée AVANT la fenêtre principale : c’est la principale qui revient', () => {
    const { createWindow, showMainWindow } = fenetrage()
    const mascotte = bille()
    createWindow()
    const principale = etat.fenetres[1] as unknown as { montree: number }
    const avant = principale.montree

    showMainWindow()

    expect(etat.construites).toHaveLength(2)
    expect(principale.montree).toBe(avant + 1)
    expect(mascotte.montree).toBe(0)
    expect(mascotte.focus).not.toHaveBeenCalled()
  })
})
