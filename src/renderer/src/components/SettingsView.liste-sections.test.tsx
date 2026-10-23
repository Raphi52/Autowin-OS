// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * LES SECTIONS DE SETTINGS EN LISTE À GAUCHE — demande de conv-1109 (2026-10-23) : « dans les
 * settings je veux que les noms des sections soient une liste à gauche des views comme les convs ».
 * Avant : une rangée de pastilles dans la barre du haut (`nav.domain-tabs` de ViewTopBar). Ce fichier
 * verrouille la nouvelle forme : une colonne de sections À GAUCHE du contenu, une ligne par section,
 * comme la liste des conversations du chat — et plus aucune pastille en haut.
 */
vi.mock('./CapabilitiesView', async () => {
  const { createElement } = await import('react')
  return {
    CapabilitiesView: ({ kind }: { kind?: string }) =>
      createElement('div', { 'data-testid': 'capabilities-stub', 'data-kind': kind })
  }
})
vi.mock('./BehaviourView', () => ({ BehaviourView: () => null }))
vi.mock('./ExecutionWorkspaceSettings', () => ({ ExecutionWorkspaceSettings: () => null }))
vi.mock('./BrainSettings', () => ({ BrainSettings: () => null }))
vi.mock('./RouterView', () => ({ RouterView: () => null }))

import { SettingsView } from './SettingsView'
import type { SettingsSection } from '../tabs'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      getPreflight: vi.fn().mockResolvedValue(null),
      recheckPreflight: vi.fn(),
      onPreflight: () => () => {},
      providerStatus: vi.fn().mockResolvedValue([]),
      onAppEvent: vi.fn(() => vi.fn())
    }
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(
  section: SettingsSection,
  onSectionChange: (s: SettingsSection) => void = () => undefined
): Promise<void> {
  await act(async () => {
    root.render(createElement(SettingsView, { active: true, section, onSectionChange }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

const lignes = (): HTMLButtonElement[] => [
  ...container.querySelectorAll<HTMLButtonElement>('nav.settings-nav button')
]

describe('Settings — les sections en liste à gauche', () => {
  it('pose la liste AVANT le contenu, dans le même corps, et plus aucune pastille en haut', async () => {
    await render('behaviour')
    const corps = container.querySelector('.settings-body')
    expect(corps).not.toBeNull()
    const [premier, second] = [...corps!.children]
    expect(premier.matches('nav.settings-nav')).toBe(true)
    expect(second.matches('.domain-content.settings-content')).toBe(true)
    expect(container.querySelector('.view-topbar .domain-tabs')).toBeNull()
  })

  it('une ligne par section, dans l’ordre d’avant', async () => {
    await render('behaviour')
    expect(lignes().map((b) => b.textContent?.trim())).toEqual([
      // « Skills · Hooks · Gates · Mods · Tools » découpé, une section par mot (conv-1109,
      // 2nd tour : « sépare la partie avec 4 mots en 4 views » — le libellé en comptait 5).
      'Skills',
      'Hooks',
      'Gates',
      'Mods',
      'Tools',
      'Behaviour',
      'Interface',
      'Providers',
      'Routage',
      'Rules',
      'Diagnostic'
    ])
  })

  it('la section ouverte est marquée, comme la conversation ouverte', async () => {
    await render('interface')
    const actives = lignes().filter((b) => b.classList.contains('is-active'))
    expect(actives.map((b) => b.textContent?.trim())).toEqual(['Interface'])
    expect(actives[0].getAttribute('aria-current')).toBe('page')
  })

  it.each([
    ['capabilities', 'skills'],
    ['hooks', 'hooks'],
    ['gates', 'gates'],
    ['mods', 'plugins'],
    ['tools', 'tools']
  ] as const)(
    'la section %s ouvre le registre %s seul, sans onglets internes',
    async (section, kind) => {
      await render(section)
      const vue = container.querySelector('[data-testid="capabilities-stub"]')
      expect(vue?.getAttribute('data-kind')).toBe(kind)
    }
  )

  it('cliquer une ligne demande sa section', async () => {
    const onSectionChange = vi.fn()
    await render('behaviour', onSectionChange)
    await act(async () =>
      lignes()
        .find((b) => b.textContent?.trim() === 'Rules')!
        .click()
    )
    expect(onSectionChange).toHaveBeenCalledWith('rules')
  })
})
