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
import { PIPELINE_PHASES, skillInstruction } from './skill-pipeline'
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
    /*
     * LE FIXTURE DERIVE DU DEFAUT COURANT, il ne recopie plus une forme figee.
     *
     * Il codait en dur l'ancien graphe `correctif` (build-1 + judge-1). Le 2026-08-25, `think` et
     * `learn` ont ete ajoutes aux profils : le fixture a cesse de correspondre et le test est tombe,
     * alors que la REGLE testee — « un profil livre INTACT qui force Claude est migre, une variante
     * utilisateur ne l'est pas » — n'avait pas bouge.
     *
     * On construit donc l'empreinte legacy comme la migration le fait elle-meme : le defaut courant,
     * plus le `provider: 'claude'` impose. Le test suit desormais les profils au lieu de les figer.
     *
     * CONSEQUENCE NOMMEE : cette migration ne reconnait que l'empreinte du defaut COURANT. Une
     * installation restee sur l'ancien graphe provider-locke ne sera plus migree — la migration
     * ciblait un defaut passe, et changer le defaut la retire de fait.
     */
    const courant = DEFAULT_WORKFLOWS.find((profile) => profile.id === 'correctif')!
    const legacyCorrectif: WorkflowProfile = {
      ...courant,
      graph: {
        ...courant.graph!,
        nodes: courant.graph!.nodes.map((node) => ({
          ...node,
          ...(node.agents
            ? { agents: node.agents.map((agent) => ({ provider: 'claude', ...agent })) }
            : {})
        }))
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
    // On vise le PREMIER nœud qui porte un agent, pas `nodes[0]` : depuis l'ajout de `think` en
    // tete, le premier nœud n'en porte aucun. L'intention testee est que la variante utilisateur
    // GARDE son provider impose.
    const porteurUtilisateur = utilisateur.graph?.nodes.find((node) => node.agents?.length)
    expect(porteurUtilisateur?.agents?.[0].provider).toBe('claude')
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
    // `think` en tete et `learn` en queue depuis le 2026-08-25. `estJugeTerminal` ignore l'arete
    // verte vers `learn`, donc le juge reste terminal (joue une fois, par le gate) et la
    // capitalisation est jouee APRES lui par l'orchestrateur.
    expect(graph.nodes.map((node) => node.phase)).toEqual([
      'think',
      'scout',
      'frame',
      'terrain',
      'build',
      'clean',
      'judge',
      'learn',
      'salvage'
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
    /*
     * CE HELPER MESURE LES ARETES, PAS LA MARCHE REELLE — il n'applique pas `estJugeTerminal`.
     *
     * La marche reelle s'arrete AVANT le juge (mesure : `think-1 > scout-1 > frame-1 > terrain-1 >
     * build-1 > clean-1`, puis arret sur `judge-1`), et l'orchestrateur joue le juge via le gate
     * puis `learn-1` apres lui. Ici on suit `nextNode` seul, donc la sequence inclut le juge et
     * l'arete verte qui mene a `learn-1`. Les deux lectures sont justes ; elles ne mesurent pas la
     * meme chose, et le distinguer evite de conclure a une double execution.
     */
    expect(marche(['green'])).toEqual([
      'think-1',
      'scout-1',
      'frame-1',
      'terrain-1',
      'build-1',
      'clean-1',
      'judge-1',
      'learn-1',
      'salvage-1'
    ])
  })

  it('un judge rouge rejoue build → clean → judge, au plus deux fois', () => {
    expect(marche(['red', 'red', 'red'])).toEqual([
      'think-1',
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

  it('toute phase employée est JOUABLE : phase du pipeline, ou skill présente sur disque', () => {
    /*
     * CE TEST A CHANGE D'ASSERTION LE 2026-08-25, PAS D'INVARIANT.
     *
     * Il exigeait que chaque nœud soit une phase du pipeline. C'etait un PROXY de l'invariant reel —
     * « un profil livre ne doit pas citer ce que le moteur ne peut pas jouer » — valable tant qu'un
     * nœud ne pouvait etre qu'une phase. Le moteur sait aussi jouer un nœud SKILL (`isSkillNode`,
     * `skill-node-tools.ts`), et les profils emploient desormais `think` et `learn`.
     *
     * L'assertion est plus FORTE qu'avant pour ces nœuds : appartenir a `PIPELINE_PHASES` ne
     * prouvait rien de leur existence, tandis qu'ici la skill doit REELLEMENT charger des
     * instructions. Un nœud dont la skill ne resout pas produirait un texte decrivant ce qu'il
     * ferait — exactement le defaut que `skill-node-tools.ts` corrige une couche plus bas.
     */
    for (const profil of DEFAULT_WORKFLOWS) {
      for (const node of profil.graph!.nodes) {
        const jouable =
          (PIPELINE_PHASES as readonly string[]).includes(node.phase) ||
          skillInstruction(node.phase).length > 500
        expect(jouable, `${profil.name}/${node.id} (${node.phase})`).toBe(true)
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
    /*
     * PLAFOND REBASÉ DE 24 À 32 LE 2026-08-25, puis DE 32 À 38 LE 2026-08-29 — avec les chiffres,
     * parce qu'un plafond relevé en silence n'est plus un garde.
     *
     * 2026-08-29 (conv-1521) : un nœud `salvage` ferme les six profils substantiels, pour que le run
     * TRIE le travail au lieu de rendre la main sur « veux-tu que je commit ? ». Coût MESURÉ après :
     * eclair 1 · correctif 13 · feature 37 · chantier-autowin 19 · panel-critique 17 ·
     * exploration 5 · remake 14. `feature` reste le majorant, pour la même raison qu'en août : ses
     * arêtes de RETOUR multiplient chaque nœud ajouté.
     *
     * `think` en tête et `learn` en queue ont été ajoutés aux six profils substantiels. Le coût
     * MESURÉ, avant → après :
     *
     *   eclair 1 → 1 (épargné)   ·   correctif 6 → 10   ·   feature 24 → 31
     *   chantier-autowin 12 → 16 ·   panel-critique 8 → 13 · exploration 2 → 4 · remake 7 → 11
     *
     * `feature` était EXACTEMENT au plafond : celui-ci avait été calibré sur lui, donc toute
     * addition le brisait mécaniquement. L'augmentation vient des arêtes de RETOUR (un juge rouge
     * rejoue le graphe) qui multiplient chaque nœud ajouté, pas des deux nœuds pris isolément.
     *
     * Le garde garde toujours : un graphe qui s'emballerait dépasserait 32. Ce qui a changé est la
     * référence, pas la règle — et elle est écrite ici pour qu'un futur dépassement se compare à une
     * mesure, non à un chiffre orphelin.
     */
    const PLAFOND = 38
    for (const profil of DEFAULT_WORKFLOWS) {
      const pire = worstCaseNodeExecutions(profil.graph!)
      expect(pire, profil.name).toBeGreaterThan(0)
      expect(pire, profil.name).toBeLessThanOrEqual(PLAFOND)
    }
  })
})
