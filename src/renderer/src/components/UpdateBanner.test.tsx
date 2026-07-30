// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function api(overrides: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      checkUpdate: vi.fn().mockResolvedValue({ available: true, behind: 5, branch: 'main' }),
      applyUpdate: vi.fn().mockResolvedValue({ ok: true }),
      ...overrides
    }
  })
}

async function render(collapsed = false): Promise<void> {
  await act(async () => {
    root.render(createElement(UpdateBanner, { collapsed }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('mise à jour disponible — un bouton, pas une bannière', () => {
  it('n’affiche RIEN quand l’app est à jour', async () => {
    api({ checkUpdate: vi.fn().mockResolvedValue({ available: false, behind: 0 }) })
    await render()
    expect(container.querySelector('[data-testid="update-banner"]')).toBeNull()
  })

  it('propose un bouton compact portant le nombre de commits en retard', async () => {
    api()
    await render()
    const button = container.querySelector('[data-testid="update-apply"]')
    expect(button).not.toBeNull()
    expect(button!.textContent).toContain('Mettre à jour')
    expect(button!.textContent).toContain('5')
    // L'ancienne bannière pleine largeur ne doit plus exister.
    expect(container.querySelector('.update-banner')).toBeNull()
  })

  it('cliquer applique la mise à jour et neutralise le bouton pendant l’opération', async () => {
    let resolveApply: (value: { ok: boolean }) => void = () => undefined
    const applyUpdate = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveApply = resolve
        })
    )
    api({ applyUpdate })
    await render()

    const button = container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!
    await act(async () => button.click())
    expect(applyUpdate).toHaveBeenCalledOnce()
    // Pas de second clic possible pendant l'application (l'app redémarre au succès).
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Mise à jour…')
    await act(async () => resolveApply({ ok: true }))
  })

  it('un échec est DIT, et le bouton redevient cliquable', async () => {
    api({ applyUpdate: vi.fn().mockResolvedValue({ ok: false, error: 'pull refusé' }) })
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!.click()
    )
    expect(container.querySelector('[data-testid="update-error"]')?.textContent).toContain(
      'pull refusé'
    )
    expect(container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!.disabled).toBe(
      false
    )
  })

  it('rail replié : l’icône seule, sans texte qui déborde', async () => {
    api()
    await render(true)
    const button = container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!
    expect(button.textContent).not.toContain('Mettre à jour')
    // L'information reste accessible, dans l'infobulle.
    expect(button.getAttribute('title')).toContain('5 commit(s)')
  })
})
