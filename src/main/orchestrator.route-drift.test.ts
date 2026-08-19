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
 * réel, fait boucler un provider en streaming, et vérifie les trois effets qui n'existaient pas :
 * l'appel est COUPÉ pendant qu'il produit, un arbitrage est demandé UNE fois, et la route repart sur
 * une phase que le pipeline n'enchaînait pas.
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
  it("coupe l'appel en cours, arbitre UNE fois, et repart sur la phase choisie", async () => {
    const provider = new AgentQuiBoucle()
    await makeOrchestrator(provider).run('fais passer la suite')

    // 1. La coupure est RÉELLE : l'adaptateur a reçu l'avortement, et AUCUNE phase `build` n'est
    //    allée jusqu'à son terme — c'est ce que « mi-parcours » veut dire.
    expect(provider.avorte).toBe(true)
    expect(provider.terminees).toBe(0)

    // 2. Un arbitrage par coupure, pas un appel de modèle par chunk. Le run rejoue `build` une
    //    seconde fois (boucle de réparation PRÉEXISTANTE, sans lien avec la dérive : mesurée
    //    identique sur un agent qui ne dérive pas), d'où un arbitrage par tentative.
    expect(provider.arbitrages).toBeGreaterThanOrEqual(1)
    // Le coût de l'arbitrage reste borné au nombre de coupures : jamais proportionnel aux chunks.
    expect(provider.arbitrages).toBeLessThan(provider.chunksEmis)

    // 3. La route a repris sur `scout`, que le pipeline (`['build']`) n'enchaînait PAS.
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
 * FAN-OUT : la règle change, et c'est délibéré. Un membre qui boucle est COUPÉ, mais il ne route
 * pas — plusieurs membres dérivent en parallèle, et si chacun réclamait sa bifurcation la
 * destination du run dépendrait de l'ordre d'arrivée des réponses.
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
  it('coupe le seul membre qui boucle, laisse l’autre finir, et le run continue', async () => {
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

    // Le membre qui boucle est coupé et n'atteint jamais son terme.
    expect(boucle?.avorte).toBe(true)
    expect(boucle?.termine).toBe(false)
    expect(boucle?.chunks).toBeLessThan(30 * (boucle?.tentatives ?? 1))

    // CE QUI COMPTE AUTANT : son voisin n'est pas emporté avec lui. Un `AbortController` partagé
    // aurait tué les deux, et la coupure ciblée serait devenue une panne de phase.
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
 * TROISIÈME site : les MEMBRES d'une sous-tâche greedy. Même règle que le fan-out de phase (couper,
 * pas router), plus une contrainte propre : le jeton d'admission du membre coupé doit être RENDU,
 * sinon une coupure pour dérive bloquerait les sous-tâches suivantes comme le ferait une vraie panne.
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

    expect(a?.avorte).toBe(true)
    expect(a?.termine).toBe(false)

    // LA PREUVE QUI COMPTE : avec une concurrence de 1, `B` ne peut tourner que si le jeton
    // d'admission de `A` a bien été rendu. Sans le `admission.release()` du chemin de dérive, `B`
    // n'aurait jamais démarré — et la coupure ciblée serait devenue un blocage de phase.
    expect(b?.avorte).toBe(false)
    expect(b?.termine).toBe(true)
    expect(b?.chunks).toBeGreaterThan(0)
  })
})
