// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { WorkflowExecutionGraph } from './WorkflowExecutionGraph'
import type { HarnessTraceEvent } from './harness-timeline-model'
import { appliquerLangue } from '../langue'

/**
 * LE GRAPHE D'EXÉCUTION D'UN TOUR SUIT LA LANGUE (traduction anglaise, conv-1170, lot « Chat —
 * exécution, contrôles et bilans »). Entrée qui doit faire échouer ce test : un libellé du graphe
 * laissé en dur, un texte calculé par le modèle de l'arbre (titre d'outil, mode de la copie) qui ne
 * suit pas la langue, une durée ou un coût écrits à la française en anglais, ou un graphe qui ne
 * revient pas au français quand on rechange la langue sans le remonter.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

function trace(
  id: string,
  sequence: number,
  overrides: Partial<HarnessTraceEvent> = {}
): HarnessTraceEvent {
  return {
    id,
    conversationId: 'conv-a',
    turnId: 'turn-1',
    parentId: undefined,
    timestamp: `2026-07-30T12:00:0${sequence}.000Z`,
    sequence,
    type: 'tool-call',
    status: 'completed',
    channel: 'tool',
    actor: { id: 'agent', kind: 'agent', label: 'Builder' },
    recipient: { id: 'tool', kind: 'tool', label: 'Terminal' },
    payloads: [{ kind: 'tool-call', content: 'contenu sensible', name: 'Bash' }],
    observation: { boundary: 'orchestrator', fidelity: 'exact' },
    metrics: { durationMs: 1250 },
    ...overrides
  }
}

/** Un run complet : copie isolée, agent, Git fusionné, clôture verte. */
const TRACE: HarnessTraceEvent[] = [
  trace('run-workspace', 1, {
    type: 'boundary',
    run: {
      runId: 'run-1',
      timestampMs: 1,
      stage: 'workspace',
      workspace: {
        mode: 'worktree',
        repositoryPath: 'C:\\repo',
        path: 'C:\\repo-run-1',
        baseBranch: 'main',
        baseSha: 'abc123'
      }
    }
  }),
  trace('run-agent', 2, {
    type: 'handoff',
    actor: { id: 'subagent', kind: 'agent', label: 'Sous-agent' },
    provider: { id: 'codex', model: 'gpt-5.6-codex' },
    execution: {
      phase: 'build',
      agentId: 'builder-1',
      taskId: 'task-build',
      groupId: 'build:fanout',
      dependencyIds: [],
      runId: 'run-1',
      attemptId: 'attempt-1'
    }
  }),
  trace('run-git', 4, {
    type: 'boundary',
    run: {
      runId: 'run-1',
      timestampMs: 4,
      stage: 'git',
      git: {
        outcome: 'merged',
        commitSha: 'def456',
        baseBranch: 'main',
        worktreePath: 'C:\\repo-run-1',
        files: ['src/app.ts']
      }
    }
  }),
  trace('run-green', 5, {
    type: 'gate',
    run: {
      runId: 'run-1',
      timestampMs: 5,
      stage: 'closure',
      closure: {
        status: 'green',
        totalDurationMs: 12_500,
        totalCostUsd: 0.042,
        integrationOutcome: 'merged'
      }
    }
  })
]

let root: Root | null = null
let hote: HTMLDivElement | null = null

/** Un chat direct : l'orchestrateur lit trois notes du Brain, regroupées en un seul bloc. */
const LECTURES: HarnessTraceEvent[] = [
  trace('appel', 1, {
    type: 'message',
    actor: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
    provider: { id: 'claude', model: 'claude-opus-5-5' },
    execution: undefined
  }),
  ...['lu-1', 'lu-2', 'lu-3'].map((id, rang) =>
    trace(id, rang + 2, {
      parentId: rang === 0 ? 'appel' : `lu-${rang}`,
      actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
      provider: undefined,
      execution: undefined,
      metrics: undefined,
      payloads: [{ kind: 'tool-call', name: 'brain_read', content: '' }]
    })
  )
]

async function monter(evenements: HarnessTraceEvent[] = TRACE): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { causalTrace: vi.fn().mockResolvedValue(evenements) }
  })
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => {
    root!.render(createElement(WorkflowExecutionGraph, { conversationId: 'conv-a', active: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return hote
}

/** Change la langue, puis laisse le graphe relire et reprojeter sa trace. */
async function passerEn(langue: 'fr' | 'en'): Promise<void> {
  await act(async () => {
    appliquerLangue(langue)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function ouvrir(zone: HTMLElement, id: string): Promise<string> {
  await act(async () =>
    zone.querySelector<HTMLButtonElement>(`[data-execution-node="${id}"]`)?.click()
  )
  return zone.querySelector('.workflow-execution-detail')?.textContent ?? ''
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  appliquerLangue('fr')
})

describe('graphe d’exécution d’un tour — langue', () => {
  it('s’affiche en anglais, puis revient au français sans être remonté', async () => {
    appliquerLangue('en')
    const zone = await monter()
    const graphe = zone.querySelector('.workflow-execution-graph')!
    const entete = () => zone.querySelector('.workflow-execution-summary')?.textContent ?? ''
    const noeud = (id: string) =>
      zone.querySelector(`[data-execution-node="${id}"]`)?.textContent ?? ''

    // Libellés du composant.
    expect(graphe.getAttribute('aria-label')).toBe('Request processing tree')
    expect(entete()).toContain('Request processing')
    expect(entete()).toMatch(/\d+ steps/)
    // Textes calculés par le modèle de l'arbre et les tables de statut.
    expect(noeud('workspace:run:run-1')).toContain('Isolated copy')
    expect(noeud('git:run-1')).toContain('Merged')
    expect(noeud('git:run-1')).toContain('done')
    // La fiche d'une étape : libellés, valeurs, durée et coût à l'anglaise.
    const fiche = await ouvrir(zone, 'closure:run-1')
    expect(fiche).toContain('Closing state')
    expect(fiche).toContain('Total time')
    expect(fiche).toContain('12.5 s')
    expect(fiche).toContain('0.042 $')
    expect(fiche).toContain('Integration')
    expect(zone.textContent).not.toMatch(/Traitement de la demande|Copie isolée|Fusionnée|terminé/)

    await passerEn('fr')
    expect(graphe.getAttribute('aria-label')).toBe('Arbre de traitement de la demande')
    expect(entete()).toContain('Traitement de la demande')
    expect(entete()).toMatch(/\d+ étapes/)
    expect(noeud('workspace:run:run-1')).toContain('Copie isolée')
    expect(noeud('git:run-1')).toContain('Fusionnée')
    expect(noeud('git:run-1')).toContain('terminé')
    const ficheFr = zone.querySelector('.workflow-execution-detail')?.textContent ?? ''
    expect(ficheFr).toContain('État de clôture')
    expect(ficheFr).toContain('12,5 s')
    expect(ficheFr).toContain('0,042 $')
  })

  it('le titre d’une action, écrit par le modèle de l’arbre, suit la langue', async () => {
    appliquerLangue('en')
    const zone = await monter(LECTURES)
    const bloc = () => zone.querySelector('[data-execution-node="lu-1"]')
    expect(bloc()?.querySelector('.workflow-execution-node-title b')?.textContent).toBe(
      'Notes read'
    )
    expect(bloc()?.getAttribute('title')).toBe('Notes read ×3 — done')

    await passerEn('fr')
    expect(bloc()?.querySelector('.workflow-execution-node-title b')?.textContent).toBe(
      'Notes lues'
    )
    expect(bloc()?.getAttribute('title')).toBe('Notes lues ×3 — terminé')
  })
})
