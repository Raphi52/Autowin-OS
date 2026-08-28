import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { graphDefects, nodeRanks } from './workflow-graph'
import { estJugeTerminal, noeudsApresJuge } from './workflow-walk'
import { skillInstruction } from './skill-pipeline'
import { sandboxForPhase } from './orchestrator'

/**
 * LE RUN SE TERMINE PAR UN TRI DU TRAVAIL, PAS PAR UNE DEMANDE A L'UTILISATEUR.
 *
 * Defaut vecu (conv-1521) : chaque run rendait la main sur « veux-tu que je commit / fusionne ? ».
 * Le travail restait dans une copie isolee et la decision d'integration retombait sur l'humain, run
 * apres run. La skill `salvage` fait exactement ce tri (balayage, jugement par CONTENU, execution),
 * elle etait sur disque et n'etait jouee QUE sur demande explicite.
 *
 * Elle est donc posee APRES la capitalisation (`learn`), dans le meme apres-gate : on ne trie que ce
 * qu'un verdict VERT a valide.
 */
const AVEC_SALVAGE = [
  'correctif',
  'feature',
  'chantier-autowin',
  'panel-critique',
  'exploration',
  'remake'
]

const profil = (id: string): (typeof DEFAULT_WORKFLOWS)[number] => {
  const trouve = DEFAULT_WORKFLOWS.find((candidat) => candidat.id === id)
  expect(trouve, `profil ${id} introuvable`).toBeTruthy()
  return trouve!
}

describe('`salvage` ferme le run apres la capitalisation', () => {
  for (const id of AVEC_SALVAGE) {
    it(`${id} : learn -> salvage, et rien ne repart de salvage`, () => {
      const graphe = profil(id).graph!
      const learn = graphe.nodes.find((n) => n.phase === 'learn')
      const salvage = graphe.nodes.filter((n) => n.phase === 'salvage')

      expect(learn, `${id} : un noeud learn`).toBeTruthy()
      expect(salvage).toHaveLength(1)
      // Atteignable DEPUIS learn : l'ordre compte, on capitalise avant de trier.
      expect(graphe.edges.some((a) => a.from === learn!.id && a.to === salvage[0]!.id)).toBe(true)
      // Terminal : trier le travail est le dernier geste du run.
      expect(graphe.edges.filter((a) => a.from === salvage[0]!.id)).toEqual([])
    })
  }

  it('la chaine apres-gate est rendue DANS L’ORDRE learn puis salvage', () => {
    const graphe = profil('feature').graph!
    expect(noeudsApresJuge(graphe)).toEqual(['learn-1', 'salvage-1'])
  })

  it('un profil sans salvage garde une chaine d’un seul maillon', () => {
    // L'entree qui doit FAIRE ECHOUER une correction trop large : si `noeudsApresJuge` se mettait a
    // inventer un maillon, ce graphe le montrerait.
    const graphe = {
      entry: 'b1',
      nodes: [
        { id: 'b1', phase: 'build' },
        { id: 'j1', phase: 'judge' },
        { id: 'l1', phase: 'learn' }
      ],
      edges: [
        { from: 'b1', to: 'j1', when: 'always' },
        { from: 'j1', to: 'l1', when: 'green' }
      ]
    } as never
    expect(noeudsApresJuge(graphe)).toEqual(['l1'])
    expect(estJugeTerminal(graphe, 'j1', nodeRanks(graphe))).toBe(true)
  })

  it('une continuation VERTE vers autre chose qu’un maillon apres-gate ne passe pas', () => {
    // Entree falsifiante : si la garde acceptait n'importe quelle sortie verte, ce juge deviendrait
    // terminal et le marcheur abandonnerait `clean-1` EN SILENCE.
    const graphe = {
      entry: 'b1',
      nodes: [
        { id: 'b1', phase: 'build' },
        { id: 'j1', phase: 'judge' },
        { id: 'c1', phase: 'clean' }
      ],
      edges: [
        { from: 'b1', to: 'j1', when: 'always' },
        { from: 'j1', to: 'c1', when: 'green' }
      ]
    } as never
    expect(noeudsApresJuge(graphe)).toEqual([])
    expect(estJugeTerminal(graphe, 'j1', nodeRanks(graphe))).toBe(false)
  })
})

describe('`salvage` peut REELLEMENT trier', () => {
  it('le noeud salvage recoit les droits d’ecriture sur une tache de mutation', () => {
    // Un noeud en lecture seule ne peut ni fusionner ni jeter : il redigerait ce qu'il ferait.
    expect(sandboxForPhase('corrige le bug de rendu', 'salvage')).toBe('danger-full-access')
  })

  it('une tache NON mutante ne gagne aucun droit — l’entree qui falsifie un elargissement', () => {
    expect(sandboxForPhase('explique-moi comment marche le routage', 'salvage')).toBe('read-only')
    expect(sandboxForPhase('corrige le bug de rendu', 'scout')).toBe('read-only')
  })

  it('la skill `salvage` charge de vraies instructions', () => {
    expect(skillInstruction('salvage').length).toBeGreaterThan(500)
  })
})

describe('ce qui ne doit PAS changer', () => {
  it('aucun juge des profils livres ne perd son statut TERMINAL', () => {
    for (const candidat of DEFAULT_WORKFLOWS) {
      const graphe = candidat.graph!
      const rangs = nodeRanks(graphe)
      for (const node of graphe.nodes.filter((n) => n.phase === 'judge')) {
        expect(estJugeTerminal(graphe, node.id, rangs), `${candidat.name}/${node.id}`).toBe(true)
      }
    }
  })

  it('`eclair` reste sans ceremonial', () => {
    expect(profil('eclair').graph!.nodes).toHaveLength(1)
  })

  it('tous les graphes livres restent valides pour le moteur', () => {
    for (const candidat of DEFAULT_WORKFLOWS) {
      expect(graphDefects(candidat.graph!), candidat.name).toEqual([])
    }
  })

  it('chaque maillon apres-gate est REELLEMENT joue par l’orchestrateur', () => {
    const orchestrateur = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')
    expect(orchestrateur).toContain('noeudsApresJuge(graphePilote)')
    expect(orchestrateur).toMatch(
      /if \(!gate\.blocked\) \{[\s\S]{0,2600}?executePipelinePhase\(noeud\.phase\)/
    )
    expect(orchestrateur).toContain("le verdict du run n'en est pas affecte")
  })
})
