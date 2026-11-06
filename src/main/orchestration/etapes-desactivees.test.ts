import { describe, expect, it } from 'vitest'
import {
  grapheSansEtapesDesactivees,
  noteSkillDesactivee,
  refusEtapeDesactivee,
  sansEtapesDesactivees
} from './etapes-desactivees'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from '../providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from '../providers/types'
import { RoleModelConfig } from '../profil/roles'
import { CostAggregator } from '../dashboards/cost'
import { TrustLedger } from '../trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { WorkflowGraph } from '../workflow/workflow-graph'

/**
 * UNE SKILL D'ÉTAPE DÉSACTIVÉE NE SE JOUE PLUS (choix de l'utilisateur, conv-1602, 2026-11-05).
 *
 * Avant : l'interrupteur de Settings › Skills n'était lu que par `skill_charger`. Un run jouait
 * l'étape quand même, et « /nom » dans le fil injectait la skill quand même.
 */

const seule =
  (...ids: string[]) =>
  (phase: string): boolean =>
    ids.includes(phase)

/** frame → build → clean → judge, avec le retour de réparation judge --red--> build. */
const CHAINE: WorkflowGraph = {
  entry: 'f',
  nodes: [
    { id: 'f', phase: 'frame' },
    { id: 'b', phase: 'build' },
    { id: 'c', phase: 'clean' },
    { id: 'j', phase: 'judge' }
  ],
  edges: [
    { from: 'f', to: 'b', when: 'always' },
    { from: 'b', to: 'c', when: 'always' },
    { from: 'c', to: 'j', when: 'always' },
    { from: 'j', to: 'b', when: 'red', maxTraversals: 2 }
  ]
}

describe('liste des étapes', () => {
  it('retire les étapes désactivées, jamais le juge qui contrôle la fin du run', () => {
    expect(
      sansEtapesDesactivees(['scout', 'frame', 'build', 'clean', 'judge'], seule('scout', 'judge'))
    ).toEqual(['frame', 'build', 'clean', 'judge'])
  })
})

describe('graphe des étapes', () => {
  it('sans étape désactivée, le graphe est rendu tel quel', () => {
    expect(grapheSansEtapesDesactivees(CHAINE, () => false)).toBe(CHAINE)
  })

  it('une étape du milieu est enjambée : build → judge', () => {
    const g = grapheSansEtapesDesactivees(CHAINE, seule('clean'))
    expect(g.nodes.map((n) => n.phase)).toEqual(['frame', 'build', 'judge'])
    expect(g.edges).toContainEqual({ from: 'b', to: 'j', when: 'always' })
    expect(g.edges.some((e) => e.from === 'c' || e.to === 'c')).toBe(false)
    // Le retour de réparation, qui ne touchait pas clean, reste avec son budget.
    expect(g.edges).toContainEqual({ from: 'j', to: 'b', when: 'red', maxTraversals: 2 })
  })

  it('une entrée désactivée cède la place à la suite', () => {
    const g = grapheSansEtapesDesactivees(CHAINE, seule('frame'))
    expect(g.entry).toBe('b')
    expect(g.nodes.some((n) => n.id === 'f')).toBe(false)
  })

  it('deux étapes désactivées à la suite sont enjambées toutes les deux', () => {
    const g = grapheSansEtapesDesactivees(CHAINE, seule('frame', 'clean'))
    expect(g.entry).toBe('b')
    expect(g.nodes.map((n) => n.phase)).toEqual(['build', 'judge'])
    expect(g.edges).toContainEqual({ from: 'b', to: 'j', when: 'always' })
  })

  it('le juge n’est jamais retiré du graphe', () => {
    expect(grapheSansEtapesDesactivees(CHAINE, seule('judge'))).toBe(CHAINE)
  })

  it('un retour enjambé garde le budget de l’arête de retour', () => {
    // build → clean ; clean --red--> frame (retour borné à 1) ; clean désactivé.
    const graphe: WorkflowGraph = {
      entry: 'f',
      nodes: [
        { id: 'f', phase: 'frame' },
        { id: 'b', phase: 'build' },
        { id: 'c', phase: 'clean' },
        { id: 'j', phase: 'judge' }
      ],
      edges: [
        { from: 'f', to: 'b', when: 'always' },
        { from: 'b', to: 'c', when: 'always' },
        { from: 'c', to: 'f', when: 'red', maxTraversals: 1 },
        { from: 'c', to: 'j', when: 'green' }
      ]
    }
    const g = grapheSansEtapesDesactivees(graphe, seule('clean'))
    expect(g.edges).toContainEqual({ from: 'b', to: 'f', when: 'red', maxTraversals: 1 })
    expect(g.edges).toContainEqual({ from: 'b', to: 'j', when: 'green' })
  })

  it('« vert » puis « rouge » ne s’enchaînent pas', () => {
    const graphe: WorkflowGraph = {
      entry: 'a',
      nodes: [
        { id: 'a', phase: 'build' },
        { id: 'x', phase: 'clean' },
        { id: 'y', phase: 'frame' }
      ],
      edges: [
        { from: 'a', to: 'x', when: 'green' },
        { from: 'x', to: 'y', when: 'red', maxTraversals: 1 }
      ]
    }
    expect(grapheSansEtapesDesactivees(graphe, seule('clean')).edges).toEqual([])
  })
})

