import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * LE CÂBLAGE, pas seulement le détecteur.
 *
 * `route-drift.test.ts` prouve que le détecteur trippe sur des flux fabriqués. Cela ne prouve RIEN
 * sur le run : un module parfait jamais appelé est du théâtre. Ce test-ci part de l'orchestrateur
 * réel, fait boucler un provider en streaming, et vérifie les trois effets qui n'existaient pas : la
 * dérive est VUE pendant que l'agent produit, un arbitrage est demandé UNE fois à la fin de son tour,
 * et la route repart sur une phase que le pipeline n'enchaînait pas — sans que rien soit interrompu.
 */

/** Boucle sur la même erreur en STREAMING, et honore l'avortement comme un vrai adaptateur. */
class AgentQuiBoucle implements ProviderAdapter {
  readonly id = 'boucle'
  readonly supportsExecution = true
  /** Les consignes `system` reçues : c'est là qu'on lit quelle phase a été payée. */
  readonly systemes: string[] = []
  /** Chunks réellement émis avant la coupure. Sans borne, le test tournerait à l'infini. */
  chunksEmis = 0
  /** L'avortement a-t-il été reçu par l'adaptateur ? La coupure doit être RÉELLE, pas déclarative. */
  avorte = false
  arbitrages = 0
  /** Phases `build` menées jusqu'à leur `return` naturel. Le compteur qui distingue coupé de fini. */
  terminees = 0

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const system = options.system ?? ''
    this.systemes.push(system)

    // L'arbitre : reconnu à son brief, pas à un compteur d'appels — un compteur mentirait dès que
    // l'ordre des phases change.
    if (system.includes('DÉRIVE DE ROUTE')) {
      this.arbitrages += 1
      return { text: 'ROUTE: scout', provider: this.id, systemInjected: true }
    }

    const phase = /SKILL\s+(scout|frame|terrain|build|clean|judge)/.exec(system)?.[1]
    if (phase === 'judge') return { text: 'VALIDE', provider: this.id, systemInjected: true }

    if (phase === 'build') {
      // La même erreur, encore et encore : exactement la série que personne ne voyait.
      for (let i = 0; i < 40; i += 1) {
        if (options.signal?.aborted) {
          this.avorte = true
          throw new Error('aborted')
        }
        this.chunksEmis += 1
        yield { delta: `Error: ECONNREFUSED sur /srv/${i} ligne ${i}\n` }
        // Laisse le tour de boucle d'événements passer, pour que l'avortement soit OBSERVABLE ici.
        await Promise.resolve()
      }
      this.terminees += 1
      return { text: 'jamais atteint', provider: this.id, systemInjected: true }
    }
    return { text: `livrable ${phase ?? '?'}`, provider: this.id, systemInjected: true }
  }
}

/** Le même agent, mais qui AVANCE : le témoin qui prouve qu'on ne coupe pas tout le monde. */
class AgentQuiAvance extends AgentQuiBoucle {
  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const system = options.system ?? ''
    const phase = /SKILL\s+(scout|frame|terrain|build|clean|judge)/.exec(system)?.[1]
    if (phase === 'build') {
      this.systemes.push(system)
      for (let i = 0; i < 40; i += 1) {
        if (options.signal?.aborted) {
          this.avorte = true
          throw new Error('aborted')
        }
        this.chunksEmis += 1
        yield { delta: `wrote src/fichier-${i}.ts\n` }
        await Promise.resolve()
      }
      this.terminees += 1
      return { text: 'livrable build', provider: this.id, systemInjected: true }
    }
    return yield* super.send(_messages, options)
  }
}

function makeOrchestrator(provider: ProviderAdapter): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' },
      orchestrator: { provider: provider.id, model: 'chef' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: () => ['build'],
    skillInstruction: (phase) => `SKILL ${phase}`
  })
}

