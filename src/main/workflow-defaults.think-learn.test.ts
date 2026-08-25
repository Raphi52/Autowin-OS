import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { graphDefects, nodeRanks } from './workflow-graph'
import { estJugeTerminal } from './workflow-walk'
import { skillInstruction } from './skill-pipeline'

/**
 * `think` EN TÊTE partout, `learn` SEULEMENT où aucun juge ne le précède (voir plus bas : la
 * mesure interdit l'autre cas). Les deux skills existaient sans jamais être jouées.
 *
 * MESURÉ le 2026-08-25 : `skills/think` et `skills/learn` sont sur disque et chargent de vraies
 * instructions (7492 et 6189 caractères), `skill-node-tools.ts` a été écrit EXPLICITEMENT pour elles
 * (« un nœud portant `think` ou `learn` recevait ses instructions […] sans disposer d'aucun de ces
 * outils ») et leur sert `brain_query` + `remember`. Et AUCUN des sept profils livrés ne les
 * employait. Une brique écrite, outillée, et jamais posée : c'est du théâtre au sens exact où ce
 * dépôt l'entend.
 *
 * POURQUOI `learn` PEUT ÉCRIRE malgré un nœud en lecture seule : `sandboxForPhase` réserve
 * `danger-full-access` à `build` et `clean`, donc un nœud skill ne touche ni fichier ni build. Mais
 * « lecture seule » qualifie le DÉPÔT, pas le Brain — déposer un fait via `remember` est un acte
 * d'une autre nature, réversible et mis en revue. C'est écrit tel quel dans `skill-node-tools.ts`.
 *
 * `eclair` EST DÉLIBÉRÉMENT ÉPARGNÉ : sa promesse est « aucun cérémonial — pour ce qui ne mérite pas
 * un pipeline ». Lui ajouter deux nœuds contredirait la seule chose qu'il dit faire.
 */

/** Les profils où le travail est substantiel — donc où charger du contexte paie. */
const AVEC_THINK = [
  'correctif',
  'feature',
  'chantier-autowin',
  'panel-critique',
  'exploration',
  'remake'
]

/**
 * `learn` NE PEUT PAS suivre un juge, et c'est MESURÉ — pas une préférence.
 *
 * Donner au juge une arête sortante le rend NON TERMINAL (`estJugeTerminal` : « un juge ne termine
 * le canevas que si TOUTES ses sorties sont des retours ROUGES »). Le marcheur continue alors au-delà
 * et consomme le budget de retour que la boucle de réparation relit ensuite — le défaut exact que ce
 * mécanisme a été écrit pour corriger. Mesuré le 2026-08-25 en posant l'arête : `correctif` passe à
 * **3 passages build** là où le profil en annonce 1 côté marcheur, `panel-critique` à 4.
 *
 * `exploration` n'a AUCUN juge : `learn` y est donc sûr, et le budget de retour reste vert.
 */
const AVEC_LEARN = ['exploration']

const profil = (id: string): (typeof DEFAULT_WORKFLOWS)[number] => {
  const trouve = DEFAULT_WORKFLOWS.find((candidat) => candidat.id === id)
  expect(trouve, `profil ${id} introuvable`).toBeTruthy()
  return trouve!
}

describe('`think` ouvre le travail substantiel', () => {
  for (const id of AVEC_THINK) {
    it(`${id} entre par un nœud think`, () => {
      const graphe = profil(id).graph!
      const entree = graphe.nodes.find((node) => node.id === graphe.entry)

      expect(entree?.phase).toBe('think')
    })
  }

  it('la skill `think` charge de vraies instructions — sinon le nœud est une coquille', () => {
    // La garde qui distingue « nœud posé » de « nœud qui travaille ». Un nœud dont la skill ne
    // résout pas produirait un texte décrivant ce qu'il ferait, exactement le défaut que
    // `skill-node-tools.ts` a été écrit pour corriger une couche plus bas.
    expect(skillInstruction('think').length).toBeGreaterThan(500)
  })
})

describe('`learn` ferme le travail substantiel', () => {
  for (const id of AVEC_LEARN) {
    it(`${id} termine sur learn, et rien n’en repart`, () => {
      const graphe = profil(id).graph!
      const learn = graphe.nodes.filter((node) => node.phase === 'learn')

      expect(learn).toHaveLength(1)
      // Terminal : capitaliser est le dernier geste, jamais une étape qu'on traverse.
      expect(graphe.edges.filter((arete) => arete.from === learn[0]!.id)).toEqual([])
      // Et atteignable : un nœud terminal sans arête entrante ne serait jamais joué.
      expect(graphe.edges.some((arete) => arete.to === learn[0]!.id)).toBe(true)
    })
  }

  it('la skill `learn` charge de vraies instructions', () => {
    expect(skillInstruction('learn').length).toBeGreaterThan(500)
  })
})

describe('ce qui ne doit PAS changer', () => {
  it('aucun juge des profils livrés ne perd son statut TERMINAL', () => {
    /*
     * LA GARDE QUI M'A ARRÊTÉ. En posant `judge → learn`, le juge cesse d'être terminal, le marcheur
     * continue et remange le budget de retour : 3 passages build au lieu de 1 sur `correctif`,
     * 4 sur `panel-critique`. Le défaut que `estJugeTerminal` corrige était revenu par ma main.
     *
     * Cette assertion le rend impossible à réintroduire sans le voir.
     */
    for (const candidat of DEFAULT_WORKFLOWS) {
      const graphe = candidat.graph!
      const rangs = nodeRanks(graphe)
      for (const node of graphe.nodes.filter((n) => n.phase === 'judge')) {
        expect(estJugeTerminal(graphe, node.id, rangs), `${candidat.name}/${node.id}`).toBe(true)
      }
    }
  })

  it('`eclair` reste sans cérémonial — un seul nœud', () => {
    // Sa promesse est son unique raison d'exister. L'enrichir serait le supprimer.
    const graphe = profil('eclair').graph!

    expect(graphe.nodes).toHaveLength(1)
    expect(graphe.nodes[0]!.phase).toBe('build')
  })

  it('tous les graphes livrés restent valides pour le moteur', () => {
    // On réutilise le validateur DU MOTEUR (`graphDefects`), jamais une seconde règle qui pourrait
    // divergerait du comportement réel.
    for (const candidat of DEFAULT_WORKFLOWS) {
      expect(graphDefects(candidat.graph!), candidat.name).toEqual([])
    }
  })
})
