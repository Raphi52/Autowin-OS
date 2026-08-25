import { describe, expect, it } from 'vitest'
import { isReturnEdge, nodeRanks } from './workflow-graph'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { estJugeTerminal, noeudApprentissageApresJuge } from './workflow-walk'

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
      /*
       * LE JUGE DE CES PROFILS N'A QUE DES RETOURS EN SORTIE — a UNE exception nommee, ajoutee le
       * 2026-08-25 : l'arete verte vers le noeud `learn` terminal.
       *
       * Cette arete n'appartient pas au canevas parcouru : `learn` est joue APRES le gate, une fois
       * le verdict rendu. La compter ferait revenir l'un des deux defauts mesures — le juge joue
       * DEUX fois (conv-1071), ou le marcheur consommant le budget de retour que la boucle de
       * reparation relit ensuite. Voir `juge-terminal-avec-learn.test.ts`.
       *
       * On asserte donc la forme EXACTE des sorties autorisees, pas un « tout est retour » devenu
       * faux a la lettre alors que sa conclusion tient.
       */
      const sorties = graphe.edges.filter((e) => e.from === juge.id)
      expect(sorties.length, `${id} : le juge a bien des aretes sortantes`).toBeGreaterThan(0)
      const apprentissage = noeudApprentissageApresJuge(graphe)
      expect(
        sorties.every((e) => isReturnEdge(e, rangs) || e.to === apprentissage),
        `${id} : ses sorties sont des retours, ou l'arete verte vers la capitalisation`
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

  it('un juge qui CONTINUE vers un nœud de même rang n’est PAS terminal', () => {
    /**
     * CONTRE-EXEMPLE trouvé par un relecteur externe, et reproduit avant correction.
     *
     * `isReturnEdge` classe une arête par la DISTANCE depuis l'entrée (`to <= from`), pas par le sens
     * de l'arête. Deux chemins de longueurs différentes vers le même nœud donnent donc des rangs
     * égaux, et une vraie continuation (`when: 'green'`) se retrouve classée RETOUR. Mesuré :
     * rang(a) = rang(b) = 1, `isReturnEdge(a→b)` = true, donc `estJugeTerminal(a)` rendait true — et
     * le marcheur ABANDONNAIT `b` en silence, sans erreur ni ligne de trace.
     *
     * Aucun des 7 profils livrés ne déclenche ce cas aujourd'hui, mais rien ne l'interdit à un profil
     * ajouté demain. La définition retenue est donc SÉMANTIQUE et non topologique : une continuation
     * s'exprime en `green`/`always`, un retour de réparation en `red`.
     */
    const graphe = {
      entry: 'e',
      nodes: [
        { id: 'e', phase: 'build' },
        { id: 'a', phase: 'judge' },
        { id: 'b', phase: 'clean' }
      ],
      edges: [
        { from: 'e', to: 'a', when: 'always' },
        { from: 'e', to: 'b', when: 'always' },
        { from: 'a', to: 'b', when: 'green' }
      ]
    } as never
    const rangs = nodeRanks(graphe)
    // La cause reste vraie — on ne corrige pas `isReturnEdge`, on cesse d'en dependre seul.
    expect(rangs.get('a')).toBe(rangs.get('b'))
    expect(estJugeTerminal(graphe, 'a', rangs)).toBe(false)
  })

  it('un juge dont la seule sortie est un retour ROUGE reste terminal', () => {
    const graphe = {
      entry: 'b1',
      nodes: [
        { id: 'b1', phase: 'build' },
        { id: 'j1', phase: 'judge' }
      ],
      edges: [
        { from: 'b1', to: 'j1', when: 'always' },
        { from: 'j1', to: 'b1', when: 'red', maxTraversals: 2 }
      ]
    } as never
    expect(estJugeTerminal(graphe, 'j1', nodeRanks(graphe))).toBe(true)
  })

  it('un noeud qui n’est pas un juge n’est jamais « juge terminal »', () => {
    const graphe = DEFAULT_WORKFLOWS.find((p) => p.id === 'correctif')!.graph!
    const rangs = nodeRanks(graphe)
    expect(estJugeTerminal(graphe, 'build-1', rangs)).toBe(false)
  })
})
