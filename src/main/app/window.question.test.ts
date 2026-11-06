/**
 * LA FENÊTRE DE QUESTION NOIRE (2026-10-30). La question partait une seule fois, à la fin
 * du chargement de la page. La fenêtre l'a manquée : page montée, 0 question reçue, plus
 * rien à cliquer, et le run est resté en pause jusqu'à sa fermeture. Mesuré dans la vraie interface :
 * l'envoi arrivait 6 à 8 ms après le branchement de l'écoute. La question reste désormais à
 * disposition de SA page, qui la demande quand elle est prête, y compris après un rechargement.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingModelQuestion } from '../modeles/model-questions'

const etat = vi.hoisted(() => ({
  fenetres: [] as Array<{
    webContents: { id: number; send: ReturnType<typeof vi.fn>; declencher: (e: string) => void }
    fermer: () => void
  }>,
  dossier: ''
}))
etat.dossier = mkdtempSync(join(tmpdir(), 'autowin-window-question-'))
afterAll(() => rmSync(etat.dossier, { recursive: true, force: true }))

vi.mock('electron', () => {
  const accepteTout = (): unknown =>
    new Proxy(() => undefined, {
      get: (_cible, cle) =>
        cle === 'then' ? undefined : cle === Symbol.toPrimitive ? (): string => '' : accepteTout(),
      apply: () => accepteTout()
    })
  class FausseFenetre {
    ecoutes = new Map<string, () => void>()
    webContents = {
      id: etat.fenetres.length + 100,
      send: vi.fn(),
      ecoutes: new Map<string, () => void>(),
      once(evenement: string, action: () => void): void {
        this.ecoutes.set(evenement, action)
      },
      declencher(evenement: string): void {
        this.ecoutes.get(evenement)?.()
      }
    }
    constructor() {
      etat.fenetres.push(this as never)
    }
    on(evenement: string, action: () => void): void {
      this.ecoutes.set(evenement, action)
    }
    once(evenement: string, action: () => void): void {
      this.ecoutes.set(evenement, action)
    }
    fermer(): void {
      this.ecoutes.get('closed')?.()
    }
    loadFile(): Promise<void> {
      return Promise.resolve()
    }
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
  }
  const ecran = { workArea: { x: 0, y: 0, width: 1920, height: 1040 }, id: 1, scaleFactor: 1 }
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
vi.mock('../../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('../../../resources/autowin-os-dev.png?asset', () => ({ default: 'dev.png' }))
vi.mock('../../../resources/icon.ico?asset', () => ({ default: 'icon.ico' }))
vi.mock('../../../resources/autowin-os-dev.ico?asset', () => ({ default: 'dev.ico' }))

const { createWindowing } = await import('./window')
const { ModelQuestionHub } = await import('../modeles/model-questions')

const QUESTION: PendingModelQuestion = {
  id: 'model-question-1',
  source: 'loop',
  text: 'Continuer ?',
  options: ['Oui', 'Non'],
  reason: 'material-ambiguity'
}

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

beforeEach(() => {
  etat.fenetres.length = 0
})

describe('fenêtre de question — la question reste à disposition de sa page', () => {
  it('sa page la récupère à tout moment : avant comme après la fin du chargement', () => {
    const { openQuestionWindow, questionDeLaPage } = fenetrage()
    openQuestionWindow(null, QUESTION)
    const page = etat.fenetres[0].webContents

    expect(questionDeLaPage(page.id)).toEqual(QUESTION)
    page.declencher('did-finish-load')
    expect(questionDeLaPage(page.id)).toEqual(QUESTION)
  })

  it('ne dépend plus d’aucun envoi à la fin du chargement', () => {
    const { openQuestionWindow } = fenetrage()
    openQuestionWindow(null, QUESTION)
    const page = etat.fenetres[0].webContents

    page.declencher('did-finish-load')

    expect(page.send).not.toHaveBeenCalled()
  })

  it('une autre page ne lit pas la question, et elle disparaît avec sa fenêtre', () => {
    const { openQuestionWindow, questionDeLaPage } = fenetrage()
    openQuestionWindow(null, QUESTION)
    openQuestionWindow(null, { ...QUESTION, id: 'model-question-2' })
    const [premiere, seconde] = etat.fenetres

    expect(questionDeLaPage(seconde.webContents.id)?.id).toBe('model-question-2')
    expect(questionDeLaPage(999)).toBeNull()

    premiere.fermer()

    expect(questionDeLaPage(premiere.webContents.id)).toBeNull()
    expect(questionDeLaPage(seconde.webContents.id)?.id).toBe('model-question-2')
  })
})
