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

  const ongletActif = (): string | null | undefined =>
    liste()!.querySelector('[role="tab"][aria-selected="true"]')?.textContent

  const touche = async (key: string): Promise<void> => {
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
  }

  it('ouvre sous sa barre la grille du chat : un onglet par fournisseur, des points', async () => {
    const { barre } = await monter()
    expect(barre.textContent).toContain('Opus 5.5')
    expect(barre.getAttribute('aria-expanded')).toBe('false')
    expect(liste()).toBeNull()

    await act(async () => barre.click())

    expect(barre.getAttribute('aria-expanded')).toBe('true')
    // Soudée à la barre : même parent, juste après elle — pas de fenêtre flottante dans la page.
    expect(liste()?.previousElementSibling).toBe(barre)
    expect(liste()!.querySelector('[data-testid="effort-matrix"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-testid="effort-matrix"]')).toHaveLength(1)
    // Les onglets du chat, l'onglet du modèle choisi ouvert.
    const onglets = [...liste()!.querySelectorAll('[role="tab"]')].map((el) => el.textContent)
    expect(onglets).toEqual(['Claude', 'ChatGPT', 'Grok'])
    expect(ongletActif()).toBe('Claude')
    // Le modèle choisi et son point cochés.
    expect(liste()!.querySelector('.effort-matrix-row.is-active')?.getAttribute('data-row')).toBe(
      'claude:claude-opus-5-5'
    )
    expect(liste()!.querySelector('[aria-checked="true"]')?.getAttribute('data-effort')).toBe('low')
  })

  it('la grille porte la classe de la fenêtre du chat, pour en prendre l’habillage du thème', async () => {
    const { barre } = await monter()
    await act(async () => barre.click())
    const grille = liste()!.querySelector('.model-select-menu')
    expect(grille?.classList.contains('modele-deroulant-grille')).toBe(true)
    expect(grille?.querySelector('[data-testid="effort-matrix"]')).not.toBeNull()
  })

  it('un point choisit le modèle à cet effort et referme la liste', async () => {
    const { barre, onSelect } = await monter()
    await act(async () => barre.click())
    await act(async () =>
      liste()!
        .querySelector<HTMLButtonElement>('[data-testid="effort-matrix-onglet-codex"]')!
        .click()
    )
    const point = liste()!.querySelector<HTMLButtonElement>(
      '[data-row="codex:gpt-5.6"] [data-effort="xhigh"]'
    )!
    await act(async () => point.click())
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'codex', model: 'gpt-5.6', reasoningEffort: 'xhigh' })
    )
    expect(liste()).toBeNull()
  })

  it('un modèle sans niveau de réflexion garde un point unique « Standard »', async () => {
    const { barre, onSelect } = await monter()
    await act(async () => barre.click())
    await act(async () =>
      liste()!
        .querySelector<HTMLButtonElement>('[data-testid="effort-matrix-onglet-grok"]')!
        .click()
    )
    const points = liste()!.querySelectorAll<HTMLButtonElement>('[data-row="grok:grok-4"] button')
    expect(points).toHaveLength(1)
    expect(points[0].getAttribute('data-effort')).toBe('none')
    expect(points[0].textContent).toBe('Standard')
    await act(async () => points[0].click())
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'grok-4', reasoningEffort: 'none' })
    )
  })

  it('refuse un fournisseur injoignable au moment du choix', async () => {
    const { barre, onSelect } = await monter({
      statuses: [{ provider: 'codex', status: 'expired' }]
    })
    await act(async () => barre.click())
    await act(async () =>
      liste()!
        .querySelector<HTMLButtonElement>('[data-testid="effort-matrix-onglet-codex"]')!
        .click()
    )
    const ligne = liste()!.querySelector('[data-row="codex:gpt-5.6"]')!
    expect(ligne.classList.contains('is-blocked')).toBe(true)
    const point = ligne.querySelector<HTMLButtonElement>('[data-effort="low"]')!
    expect(point.title).toContain('Expiré')
    await act(async () => point.click())
    expect(onSelect).not.toHaveBeenCalled()
    expect(liste()).not.toBeNull()
  })

  it('se referme sur Échap (focus rendu à la barre) et au clic dehors', async () => {
    const { barre } = await monter()
    await act(async () => barre.click())
    // À l'ouverture, le point du modèle choisi prend le focus.
    expect(document.activeElement?.getAttribute('data-effort')).toBe('low')
    expect(document.activeElement?.closest('[data-row]')?.getAttribute('data-row')).toBe(
      'claude:claude-opus-5-5'
    )
    await touche('Escape')
    expect(liste()).toBeNull()
    expect(document.activeElement).toBe(barre)

    await act(async () => barre.click())
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(liste()).toBeNull()
  })

  it('les flèches parcourent la grille : un point à droite, le même effort en dessous', async () => {
    const { barre } = await monter()
    await act(async () => barre.click())
    // Départ : Opus, low. Droite → Opus, medium.
    await touche('ArrowRight')
    expect(document.activeElement?.getAttribute('data-effort')).toBe('medium')
    // Bas → Haiku n'a pas medium : la flèche tombe sur le dernier point de sa ligne.
    await touche('ArrowDown')
    expect(document.activeElement?.closest('[data-row]')?.getAttribute('data-row')).toBe(
      'claude:claude-haiku-5-5'
    )
    // Haut, deux fois → au-dessus de la première ligne, l'onglet ouvert.
    await touche('ArrowUp')
    await touche('ArrowUp')
    expect(document.activeElement?.getAttribute('role')).toBe('tab')
    // Droite sur un onglet → l'onglet voisin.
    await touche('ArrowRight')
    expect(document.activeElement?.textContent).toBe('ChatGPT')
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
