// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeView } from './HomeView'
import { CLE_VISIBILITE_WIDGETS } from './home-widgets-visibility'
import { CLE_NOM_JARVIS } from './jarvis-nom'

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

beforeEach(() => {
  window.localStorage.clear()
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    taskManagerSnapshot: vi.fn(async () => ({ tasks: [], alerts: [] })),
    outlookSnapshot: vi.fn(async () => ({ ok: true, mails: [], events: [] })),
    onTaskManagerSnapshot: vi.fn(() => () => {})
  }
})

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

async function mount(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(createElement(HomeView, { active: true }))
  })
  return container
}

const q = <T extends Element>(c: ParentNode, sel: string): T | null => c.querySelector<T>(sel)

async function ouvrir(c: HTMLDivElement): Promise<void> {
  const bouton = q<HTMLButtonElement>(c, '[data-testid="home-settings"]')!
  await act(async () => bouton.click())
}

/**
 * Ecrire dans un champ comme un humain.
 *
 * Affecter `value` puis emettre `input` ne suffit pas : React memorise la derniere valeur vue et
 * considere qu'elle n'a pas change. Il faut passer par le setter natif du prototype.
 */
function saisir(champ: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set
  setter?.call(champ, valeur)
  champ.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('le bouton Reglages de l accueil', () => {
  it('ouvre un panneau, ferme par defaut', async () => {
    const container = await mount()
    expect(q(container, '[data-testid="home-settings-panel"]')).toBeNull()
    await ouvrir(container)
    expect(q(container, '[data-testid="home-settings-panel"]')).not.toBeNull()
  })

  it('range les commandes de disposition dedans, plus dans la barre', async () => {
    const container = await mount()
    expect(q(container, '[data-testid="home-undo"]')).toBeNull()
    await ouvrir(container)
    const panneau = q<HTMLElement>(container, '[data-testid="home-settings-panel"]')!
    expect(q(panneau, '[data-testid="home-undo"]')).not.toBeNull()
    expect(panneau.textContent).toContain('Disperser')
    expect(panneau.textContent).toContain('Rétablir la disposition')
  })
})

describe('un interrupteur par widget', () => {
  it('eteint une tuile et la rallume a la meme place', async () => {
    const container = await mount()
    const avant = q<HTMLElement>(container, '[data-testid="home-widget-agenda"]')!.style.transform
    await ouvrir(container)
    const interrupteur = q<HTMLInputElement>(
      container,
      '[data-testid="home-widget-switch-agenda"]'
    )!
    expect(interrupteur.getAttribute('role')).toBe('switch')
    await act(async () => interrupteur.click())
    expect(q(container, '[data-testid="home-widget-agenda"]')).toBeNull()
    // Les autres tuiles ne bougent pas : eteindre n'est pas rearranger.
    expect(q(container, '[data-testid="home-widget-mails"]')).not.toBeNull()
    await act(async () => interrupteur.click())
    expect(q<HTMLElement>(container, '[data-testid="home-widget-agenda"]')!.style.transform).toBe(
      avant
    )
  })

  it('retient le reglage d une ouverture a l autre', async () => {
    const premier = await mount()
    await ouvrir(premier)
    await act(async () =>
      q<HTMLInputElement>(premier, '[data-testid="home-widget-switch-routines"]')!.click()
    )
    expect(window.localStorage.getItem(CLE_VISIBILITE_WIDGETS)).toContain('"routines":false')

    const second = await mount()
    expect(q(second, '[data-testid="home-widget-routines"]')).toBeNull()
    expect(q(second, '[data-testid="home-widget-agenda"]')).not.toBeNull()
  })
})

describe('le nom de l assistant', () => {
  it('se choisit dans les reglages et devient le titre de la tuile', async () => {
    const container = await mount()
    expect(
      q<HTMLElement>(container, '[data-testid="home-widget-jarvis"] h2')!.textContent
    ).toBe('Jarvis')
    await ouvrir(container)
    const champ = q<HTMLInputElement>(container, '[data-testid="home-jarvis-nom"]')!
    await act(async () => saisir(champ, 'Alfred'))
    expect(
      q<HTMLElement>(container, '[data-testid="home-widget-jarvis"] h2')!.textContent
    ).toBe('Alfred')
    expect(window.localStorage.getItem(CLE_NOM_JARVIS)).toBe('Alfred')
  })

  it('reprend le nom enregistre a l ouverture suivante', async () => {
    window.localStorage.setItem(CLE_NOM_JARVIS, 'Friday')
    const container = await mount()
    expect(
      q<HTMLElement>(container, '[data-testid="home-widget-jarvis"] h2')!.textContent
    ).toBe('Friday')
  })
})
