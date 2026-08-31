// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeView } from './HomeView'
import {
  marquerConversationEnAttente,
  retirerConversationEnAttente,
  viderConversationsEnAttente
} from './conversations-attention'

/**
 * L'ACCUEIL montre les conversations en attente. Le hublot (une horloge posee sur le decor) ne
 * servait a rien : il est remplace par la liste CLICKABLE des conversations dont la fenetre est en
 * etat « cadre dore / pastille jaune ».
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

beforeEach(() => {
  ;(window as unknown as { innerWidth: number }).innerWidth = 1440
  ;(window as unknown as { innerHeight: number }).innerHeight = 900
  ;(window as unknown as { api: unknown }).api = {
    taskManagerSnapshot: vi.fn(async () => ({ tasks: [], alerts: [] })),
    outlookSnapshot: vi.fn(async () => ({ ok: true, mails: [], evenements: [] }))
  }
  viderConversationsEnAttente()
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  window.localStorage.clear()
  viderConversationsEnAttente()
})

async function mount(onNavigate?: (d: string) => void): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(createElement(HomeView, { active: true, onNavigate }))
  })
  return container
}

const tuile = (c: HTMLDivElement): HTMLElement =>
  c.querySelector('[data-testid="home-widget-conversations"]') as HTMLElement

describe('accueil — widget conversations', () => {
  it('remplace le hublot : aucune tuile hublot ne subsiste', async () => {
    const c = await mount()
    expect(c.querySelector('[data-testid="home-widget-hublot"]')).toBeNull()
    expect(tuile(c)).not.toBeNull()
  })

  it('incremente la liste quand une fenetre passe en attention, et la decremente au retour', async () => {
    const c = await mount()
    expect(tuile(c).textContent).toContain('Aucune conversation')
    await act(async () => marquerConversationEnAttente('conv-1577', 'Widget conversations'))
    await act(async () => marquerConversationEnAttente('conv-9', 'Baseline'))
    const items = tuile(c).querySelectorAll('[data-testid="home-conversation"]')
    expect(items).toHaveLength(2)
    expect(tuile(c).textContent).toContain('Widget conversations')
    /**
     * L'entree qui ferait echouer ce test si le retrait etait faux : `conv-9`, NON retiree, doit
     * rester affichee. Un widget qui viderait toute la liste au retour d'une seule conversation
     * passerait un simple « conv-1577 absent » et echouerait ici.
     */
    await act(async () => retirerConversationEnAttente('conv-1577'))
    const restants = tuile(c).querySelectorAll('[data-testid="home-conversation"]')
    expect(restants).toHaveLength(1)
    expect(restants[0].textContent).toContain('Baseline')
  })

  it('un clic ouvre LA conversation cliquee et bascule sur le chat', async () => {
    const navigations: string[] = []
    const ouvertes: unknown[] = []
    const ecoute = (e: Event): void => {
      ouvertes.push((e as CustomEvent).detail)
    }
    window.addEventListener('autowin:open-conversation', ecoute)
    const c = await mount((d) => navigations.push(d))
    await act(async () => marquerConversationEnAttente('conv-1577', 'Widget conversations'))
    await act(async () => marquerConversationEnAttente('conv-9', 'Baseline'))
    const cible = tuile(c).querySelectorAll(
      '[data-testid="home-conversation"]'
    )[1] as HTMLButtonElement
    await act(async () => cible.click())
    window.removeEventListener('autowin:open-conversation', ecoute)
    expect(ouvertes).toEqual(['conv-9'])
    expect(navigations).toEqual(['chat'])
    // Ouvrir = revenir dessus : elle sort de la liste, l'autre reste.
    const restants = tuile(c).querySelectorAll('[data-testid="home-conversation"]')
    expect(restants).toHaveLength(1)
    expect(restants[0].textContent).toContain('Widget conversations')
  })

  it("affiche le compte en pastille sur l'etiquette de la tuile", async () => {
    const c = await mount()
    await act(async () => marquerConversationEnAttente('conv-1577', 'Widget conversations'))
    expect(tuile(c).querySelector('.home-tile__count')?.textContent).toBe('1')
  })
})
