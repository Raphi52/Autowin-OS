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

const liste = (c: HTMLElement): HTMLSelectElement =>
  c.querySelector('[data-testid="interface-mascotte-style"]') as HTMLSelectElement

describe('Settings · Interface — style « Magicien / Basique » (conv-1249)', () => {
  const choisir = async (select: HTMLSelectElement, valeur: string): Promise<void> => {
    await act(async () => {
      select.value = valeur
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('montre le style gardé par le moteur, avec les deux choix', async () => {
    const c = await monter({
      mascotteAffichee: vi.fn(async () => true),
      afficherMascotte: vi.fn(),
      styleMascotte: vi.fn(async () => 'basique'),
      choisirStyleMascotte: vi.fn()
    })
    expect(liste(c).disabled).toBe(false)
    expect(liste(c).value).toBe('basique')
    expect([...liste(c).options].map((o) => o.textContent)).toEqual(['Magicien', 'Basique'])
  })

  it('choisir Basique le demande au moteur et affiche SA réponse', async () => {
    const choisirStyleMascotte = vi.fn(async (style: string) => style)
    const c = await monter({
      mascotteAffichee: vi.fn(async () => true),
      afficherMascotte: vi.fn(),
      styleMascotte: vi.fn(async () => 'magicien'),
      choisirStyleMascotte
    })
    await choisir(liste(c), 'basique')
    expect(choisirStyleMascotte).toHaveBeenCalledWith('basique')
    expect(liste(c).value).toBe('basique')
  })

  it('un enregistrement refusé garde le style d’avant et le dit', async () => {
    const c = await monter({
      mascotteAffichee: vi.fn(async () => true),
      afficherMascotte: vi.fn(),
      styleMascotte: vi.fn(async () => 'magicien'),
      choisirStyleMascotte: vi.fn(async () => {
        throw new Error('APPDATA absent')
      })
    })
    await choisir(liste(c), 'basique')
    expect(liste(c).value).toBe('magicien')
    expect(c.textContent).toContain('n’a pas pu être enregistré')
  })

  it('sans réponse du moteur sur le style, la liste reste inerte', async () => {
    const c = await monter({ mascotteAffichee: vi.fn(async () => true), afficherMascotte: vi.fn() })
    expect(liste(c).disabled).toBe(true)
  })
})
