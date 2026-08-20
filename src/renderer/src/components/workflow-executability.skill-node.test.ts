import { describe, expect, it } from 'vitest'
import { workflowIssues } from './workflow-executability'

/**
 * Un graphe mixte (phases + skills du disque) doit être ACTIVABLE, et un graphe référençant une
 * skill DISPARUE doit le dire ici plutôt que d'échouer au lancement.
 */
const grapheMixte = {
  graph: {
    entry: 'n1',
    nodes: [
      { id: 'n1', phase: 'frame' },
      { id: 'n2', phase: 'think' },
      { id: 'n3', phase: 'judge' }
    ],
    edges: [
      { from: 'n1', to: 'n2', when: 'always' as const },
      { from: 'n2', to: 'n3', when: 'always' as const }
    ]
  }
}

describe('exécutabilité d’un nœud skill', () => {
  it('un graphe mêlant phases et skills installées est activable', () => {
    expect(workflowIssues(grapheMixte as never, ['think', 'learn'])).toEqual([])
  })

  it('une skill absente de la machine est signalée, pas silencieuse', () => {
    const soucis = workflowIssues(grapheMixte as never, ['learn'])
    expect(soucis).toHaveLength(1)
    expect(soucis[0]).toContain('think')
    expect(soucis[0]).toContain('introuvable')
  })

  it('sans inventaire fourni, le comportement d’origine est conservé', () => {
    expect(workflowIssues(grapheMixte as never)).toEqual(['phase inconnue : think'])
  })
})
