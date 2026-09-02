import { describe, expect, it } from 'vitest'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { sandboxForPhase } from './orchestrator'
import { nativeSkills } from './native-registry'
import { isPipelinePhase } from './skill-pipeline'
import { GARDE_TACHE, phaseBrief } from './phase-briefs'
import { TOURS_OUTILS_MAX } from './skill-node-tools'

/**
 * Un nœud de graphe peut porter une SKILL du disque et pas seulement l'une des huit phases.
 *
 * Ce que ces tests gardent, et qui manquait : une brique qui FIGURE au dessin sans rien exécuter.
 * `phaseBrief` d'un identifiant hors pipeline rend une chaîne vide et la dépendance
 * `skillInstruction` n'est branchée nulle part en production — sans le chargement du kit, un nœud
 * skill partirait donc avec AUCUNE instruction, et personne ne s'en apercevrait.
 */
class ProviderCapturant implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  // Ce faux provider ne diffuse rien : il capture l'appel et rend le resultat final.
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return {
      text: this.calls.length === 1 ? 'analyse rendue' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system)
    }
  }
}

const orchestrateur = (provider: ProviderCapturant, phases: string[]): Orchestrator =>
  new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id },
      judge: { provider: provider.id }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\workspace',
    worktrees: makeTestWorktrees('C:\\workspace'),
    execPhases: phases as never
  })

describe('nœud portant une skill du disque', () => {
  it("la skill de test existe vraiment sur disque (sinon l'assertion suivante ne prouve rien)", () => {
    const ids = nativeSkills().map((skill) => skill.id)
    expect(ids).toContain('think')
    expect(isPipelinePhase('think')).toBe(false)
  })

  it("n'a AUCUNE consigne native : le kit est sa seule source", () => {
    expect(phaseBrief('think')).toBe('')
  })

  it('injecte le corps du SKILL.md dans le prompt système, sans dépendance branchée', async () => {
    const provider = new ProviderCapturant()
    await orchestrateur(provider, ['think']).run('remets-toi dans ce dépôt')
    const systeme = provider.calls[0]?.system ?? ''
    expect(systeme).toContain('SKILL THINK')
    // Discriminant : le corps, pas seulement l'en-tête. Un chargement vide passerait le test ci-dessus.
    expect(systeme.length).toBeGreaterThan(500)
    expect(provider.calls[0].systemBlocks?.some((b) => b.name === 'skill:think')).toBe(true)
  })

  /**
   * Defaut vecu le 2026-09-02 (conv-126) : c'est un noeud SKILL (`arena`) qui a substitue sa tache
   * en cours de route. Son corps vient du kit, donc il ne passe PAS par `phaseBrief` — la garde
   * commune doit etre posee sur CE second chemin d'assemblage, sinon elle ne couvre que la moitie
   * des noeuds.
   */
  it('recoit lui aussi la garde « la tache donnee ne se remplace pas »', async () => {
    const provider = new ProviderCapturant()
    await orchestrateur(provider, ['think']).run('remets-toi dans ce depot')
    const systeme = provider.calls[0]?.system ?? ''
    expect(systeme).toContain(GARDE_TACHE)
    // La garde precede le corps du kit : elle n'est pas noyee en fin de prompt.
    expect(systeme.indexOf(GARDE_TACHE)).toBeLessThan(systeme.indexOf('SKILL THINK'))
  })

  it('reste en LECTURE SEULE : seules build et clean écrivent', () => {
    expect(sandboxForPhase('modifie le bouton', 'think')).toBe('read-only')
    expect(sandboxForPhase('modifie le bouton', 'build')).toBe('danger-full-access')
  })
})

/**
 * La boucle d'outils, vue depuis un VRAI run. Le module `skill-node-tools` peut être parfait et
 * n'être appelé par personne — c'est exactement le défaut qu'on corrige ici, une couche plus bas.
 */
class ProviderOutilleur implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  readonly recus: Message[][] = []
  constructor(private readonly sorties: string[]) {}
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    this.recus.push(messages)
    const texte = this.sorties[this.calls.length - 1] ?? 'VALIDE'
    return { text: texte, provider: this.id, systemInjected: Boolean(options.system) }
  }
}

