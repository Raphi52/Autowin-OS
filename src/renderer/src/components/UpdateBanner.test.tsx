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

describe('rejets IPC de mise a jour', () => {
  it('dit un rejet de applyUpdate et permet de reessayer', async () => {
    api({ applyUpdate: vi.fn().mockRejectedValue(new Error('bridge coupe')) })
    await render()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!.click()
    )

    expect(container.querySelector('[data-testid="update-error"]')?.textContent).toContain(
      'bridge coupe'
    )
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!.disabled
    ).toBe(false)
  })

  it('rend un rejet de checkUpdate visible et relancable', async () => {
    const checkUpdate = vi.fn().mockRejectedValue(new Error('origin inaccessible'))
    api({ checkUpdate })
    await render()

    expect(container.querySelector('[data-testid="update-error"]')?.textContent).toContain(
      'origin inaccessible'
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="update-retry"]')!.click()
    )
    expect(checkUpdate).toHaveBeenCalledTimes(2)
  })

  it('rend un echec resolu par le main visible et relancable', async () => {
    const checkUpdate = vi.fn().mockResolvedValue({
      available: false,
      behind: 0,
      error: 'fetch refuse'
    })
    api({ checkUpdate })
    await render()

    expect(container.querySelector('[data-testid="update-error"]')?.textContent).toContain(
      'fetch refuse'
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="update-retry"]')!.click()
    )
    expect(checkUpdate).toHaveBeenCalledTimes(2)
  })

  it('ignore une reponse obsolete quand deux checks se terminent dans le desordre', async () => {
    let resolveFirst: (value: { available: boolean; behind: number }) => void = () => undefined
    let resolveSecond: (value: { available: boolean; behind: number }) => void = () => undefined
    const checkUpdate = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ available: boolean; behind: number }>((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ available: boolean; behind: number }>((resolve) => {
            resolveSecond = resolve
          })
      )
    api({ checkUpdate })
    await act(async () => root.render(createElement(UpdateBanner, {})))
    await act(async () => window.dispatchEvent(new Event('focus')))

    await act(async () => resolveSecond({ available: true, behind: 2 }))
    expect(container.querySelector('[data-testid="update-apply"]')?.textContent).toContain('2')
    await act(async () => resolveFirst({ available: true, behind: 1 }))

    expect(container.querySelector('[data-testid="update-apply"]')?.textContent).toContain('2')
  })

  it('refait le check apres son rejet meme si une ancienne mise a jour reste connue', async () => {
    const checkUpdate = vi
      .fn()
      .mockResolvedValueOnce({ available: true, behind: 5, branch: 'main' })
      .mockRejectedValueOnce(new Error('origin temporairement inaccessible'))
      .mockResolvedValueOnce({ available: true, behind: 6, branch: 'main' })
    const applyUpdate = vi.fn().mockResolvedValue({ ok: true })
    api({ checkUpdate, applyUpdate })
    await render()

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(container.querySelector('[data-testid="update-retry"]')).not.toBeNull()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="update-retry"]')!.click()
    )

    expect(checkUpdate).toHaveBeenCalledTimes(3)
    expect(applyUpdate).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="update-apply"]')?.textContent).toContain('6')
  })

  it("ne masque pas un rejet d'application quand un check deja en vol reussit ensuite", async () => {
    let resolveCheck: (value: {
      available: boolean
      behind: number
      branch: string
    }) => void = () => undefined
    const checkUpdate = vi
      .fn()
      .mockResolvedValueOnce({ available: true, behind: 5, branch: 'main' })
      .mockImplementationOnce(
        () =>
          new Promise<{ available: boolean; behind: number; branch: string }>((resolve) => {
            resolveCheck = resolve
          })
      )
    api({ checkUpdate, applyUpdate: vi.fn().mockRejectedValue(new Error('pull refuse')) })
    await render()

    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!.click()
    )
    expect(container.querySelector('[data-testid="update-error"]')?.textContent).toContain(
      'pull refuse'
    )

    await act(async () => resolveCheck({ available: true, behind: 6, branch: 'main' }))
    expect(container.querySelector('[data-testid="update-error"]')?.textContent).toContain(
      'pull refuse'
    )
  })

  it("ne retire pas l'erreur d'application si un check en vol annonce aucune mise a jour", async () => {
    let resolveCheck: (value: { available: boolean; behind: number }) => void = () => undefined
    let rejectApply: (reason: Error) => void = () => undefined
    const checkUpdate = vi
      .fn()
      .mockResolvedValueOnce({ available: true, behind: 5, branch: 'main' })
      .mockImplementationOnce(
        () =>
          new Promise<{ available: boolean; behind: number }>((resolve) => {
            resolveCheck = resolve
          })
      )
    const applyUpdate = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectApply = reject
        })
    )
    api({ checkUpdate, applyUpdate })
    await render()

    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!.click()
    )
    await act(async () => resolveCheck({ available: false, behind: 0 }))
    await act(async () => rejectApply(new Error('pull refuse')))

    expect(container.querySelector('[data-testid="update-error"]')?.textContent).toContain(
      'pull refuse'
    )
    expect(container.querySelector('[data-testid="update-apply"]')).not.toBeNull()
  })
})

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

  it('libere le bouton et revalide apres un succes sans effet', async () => {
    const checkUpdate = vi
      .fn()
      .mockResolvedValueOnce({ available: true, behind: 1, branch: 'main' })
      .mockResolvedValueOnce({ available: true, behind: 2, branch: 'main' })
    const applyUpdate = vi.fn().mockResolvedValue({
      ok: true,
      effect: 'none',
      reload: false,
      relaunch: false
    })
    api({ checkUpdate, applyUpdate })
    await render()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!.click()
    )

    expect(checkUpdate).toHaveBeenCalledTimes(2)
    const button = container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!
    expect(button.disabled).toBe(false)
    expect(button.textContent).toContain('2')
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
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!.disabled
    ).toBe(false)
  })

  it('rail replié : l’icône seule, sans texte qui déborde', async () => {
    api()
    await render(true)
    const button = container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!
    expect(button.textContent).not.toContain('Mettre à jour')
    // L'information reste accessible, dans l'infobulle.
    expect(button.getAttribute('title')).toContain('5 commit(s)')
  })

  it('rail replié : un échec reste perceptible et permet de réessayer', async () => {
    api({ applyUpdate: vi.fn().mockResolvedValue({ ok: false, error: 'pull refusé' }) })
    await render(true)
    const button = container.querySelector<HTMLButtonElement>('[data-testid="update-apply"]')!

    await act(async () => button.click())

    expect(button.disabled).toBe(false)
    expect(button.classList.contains('is-error')).toBe(true)
    expect(button.getAttribute('title')).toContain('pull refusé')
    expect(button.getAttribute('aria-label')).toContain('pull refusé')
  })
})

