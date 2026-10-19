import { describe, expect, it } from 'vitest'
import {
  bindingDePhaseValide,
  costOfTrace,
  evidenceSatisfiesTask,
  limitGreedyPlan,
  lireVerdictJuge,
  phasesApresBuildDeReparation,
  raisonsDArretDuRun,
  sansRetourReparationJuge,
  taskForPipelineContext,
  verdictDePhase,
  workspaceIsolationNotice,
  type OrchestrationStep
} from './orchestrator'
import type { WorkflowGraph } from './workflow-graph'
import type { ExecutionEvidence } from './providers/types'

// Filet des fonctions pures de l'orchestrateur, qui n'avait pas de test voisin (2026-10-16).

const graphe = (
  nodes: [string, string][],
  edges: [string, string, 'always' | 'green' | 'red'][]
): WorkflowGraph =>
  ({
    entry: nodes[0][0],
    nodes: nodes.map(([id, phase]) => ({ id, phase })),
    edges: edges.map(([from, to, when]) => ({ from, to, when, maxTraversals: 2 }))
  }) as WorkflowGraph

describe('verdictDePhase / lireVerdictJuge', () => {
  it('les phases autres que judge sont toujours vertes', () => {
    expect(verdictDePhase('build', '')).toBe('green')
    expect(verdictDePhase('scout', 'DEFAUT: rien')).toBe('green')
  })
  it('juge fermé par défaut : vide, hors contrat, erreur', () => {
    expect(lireVerdictJuge('')).toBe(false)
    expect(lireVerdictJuge('Error: provider timeout')).toBe(false)
    expect(lireVerdictJuge('Le travail semble correct.')).toBe(false)
  })
  it('rejet lu où qu’il soit, même après VALIDE', () => {
    expect(lireVerdictJuge('DEFAUT: test manquant')).toBe(false)
    expect(lireVerdictJuge('Le livrable présente un DEFAUT: oubli')).toBe(false)
    expect(lireVerdictJuge('KO : rien')).toBe(false)
  })
  it('VALIDE accepté hors de la tête de phrase (conv-1136)', () => {
    expect(lireVerdictJuge('VALIDE')).toBe(true)
    expect(lireVerdictJuge('Verdict : VALIDE')).toBe(true)
  })
})

describe('sansRetourReparationJuge', () => {
  it('retire seulement le retour rouge judge→build', () => {
    const g = graphe(
      [
        ['b', 'build'],
        ['j', 'judge'],
        ['s', 'scout']
      ],
      [
        ['b', 'j', 'always'],
        ['j', 'b', 'red'],
        ['j', 's', 'red']
      ]
    )
    const r = sansRetourReparationJuge(g)
    expect(r.edges.map((e) => `${e.from}>${e.to}:${e.when}`)).toEqual(['b>j:always', 'j>s:red'])
    expect(g.edges).toHaveLength(3)
  })
})

describe('phasesApresBuildDeReparation', () => {
  it('rend le milieu entre build et juge', () => {
    const g = graphe(
      [
        ['b', 'build'],
        ['c', 'clean'],
        ['j', 'judge']
      ],
      [
        ['b', 'c', 'always'],
        ['c', 'j', 'always'],
        ['j', 'b', 'red']
      ]
    )
    expect(phasesApresBuildDeReparation(g)).toEqual(['clean'])
  })
  it('vide sans retour rouge ou si le chemin bifurque', () => {
    const sansRetour = graphe(
      [
        ['b', 'build'],
        ['j', 'judge']
      ],
      [['b', 'j', 'always']]
    )
    expect(phasesApresBuildDeReparation(sansRetour)).toEqual([])
    const bifurque = graphe(
      [
        ['b', 'build'],
        ['c', 'clean'],
        ['s', 'scout'],
        ['j', 'judge']
      ],
      [
        ['b', 'c', 'always'],
        ['b', 's', 'always'],
        ['c', 'j', 'always'],
        ['j', 'b', 'red']
      ]
    )
    expect(phasesApresBuildDeReparation(bifurque)).toEqual([])
  })
  it('build directement suivi du juge : rien à rejouer', () => {
    const g = graphe(
      [
        ['b', 'build'],
        ['j', 'judge']
      ],
      [
        ['b', 'j', 'always'],
        ['j', 'b', 'red']
      ]
    )
    expect(phasesApresBuildDeReparation(g)).toEqual([])
  })
})

