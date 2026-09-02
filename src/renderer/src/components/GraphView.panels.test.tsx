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
