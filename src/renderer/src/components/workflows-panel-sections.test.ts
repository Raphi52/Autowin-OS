import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_PANEL_SECTIONS,
  sectionUsesScope,
  visibleScopedRuns,
  type WorkflowPanelSection
} from './workflows-panel-sections'
import type { ScopedLiveRun } from './chat-view-model'

/**
 * Demande de l'utilisateur, mot pour mot : « il faut une section sous agents une section run et une
 * section source control ». Le panneau n'en avait que deux, et la première mélangeait le fil des
 * sous-agents avec la liste des RUN.md.
 */
describe('les trois sections du panneau Workflows', () => {
  it('expose EXACTEMENT les trois sections demandées, dans cet ordre', () => {
    expect(WORKFLOW_PANEL_SECTIONS.map((s) => s.id)).toEqual(['subagents', 'run', 'source-control'])
    expect(WORKFLOW_PANEL_SECTIONS.map((s) => s.label)).toEqual([
      'Sous-agents',
      'Run',
      'Source control'
    ])
  })

  it('la portée gouverne les sous-agents et les runs, jamais Source control', () => {
    expect(sectionUsesScope('subagents')).toBe(true)
    expect(sectionUsesScope('run')).toBe(true)
    expect(sectionUsesScope('source-control')).toBe(false)
  })
})

const run = (status: ScopedLiveRun<string>['status']): ScopedLiveRun<string> => ({
  convId: 'conv-a',
  runPath: 'run-a',
  task: 'audit',
  steps: ['worker A'],
  status
})

describe('sélection des fils de sous-agents', () => {
  it('un run TERMINÉ reste visible — le défaut d’origine', () => {
    // C'est fini qu'on veut relire le fil : il est la preuve de ce qui a été fait.
    for (const status of ['green', 'red'] as const) {
      const visibles = visibleScopedRuns({ 'conv-a': run(status) }, 'conv-a', 'conv')
      expect(visibles).toHaveLength(1)
      expect(visibles[0]?.[1].steps).toEqual(['worker A'])
    }
  })

  it('un run EN COURS est visible aussi — la sélection ne filtre pas sur le statut', () => {
    expect(visibleScopedRuns({ 'conv-a': run('running') }, 'conv-a', 'conv')).toHaveLength(1)
  })

  it('portée « cette conversation » : les fils des AUTRES conversations sont écartés', () => {
    const liveRuns = { 'conv-a': run('green'), 'conv-b': run('running') }
    expect(visibleScopedRuns(liveRuns, 'conv-a', 'conv').map(([id]) => id)).toEqual(['conv-a'])
  })

  it('portée « tous » : toutes les conversations remontent', () => {
    const liveRuns = { 'conv-a': run('green'), 'conv-b': run('running') }
    expect(visibleScopedRuns(liveRuns, 'conv-a', 'tous')).toHaveLength(2)
  })

  it('sans conversation active en portée « cette conversation », rien ne remonte', () => {
    expect(visibleScopedRuns({ 'conv-a': run('green') }, undefined, 'conv')).toEqual([])
  })
})

/**
 * CÂBLAGE — le modèle ci-dessus ne sert à rien s'il n'est pas celui que le panneau utilise. Ces
 * assertions gardent le raccordement ; le COMPORTEMENT, lui, est testé sur les sorties au-dessus.
 */
describe('câblage du panneau', () => {
  const chatView = (): string => readFileSync(join(__dirname, 'ChatView.tsx'), 'utf8')

  it('le panneau consomme le modèle de sections et la sélection extraite', () => {
    const source = chatView()
    expect(source).toContain('WORKFLOW_PANEL_SECTIONS')
    expect(source).toContain('visibleScopedRuns')
  })

  it('plus aucun code ne détruit un run terminé après un délai', () => {
    // Le défaut exact : à l'événement `orchestrate-end`, une minuterie différée dispatchait l'événement
    // d'effacement vers le réducteur, qui supprimait l'entrée et ses steps.
    expect(chatView()).not.toMatch(/type: 'clear'/)
  })

  it('Source control réutilise le composant existant au lieu d’être réécrit', () => {
    expect(chatView()).toContain('<SourceControlPane')
  })
})

// Garde de typage : la section par défaut doit rester une section RÉELLE.
const defaultSection: WorkflowPanelSection = 'subagents'
describe('section par défaut', () => {
  it('est Sous-agents — c’est ce qu’on regarde pendant une orchestration', () => {
    expect(WORKFLOW_PANEL_SECTIONS[0]?.id).toBe(defaultSection)
  })
})
