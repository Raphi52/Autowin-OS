// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelQuestionPopup } from './ModelQuestionPopup'

let container: HTMLDivElement
let root: Root
let emit: ((question: unknown) => void) | undefined

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  emit = undefined
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      onModelQuestion: (cb: (q: unknown) => void) => {
        emit = cb
        return () => undefined
      },
      answerModelQuestion: vi.fn().mockResolvedValue({ ok: true })
    }
  })
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

function mount(): void {
  act(() => root.render(createElement(ModelQuestionPopup)))
}
function ask(): void {
  act(() => emit?.({ id: 'q1', source: 'chat', text: 'Continuer ?', options: [] }))
}

describe('ModelQuestionPopup — échappatoire', () => {
  it('ferme la fenêtre sur Escape', () => {
    const close = vi.fn()
    Object.defineProperty(window, 'close', { configurable: true, value: close })
    mount()
    ask()
    expect(container.querySelector('.model-question-popup')).not.toBeNull()
    act(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    expect(close).toHaveBeenCalled()
  })

  it('offre un bouton « Passer » qui ferme la fenêtre', () => {
    const close = vi.fn()
    Object.defineProperty(window, 'close', { configurable: true, value: close })
    mount()
    ask()
    const skip = [...container.querySelectorAll('button')].find((b) =>
      /passer/i.test(b.textContent ?? '')
    )
    expect(skip).toBeTruthy()
    act(() => (skip as HTMLButtonElement).click())
    expect(close).toHaveBeenCalled()
  })
})
