// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ecouterElementsCibles, type ElementCible } from './components/alt-clic'

/**
 * ALT+CLIC HORS DU CHAT (conv-1338, 2026-10-30) : `App` installe le geste une fois pour toute l'app.
 * Depuis une autre vue, la capture est prise, puis le chat s'ouvre et reçoit l'élément, même s'il
 * n'avait encore jamais été affiché (`visitedTabs`). Le chat est ici un faux qui écoute la vraie file.
 */
const recus: ElementCible[] = []

vi.mock('./components/ChatView', () => ({
  ChatView: () => {
    useEffect(() => ecouterElementsCibles((element) => recus.push(element)), [])
    return createElement('div', { 'data-testid': 'faux-chat' })
  }
}))
vi.mock('./components/ObservatoryView', () => ({ ObservatoryView: () => null }))
vi.mock('./components/TicketsView', () => ({ TicketsView: () => null }))
vi.mock('./components/AgentStudioView', () => ({ AgentStudioView: () => null }))
vi.mock('./components/KnowledgeView', () => ({ KnowledgeView: () => null }))
vi.mock('./components/SettingsView', () => ({
  SettingsView: () =>
    createElement('button', { id: 'dans-reglages', className: 'reglage' }, 'Thème sombre')
}))
vi.mock('./components/ModelQuestionPopup', () => ({ ModelQuestionPopup: () => null }))

import { MainApp } from './App'

async function monter(api: Record<string, unknown>): Promise<{ root: Root }> {
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(MainApp))
    await Promise.resolve()
  })
  await act(async () => {
    await new Promise((fin) => setTimeout(fin, 0))
  })
  return { root }
}

describe('Alt+clic depuis une autre vue', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    recus.length = 0
    document.body.replaceChildren()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('Réglages, chat jamais ouvert : capture d’abord, puis le chat s’ouvre et reçoit l’élément', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 110,
      bottom: 70
    } as DOMRect)
    const ordre: string[] = []
    const capturerElement = vi.fn(async () => {
      ordre.push('capture')
      return 'data:image/png;base64,QUJD'
    })
    const appCommand = vi.fn(async (nom: string, args?: { tab?: string }) => {
      if (nom === 'navigate') ordre.push(`vers ${args?.tab}`)
      return { ok: true }
    })
    const { root } = await monter({
      storageMigration: vi.fn().mockResolvedValue({}),
      completeStorageMigration: vi.fn().mockResolvedValue(true),
      appState: vi.fn(async () => ({ tab: 'settings' })),
      onAppEvent: vi.fn(() => vi.fn()),
      getZoomFactor: () => 1,
      capturerElement,
      appCommand
    })
    const bouton = document.querySelector('#dans-reglages')
    expect(bouton, 'la vue Réglages doit être à l’écran').toBeTruthy()
    expect(document.querySelector('[data-testid="faux-chat"]')).toBeNull()

    await act(async () => {
      bouton!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })
      )
      await new Promise((fin) => setTimeout(fin, 0))
    })
    await vi.waitFor(() => expect(recus).toHaveLength(1))

    expect(ordre).toEqual(['capture', 'vers chat'])
    expect(document.querySelector('[data-testid="faux-chat"]')).toBeTruthy()
    expect(recus[0].texte).toContain('élément pointé : « Thème sombre »')
    expect(recus[0].image?.type).toBe('image/png')
    await act(async () => root.unmount())
  })
})