describe('sonde RÉGULIÈRE — une seule fois au montage ne suffisait pas', () => {
  afterEach(() => vi.useRealTimers())

  it('re-sonde périodiquement : un collègue qui laisse l’app ouverte voit arriver les commits', async () => {
    // Comportement d'origine : UNE sonde au montage. Un nouveau commit n'apparaissait qu'au
    // redémarrage suivant — c'est-à-dire jamais, pour qui garde l'app ouverte toute la journée.
    vi.useFakeTimers()
    const checkUpdate = vi.fn().mockResolvedValue({ available: true, behind: 1, branch: 'main' })
    api({ checkUpdate })
    await act(async () => {
      root.render(createElement(UpdateBanner, {}))
    })
    expect(checkUpdate).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(180_000)
    })
    expect(checkUpdate).toHaveBeenCalledTimes(2)
    await act(async () => {
      vi.advanceTimersByTime(360_000)
    })
    expect(checkUpdate).toHaveBeenCalledTimes(4)
  })

  it('re-sonde quand on REVIENT sur l’app, sans attendre le tour d’horloge', async () => {
    const checkUpdate = vi.fn().mockResolvedValue({ available: true, behind: 1, branch: 'main' })
    api({ checkUpdate })
    await render()
    expect(checkUpdate).toHaveBeenCalledTimes(1)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(checkUpdate).toHaveBeenCalledTimes(2)
  })

  it('arrête de sonder après démontage — pas de fetch fantôme', async () => {
    vi.useFakeTimers()
    const checkUpdate = vi.fn().mockResolvedValue({ available: true, behind: 1, branch: 'main' })
    api({ checkUpdate })
    await act(async () => {
      root.render(createElement(UpdateBanner, {}))
    })
    await act(async () => root.unmount())
    const after = checkUpdate.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(600_000)
    })
    expect(checkUpdate).toHaveBeenCalledTimes(after)
    root = createRoot(container) // le afterEach global démonte
  })
})

describe('SOUPLESSE hors de main — proposer, jamais choisir à sa place', () => {
  const onFeature = {
    available: true,
    behind: 3,
    branch: 'feat/x',
    reference: 'origin/main',
    strategies: ['merge', 'rebase', 'switch-main']
  }

  it('le bouton principal DIT ce qu’il fait, au lieu d’annoncer un « mettre à jour » qui refusera', async () => {
    api({ checkUpdate: vi.fn().mockResolvedValue(onFeature) })
    await render()
    const button = container.querySelector('[data-testid="update-apply"]')!
    expect(button.textContent).toContain('Fusionner origin/main')
    expect(button.getAttribute('title')).toContain('tu es sur feat/x')
  })

  it('expose les AUTRES voies, et applique celle qu’on clique', async () => {
    const applyUpdate = vi.fn().mockResolvedValue({ ok: true })
    api({ checkUpdate: vi.fn().mockResolvedValue(onFeature), applyUpdate })
    await render()
    expect(container.querySelector('[data-testid="update-choices"]')).toBeNull()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="update-more"]')!.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="update-choice-rebase"]')!.click()
      await Promise.resolve()
    })
    // La stratégie part au main : c'est le CLIC qui porte l'intention, pas un défaut caché.
    expect(applyUpdate).toHaveBeenCalledWith('rebase')
  })

  it('sur main : aucune alternative proposée, le geste est sans ambiguïté', async () => {
    api({
      checkUpdate: vi.fn().mockResolvedValue({
        available: true,
        behind: 2,
        branch: 'main',
        strategies: ['fast-forward']
      })
    })
    await render()
    expect(container.querySelector('[data-testid="update-more"]')).toBeNull()
    expect(container.querySelector('[data-testid="update-apply"]')!.textContent).toContain(
      'Mettre à jour'
    )
  })

  it('annonce que le travail en cours sera mis de côté, au lieu de refuser après le clic', async () => {
    api({
      checkUpdate: vi
        .fn()
        .mockResolvedValue({ available: true, behind: 1, branch: 'main', dirty: true })
    })
    await render()
    expect(
      container.querySelector('[data-testid="update-apply"]')!.getAttribute('title')
    ).toContain('mis de côté puis remis')
  })
})