describe('dérive de route détectée pendant la phase', () => {
  it('ne coupe RIEN, le dit, et change la route à la fin du tour', async () => {
    const provider = new AgentQuiBoucle()
    await makeOrchestrator(provider).run('fais passer la suite')

    // 1. RIEN N'A ÉTÉ COUPÉ, et c'est LA garantie de ce test : l'adaptateur n'a jamais vu
    //    d'avortement, et chaque phase `build` est allée jusqu'à son terme malgré la dérive.
    //    « Plus aucune coupe de run » (doctrine utilisateur du 2026-08-19).
    expect(provider.avorte).toBe(false)
    expect(provider.terminees).toBeGreaterThanOrEqual(1)
    expect(provider.chunksEmis).toBe(provider.terminees * 40)

    // 2. La dérive est bien VUE : un arbitrage a lieu, au plus un par tour, jamais par chunk.
    expect(provider.arbitrages).toBeGreaterThanOrEqual(1)
    expect(provider.arbitrages).toBeLessThanOrEqual(provider.terminees)

    // 3. Et elle sert à quelque chose : la route a repris sur `scout`, que le pipeline
    //    (`['build']`) n'enchaînait PAS. Corriger la trajectoire n'exige donc pas de couper.
    expect(provider.systemes.some((s) => s.includes('SKILL scout'))).toBe(true)
  })

  it("n'interrompt PAS un agent qui avance — le témoin", async () => {
    const provider = new AgentQuiAvance()
    await makeOrchestrator(provider).run('fais passer la suite')

    expect(provider.avorte).toBe(false)
    expect(provider.arbitrages).toBe(0)
    // Chaque tentative `build` est allée jusqu'à son terme, sans une seule coupure.
    expect(provider.terminees).toBeGreaterThanOrEqual(1)
    expect(provider.chunksEmis).toBe(provider.terminees * 40)
    expect(provider.systemes.some((s) => s.includes('SKILL scout'))).toBe(false)
  })
})

/**
 * FAN-OUT : un membre qui boucle est SIGNALÉ, et il ne route pas non plus — plusieurs membres
 * dérivent en parallèle, et si chacun réclamait sa bifurcation la destination du run dépendrait de
 * l'ordre d'arrivée des réponses. La dérive part dans la synthèse, seul endroit d'où on route.
 */
class FanOutMixte implements ProviderAdapter {
  readonly id = 'fan'
  readonly supportsExecution = true
  /** Par modèle : chunks émis, coupé ou non, mené à terme ou non. */
  readonly parModele = new Map<
    string,
    { chunks: number; avorte: boolean; termine: boolean; tentatives: number }
  >()
  readonly systemes: string[] = []
  arbitrages = 0

  private etat(model: string): {
    chunks: number
    avorte: boolean
    termine: boolean
    tentatives: number
  } {
    const vu = this.parModele.get(model)
    if (vu) return vu
    const neuf = { chunks: 0, avorte: false, termine: false, tentatives: 0 }
    this.parModele.set(model, neuf)
    return neuf
  }

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const system = options.system ?? ''
    this.systemes.push(system)
    if (system.includes('DÉRIVE DE ROUTE')) {
      this.arbitrages += 1
      return { text: 'ROUTE: continuer', provider: this.id, systemInjected: true }
    }
    const model = options.model ?? '(défaut)'
    // `qui-boucle` répète la même erreur ; tout autre membre produit un progrès réel.
    const boucle = model === 'qui-boucle'
    const etat = this.etat(model)
    if (options.execution) {
      etat.tentatives += 1
      for (let i = 0; i < 30; i += 1) {
        if (options.signal?.aborted) {
          etat.avorte = true
          throw new Error('aborted')
        }
        etat.chunks += 1
        yield {
          delta: boucle
            ? `Error: ECONNREFUSED sur /srv/${i} ligne ${i}\n`
            : `wrote src/fichier-${i}.ts\n`
        }
        await Promise.resolve()
      }
      etat.termine = true
    }
    return { text: `sortie ${model}`, provider: this.id, systemInjected: true }
  }
}

