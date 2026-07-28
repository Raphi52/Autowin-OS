// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ResumedTurnsBanner } from './ResumedTurnsBanner'

function api(unfinished: unknown): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { unfinishedTurns: vi.fn(async () => unfinished) }
  })
}

let root: Root
let container: HTMLDivElement
async function render(onResume?: (id: string) => void): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(ResumedTurnsBanner, { onResume }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ResumedTurnsBanner (survie niveau 2 visible)', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    act(() => root.unmount())
    document.body.replaceChildren()
  })

  it('annonce les tours interrompus par la fermeture de l’app', async () => {
    api([
      { conversationId: 'conv-1', turnId: 't1', events: 12, updatedAt: 1 },
      { conversationId: 'conv-2', turnId: 't2', events: 3, updatedAt: 2 }
    ])
    await render()
    expect(container.querySelector('[data-testid="resumed-turns"]')).not.toBeNull()
    expect(container.textContent).toContain('2')
    expect(container.textContent).toContain('12 événement(s) récupéré(s)')
  })

  it('« Reprendre » remonte la conversation à ouvrir puis se ferme', async () => {
    const onResume = vi.fn()
    api([{ conversationId: 'conv-42', turnId: 't', events: 1, updatedAt: 1 }])
    await render(onResume)
    await act(async () => {
      ;(container.querySelector('[data-testid="resumed-turns-open"]') as HTMLElement).click()
    })
    expect(onResume).toHaveBeenCalledWith('conv-42')
    expect(container.querySelector('[data-testid="resumed-turns"]')).toBeNull()
  })

  it('aucun tour inachevé → bandeau SILENCIEUX', async () => {
    api([])
    await render()
    expect(container.querySelector('[data-testid="resumed-turns"]')).toBeNull()
  })

  it('« Ignorer » masque le bandeau', async () => {
    api([{ conversationId: 'c', turnId: 't', events: 1, updatedAt: 1 }])
    await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="resumed-turns-later"]') as HTMLElement).click()
    })
    expect(container.querySelector('[data-testid="resumed-turns"]')).toBeNull()
  })
})
