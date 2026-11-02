// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelQuestionPopup } from './ModelQuestionPopup'

let container: HTMLDivElement
let root: Root
const QUESTION = { id: 'q1', source: 'chat', text: 'Continuer ?', options: [] }

function poserLePont(pendingModelQuestion: unknown): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      pendingModelQuestion,
      answerModelQuestion: vi.fn().mockResolvedValue({ ok: true })
    }
  })
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  poserLePont(vi.fn().mockResolvedValue(QUESTION))
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0)
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function mount(): Promise<void> {
  await act(async () => root.render(createElement(ModelQuestionPopup)))
}

describe('ModelQuestionPopup — la page récupère sa question', () => {
  it('affiche la question sans attendre aucun envoi du processus principal', async () => {
    await mount()
    expect(container.querySelector('.model-question-popup p')?.textContent).toBe('Continuer ?')
  })

  it('la retrouve après un rechargement de la page', async () => {
    await mount()
    act(() => root.unmount())
    root = createRoot(container)
    await mount()
    expect(container.querySelector('.model-question-popup p')?.textContent).toBe('Continuer ?')
  })

  it.each([
    ['le processus principal n’a plus de question', vi.fn().mockResolvedValue(null)],
    ['la demande échoue', vi.fn().mockRejectedValue(new Error('canal absent'))],
    ['le pont ne connaît pas encore la demande', undefined]
  ])('jamais de fenêtre vide : %s', async (_cas, demande) => {
    const close = vi.fn()
    Object.defineProperty(window, 'close', { configurable: true, value: close })
    poserLePont(demande)
    await mount()
    expect(container.textContent).toMatch(/n’a pas pu s’afficher/)
    const passer = [...container.querySelectorAll('button')].find((b) =>
      /passer/i.test(b.textContent ?? '')
    )
    act(() => (passer as HTMLButtonElement).click())
    expect(close).toHaveBeenCalled()
  })
})

describe('ModelQuestionPopup — échappatoire', () => {
  it('ferme la fenêtre sur Escape', async () => {
    const close = vi.fn()
    Object.defineProperty(window, 'close', { configurable: true, value: close })
    await mount()
    expect(container.querySelector('.model-question-popup')).not.toBeNull()
    act(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    expect(close).toHaveBeenCalled()
  })

  it('offre un bouton « Passer » qui ferme la fenêtre', async () => {
    const close = vi.fn()
    Object.defineProperty(window, 'close', { configurable: true, value: close })
    await mount()
    const skip = [...container.querySelectorAll('button')].find((b) =>
      /passer/i.test(b.textContent ?? '')
    )
    expect(skip).toBeTruthy()
    act(() => (skip as HTMLButtonElement).click())
    expect(close).toHaveBeenCalled()
  })
})
