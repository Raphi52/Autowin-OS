/**
 * LE SCOUT EN DOUBLE D'UNE SÉLECTION — conv-1080, « le doublon enlève-le, ça c'est sûr ».
 *
 * Mesuré avant correction : 4 runs de sélection « Traite ENSEMBLE… » sur 43 rejouaient une phase
 * scout. Entrées qui tuent une correction fausse : les VRAIS workflows livrés (pas un graphe écrit
 * pour le test), un scout en ENTRÉE de graphe, un graphe fait du seul scout, et une demande qui
 * n'est PAS une sélection — elle doit garder son scout.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { graphOf } from './workflow-profiles'
import { graphDefects, graphFromPhases, linearPhasesOf, type WorkflowGraph } from './workflow-graph'
import { graphSansPhase, workflowSansScoutPourSelection } from './selection-sans-scout'
import { regimePhases } from './task-regime'
import type { WorkflowRunOverride } from './orchestrator'
import {
  redigerPromptCorrectionDirecte,
  redigerPromptWorkflowSelection
} from '../renderer/src/components/veille-candidats-message'

const livre = (id: string): WorkflowGraph => {
  const profil = DEFAULT_WORKFLOWS.find((p) => p.id === id)
  const graphe = profil ? graphOf(profil) : undefined
  if (!graphe) throw new Error(`workflow livré « ${id} » introuvable`)
  return graphe
}

const SELECTION = redigerPromptWorkflowSelection([
  { titre: 'Journal permissif', type: 'fix', url: 'src/main/activity/ledger.ts:63' },
  { titre: 'Vue des coûts', type: 'new', url: 'src/main/index.ts:1' }
])

describe('graphSansPhase', () => {
  it('« Chantier Autowin » : think → frame, plus aucun scout, graphe toujours valide', () => {
    const avant = livre('chantier-autowin')
    const apres = graphSansPhase(avant, 'scout')!
    expect(apres.nodes.map((n) => n.phase)).toEqual(
      avant.nodes.map((n) => n.phase).filter((p) => p !== 'scout')
    )
    expect(apres.edges).toContainEqual({ from: 'think-1', to: 'frame-1', when: 'always' })
    expect(apres.edges.some((e) => e.from === 'scout-1' || e.to === 'scout-1')).toBe(false)
    // Le retour du juge vers le build, borné, survit tel quel.
    expect(apres.edges).toContainEqual({
      from: 'judge-1',
      to: 'build-1',
      when: 'red',
      maxTraversals: 2
    })
    expect(graphDefects(apres)).toEqual([])
  })

  it('« Exploration » : think → frame → learn → git', () => {
    expect(linearPhasesOf(graphSansPhase(livre('exploration'), 'scout')!)).toEqual([
      'think',
      'frame',
      'learn',
      'git'
    ])
  })

  it('un scout en ENTRÉE cède l’entrée à son successeur', () => {
    const apres = graphSansPhase(graphFromPhases(['scout', 'frame', 'build']), 'scout')!
    expect(apres.entry).toBe('frame-1')
    expect(linearPhasesOf(apres)).toEqual(['frame', 'build'])
  })

  it('un graphe fait du seul scout ne laisse rien à jouer', () => {
    expect(graphSansPhase(graphFromPhases(['scout']), 'scout')).toBeUndefined()
  })

  it('un graphe sans scout est rendu tel quel', () => {
    const feature = livre('feature')
    expect(graphSansPhase(feature, 'scout')).toBe(feature)
  })
})

describe('workflowSansScoutPourSelection', () => {
  const chantier: WorkflowRunOverride = {
    explicit: true,
    identity: { name: 'Chantier Autowin', source: 'manuel' },
    graph: livre('chantier-autowin'),
    phases: ['scout', 'frame', 'build', 'clean']
  }

  it('une sélection garde le workflow choisi, son nom, son choix manuel — sans le scout', () => {
    const apres = workflowSansScoutPourSelection(chantier, SELECTION)!
    expect(apres.explicit).toBe(true)
    expect(apres.identity?.name).toBe('Chantier Autowin')
    expect(apres.graph?.nodes.some((n) => n.phase === 'scout')).toBe(false)
    expect(apres.phases).toEqual(['frame', 'build', 'clean'])
  })

  it('la correction directe (/build) est aussi une sélection', () => {
    const direct = redigerPromptCorrectionDirecte([{ titre: 'X', type: 'fix', url: 'src/a.ts:1' }])
    expect(workflowSansScoutPourSelection(chantier, direct)?.graph).not.toBe(chantier.graph)
  })

  it('une demande qui n’est PAS une sélection garde son scout', () => {
    expect(workflowSansScoutPourSelection(chantier, 'Refonds l’architecture du routeur')).toBe(
      chantier
    )
  })

  it('aucun workflow : rien à retirer', () => {
    expect(workflowSansScoutPourSelection(undefined, SELECTION)).toBeUndefined()
  })
})

describe('régime par défaut (aucun workflow sur le fil)', () => {
  it('une sélection en workflow complet ne commence plus par un scout', () => {
    expect(regimePhases(SELECTION)).toEqual(['frame', 'build', 'clean'])
  })

  it('une tâche critique ordinaire garde son scout', () => {
    expect(regimePhases('Refonds l’architecture du routeur de phases')).toEqual([
      'scout',
      'frame',
      'build',
      'clean'
    ])
  })
})

describe('branchement réel', () => {
  it('os.ts retire le scout autour du workflow du fil, workflow actif par défaut compris', () => {
    // Plus de workflow imposé depuis conv-1070 : le workflow actif de la vue est rendu par
    // `poseConversationWorkflow` comme valeur par défaut, donc filtré comme les autres.
    const os = readFileSync(new URL('./os.ts', import.meta.url), 'utf8')
    expect(os).toMatch(
      /runOptions\.workflowOverride\s*\?\?\s*workflowSansScoutPourSelection\(\s*await this\.poseConversationWorkflow\(conversationId, task\)/u
    )
  })
})
