import { describe, expect, it } from 'vitest'
import { isReturnEdge, nodeRanks } from './workflow-graph'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { estJugeTerminal } from './workflow-walk'

/**
 * QUI est le juge TERMINAL du canevas — et pourquoi la reponse actuelle est fausse.
 *
 * L'orchestrateur s'arrete avant le juge terminal, parce que ce juge EST le gate final joue juste
 * apres la marche : le jouer deux fois a ete constate sur le run reel conv-1071, le premier appel
 * ayant en plus le sandbox d'une phase de mutation. Le retour rouge, lui, appartient a la boucle de
 * reparation.
 *
 * La definition retenue etait « un juge SANS aucune arete sortante ». Or un profil exprime « sur
 * rouge, retourne au build » PAR une arete sortante : aucun des sept profils livres ne possede donc
 * de juge sans sortie, et la garde ne se declenchait JAMAIS. Consequence mesuree
 * (`workflow-walk.recovery-budget.test.ts`) : le marcheur consommait le budget de retour, puis la
 * boucle de reparation relisait le MEME `maxTraversals` comme s'il etait intact — 5 a 7 passages
 * `build` la ou le profil en annonce 2 ou 3.
 *
 * La definition juste est celle de la marche AVANT : un juge est terminal quand il n'a plus aucune
 * arete qui AVANCE. Ses aretes de RETOUR ne l'empechent pas de terminer le canevas.
 */
describe('juge terminal', () => {
  it('reconnait comme TERMINAL un juge dont toutes les sorties sont des RETOURS', () => {
    for (const id of ['correctif', 'feature', 'panel-critique', 'chantier-autowin', 'remake']) {
      const profil = DEFAULT_WORKFLOWS.find((p) => p.id === id)
      expect(profil, `profil ${id} introuvable`).toBeDefined()
      const graphe = profil!.graph!
      const rangs = nodeRanks(graphe)
      const juges = graphe.nodes.filter((n) => n.phase === 'judge')
      expect(juges.length, `${id} doit avoir un juge pour que ce test prouve quelque chose`).toBe(1)
      const juge = juges[0]!
      // Le juge de ces profils n'a que des retours en sortie : il termine bien le canevas.
      const sorties = graphe.edges.filter((e) => e.from === juge.id)
      expect(sorties.length, `${id} : le juge a bien des aretes sortantes`).toBeGreaterThan(0)
      expect(
        sorties.every((e) => isReturnEdge(e, rangs)),
        `${id} : toutes ses sorties sont des retours`
      ).toBe(true)
      expect(estJugeTerminal(graphe, juge.id, rangs), `${id} : donc TERMINAL`).toBe(true)
    }
  })

  it('ne prend PAS pour terminal un juge qui a encore une arete vers l’avant', () => {
    const graphe = {
      entry: 'build-1',
      nodes: [
        { id: 'build-1', phase: 'build' },
        { id: 'judge-1', phase: 'judge' },
        { id: 'clean-1', phase: 'clean' }
      ],
      edges: [
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'clean-1', when: 'green' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
      ]
    } as never
    const rangs = nodeRanks(graphe)
    // Un juge INTERMEDIAIRE garde son comportement de routage : il n'est pas le gate final.
    expect(estJugeTerminal(graphe, 'judge-1', rangs)).toBe(false)
  })

  it('un noeud qui n’est pas un juge n’est jamais « juge terminal »', () => {
    const graphe = DEFAULT_WORKFLOWS.find((p) => p.id === 'correctif')!.graph!
    const rangs = nodeRanks(graphe)
    expect(estJugeTerminal(graphe, 'build-1', rangs)).toBe(false)
  })
})