describe('limitGreedyPlan', () => {
  it('coupe au plafond et retire les nœuds dont un prérequis est coupé', () => {
    const plan = [
      { id: 'a', prompt: 'a', deps: [] },
      { id: 'b', prompt: 'b', deps: ['c'] },
      { id: 'c', prompt: 'c', deps: [] }
    ]
    expect(limitGreedyPlan(plan, 2).map((n) => n.id)).toEqual(['a'])
    expect(limitGreedyPlan(plan, 3).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(limitGreedyPlan(plan, -1)).toEqual([])
  })
})

describe('costOfTrace', () => {
  it('somme les coûts finis et positifs', () => {
    const trace = [{ costUsd: 1.5 }, { costUsd: -2 }, { costUsd: NaN }, {}, { costUsd: 0.5 }]
    expect(costOfTrace(trace as unknown as OrchestrationStep[])).toBe(2)
  })
})

describe('taskForPipelineContext', () => {
  it('retire un préfixe de phase native, garde le reste', () => {
    expect(taskForPipelineContext('/build corrige le bug')).toBe('corrige le bug')
    expect(taskForPipelineContext('  /SCOUT  cherche')).toBe('cherche')
    expect(taskForPipelineContext('/inconnu fais ça')).toBe('/inconnu fais ça')
    expect(taskForPipelineContext('sans préfixe')).toBe('sans préfixe')
  })
})

describe('raisonsDArretDuRun', () => {
  it('nomme l’erreur, la borne, et ignore l’absence d’erreur', () => {
    expect(raisonsDArretDuRun(undefined)).toBeUndefined()
    expect(raisonsDArretDuRun(new Error('quota'))).toEqual([
      'run arrêté avant le contrôle final : quota'
    ])
    expect(raisonsDArretDuRun('  ')).toEqual([
      'run arrêté avant le contrôle final : erreur sans message'
    ])
    const long = raisonsDArretDuRun('x'.repeat(1000))![0]
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThan(400)
  })
})

describe('bindingDePhaseValide', () => {
  const courant = { provider: 'claude', model: 'm1' }
  it('sans instantané : configuration courante', () => {
    expect(bindingDePhaseValide(undefined, courant as never, ['claude'])).toEqual({
      binding: courant
    })
  })
  it('provider disparu : repli avec note', () => {
    const r = bindingDePhaseValide({ provider: 'codex' } as never, courant as never, ['claude'])
    expect(r.binding).toBe(courant)
    expect(r.note).toMatch(/codex n'est plus disponible/)
  })
  it('instantané divergent mais disponible : gardé, divergence notée', () => {
    const snap = { provider: 'claude', model: 'm2' }
    const r = bindingDePhaseValide(snap as never, courant as never, ['claude'])
    expect(r.binding).toBe(snap)
    expect(r.note).toMatch(/m2.*m1/)
  })
})

describe('workspaceIsolationNotice', () => {
  it('vide hors copie isolée', () => {
    expect(workspaceIsolationNotice('D:\\repo', 'D:\\repo')).toBe('')
    expect(workspaceIsolationNotice('', 'D:\\repo')).toBe('')
  })
  it('nomme la copie par son dossier et neutralise les sauts de ligne', () => {
    const t = workspaceIsolationNotice('C:\\tmp\\wt-42', 'D:\\re\npo`x')
    expect(t).toContain('« wt-42 »')
    expect(t).toContain('D:\\re po x')
    expect(t).not.toContain('C:\\tmp')
  })
})

describe('evidenceSatisfiesTask', () => {
  const ev = (p: Partial<ExecutionEvidence>): ExecutionEvidence =>
    ({ type: 't', kind: 'other', status: 'ok', ok: true, summary: '', ...p }) as ExecutionEvidence
  it('tâche non mutante : toujours satisfaite', () => {
    expect(evidenceSatisfiesTask('explique le module orchestrateur')).toBe(true)
  })
  it('mutation : exige mutation + vérification réussies', () => {
    const tache = 'corrige le bug dans src/a.ts'
    expect(evidenceSatisfiesTask(tache, [])).toBe(false)
    expect(evidenceSatisfiesTask(tache, [ev({ kind: 'mutation', path: 'src/a.ts' })])).toBe(false)
    expect(
      evidenceSatisfiesTask(tache, [
        ev({ kind: 'mutation', path: 'src/a.ts' }),
        ev({ kind: 'verification', command: 'npx vitest run' })
      ])
    ).toBe(true)
    expect(
      evidenceSatisfiesTask(tache, [
        ev({ kind: 'mutation', path: 'src/a.ts' }),
        ev({ kind: 'verification', ok: false })
      ])
    ).toBe(false)
  })
})
