// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { appliquerLangue } from '../langue'
import { BehaviourView } from './BehaviourView'
import { CapabilitiesView } from './CapabilitiesView'
import { RouterView } from './RouterView'

/**
 * LES PAGES SKILLS, BEHAVIOUR ET ROUTAGE DE SETTINGS SUIVENT LA LANGUE (traduction anglaise,
 * conv-1170, lot 15). Entrée qui doit faire échouer ce test : un libellé de ces pages laissé en dur
 * en français, ou une page qui ne se redessine pas quand la langue change (retour au français
 * compris, mot pour mot).
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(
  element: React.ReactElement,
  api: Record<string, unknown>
): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => {
    root!.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return hote
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  appliquerLangue('fr')
})

const texteDe = (zone: HTMLElement): string => zone.textContent ?? ''

describe('Settings · Skills — langue', () => {
  it('bascule en anglais sans être remontée, puis revient au français', async () => {
    const zone = await monter(createElement(CapabilitiesView, { active: true, kind: 'skills' }), {
      skills: vi.fn(async () => [
        {
          id: 'build',
          label: 'build',
          description: 'La boucle de réparation',
          enabled: true,
          mutable: false,
          source: 'autowin',
          sourceLabel: 'Autowin'
        }
      ]),
      claudeHooks: vi.fn(async () => []),
      codexHooks: vi.fn(async () => []),
      toolUsage: vi.fn(async () => []),
      capabilityControls: vi.fn(async () => []),
      setCapabilityTool: vi.fn()
    })
    const recherche = (): string | null =>
      zone.querySelector('.cockpit-toolbar input')?.getAttribute('placeholder') ?? null
    // Le surtitre de ModuleHeader n'est pas affiché : la description et le reste de la page le sont.
    expect(recherche()).toBe('Rechercher une capacité…')
    expect(texteDe(zone)).toContain('Les procédures que les agents peuvent suivre dans chaque run.')
    expect(texteDe(zone)).toContain('Inspecteur')

    await act(async () => appliquerLangue('en'))
    expect(recherche()).toBe('Search for a capability…')
    expect(texteDe(zone)).toContain('The procedures the agents can follow in each run.')
    expect(texteDe(zone)).toContain('Inspector')
    expect(texteDe(zone)).toContain('Skills available')
    expect(texteDe(zone)).toContain('1 result')
    expect(texteDe(zone)).toContain('Impact of the change')
    expect(texteDe(zone)).not.toContain('Inspecteur')

    await act(async () => appliquerLangue('fr'))
    expect(recherche()).toBe('Rechercher une capacité…')
    expect(texteDe(zone)).toContain('Skills disponibles')
    expect(texteDe(zone)).toContain('1 résultat')
    expect(texteDe(zone)).toContain('Inspecteur')
  })
})

describe('Settings · Behaviour — langue', () => {
  it('bascule en anglais sans être remontée, puis revient au français', async () => {
    const zone = await monter(createElement(BehaviourView), {
      behaviourComposition: vi.fn(async () => ({
        inspection: { workspace: 'C:\\depot', files: [] },
        cockpit: { systemPrompt: [], retrievedContext: [], turnContext: [], modelSelection: [] },
        orchestrated: {
          systemPrompt: [],
          injectedContext: [],
          modelSelection: [],
          topology: [],
          regime: [],
          guardrails: []
        },
        direct: { systemPrompt: [], modelSelection: [] }
      })),
      chooseBehaviourWorkspace: vi.fn(async () => undefined)
    })
    expect(texteDe(zone)).toContain('Choisir un workspace')
    expect(texteDe(zone)).toContain('Contexte du tour')

    await act(async () => appliquerLangue('en'))
    expect(texteDe(zone)).toContain('Configure what influences the Chat’s answers and decisions.')
    expect(texteDe(zone)).toContain('Choose a workspace')
    expect(texteDe(zone)).toContain('Orchestrated')
    expect(texteDe(zone)).toContain('Turn context')
    expect(texteDe(zone)).toContain('No instruction file found in this workspace.')
    expect(texteDe(zone)).not.toContain('Choisir un workspace')

    await act(async () => appliquerLangue('fr'))
    expect(texteDe(zone)).toContain('Choisir un workspace')
    expect(texteDe(zone)).toContain('Orchestré')
    expect(texteDe(zone)).toContain('Aucun fichier d’instructions découvert dans ce workspace.')
  })
})

describe('Settings · Routage — langue', () => {
  it('bascule en anglais sans être remontée, puis revient au français', async () => {
    const zone = await monter(createElement(RouterView, {}), {
      models: async () => [],
      providerStatus: async () => [{ provider: 'kimi', status: 'absent', testable: true }],
      roles: async () => ({}),
      providerTest: vi.fn(),
      onAppEvent: vi.fn(() => () => undefined),
      setRole: vi.fn()
    })
    expect(zone.querySelector('h1')?.textContent).toBe('Routeur')
    expect(texteDe(zone)).toContain('Modèle par défaut du chat')

    await act(async () => appliquerLangue('en'))
    expect(zone.querySelector('h1')?.textContent).toBe('Router')
    expect(texteDe(zone)).toContain('Chat default model')
    expect(texteDe(zone)).toContain('Not connected')
    expect(texteDe(zone)).toContain('Sign in again')
    expect(texteDe(zone)).toContain('Put on standby')
    expect(texteDe(zone)).toContain('No model listed for this provider.')
    expect(texteDe(zone)).not.toContain('Modèle par défaut du chat')

    await act(async () => appliquerLangue('fr'))
    expect(zone.querySelector('h1')?.textContent).toBe('Routeur')
    expect(texteDe(zone)).toContain('Se reconnecter')
    expect(texteDe(zone)).toContain('Aucun modèle listé pour ce provider.')
  })
})