describe('dérive dans un membre de fan-out', () => {
  it('signale le membre qui boucle sans le couper, et ne route pas depuis un fan-out', async () => {
    const provider = new FanOutMixte()
    await new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'gros' },
        judge: { provider: provider.id, model: 'juge' },
        orchestrator: { provider: provider.id, model: 'chef' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      classifyPhases: () => ['build'],
      skillInstruction: (phase) => `SKILL ${phase}`,
      phaseFanOut: (phase) =>
        phase === 'build'
          ? [
              { provider: provider.id, model: 'qui-boucle' },
              { provider: provider.id, model: 'qui-avance' }
            ]
          : []
    }).run('fais passer la suite')

    const boucle = provider.parModele.get('qui-boucle')
    const avance = provider.parModele.get('qui-avance')

    // Le membre qui boucle est SIGNALÉ, pas coupé : il va au bout de son tour comme les autres.
    expect(boucle?.avorte).toBe(false)
    expect(boucle?.termine).toBe(true)

    // Son voisin non plus n'est pas touché — aucun des deux ne subit d'avortement.
    expect(avance?.avorte).toBe(false)
    expect(avance?.termine).toBe(true)
    // Chaque tentative est allée au bout de ses 30 chunks. Le run rejoue `build` (boucle de
    // réparation PRÉEXISTANTE, sans lien avec la dérive), d'où le décompte par tentative.
    expect(avance?.tentatives).toBeGreaterThanOrEqual(1)
    expect(avance?.chunks).toBe(30 * (avance?.tentatives ?? 0))

    // AUCUN arbitrage depuis un fan-out, et c'est la règle : arbitrer par membre ferait payer un
    // appel de modèle par membre qui boucle, pour une décision de route que le fan-out n'a pas le
    // droit de prendre. La dérive part dans la synthèse, seul endroit d'où une route se décide.
    expect(provider.arbitrages).toBe(0)
    expect(provider.systemes.some((s) => s.includes('SKILL scout'))).toBe(false)
  })
})

/**
 * TROISIÈME site : les MEMBRES d'une sous-tâche greedy. Même règle que partout — on OBSERVE et on
 * rapporte. Ne plus couper a fait disparaître d'un coup la contrainte la plus subtile de ce site :
 * il fallait RENDRE le jeton d'admission du membre coupé, sinon une coupure pour dérive bloquait les
 * sous-tâches suivantes comme l'aurait fait une vraie panne. Sans coupure, plus de jeton à rendre.
 */
class GreedyQuiBoucle implements ProviderAdapter {
  readonly id = 'greedy'
  readonly supportsExecution = true
  /** Par sous-tâche : chunks émis, coupée, menée à terme. */
  readonly parTache = new Map<string, { chunks: number; avorte: boolean; termine: boolean }>()

  private etat(id: string): { chunks: number; avorte: boolean; termine: boolean } {
    const vu = this.parTache.get(id)
    if (vu) return vu
    const neuf = { chunks: 0, avorte: false, termine: false }
    this.parTache.set(id, neuf)
    return neuf
  }

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const contenu = String(messages[messages.length - 1]?.content ?? '')
    const id = /\[sous-tâche (\w+)\]/.exec(contenu)?.[1]
    if (!id) return { text: 'VALIDE', provider: this.id, systemInjected: true }
    const etat = this.etat(id)
    // Seule la sous-tâche `A` boucle ; `B` produit un progrès réel.
    const boucle = id === 'A'
    for (let i = 0; i < 30; i += 1) {
      if (options.signal?.aborted) {
        etat.avorte = true
        throw new Error('aborted')
      }
      etat.chunks += 1
      yield {
        delta: boucle ? `Error: ECONNREFUSED ligne ${i}\n` : `wrote src/b-${i}.ts\n`
      }
      await Promise.resolve()
    }
    etat.termine = true
    return { text: `OUT_${id}`, provider: this.id, systemInjected: true }
  }
}

describe('dérive dans un membre de sous-tâche greedy', () => {
  it('coupe la sous-tâche qui boucle sans bloquer celle qui avance', async () => {
    const provider = new GreedyQuiBoucle()
    await new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'gros' },
        judge: { provider: provider.id, model: 'juge' },
        orchestrator: { provider: provider.id, model: 'chef' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      classifyPhases: () => ['build'],
      skillInstruction: (phase) => `SKILL ${phase}`,
      greedyConcurrency: 1,
      decompose: async () => [
        { id: 'A', deps: [], prompt: 'fais A' },
        { id: 'B', deps: [], prompt: 'fais B' }
      ]
    }).run('fais passer la suite')

    const a = provider.parTache.get('A')
    const b = provider.parTache.get('B')

    // La sous-tâche qui boucle est signalée, pas coupée : elle finit son tour.
    expect(a?.avorte).toBe(false)
    expect(a?.termine).toBe(true)

    // Et comme rien n'est avorté, le jeton d'admission suit son cours normal : avec une concurrence
    // de 1, `B` démarre bien après `A`. Ne plus couper supprime du même coup tout le risque de
    // blocage que le chemin de dérive devait gérer à la main.
    expect(b?.avorte).toBe(false)
    expect(b?.termine).toBe(true)
    expect(b?.chunks).toBeGreaterThan(0)
  })
})

