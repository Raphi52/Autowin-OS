// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentStudioView } from './AgentStudioView'
import { appliquerLangue } from '../langue'

/**
 * AGENT STUDIO SUIT LA LANGUE (traduction anglaise, lot « Agent Studio », conv-1170). Entrée qui
 * doit faire échouer ce test : un libellé de l'en-tête, de la topologie ou des workflows laissé en
 * dur, une phrase calculée hors composant (résumé d'un profil, mesures d'arène) qui ne suit pas la
 * langue, ou un écran qui ne se redessine pas quand la langue change.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const modeles = [
  {
    id: 'gpt',
    provider: 'openai',
    model: 'gpt',
    label: 'GPT',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium'
  }
]

const topologie = {
  version: 1,
  orchestrator: {
    slotId: 'orchestrator',
    provider: 'openai',
    modelId: 'gpt',
    reasoningEffort: 'medium'
  },
  subagents: [],
  panels: { scout: [], frame: [], terrain: [], judge: [] }
}

const profils = {
  activeId: null,
  profiles: [{ id: 'p1', name: 'Rapide', phases: ['build'], allocation: { judgeMembers: 2 } }]
}

let hote: HTMLDivElement
let root: Root

beforeEach(() => {
  const connu: Record<string, unknown> = {
    models: vi.fn().mockResolvedValue(modeles),
    topology: vi.fn().mockResolvedValue(topologie),
    profiles: vi.fn().mockResolvedValue([]),
    workflowProfiles: vi.fn().mockResolvedValue(profils),
    arenaDuelsParWorkflow: vi.fn().mockResolvedValue({}),
    workflowResultatsReels: vi.fn().mockResolvedValue({}),
    onAppEvent: vi.fn(() => vi.fn())
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: new Proxy(connu, {
      get: (cible, propriete: string) =>
        cible[propriete] ?? (cible[propriete] = vi.fn().mockResolvedValue([]))
    })
  })
  hote = document.createElement('div')
  document.body.append(hote)
  root = createRoot(hote)
})

afterEach(async () => {
  await act(async () => root.unmount())
  hote.remove()
  appliquerLangue('fr')
})

async function monter(section: 'topology' | 'workflows'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(AgentStudioView, { active: true, section, onSectionChange: () => undefined })
    )
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

const texte = (): string => hote.textContent ?? ''
const onglets = (): string[] =>
  [...hote.querySelectorAll('.domain-tabs button')].map((b) => b.textContent?.trim() ?? '')

describe('Agent Studio — langue', () => {
  it('section Workflows : bascule en anglais sans être remontée, puis revient au français', async () => {
    await monter('workflows')
    expect(texte()).toContain(
      'Quels modèles jouent quels rôles, et quels workflows les enchaînent.'
    )
    expect(onglets()).toContain('Modèles & topologie')
    expect(texte()).toContain('Tout exporter')
    expect(texte()).toContain('Arène : aucune mesure enregistrée')
    expect(texte()).toContain('build · 2 juge(s)')

    await act(async () => appliquerLangue('en'))
    expect(texte()).toContain('Which models play which roles, and which workflows chain them.')
    expect(onglets()).toContain('Models & topology')
    expect(texte()).toContain('A named way of working — models, efforts, phases, instructions.')
    expect(texte()).toContain('Export all')
    expect(texte()).toContain('Import')
    expect(texte()).toContain('Edit')
    expect(texte()).toContain('Arena: no measurement recorded')
    expect(texte()).toContain('Real usage: no run recorded under this name')
    expect(texte()).toContain('build · 2 judge(s)')
    expect(hote.querySelector('[data-testid="workflow-edit-p1"]')?.getAttribute('aria-label')).toBe(
      'Open the editor of Rapide'
    )

    await act(async () => appliquerLangue('fr'))
    expect(texte()).toContain(
      'Quels modèles jouent quels rôles, et quels workflows les enchaînent.'
    )
    expect(texte()).toContain('Tout exporter')
    expect(texte()).toContain('Éditer')
  })

  it('section Modèles : la topologie parle anglais, puis revient au français', async () => {
    appliquerLangue('en')
    await monter('topology')
    // Le surtitre du ModuleHeader n'est pas affiché : on lit sa description.
    expect(texte()).toContain('Assign models to roles and check their availability.')
    expect(texte()).toContain('Orchestrator')
    expect(texte()).toContain('A single model drives and consolidates.')
    expect(texte()).toContain('Imported models')
    expect(texte()).toContain('Drop a model here')
    expect(texte()).toContain('Current runtime')
    expect(
      hote.querySelector('[data-testid="topology-profile-select"]')?.getAttribute('aria-label')
    ).toBe('Apply a profile')

    await act(async () => appliquerLangue('fr'))
    expect(texte()).toContain('Assigne les modèles aux rôles et contrôle leur disponibilité.')
    expect(texte()).toContain('Un seul modèle pilote et consolide.')
    expect(texte()).toContain('Glissez un modèle ici')
  })
})
