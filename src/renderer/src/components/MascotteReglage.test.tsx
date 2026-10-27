// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MascotteReglage } from './MascotteReglage'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const montes: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

async function monter(api: unknown): Promise<HTMLDivElement> {
  ;(window as unknown as { api: unknown }).api = api
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  montes.push({ root, container })
  await act(async () => {
    root.render(createElement(MascotteReglage))
  })
  return container
}

afterEach(async () => {
  for (const m of montes.splice(0)) {
    await act(async () => m.root.unmount())
    m.container.remove()
  }
  delete (window as unknown as { api?: unknown }).api
})

const interrupteur = (c: HTMLElement): HTMLButtonElement =>
  c.querySelector('[data-testid="interface-mascotte-switch"]') as HTMLButtonElement

describe('Settings · Interface — interrupteur « Mascotte du bureau » (conv-1145)', () => {
  it('montre le choix lu dans le moteur', async () => {
    const c = await monter({ mascotteAffichee: vi.fn(async () => true), afficherMascotte: vi.fn() })
    expect(interrupteur(c).getAttribute('aria-checked')).toBe('true')
    expect(interrupteur(c).textContent).toContain('Affichée')
  })

  it('un clic demande au moteur de la masquer et affiche SA réponse', async () => {
    const afficherMascotte = vi.fn(async (oui: boolean) => oui)
    const c = await monter({ mascotteAffichee: vi.fn(async () => true), afficherMascotte })
    await act(async () => interrupteur(c).click())
    expect(afficherMascotte).toHaveBeenCalledWith(false)
    expect(interrupteur(c).getAttribute('aria-checked')).toBe('false')
    expect(interrupteur(c).textContent).toContain('Masquée')
  })

  it('un enregistrement refusé laisse l’interrupteur où il était et le dit', async () => {
    const c = await monter({
      mascotteAffichee: vi.fn(async () => true),
      afficherMascotte: vi.fn(async () => {
        throw new Error('APPDATA absent')
      })
    })
    await act(async () => interrupteur(c).click())
    expect(interrupteur(c).getAttribute('aria-checked')).toBe('true')
    expect(c.textContent).toContain('n’a pas pu être enregistré')
  })

  it('fermée par la croix de la bille, il le montre au retour dans Autowin (conv-1142)', async () => {
    let affichee = true
    const c = await monter({
      mascotteAffichee: vi.fn(async () => affichee),
      afficherMascotte: vi.fn()
    })
    expect(interrupteur(c).textContent).toContain('Affichée')
    affichee = false // la croix, cliquée sur le bureau
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(interrupteur(c).getAttribute('aria-checked')).toBe('false')
    expect(interrupteur(c).textContent).toContain('Masquée')
  })

  it('sans pont vers le moteur, l’interrupteur reste inerte', async () => {
    const c = await monter(undefined)
    expect(interrupteur(c).disabled).toBe(true)
  })
})
