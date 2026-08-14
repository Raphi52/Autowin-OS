import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  removeWorkflowProfile,
  saveWorkflowProfiles,
  seedDefaultWorkflows,
  type WorkflowProfile
} from './workflow-profiles'
import { PIPELINE_PHASES } from './skill-pipeline'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { graphDefects, nodeRanks, worstCaseNodeExecutions } from './workflow-graph'
import { initialBudget, nextNode, type NodeVerdict } from './workflow-walk'
import { PERSONAS } from '../shared/persona'

/**
 * Un catalogue livré d'origine qui ne passe pas la validation du moteur serait pire que pas de
 * catalogue : l'utilisateur ouvrirait la vue sur six graphes que l'application refuse d'enregistrer,
 * sans comprendre pourquoi. Ces tests confrontent les exemples aux règles qu'ils sont censés montrer.
 */

/**
 * Défaut CONSTATÉ EN RÉEL le 2026-08-05 : l'installation de l'utilisateur n'avait qu'un profil et
 * n'a JAMAIS reçu les six workflows livrés. `seedDefaultWorkflows` ne semait que si le FICHIER était
 * absent — or il existait. Six workflows « livrés » et invisibles.
 */
describe('semis du catalogue', () => {
  const racines: string[] = []
  afterEach(() => {
    for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
  })
  const chemin = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'autowin-seed-'))
    racines.push(dir)
    return join(dir, 'workflow-profiles.json')
  }

  it('une installation qui possède DÉJÀ un profil reçoit quand même le catalogue', () => {
    const p = chemin()
    saveWorkflowProfiles({ profiles: [{ id: 'workflow-1', name: 'Le mien' }], activeId: null }, p)
    const apres = seedDefaultWorkflows(p)
    expect(apres.profiles.map((x) => x.id)).toContain('workflow-1') // le sien est INTACT
    expect(apres.profiles.length).toBeGreaterThan(DEFAULT_WORKFLOWS.length)
  })

  it('un second démarrage ne resème RIEN — un workflow supprimé reste supprimé', () => {
    const p = chemin()
    const premier = seedDefaultWorkflows(p)
    const sansEclair = removeWorkflowProfile(premier, 'eclair')
    saveWorkflowProfiles(sansEclair, p)
    const second = seedDefaultWorkflows(p)
    expect(second.profiles.map((x) => x.id)).not.toContain('eclair')
  })

  it('migre un workflow livre intact qui forcait Claude, sans toucher une variante utilisateur', () => {
    const p = chemin()
    const legacyCorrectif: WorkflowProfile = {
      id: 'correctif',
      name: 'Correctif',
      description: DEFAULT_WORKFLOWS.find((profile) => profile.id === 'correctif')!.description,
      graph: {
        entry: 'build-1',
        nodes: [
          { id: 'build-1', phase: 'build', agents: [{ provider: 'claude', persona: 'preuve' }] },
          { id: 'judge-1', phase: 'judge', agents: [{ provider: 'claude', persona: 'correcteur' }] }
        ],
        edges: [
          { from: 'build-1', to: 'judge-1', when: 'always' },
          { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
        ]
      }
    }
    saveWorkflowProfiles(
      {
        seeded: true,
        activeId: 'correctif',
        profiles: [legacyCorrectif, { ...legacyCorrectif, id: 'mon-correctif', name: 'Le mien' }]
      },
      p
    )

    const apres = seedDefaultWorkflows(p)
    const livre = apres.profiles.find((profile) => profile.id === 'correctif')!
    const utilisateur = apres.profiles.find((profile) => profile.id === 'mon-correctif')!

    expect(livre.graph?.nodes.flatMap((node) => node.agents ?? []).every((a) => !a.provider)).toBe(
      true
    )
    expect(utilisateur.graph?.nodes[0].agents?.[0].provider).toBe('claude')
  })
})

describe('workflows livrés d’origine', () => {
  const chantier = (): NonNullable<(typeof DEFAULT_WORKFLOWS)[number]['graph']> => {
    const graph = DEFAULT_WORKFLOWS.find((profil) => profil.id === 'chantier-autowin')?.graph
    expect(graph, 'le profil Chantier Autowin doit être livré').toBeDefined()
    return graph!
  }

  const marche = (verdictsJudge: NodeVerdict[]): string[] => {
    const graph = chantier()
    const ranks = nodeRanks(graph)
    const budget = initialBudget(graph, ranks)
    const visites: string[] = []
    let courant: string | undefined = graph.entry
    let indexJudge = 0
    while (courant && visites.length < 30) {
      visites.push(courant)
      const node = graph.nodes.find((candidat) => candidat.id === courant)!
      const verdict = node.phase === 'judge' ? (verdictsJudge[indexJudge++] ?? 'green') : 'green'
      courant = nextNode(graph, courant, verdict, budget, ranks)?.to
    }
    return visites
  }

  it('livre un Chantier Autowin complet qui respecte Agent Studio', () => {
    const graph = chantier()
    expect(graph.nodes.map((node) => node.phase)).toEqual([
      'scout',
      'frame',
      'terrain',
      'build',
      'clean',
      'judge'
    ])
    // Aucun fournisseur, modèle ou fan-out caché : le moteur reprend la configuration Agent Studio.
    expect(graph.nodes.every((node) => node.agents === undefined)).toBe(true)
  })

  it('aucun workflow livre ne cache un provider qui contourne Agent Studio', () => {
    for (const profile of DEFAULT_WORKFLOWS) {
      for (const node of profile.graph?.nodes ?? []) {
        for (const agent of node.agents ?? []) {
          expect(agent.provider, `${profile.id}/${node.id}`).toBeUndefined()
        }
      }
    }
  })

  it('termine le chemin nominal seulement après clean puis judge vert', () => {
    expect(marche(['green'])).toEqual([
      'scout-1',
      'frame-1',
      'terrain-1',
      'build-1',
      'clean-1',
      'judge-1'
    ])
  })

  it('un judge rouge rejoue build → clean → judge, au plus deux fois', () => {
    expect(marche(['red', 'red', 'red'])).toEqual([
      'scout-1',
      'frame-1',
      'terrain-1',
      'build-1',
      'clean-1',
      'judge-1',
      'build-1',
      'clean-1',
      'judge-1',
      'build-1',
      'clean-1',
      'judge-1'
    ])
  })

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
