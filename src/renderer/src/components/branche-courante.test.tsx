// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useBrancheCourante } from './branche-courante'

/**
 * DEFAUT MESURE le 2026-08-30 : le badge affichait `main` alors que le depot etait sur
 * `chore/route-confidence-threshold-097`. La lecture ne se faisait qu'au montage de la vue.
 */
function Sonde({ lire }: { lire: () => Promise<unknown> }): ReactElement {
  const branche = useBrancheCourante(lire as never, 50)
  return createElement('span', { 'data-test': 'branche' }, branche ?? '')
}

async function monter(lire: () => Promise<unknown>): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(Sonde, { lire }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

const etat = (branch: string) => ({ available: true, state: { branch } })

describe('badge de branche — il suit la branche REELLE', () => {
  it('affiche la branche au montage', async () => {
    const container = await monter(async () => etat('main'))
    expect(container.textContent).toBe('main')
  })

  it('se met à jour quand le dépôt CHANGE de branche pendant la session', async () => {
    let courante = 'main'
    const container = await monter(async () => etat(courante))
    expect(container.textContent).toBe('main')

    courante = 'chore/route-confidence-threshold-097'
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toBe('chore/route-confidence-threshold-097')
  })

  it('relit périodiquement, sans attendre un focus', async () => {
    vi.useFakeTimers()
    try {
      let courante = 'main'
      const container = await monter(async () => etat(courante))
      courante = 'feat/x'
      await act(async () => {
        vi.advanceTimersByTime(60)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(container.textContent).toBe('feat/x')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reste silencieux quand la lecture échoue — jamais un nom inventé', async () => {
    const container = await monter(async () => {
      throw new Error('git indisponible')
    })
    expect(container.textContent).toBe('')
  })
})
