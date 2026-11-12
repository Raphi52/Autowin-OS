// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ModeleDeroulant, type ProprietesMenuDeModele } from './ModeleDeroulant'

/*
 * LE MENU DÉROULANT D'AGENT STUDIO — un vrai menu déroulant, pas la fenêtre du chat : la liste se
 * monte DANS le composant, juste sous sa barre (et donc de sa largeur), jamais dans un portail
 * vers `document.body` ; ni onglets de fournisseur, ni grille modèle × effort.
 */
const MODELES: ProprietesMenuDeModele['models'] = [
  {
    id: 'claude-opus',
    provider: 'claude',
    model: 'claude-opus-5-5',
    label: 'Opus 5.5',
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'claude-haiku',
    provider: 'claude',
    model: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    reasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: 'high'
  },
  {
    id: 'codex-gpt',
    provider: 'codex',
    model: 'gpt-5.6',
    label: 'GPT-5.6',
    reasoningEfforts: ['low', 'xhigh'],
    defaultReasoningEffort: 'low'
  },
  {
    id: 'grok-4',
    provider: 'grok',
    model: 'grok-4',
    label: 'Grok 4',
    reasoningEfforts: ['none']
  }
]

describe('ModeleDeroulant', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  async function monter(
    props: Partial<ProprietesMenuDeModele> = {}
  ): Promise<{ onSelect: ReturnType<typeof vi.fn>; barre: HTMLButtonElement }> {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const onSelect = vi.fn()
    await act(async () => {
      root?.render(
        createElement(ModeleDeroulant, {
          busy: false,
          catalogLoaded: true,
          models: MODELES,
          binding: { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'low' },
          pending: false,
          error: null,
          onSelect,
          idBase: 'menu',
          libelle: 'Orchestrateur',
          ...props
        })
      )
    })
    const barre = host.querySelector<HTMLButtonElement>('button[data-testid="menu"]')!
    return { onSelect, barre }
  }

  const liste = (): HTMLElement | null =>
    host!.querySelector<HTMLElement>('[data-testid="menu-liste"]')

  it('ouvre la liste sous sa barre, dans le composant, sans la fenêtre du chat', async () => {
    const { barre } = await monter()
    expect(barre.textContent).toContain('Opus 5.5')
    expect(barre.getAttribute('aria-expanded')).toBe('false')
    expect(liste()).toBeNull()

    await act(async () => barre.click())

    expect(barre.getAttribute('aria-expanded')).toBe('true')
    // Soudée à la barre : même parent, juste après elle.
    expect(liste()?.previousElementSibling).toBe(barre)
    expect(document.body.querySelector('[data-testid="effort-matrix"]')).toBeNull()
    expect(document.body.querySelector('[role="tablist"]')).toBeNull()
    // Groupés par fournisseur, avec leur nom affiché.
    const fournisseurs = [...liste()!.querySelectorAll('.modele-deroulant-fournisseur')].map(
      (el) => el.textContent
    )
    expect(fournisseurs).toEqual(['Claude', 'ChatGPT', 'Grok'])
    // Le modèle choisi est marqué, et son effort coché.
    const active = liste()!.querySelector('.modele-deroulant-ligne.is-active')
    expect(active?.getAttribute('data-row')).toBe('claude:claude-opus-5-5')
    expect(liste()!.querySelector('[aria-checked="true"]')?.getAttribute('data-effort')).toBe('low')
  })

  it('aligne les pastilles en colonnes : un cran absent garde sa place', async () => {
    const { barre } = await monter()
    await act(async () => barre.click())
    const haiku = liste()!.querySelector('[data-row="claude:claude-haiku-5-5"]')!
    // Colonnes du groupe Claude : low, medium, high, max — Haiku n'en a que deux.
    expect(haiku.querySelectorAll('.modele-deroulant-cran')).toHaveLength(4)
    expect(haiku.querySelectorAll('button[data-effort]')).toHaveLength(2)
    expect(haiku.querySelectorAll('.modele-deroulant-cran.is-absent')).toHaveLength(2)
  })

  it('une pastille choisit le modèle à cet effort et referme la liste', async () => {
    const { barre, onSelect } = await monter()
    await act(async () => barre.click())
    const cran = liste()!.querySelector<HTMLButtonElement>(
      '[data-row="codex:gpt-5.6"] [data-effort="xhigh"]'
    )!
    await act(async () => cran.click())
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'codex', model: 'gpt-5.6', reasoningEffort: 'xhigh' })
    )
    expect(liste()).toBeNull()
  })

  it('le nom choisit le modèle à son effort retenu ; sans effort, à « none »', async () => {
    const { barre, onSelect } = await monter()
    await act(async () => barre.click())
    // Haiku n'est pas le modèle choisi : il prend l'effort de son catalogue.
    await act(async () =>
      liste()!
        .querySelector<HTMLButtonElement>(
          '[data-row="claude:claude-haiku-5-5"] .modele-deroulant-nom'
        )!
        .click()
    )
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'claude-haiku-5-5', reasoningEffort: 'high' })
    )

    await act(async () => barre.click())
    await act(async () =>
      liste()!
        .querySelector<HTMLButtonElement>('[data-row="grok:grok-4"] .modele-deroulant-nom')!
        .click()
    )
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'grok-4', reasoningEffort: 'none' })
    )
  })

  it('refuse un fournisseur injoignable au moment du choix', async () => {
    const { barre, onSelect } = await monter({
      statuses: [{ provider: 'codex', status: 'expired' }]
    })
    await act(async () => barre.click())
    const ligne = liste()!.querySelector('[data-row="codex:gpt-5.6"]')!
    expect(ligne.classList.contains('is-bloquee')).toBe(true)
    expect(ligne.textContent).toContain('Expiré')
    await act(async () => ligne.querySelector<HTMLButtonElement>('[data-effort="low"]')!.click())
    expect(onSelect).not.toHaveBeenCalled()
    expect(liste()).not.toBeNull()
  })

  it('se referme sur Échap (focus rendu à la barre) et au clic dehors', async () => {
    const { barre } = await monter()
    await act(async () => barre.click())
    // À l'ouverture, le modèle choisi prend le focus.
    expect(document.activeElement?.closest('[data-row]')?.getAttribute('data-row')).toBe(
      'claude:claude-opus-5-5'
    )
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(liste()).toBeNull()
    expect(document.activeElement).toBe(barre)

    await act(async () => barre.click())
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(liste()).toBeNull()
  })

  it('les flèches passent d’un bouton de la liste au suivant', async () => {
    const { barre } = await monter()
    await act(async () => barre.click())
    const boutons = [...liste()!.querySelectorAll<HTMLButtonElement>('button')]
    const depart = boutons.indexOf(document.activeElement as HTMLButtonElement)
    expect(depart).toBeGreaterThanOrEqual(0)
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      )
    })
    expect(document.activeElement).toBe(boutons[depart + 1])
  })

  it('pendant un enregistrement, la barre tourne mais reste ouvrable', async () => {
    const { barre } = await monter({ pending: true })
    expect(barre.disabled).toBe(false)
    expect(barre.getAttribute('aria-busy')).toBe('true')
    expect(host!.querySelector('[role="status"]')?.textContent).toBe('Enregistrement…')
    await act(async () => barre.click())
    expect(liste()).not.toBeNull()
  })

  it('catalogue vide : barre fermée et état lisible', async () => {
    const { barre } = await monter({ models: [] })
    expect(barre.disabled).toBe(true)
    expect(host!.querySelector('[role="status"]')?.textContent).toBe('Catalogue de modèles vide.')
  })
})
