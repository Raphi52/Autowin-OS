// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { useObservatorySources } from './useObservatorySources'

const ignoreSourceError = (): void => undefined

function Harness({
  conversationId,
  refreshKey = 0,
  semanticRetryKey = 0
}: {
  conversationId: string
  refreshKey?: number
  semanticRetryKey?: number
}): React.JSX.Element {
  const sources = useObservatorySources<never>({
    active: true,
    conversationId,
    refreshKey,
    semanticRetryKey,
    onSourceError: ignoreSourceError
  })
  const semanticTimeline = (
    sources as typeof sources & { semanticTimeline?: { nodes: unknown[]; edges: unknown[] } }
  ).semanticTimeline
  return (
    <div>
      {sources.conversationActivity.map((entry) => entry.label).join(',')}
      <output data-testid="semantic-count">{semanticTimeline?.nodes.length ?? 0}</output>
    </div>
  )
}

describe('useObservatorySources conversation scope', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('efface l activite precedente pendant le chargement de la conversation suivante', async () => {
    const resolvers = new Map<
      string,
      (value: Array<{ ts: string; kind: string; label: string }>) => void
    >()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        activitySessions: vi.fn(async () => []),
        authorizeDiagnostics: vi.fn(async () => null),
        promptTracesGlobal: vi.fn(async () => []),
        semanticTimeline: vi.fn(async () => ({ nodes: [], edges: [] })),
        conversationActivity: vi.fn(
          (id: string) =>
            new Promise<Array<{ ts: string; kind: string; label: string }>>((resolve) => {
              resolvers.set(id, resolve)
            })
        )
      }
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => {
      root.render(createElement(Harness, { conversationId: 'A' }))
    })
    await act(async () => {
      resolvers.get('A')?.([{ ts: '1', kind: 'run', label: 'activite A' }])
      await Promise.resolve()
    })
    expect(container.textContent).toBe('activite A0')

    act(() => {
      root.render(createElement(Harness, { conversationId: 'B' }))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).toBe('0')

    await act(async () => root.unmount())
  })

  it('charge la projection semantique de la conversation active', async () => {
    const semanticTimeline = vi.fn(async () => ({ nodes: [{ id: 'node-1' }], edges: [] }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        activitySessions: vi.fn(async () => []),
        conversationActivity: vi.fn(async () => []),
        authorizeDiagnostics: vi.fn(async () => null),
        promptTracesGlobal: vi.fn(async () => []),
        semanticTimeline
      }
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(Harness, { conversationId: 'conv-semantic' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(semanticTimeline).toHaveBeenCalledWith('conv-semantic')
    expect(container.querySelector('[data-testid="semantic-count"]')?.textContent).toBe('1')

    await act(async () => {
      root.render(createElement(Harness, { conversationId: 'conv-semantic', refreshKey: 1 }))
      await Promise.resolve()
    })
    expect(semanticTimeline).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('relance une timeline en erreur seulement sur le retry semantique explicite', async () => {
    const semanticTimeline = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeline indisponible'))
      .mockResolvedValueOnce({ nodes: [{ id: 'recovered' }], edges: [] })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        activitySessions: vi.fn(async () => []),
        conversationActivity: vi.fn(async () => []),
        authorizeDiagnostics: vi.fn(async () => null),
        promptTracesGlobal: vi.fn(async () => []),
        semanticTimeline
      }
    })
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Harness, { conversationId: 'conv-retry' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(semanticTimeline).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(createElement(Harness, { conversationId: 'conv-retry', semanticRetryKey: 1 }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(semanticTimeline).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="semantic-count"]')?.textContent).toBe('1')
    await act(async () => root.unmount())
  })
})
