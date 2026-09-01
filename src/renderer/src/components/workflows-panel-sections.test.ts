import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { visibleScopedRuns } from './workflows-panel-sections'
import type { ScopedLiveRun } from './chat-view-model'

/**
 * LES QUATRE SECTIONS N’EXISTENT PLUS.
 *
 * Elles exposaient quatre projections de la MÊME exécution. Le graphe est devenu la navigation du
 * panneau ; le modèle de sections a été retiré avec elles. Ce test garde la suppression : un
 * `WORKFLOW_PANEL_SECTIONS` qui reviendrait ramènerait la barre d’onglets avec lui.
 */
describe('le modèle des quatre sections a bien disparu', () => {
  it('n’exporte plus ni la liste des sections ni la règle de portée', async () => {
    const module = (await import('./workflows-panel-sections')) as Record<string, unknown>
    expect(module.WORKFLOW_PANEL_SECTIONS).toBeUndefined()
    expect(module.sectionUsesScope).toBeUndefined()
    expect(typeof module.visibleScopedRuns).toBe('function')
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
  // Le panneau lui-même vit dans WorkflowsPanel.tsx (extrait de ChatView) ; ChatView ne fait
  // plus que lui passer les props et consomme toujours le modèle de sélection des fils.
  const chatView = (): string => readFileSync(join(__dirname, 'ChatView.tsx'), 'utf8')
  const workflowsPanel = (): string => readFileSync(join(__dirname, 'WorkflowsPanel.tsx'), 'utf8')

  it('le panneau est piloté par le graphe, et ChatView garde la sélection des fils', () => {
    expect(chatView()).toContain('visibleScopedRuns')
    // Le panneau ne choisit plus une section : il REÇOIT la sélection du graphe.
    expect(workflowsPanel()).not.toContain('WORKFLOW_PANEL_SECTIONS')
    expect(workflowsPanel()).toContain('onSelect={setSelection}')
  })

  it('plus aucun code ne détruit un run terminé après un délai', () => {
    // Le défaut exact : à l'événement `orchestrate-end`, une minuterie différée dispatchait l'événement
    // d'effacement vers le réducteur, qui supprimait l'entrée et ses steps.
    expect(chatView()).not.toMatch(/type: 'clear'/)
    expect(workflowsPanel()).not.toMatch(/type: 'clear'/)
  })

  it('Source control réutilise le composant existant au lieu d’être réécrit', () => {
    expect(workflowsPanel()).toContain('<SourceControlPane')
  })
})