describe('refus de départ', () => {
  it('refuse l’étape nommée quand elle est désactivée, le juge compris', () => {
    expect(
      refusEtapeDesactivee({ phaseNommee: 'terrain', modifie: false, desactivee: seule('terrain') })
    ).toContain('« terrain » est désactivée')
    expect(
      refusEtapeDesactivee({ phaseNommee: 'judge', modifie: false, desactivee: seule('judge') })
    ).toContain('« judge » est désactivée')
  })

  it('refuse un run qui modifie quand build est désactivé', () => {
    expect(refusEtapeDesactivee({ modifie: true, desactivee: seule('build') })).toContain(
      '« build » est désactivée'
    )
  })

  it('laisse partir le reste', () => {
    expect(refusEtapeDesactivee({ modifie: false, desactivee: seule('build') })).toBeUndefined()
    expect(
      refusEtapeDesactivee({ phaseNommee: 'scout', modifie: true, desactivee: seule('clean') })
    ).toBeUndefined()
  })
})

describe('« /nom » dans le fil', () => {
  const skills = (): Array<{ id: string; enabled: boolean }> => [
    { id: 'terrain', enabled: false },
    { id: 'scout', enabled: true }
  ]

  it('une skill désactivée donne une note au lieu de sa procédure', () => {
    const note = noteSkillDesactivee('terrain', skills)
    expect(note).toContain('=== SKILL DÉSACTIVÉE ===')
    expect(note).toContain('« /terrain »')
    expect(note).toContain('Settings › Skills')
  })

  it('une skill active ou inconnue ne donne aucune note', () => {
    expect(noteSkillDesactivee('scout', skills)).toBeUndefined()
    expect(noteSkillDesactivee('inconnue', skills)).toBeUndefined()
  })
})

class RecordingProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    this.calls.push(options)
    return { text: 'VALIDE', provider: this.id, systemInjected: Boolean(options.system) }
  }
}

const orchestrateur = (
  provider: ProviderAdapter,
  etapeDesactivee?: (phase: string) => boolean,
  graph?: WorkflowGraph
): Orchestrator =>
  new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: () => ['frame', 'build', 'clean'],
    etapeDesactivee,
    ...(graph ? { currentWorkflow: () => ({ graph, explicit: true }) } : {})
  })

describe('branchement dans le lanceur de runs (Orchestrator)', () => {
  it('les étapes du run perdent celles qui sont désactivées', () => {
    const tache = 'Ajoute un tri par date dans le rail et prouve-le par un test ciblé.'
    expect(orchestrateur(new RecordingProvider()).effectivePhases(tache)).toEqual([
      'frame',
      'build',
      'clean'
    ])
    expect(orchestrateur(new RecordingProvider(), seule('clean')).effectivePhases(tache)).toEqual([
      'frame',
      'build'
    ])
  })

  it('le graphe du run perd ses étapes désactivées', () => {
    const tache = 'Ajoute un tri par date dans le rail et prouve-le par un test ciblé.'
    const g = orchestrateur(new RecordingProvider(), seule('clean'), CHAINE).graphePourTache(tache)
    expect(g?.nodes.map((n) => n.phase)).toEqual(['frame', 'build', 'judge'])
  })

  it('un run « /terrain » est refusé avant tout appel au modèle quand terrain est désactivé', async () => {
    const provider = new RecordingProvider()
    await expect(
      orchestrateur(provider, seule('terrain')).run('/terrain prépare le harnais du module rail')
    ).rejects.toThrow('« terrain » est désactivée')
    expect(provider.calls).toHaveLength(0)
  })
})
