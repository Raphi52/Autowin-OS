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

/**
 * Le panneau est OUVERT au montage (choix du 2026-09-01) : le bouton ne fait donc que BASCULER.
 * Les tests qui veulent le panneau n'ont plus rien a cliquer -- ils le trouvent deja la.
 */
async function basculerReglages(c: HTMLDivElement): Promise<void> {
  const bouton = q<HTMLButtonElement>(c, '[data-testid="home-settings"]')!
  await act(async () => bouton.click())
}

/**
 * Ouvre le panneau S'IL est ferme.
 *
 * Volontairement idempotent : l'etat initial du panneau est un choix d'affichage qui peut changer,
 * et un test sur les interrupteurs n'a pas a en dependre.
 */
async function ouvrirReglages(c: HTMLDivElement): Promise<void> {
  if (q(c, '[data-testid="home-settings-panel"]') === null) await basculerReglages(c)
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
  it('est OUVERT au montage', async () => {
    // CHOIX DU 2026-09-01, demande de l'utilisateur : les reglages de l'accueil (tuiles affichees,
    // nom de l'assistant, disposition) sont ce qu'on vient regler en arrivant. Les cacher derriere
    // un clic obligeait a le rouvrir a chaque ouverture de l'accueil.
    const container = await mount()
    expect(q(container, '[data-testid="home-settings-panel"]')).not.toBeNull()
  })

  it('ouvre et referme le panneau au clic', async () => {
    const container = await mount()
    await ouvrirReglages(container)
    expect(q(container, '[data-testid="home-settings-panel"]')).not.toBeNull()
    await basculerReglages(container)
    expect(q(container, '[data-testid="home-settings-panel"]')).toBeNull()
    await basculerReglages(container)
    expect(q(container, '[data-testid="home-settings-panel"]')).not.toBeNull()
  })

  it('range les commandes de disposition dedans, plus dans la barre', async () => {
    const container = await mount()
    await ouvrirReglages(container)
    const panneau = q<HTMLElement>(container, '[data-testid="home-settings-panel"]')!
    const undo = q<HTMLElement>(container, '[data-testid="home-undo"]')!
    // La commande existe UNE seule fois, et elle est DANS le panneau : c'est ce qui prouve qu'elle
    // n'est plus dans la barre.
    expect(container.querySelectorAll('[data-testid="home-undo"]')).toHaveLength(1)
    expect(panneau.contains(undo)).toBe(true)
    expect(panneau.textContent).toContain('Disperser')
    expect(panneau.textContent).toContain('Rétablir la disposition')
    // Referme : la commande part avec le panneau, elle n'a pas de double dans la barre.
    await basculerReglages(container)
    expect(q(container, '[data-testid="home-undo"]')).toBeNull()
  })
})

describe('un interrupteur par widget', () => {
  it('eteint une tuile et la rallume a la meme place', async () => {
    const container = await mount()
    const avant = q<HTMLElement>(container, '[data-testid="home-widget-agenda"]')!.style.transform
    await ouvrirReglages(container)
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
    await ouvrirReglages(premier)
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
    await ouvrirReglages(container)
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

describe('relire Outlook se commande depuis la tuile Outlook', () => {
  it('vit DANS l etiquette des interlocuteurs, plus dans la barre du haut', async () => {
    const container = await mount()
    const bouton = q<HTMLButtonElement>(container, '[data-testid="home-refresh-outlook"]')!
    expect(bouton).not.toBeNull()
    // La preuve qui compte : son ancetre est la tuile des mails, pas l'en-tete de la page.
    expect(bouton.closest('[data-testid="home-widget-mails"]')).not.toBeNull()
    expect(bouton.closest('.home-view__header')).toBeNull()
  })

  it('ne prend pas la tuile en main quand on le clique', async () => {
    // La tuile se saisit N'IMPORTE OU : sans arret de la propagation, cliquer le bouton amorcerait
    // un deplacement.
    const container = await mount()
    const bouton = q<HTMLButtonElement>(container, '[data-testid="home-refresh-outlook"]')!
    await act(async () => bouton.click())
    expect(q<HTMLElement>(container, '[data-testid="home-widget-mails"]')!.dataset.held).toBeUndefined()
  })
})
