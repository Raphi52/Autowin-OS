// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { useObservatorySources } from './useObservatorySources'

const ignorer = (): void => undefined

// Les indicateurs « en cours » sont deduits de la derniere cle reglee : ce test
// garde leur comportement (vrai pendant la requete, faux apres, vrai de nouveau a chaque cle).
function Harness({ refreshKey, active = true }: { refreshKey: number; active?: boolean }) {
  const s = useObservatorySources<never>({
    active,
    conversationId: 'c1',
    refreshKey,
    semanticRetryKey: 0,
    onSourceError: ignorer
  })
  return (
    <output data-testid="etat">
      {[s.loadingRuns, s.loadingActivitySessions, s.loadingConversationActivity].join(',')}
    </output>
  )
}

describe('useObservatorySources indicateurs de chargement', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('passe a vrai pendant la requete, a faux une fois reglee, et rearme a chaque cle', async () => {
    const attentes: Array<() => void> = []
    const lent = <T,>(valeur: T): Promise<T> =>
      new Promise((resolve) => attentes.push(() => resolve(valeur)))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        activitySessions: vi.fn(() => lent([])),
        listRuns: vi.fn(() => lent([])),
        conversationActivity: vi.fn(() => lent([])),
        authorizeDiagnostics: vi.fn(async () => null),
        promptTracesGlobal: vi.fn(async () => []),
        semanticTimeline: vi.fn(async () => ({ nodes: [], edges: [] }))
      }
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const lire = (): string => host.querySelector('[data-testid="etat"]')?.textContent ?? ''
    const regler = async (): Promise<void> => {
      await act(async () => {
        attentes.splice(0).forEach((f) => f())
        await Promise.resolve()
      })
    }

    await act(async () => root.render(createElement(Harness, { refreshKey: 0 })))
    expect(lire()).toBe('true,true,true')
    await regler()
    expect(lire()).toBe('false,false,false')
    await act(async () => root.render(createElement(Harness, { refreshKey: 1 })))
    expect(lire()).toBe('true,true,true')
    await regler()
    expect(lire()).toBe('false,false,false')
    await act(async () => root.unmount())
  })

  it('reste a faux tant que la source est inactive', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        authorizeDiagnostics: vi.fn(async () => null),
        semanticTimeline: vi.fn(async () => null)
      }
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(createElement(Harness, { refreshKey: 0, active: false })))
    expect(host.textContent).toBe('false,false,false')
    await act(async () => root.unmount())
  })
})
