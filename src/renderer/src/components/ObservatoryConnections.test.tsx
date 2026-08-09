// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'

describe('Observatory connected sources', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  it('shows scoped conversation activity and opens transcript images through preload', async () => {
    const activityImage = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AA==' }))
    const brainTraces = vi.fn(async () => [])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        conversations: vi.fn(async () => [
          { id: 'c1', title: 'C1', provider: 'codex', updatedAt: 1 }
        ]),
        promptCalls: vi.fn(async () => []),
        promptTraceSummary: vi.fn(async () => []),
        authorizeDiagnostics: vi.fn(async () => null),
        promptTracesGlobal: vi.fn(async () => []),
        causalTrace: vi.fn(async () => []),
        brainTraces,
        conversationActivity: vi.fn(async () => [
          { ts: '2026-01-01', kind: 'run', label: 'Build terminé' }
        ]),
        activitySessions: vi.fn(async () => [
          { id: 's1', project: 'Autowin', path: 'session.jsonl', sizeMb: 1, mtime: 1 }
        ]),
        activitySession: vi.fn(async () => ({
          meta: { id: 's1', project: 'Autowin' },
          turns: [{ kind: 'assistant', text: 'preuve transcript' }],
          images: [{ path: 'proof.png', exists: true }],
          totalToolCalls: 2
        })),
        activityImage
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ObservatoryView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Build terminé')
    expect(brainTraces).toHaveBeenCalledWith('c1')
    const session = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Autowin')
    ) as HTMLButtonElement
    await act(async () => {
      session.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('preuve transcript')
    const image = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Voir image')
    ) as HTMLButtonElement
    await act(async () => {
      image.click()
      await Promise.resolve()
    })
    expect(activityImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', project: 'Autowin' }),
      'proof.png'
    )
    expect(container.querySelector('img')?.getAttribute('src')).toContain('data:image/png')
    await act(async () => root.unmount())
    container.remove()
  })

  it('nomme chaque source rejetée au lieu de la présenter comme vide', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        conversations: vi.fn(async () => [
          { id: 'c1', title: 'C1', provider: 'codex', updatedAt: 1 }
        ]),
        promptCalls: vi.fn(async () => []),
        promptTraceSummary: vi.fn(async () => []),
        authorizeDiagnostics: vi.fn(async () => null),
        promptTracesGlobal: vi.fn(async () => []),
        causalTrace: vi.fn(async () => []),
        brainTraces: vi.fn(async () => {
          throw new Error('brain hors ligne')
        }),
        conversationActivity: vi.fn(async () => {
          throw new Error('activité illisible')
        }),
        activitySessions: vi.fn(async () => {
          throw new Error('sessions indisponibles')
        })
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(ObservatoryView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('activitySessions : sessions indisponibles')
    expect(alert?.textContent).toContain('conversationActivity : activité illisible')
    expect(alert?.textContent).toContain('brainTraces : brain hors ligne')

    await act(async () => root.unmount())
    container.remove()
  })
})
