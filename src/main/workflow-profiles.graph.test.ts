import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { graphOf, loadWorkflowProfiles, saveWorkflowProfiles } from './workflow-profiles'
import type { WorkflowGraph } from './workflow-graph'

let dossier: string
let chemin: string

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'wf-graph-'))
  chemin = join(dossier, 'workflow-profiles.json')
})
afterEach(() => rmSync(dossier, { recursive: true, force: true }))

const boucle: WorkflowGraph = {
  entry: 'f',
  nodes: [
    { id: 'f', phase: 'frame' },
    { id: 'b', phase: 'build' },
    { id: 'j', phase: 'judge', agents: [{ provider: 'claude' }, { provider: 'codex' }], quorum: 2 }
  ],
  edges: [
    { from: 'f', to: 'b', when: 'always' },
    { from: 'b', to: 'j', when: 'always' },
    { from: 'j', to: 'b', when: 'red', maxTraversals: 2 }
  ]
}

const ecrire = (profiles: unknown[]): void =>
  writeFileSync(chemin, JSON.stringify({ profiles, activeId: null }), 'utf8')

describe('un graphe survit au disque', () => {
  it('écrit puis relu, il revient intact — agents et quorum compris', () => {
    saveWorkflowProfiles({ profiles: [{ id: 'g', name: 'G', graph: boucle }], activeId: null }, chemin)
    const relu = loadWorkflowProfiles(chemin).profiles[0]
    expect(relu.graph).toEqual(boucle)
    expect(relu.graph?.nodes[2].quorum).toBe(2)
  })

  it('un graphe INEXÉCUTABLE est écarté à la lecture, il ne devient pas un piège', () => {
    // Un retour sans borne chargé tel quel ferait boucler un run indéfiniment.
    const sansBorne = {
      ...boucle,
      edges: boucle.edges.map((e) => (e.when === 'red' ? { from: e.from, to: e.to, when: e.when } : e))
    }
    ecrire([{ id: 'g', name: 'G', graph: sansBorne, phases: ['build'] }])
    const relu = loadWorkflowProfiles(chemin).profiles[0]
    expect(relu.graph).toBeUndefined()
    expect(relu.phases).toEqual(['build']) // on retombe sur ce qui reste lisible
  })

  it('écarter le graphe ne fait pas disparaître le profil entier', () => {
    ecrire([{ id: 'g', name: 'G', graph: { entry: 'nulle-part', nodes: [], edges: [] } }])
    expect(loadWorkflowProfiles(chemin).profiles).toHaveLength(1)
  })
})

describe('les profils d’avant le canevas', () => {
  it('une liste de phases se lit comme un graphe équivalent', () => {
    const graphe = graphOf({ id: 'a', name: 'A', phases: ['frame', 'build'] })
    expect(graphe?.nodes.map((n) => n.phase)).toEqual(['frame', 'build'])
    expect(graphe?.edges).toHaveLength(1)
  })

  it('le graphe déclaré PRIME sur les phases', () => {
    const graphe = graphOf({ id: 'a', name: 'A', phases: ['clean'], graph: boucle })
    expect(graphe).toBe(boucle)
  })

  it('un profil sans phases ni graphe n’en invente pas un', () => {
    expect(graphOf({ id: 'a', name: 'A' })).toBeUndefined()
  })
})
