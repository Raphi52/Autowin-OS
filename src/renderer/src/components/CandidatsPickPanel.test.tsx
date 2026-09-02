// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidatsPickPanel } from './CandidatsPickPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CandidatsPickPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('envoie au workflow uniquement les candidats cochés et expose les trois détails', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[
            {
              type: 'ajout',
              titre: 'Cockpit',
              url: 'src/main/index.ts:1',
              what: 'Affiche les coûts.',
              why: 'Les coûts sont relus à la main.',
              how: 'Ajouter une vue dédiée.'
            },
            { type: 'correction', titre: 'Retry', url: 'src/main/retry.ts:2' }
          ]}
          onPick={onPick}
        />
      )
    )

    const cases = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(cases).toHaveLength(3)
    act(() => cases[2].click())
    expect(container.querySelector('.cpick-compte')?.textContent).toContain('1/2')

    const deplier = container.querySelector<HTMLButtonElement>('[data-testid="cpick-deplier"]')
    act(() => deplier?.click())
    expect(container.querySelector('[data-testid="cpick-details"]')?.textContent).toContain(
      'Quoi ?Affiche les coûts.Pourquoi ?Les coûts sont relus à la main.Comment ?Ajouter une vue dédiée.'
    )

    const lancer = container.querySelector<HTMLButtonElement>('[data-testid="cpick-lancer"]')
    act(() => lancer?.click())
    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick.mock.calls[0][0]).toContain('Cockpit')
    expect(onPick.mock.calls[0][0]).toContain('Quoi : Affiche les coûts.')
    expect(onPick.mock.calls[0][0]).toContain('Pourquoi : Les coûts sont relus à la main.')
    expect(onPick.mock.calls[0][0]).toContain('Comment : Ajouter une vue dédiée.')
    expect(onPick.mock.calls[0][0]).not.toContain('Retry')
  })
})
