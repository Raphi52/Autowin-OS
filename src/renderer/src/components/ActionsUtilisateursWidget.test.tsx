// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionsUtilisateursWidget, type ApiActions } from './ActionsUtilisateursWidget'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let hote: HTMLDivElement | null = null

const monter = async (api: ApiActions): Promise<HTMLDivElement> => {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => {
    root!.render(createElement(ActionsUtilisateursWidget, { api }))
  })
  // Laisse les promesses du chargement se résoudre.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return hote
}

afterEach(() => {
  act(() => root?.unmount())
  hote?.remove()
  root = null
  hote = null
})

const greffes = async (): Promise<{ database: string }[]> => [
  { database: 'RIG_AMIENS' },
  { database: 'RIG_PAPEETE' }
]

describe('widget des actions des utilisateurs', () => {
  it('affiche qui a fait quoi', async () => {
    const vue = await monter({
      listerGreffes: greffes,
      lireActions: async () => ({
        ok: true,
        greffe: 'RIG_AMIENS',
        actions: [{ utilisateur: 'MDUPONT', quand: '2026-09-17T09:00:00', action: 'Dépôt acte' }]
      })
    })
    expect(vue.textContent).toContain('MDUPONT')
    expect(vue.textContent).toContain('Dépôt acte')
  })

  it('affiche la CAUSE au lieu d’une liste vide quand la lecture échoue', async () => {
    const vue = await monter({
      listerGreffes: greffes,
      lireActions: async () => ({ ok: false, raison: 'Aucune table de trace dans RIG_AMIENS.' })
    })
    expect(vue.textContent).toContain('Aucune table de trace')
    expect(vue.textContent).not.toContain('Aucune action enregistrée')
  })

  it('relit le greffe choisi', async () => {
    const lireActions = vi.fn(async () => ({ ok: true as const, greffe: 'x', actions: [] }))
    const vue = await monter({ listerGreffes: greffes, lireActions })
    const select = vue.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('RIG_AMIENS')
    await act(async () => {
      select.value = 'RIG_PAPEETE'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(lireActions).toHaveBeenCalledWith({ database: 'RIG_PAPEETE' })
  })
})