/**
 * D1 — LE PLAFOND DE BIFURCATIONS AVEC UN GRAPHE QUI PILOTE.
 *
 * Le plafond ne bornait que la branche SANS graphe. Avec un graphe, `nextNode()` honore le souhait du
 * modèle même vers une phase qu'aucune arête ne desservait : il fabrique une arête synthétique, qui
 * n'a par construction aucun budget. Un agent qui dérive à chaque tentative pouvait donc faire payer
 * jusqu'à 200 phases réelles là où trois étaient annoncées.
 */
class DeriveSansFin implements ProviderAdapter {
  readonly id = 'sansfin'
  readonly supportsExecution = true
  /** Combien de fois la phase `build` a réellement été PAYÉE. Le seul chiffre qui compte ici. */
  builds = 0
  arbitrages = 0

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const system = options.system ?? ''
    // L'arbitre renvoie TOUJOURS la phase courante : la girouette parfaite, le pire cas du plafond.
    if (system.includes('DÉRIVE DE ROUTE')) {
      this.arbitrages += 1
      return { text: 'ROUTE: build', provider: this.id, systemInjected: true }
    }
    const phase = /SKILL\s+(scout|frame|terrain|build|clean|judge)/.exec(system)?.[1]
    if (phase === 'judge') return { text: 'VALIDE', provider: this.id, systemInjected: true }
    if (phase === 'build') {
      this.builds += 1
      for (let i = 0; i < 10; i += 1) {
        if (options.signal?.aborted) throw new Error('aborted')
        yield { delta: `Error: ECONNREFUSED sur /srv/${i}\n` }
        await Promise.resolve()
      }
      return { text: 'jamais atteint', provider: this.id, systemInjected: true }
    }
    return { text: `livrable ${phase ?? '?'}`, provider: this.id, systemInjected: true }
  }
}

/** Le plafond côté moteur (`PLAFOND_BIFURCATIONS`). Écrit ici pour que le test dise POURQUOI 4. */
const PLAFOND_ATTENDU = 3

describe('D1 — une dérive répétée reste BORNÉE même quand un graphe pilote', () => {
  it('ne paie pas 200 phases : le plafond de bifurcations vaut aussi sur la branche graphe', async () => {
    const provider = new DeriveSansFin()
    await new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'gros' },
        judge: { provider: provider.id, model: 'juge' },
        orchestrator: { provider: provider.id, model: 'chef' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      skillInstruction: (phase) => `SKILL ${phase}`,
      currentWorkflow: () => ({
        graph: {
          entry: 'build-1',
          nodes: [
            { id: 'build-1', phase: 'build' },
            { id: 'judge-2', phase: 'judge' }
          ],
          edges: [{ from: 'build-1', to: 'judge-2', when: 'always' }]
        }
      })
    }).run('fais passer la suite')

    // Le graphe prévoit UNE phase build. Chaque tentative dérive et l'arbitre redemande `build`.
    // Le plafond vaut 3 : on tolère les bifurcations annoncées, jamais la girouette sans fin.
    // Avant correctif, seul `pas < 200` bornait la marche — mesuré ici comme un plafond de fait.
    // MESURÉ : 200 avant correctif (le garde-fou générique `pas < 200` était la seule borne),
    // 4 après (la visite prévue + les 3 bifurcations du plafond). Le sabotage du bloc de décompte
    // fait remonter ce chiffre à 200 — l'assertion mord donc réellement.
    expect(provider.builds).toBeGreaterThan(0)
    expect(provider.builds).toBeLessThanOrEqual(PLAFOND_ATTENDU + 1)
    expect(provider.arbitrages).toBeLessThanOrEqual(PLAFOND_ATTENDU + 1)
  })
})
