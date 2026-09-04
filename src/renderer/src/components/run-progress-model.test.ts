import { describe, expect, it } from 'vitest'
import { buildRunProgress, extractObstacles } from './run-progress-model'
import type { OrchStep } from './chat-view-model'

const steps: OrchStep[] = [
  {
    step: 'exec',
    role: 'scout',
    detail: 'phase scout',
    model: 'claude-x',
    status: 'completed',
    text: 'Trois candidats.\n⚠️ Non résolu : la baseline ne tourne pas ici.',
    thinking: 'Je regarde RunInspector puis WorkflowsPanel.',
    costUsd: 0.01,
    tokens: 1200
  },
  {
    step: 'exec',
    role: 'build',
    detail: 'phase build',
    status: 'failed',
    error: 'npx vitest a échoué (exit 1)',
    evidence: [
      {
        type: 'command',
        kind: 'shell',
        ok: false,
        summary: 'vitest',
        command: 'npx vitest',
        exitCode: 1
      }
    ]
  }
]

describe('extractObstacles', () => {
  it('ne retient que les lignes de friction, pas le corps du texte', () => {
    const found = extractObstacles(
      'Trois candidats.\n⚠️ Non résolu : baseline.\n⛔ Bloqué : droit manquant.'
    )
    expect(found).toEqual(['⚠️ Non résolu : baseline.', '⛔ Bloqué : droit manquant.'])
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER une extraction trop large (tout le texte) :
    expect(extractObstacles('Rien à signaler.\nTout est vert.')).toEqual([])
  })
})

describe('buildRunProgress', () => {
  it('construit une timeline avec état, obstacles, pensée et preuves', () => {
    const view = buildRunProgress(steps, { step: 'judge', role: 'judge', phase: 'judge' })
    expect(view.entries.map((e) => e.state)).toEqual(['done', 'failed', 'running'])
    expect(view.entries[0].label).toContain('scout')
    expect(view.entries[0].obstacles).toEqual(['⚠️ Non résolu : la baseline ne tourne pas ici.'])
    expect(view.entries[0].thinking).toContain('RunInspector')
    expect(view.entries[1].obstacles).toContain('npx vitest a échoué (exit 1)')
    expect(view.entries[1].evidence).toEqual([{ ok: false, summary: '$ npx vitest — exit 1' }])
    expect(view.entries[2].state).toBe('running')
    expect(view.doneCount).toBe(1)
    expect(view.failedCount).toBe(1)
    expect(view.obstacleCount).toBe(2)
    expect(view.totalCost).toBeCloseTo(0.01)
  })

  it('une même friction remontée par plusieurs sources ne compte QUE pour un obstacle', () => {
    const ligne = '⛔ Bloqué : le worktree refuse la publication'
    const autre = '⚠️ Non résolu : le brief dépasse son plafond'
    const view = buildRunProgress([
      {
        step: 'build',
        status: 'failed',
        error: ligne,
        text: `${ligne}

${autre}
${ligne}`,
        thinking: ligne
      } as never
    ])
    // Ordre de PREMIÈRE apparition conservé, et aucune friction réelle perdue.
    expect(view.entries[0].obstacles).toEqual([ligne, autre])
    expect(view.obstacleCount).toBe(2)
    // Le doublon ne doit pas non plus réapparaître dans les sous-étapes affichées.
    expect(view.entries[0].substeps.filter((s) => s.label === ligne)).toHaveLength(1)
  })

  it('sans phase active, aucune entrée en cours', () => {
    const view = buildRunProgress([steps[0]])
    expect(view.entries).toHaveLength(1)
    expect(view.entries.every((e) => e.state !== 'running')).toBe(true)
  })
})
