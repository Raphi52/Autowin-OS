// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillsCatalog } from './useSkillsInventory'

/**
 * Defaut vecu le 2026-09-16 : la skill `/facture` supprimee du disque restait proposee par la
 * palette `/` du chat jusqu'au redemarrage de l'app. Cause reelle : cet inventaire n'etait lu
 * qu'AU MONTAGE. Ce test tient la relecture au retour de focus — sans lui, rien n'empeche de
 * remettre `[]` en dependances et de reintroduire la liste fantome.
 */
let container: HTMLDivElement
let root: Root
let rendu: string[]

function Sonde(): null {
  rendu = useSkillsCatalog()?.map((s) => s.id) ?? []
  return null
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  rendu = []
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('useSkillsCatalog', () => {
  it('relit l inventaire au retour de focus et oublie une skill disparue du disque', async () => {
    const capabilityControls = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'scout', description: 'S', enabled: true },
        { id: 'facture', description: 'F', enabled: true }
      ])
      .mockResolvedValue([{ id: 'scout', description: 'S', enabled: true }])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { capabilityControls }
    })

    await act(async () => {
      root.render(createElement(Sonde))
    })
    expect(rendu).toEqual(['scout', 'facture'])
    expect(capabilityControls).toHaveBeenCalledTimes(1)

    // La skill est supprimee du disque pendant que l'app tourne, puis l'utilisateur revient
    // sur la fenetre.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(capabilityControls).toHaveBeenCalledTimes(2)
    expect(rendu).toEqual(['scout'])
  })
})
