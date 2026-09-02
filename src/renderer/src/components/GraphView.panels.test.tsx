// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NodePanel } from './GraphView.panels'

describe('NodePanel — curation canonique', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => document.body.replaceChildren())

  it('rend le retrait explicite et appelle exactement son action', async () => {
    const onRetract = vi.fn()
    const onSupersede = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(NodePanel, {
          node: { id: 'knowledge/domain/autowin-os-a', label: 'Leçon A', group: 0 },
          file: { path: 'a.md', content: '# A' },
          fileErr: '',
          linkedNodes: [],
          onNavigate: vi.fn(),
          onRetract,
          onSupersede
        })
      )
    })
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Retirer du Brain canonique')
    ) as HTMLButtonElement
    expect(button).toBeTruthy()
    await act(async () => button.click())
    expect(onRetract).toHaveBeenCalledTimes(1)
    const supersede = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Remplacer par une autre fiche')
    ) as HTMLButtonElement
    await act(async () => supersede.click())
    expect(onSupersede).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })
  it('rend le détail du nœud : identité, scores et relations déclarées', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(NodePanel, {
          node: {
            id: 'knowledge/domain/autowin-os-b',
            label: 'Leçon B',
            group: 2,
            themes: ['domain'],
            denseScore: 0.42,
            fusedScore: 0.9,
            relations: [{ type: 'supersedes', target: 'knowledge/domain/autowin-os-a' }]
          },
          file: { path: 'b.md', content: '# B' },
          fileErr: '',
          linkedNodes: [],
          onNavigate: vi.fn()
        })
      )
    })
    const detail = container.querySelector('[data-testid="node-panel-details"]') as HTMLDetailsElement
    expect(detail).toBeTruthy()
    await act(async () => {
      detail.open = true
    })
    expect(detail.textContent).toContain('knowledge/domain/autowin-os-b')
    expect(detail.textContent).toContain('dense 0,420')
    expect(detail.textContent).toContain('supersedes')
    expect(detail.textContent).toContain('knowledge/domain/autowin-os-a')
    const cles = [...detail.querySelectorAll('.human-json__key')].map((noeud) => noeud.textContent)
    expect(cles).toContain('group')
    await act(async () => root.unmount())
  })
})

describe('NodePanel — profondeur de lecture', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => document.body.replaceChildren())

  async function rendre(props: Record<string, unknown>): Promise<HTMLDivElement> {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(NodePanel, {
          node: { id: 'knowledge/a', label: 'Fiche A', group: 0, file: 'brain/a.md' },
          file: { path: 'a.md', content: '# A' },
          fileErr: '',
          linkedNodes: [],
          onNavigate: vi.fn(),
          ...props
        } as never)
      )
    })
    return container
  }

  it('montre le degré du nœud — combien de liens entrent, combien sortent', async () => {
    const container = await rendre({ degre: { entrants: 3, sortants: 5 } })
    expect(container.querySelector('.node-links__degre')?.textContent).toContain('3')
    expect(container.querySelector('.node-links__degre')?.textContent).toContain('5')
  })

  it('propose le voisinage à 2 sauts et navigue vers le nœud atteint', async () => {
    const onNavigate = vi.fn()
    const loin = { id: 'knowledge/c', label: 'Fiche C', group: 0 }
    const container = await rendre({
      onNavigate,
      deuxiemeSaut: [{ node: loin, via: { id: 'knowledge/b', label: 'Fiche B', group: 0 } }]
    })
    const bloc = container.querySelector('[data-testid="node-second-hop"]')
    expect(bloc?.textContent).toContain('Fiche C')
    expect(bloc?.textContent).toContain('via Fiche B')
    const bouton = bloc?.querySelector('button') as HTMLButtonElement
    await act(async () => bouton.click())
    expect(onNavigate).toHaveBeenCalledWith(loin)
  })

  it('filtre les liens par relation dès que plusieurs relations coexistent', async () => {
    const container = await rendre({
      linkedNodes: [
        {
          node: { id: 'b', label: 'Cité B', group: 0 },
          direction: 'outgoing' as const,
          relation: 'cite'
        },
        {
          node: { id: 'c', label: 'Contredit C', group: 0 },
          direction: 'incoming' as const,
          relation: 'contredit'
        }
      ]
    })
    const select = container.querySelector('.node-links__relation') as HTMLSelectElement
    expect(select).toBeTruthy()
    await act(async () => {
      select.value = 'cite'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const nav = container.querySelector('.node-links') as HTMLElement
    expect(nav.textContent).toContain('Cité B')
    expect(nav.textContent).not.toContain('Contredit C')
  })

  it('rend le chemin du fichier copiable', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const container = await rendre({})
    const bouton = container.querySelector('.node-panel__copier') as HTMLButtonElement
    await act(async () => bouton.click())
    expect(writeText).toHaveBeenCalledWith('brain/a.md')
  })
})