describe('boucle d’outils d’un nœud skill, dans un run réel', () => {
  const appelsBus: Array<{ name: string; args: Record<string, unknown> }> = []
  const lanceur = {
    exec: async (name: string, args: Record<string, unknown>) => {
      appelsBus.push({ name, args })
      return { ok: true, data: 'empreinte trouvee' }
    }
  }
  const construire = (provider: ProviderOutilleur, avecOutils: boolean): Orchestrator =>
    new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      execPhases: ['think'] as never,
      ...(avecOutils ? { skillCommands: () => lanceur } : {})
    })

  it('une commande émise par un nœud skill atteint VRAIMENT le bus', async () => {
    appelsBus.length = 0
    const provider = new ProviderOutilleur([
      '<cmd>{"name":"brain_query","args":{"query":"empreinte du depot"}}</cmd>',
      'Voici ce que je sais du dépôt.'
    ])
    await construire(provider, true).run('remets-toi dans ce dépôt')
    expect(appelsBus).toEqual([{ name: 'brain_query', args: { query: 'empreinte du depot' } }])
  })

  it('le RÉSULTAT est réinjecté au tour suivant — sinon la lecture ne sert à rien', async () => {
    appelsBus.length = 0
    const provider = new ProviderOutilleur([
      '<cmd>{"name":"brain_query","args":{"query":"empreinte"}}</cmd>',
      'Livrable final.'
    ])
    await construire(provider, true).run('remets-toi dans ce dépôt')
    const secondTour = provider.recus[1]?.map((m) => String(m.content)).join('\n') ?? ''
    expect(secondTour).toContain('empreinte trouvee')
  })

  it('sans lanceur branché, aucun appel : le comportement d’avant est intact', async () => {
    appelsBus.length = 0
    const provider = new ProviderOutilleur([
      '<cmd>{"name":"brain_query","args":{"query":"empreinte"}}</cmd>'
    ])
    await construire(provider, false).run('remets-toi dans ce dépôt')
    expect(appelsBus).toEqual([])
  })

  it('une PHASE du pipeline n’obtient AUCUN outil, meme avec le lanceur branche', async () => {
    appelsBus.length = 0
    const provider = new ProviderOutilleur([
      '<cmd>{"name":"brain_query","args":{"query":"empreinte"}}</cmd>',
      'VALIDE'
    ])
    const orchestrateur = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      execPhases: ['build'],
      skillCommands: () => lanceur
    })
    await orchestrateur.run('modifie le bouton')
    // `build` garde exactement son comportement : la boucle est reservee aux noeuds skill.
    expect(appelsBus).toEqual([])
  })

  it('la boucle est BORNEE et le run continue au depassement — elle ne coupe jamais', async () => {
    appelsBus.length = 0
    // Le modele redemande un outil a CHAQUE tour : sans borne, la boucle serait infinie.
    const provider = new ProviderOutilleur(
      Array.from(
        { length: 12 },
        () => '<cmd>{"name":"brain_query","args":{"query":"encore"}}</cmd>'
      )
    )
    const resultat = await construire(provider, true).run('remets-toi dans ce depot')
    expect(appelsBus.length).toBeLessThanOrEqual(TOURS_OUTILS_MAX)
    // Le run VA AU BOUT : le depassement garde le dernier texte au lieu de tuer la phase.
    expect(resultat).toBeDefined()
  })

  it('ANNONCE ses outils au modele — une capacite non declaree est une capacite absente', async () => {
    const provider = new ProviderOutilleur(['Livrable.'])
    await construire(provider, true).run('remets-toi dans ce depot')
    const systeme = provider.calls[0]?.system ?? ''
    expect(systeme).toContain('OUTILS DISPONIBLES')
    expect(systeme).toContain('brain_query')
    expect(systeme).toContain('remember')
    // `orchestrate` n'est PAS annonce : on ne promet pas ce qui sera refuse.
    expect(systeme).not.toContain('- orchestrate')
  })

  it('n annonce AUCUN outil a une phase du pipeline', async () => {
    const provider = new ProviderOutilleur(['Livrable.', 'VALIDE'])
    const orchestrateur = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      execPhases: ['build'],
      skillCommands: () => lanceur
    })
    await orchestrateur.run('modifie le bouton')
    expect(provider.calls[0]?.system ?? '').not.toContain('OUTILS DISPONIBLES')
  })

  it('le tour d OUTIL reporte le contexte de la phase, il ne l efface pas', async () => {
    /**
     * Le provider Claude n'envoie que le DERNIER message utilisateur
     * (`providers/claude.ts` : `lastUser = lastUserMessage?.content`). Passer un tableau
     * `[contexte, reponse, resultat]` en croyant a une conversation faisait perdre le contexte de
     * la phase des le premier appel d'outil.
     *
     * Mesure sur le run reel `conv-1341` : le nœud `learn` a interroge le Brain, puis a conclu
     * « mon contexte ne contient aucune sortie de phase precedente ». Il disait VRAI — son premier
     * tour avait 3661 caracteres avec `[phase think]` et `[phase build]`, son second n'avait plus
     * que le compte rendu de sa propre commande. La boucle censee l'outiller le rendait aveugle.
     */
    appelsBus.length = 0
    const provider = new ProviderOutilleur([
      '<cmd>{"name":"brain_query","args":{"question":"empreinte"}}</cmd>',
      'Livrable final.'
    ])
    await construire(provider, true).run('remets-toi dans ce depot')

    const premier = provider.recus[0]?.map((m) => String(m.content)).join('') ?? ''
    const second = provider.recus[1] ?? []
    // UN SEUL message utilisateur au second tour : tout le reste serait ignore par le provider.
    expect(second).toHaveLength(1)
    expect(second[0].role).toBe('user')
    const texte = String(second[0].content)
    // Le contexte du PREMIER tour doit s'y retrouver, sinon le nœud repart aveugle.
    expect(texte).toContain(premier.slice(0, 60))
    expect(texte).toContain('TA REPONSE PRECEDENTE')
    expect(texte).toContain('empreinte trouvee')
  })
})
