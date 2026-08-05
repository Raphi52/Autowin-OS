import { describe, expect, it } from 'vitest'
import { PIPELINE_PHASES } from './skill-pipeline'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { graphDefects, worstCaseNodeExecutions } from './workflow-graph'
import { PERSONAS } from '../shared/persona'

/**
 * Un catalogue livré d'origine qui ne passe pas la validation du moteur serait pire que pas de
 * catalogue : l'utilisateur ouvrirait la vue sur six graphes que l'application refuse d'enregistrer,
 * sans comprendre pourquoi. Ces tests confrontent les exemples aux règles qu'ils sont censés montrer.
 */

describe('workflows livrés d’origine', () => {
  it('aucun ne porte de défaut — ils sont enregistrables tels quels', () => {
    for (const profil of DEFAULT_WORKFLOWS) {
      expect(graphDefects(profil.graph!), `${profil.name} : ${JSON.stringify(graphDefects(profil.graph!))}`).toEqual([])
    }
  })

  it('les identifiants et les noms sont uniques', () => {
    const ids = DEFAULT_WORKFLOWS.map((p) => p.id)
    const noms = DEFAULT_WORKFLOWS.map((p) => p.name)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(noms).size).toBe(noms.length)
  })

  it('chacun s’explique : un nom sans description ne se choisit pas', () => {
    for (const profil of DEFAULT_WORKFLOWS) {
      expect(profil.description?.length ?? 0, profil.name).toBeGreaterThan(30)
    }
  })

  it('toute phase employée existe réellement dans le pipeline', () => {
    for (const profil of DEFAULT_WORKFLOWS) {
      for (const node of profil.graph!.nodes) {
        expect(PIPELINE_PHASES, `${profil.name}/${node.id}`).toContain(node.phase)
      }
    }
  })

  it('toute persona employée existe au catalogue — sinon l’angle injecté serait le texte brut d’un id', () => {
    const connues = new Set(Object.values(PERSONAS).flat().map((p) => p.id))
    for (const profil of DEFAULT_WORKFLOWS) {
      for (const node of profil.graph!.nodes) {
        for (const agent of node.agents ?? []) {
          if (agent.persona) expect(connues, `${profil.name}/${node.id}`).toContain(agent.persona)
        }
      }
    }
  })

  it('un panel de plusieurs agents leur donne des angles DIFFÉRENTS', () => {
    for (const profil of DEFAULT_WORKFLOWS) {
      for (const node of profil.graph!.nodes) {
        const agents = node.agents ?? []
        if (agents.length < 2) continue
        const angles = agents.map((a) => a.persona)
        // C'est tout l'intérêt du fan-out : trois agents identiques coûtent trois fois plus cher
        // pour rendre trois fois le même avis.
        expect(new Set(angles).size, `${profil.name}/${node.id}`).toBe(agents.length)
      }
    }
  })

  it('le pire cas reste borné et raisonnable — un exemple ne doit pas coûter une fortune', () => {
    for (const profil of DEFAULT_WORKFLOWS) {
      const pire = worstCaseNodeExecutions(profil.graph!)
      expect(pire, profil.name).toBeGreaterThan(0)
      expect(pire, profil.name).toBeLessThanOrEqual(24)
    }
  })
})
