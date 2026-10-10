import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CostAggregator } from './dashboards/cost'
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
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { compileExecutionQuote } from './execution-quote'
import { ExecutionSupervisor } from './execution-supervisor'
import {
  saveOrchestrationAgentCheckpoint,
  saveOrchestrationState
} from './runs/orchestration-state'

/*
 * COURSE ENTRE LA RÉSERVATION D'UN APPEL ET L'INSCRIPTION DE SON AGENT.
 *
 * Mesure conv-163 (run-a9feec26bda6-1, 2026-10-10 12:18:10) : `scout:dette` meurt en 284 ms sur
 * « checkpoint orchestration causalement invalide : liens de reservation incoherents ».
 * Même message dans conv-44, 45, 46 et 47 depuis le 2026-10-02, toujours sur un panel scout.
 *
 * Mécanique : le registre réserve l'appel (`registry.ts`, `reserveProviderCall`), puis l'adaptateur
 * Claude attend deux fois (instantané du dépôt, mise à jour du CLI) AVANT d'annoncer son agent
 * (`onSpawnIntent`). Pendant cette attente, le membre voisin arrive à sa sauvegarde OBLIGATOIRE
 * (`onJournal`) : le contrôle compte 1 agent actif pour 2 appels réservés, refuse, et le
 * lancement du voisin est annulé.
 *
 * Ce faux adaptateur rejoue exactement cet ordre : les deux membres réservent, puis m1 s'inscrit
 * pendant que m2 attend encore.
 */
class AdaptateurQuiAttendAvantInscription implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  /** Jetons dont la sauvegarde obligatoire a réussi : l'agent a vraiment été lancé. */
  readonly lances: string[] = []
  private entres = 0
  private tousEntresResolve!: () => void
  private readonly tousEntres = new Promise<void>((resolve) => (this.tousEntresResolve = resolve))
  private m1TermineResolve!: () => void
  private readonly m1Termine = new Promise<void>((resolve) => (this.m1TermineResolve = resolve))

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    yield* [] as StreamChunk[]
    const model = options.model ?? ''
    const execution = options.execution
    if (execution && (model === 'm1' || model === 'm2')) {
      const token = `tok-${model}`
      this.entres += 1
      if (this.entres === 2) this.tousEntresResolve()
      // L'attente de l'adaptateur réel entre réservation et inscription. Bornée : si le panel ne
      // tournait pas en parallèle, le test doit échouer en le disant, pas pendre.
      let garde: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          this.tousEntres,
          new Promise<never>((_resolve, reject) => {
            garde = setTimeout(
              () => reject(new Error('les deux membres scout ne tournent pas en parallèle')),
              2000
            )
          })
        ])
      } finally {
        if (garde) clearTimeout(garde)
      }
      // m2 attend encore pendant que m1 s'inscrit et passe sa sauvegarde obligatoire.
      if (model === 'm2') await this.m1Termine
      try {
        execution.onSpawnIntent?.(token, true)
        try {
          execution.onJournal?.(token, `C:/journaux/${token}.stdout.jsonl`)
        } catch (error) {
          // Ce que fait `claude.ts` quand `onJournal` refuse : il retire l'intention, puis rejette.
          execution.onSpawnIntent?.(token, false)
          throw error
        }
        this.lances.push(token)
        execution.onSpawned?.(token, model === 'm1' ? 4201 : 4202)
      } finally {
        if (model === 'm1') this.m1TermineResolve()
      }
    }
    return {
      text: 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 }
    }
  }
}

describe('course réservation ↔ inscription de l’agent (panel scout parallèle)', () => {
  it('lance les deux membres scout sans qu’aucune sauvegarde ne soit refusée', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orch-course-reservation-'))
    const supervisor = new ExecutionSupervisor()
    const tache = 'scout comment améliorer le graph du chat'
    const quote = compileExecutionQuote(tache)
    quote.limits.maxConcurrency = Math.max(2, quote.limits.maxConcurrency)
    const provider = new AdaptateurQuiAttendAvantInscription()
    const refus: string[] = []
    const orch = new Orchestrator({
      registry: new ProviderRegistry(undefined, supervisor).register(provider),
      roles: new RoleModelConfig({
        orchestrator: { provider: provider.id, model: 'orch' },
        subagent: { provider: provider.id, model: 'worker' },
        judge: { provider: provider.id, model: 'judge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['scout'],
      phaseFanOut: (phase) =>
        phase === 'scout'
          ? [
              { provider: provider.id, model: 'm1' },
              { provider: provider.id, model: 'm2' }
            ]
          : [],
      currentExecutionQuote: () => supervisor.currentQuote(),
      currentExecutionUsage: () => supervisor.currentSnapshot(),
      // Même câblage que `os.ts` : acquis de phase, puis agents + compteur d'appels du superviseur.
      onPhaseCompleted: (info) =>
        saveOrchestrationState(root, {
          runId: info.runId,
          task: info.task,
          phaseOutputs: info.phaseOutputs,
          ...(info.executionQuote ? { executionQuote: info.executionQuote } : {}),
          ...(info.usage ? { usage: info.usage } : {}),
          ...(info.agents?.length ? { agents: info.agents } : {}),
          startedAt: 1,
          updatedAt: 1
        }),
      onAgentsChanged: (runId, agents) => {
        try {
          saveOrchestrationAgentCheckpoint(root, runId, agents, supervisor.currentSnapshot(), 2)
        } catch (error) {
          refus.push(error instanceof Error ? error.message : String(error))
          throw error
        }
      }
    })

    try {
      await supervisor.run(quote, undefined, () => orch.run(tache))
      expect(refus).toEqual([])
      expect([...provider.lances].sort()).toEqual(['tok-m1', 'tok-m2'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('un appel réglé sans agent annoncé ne laisse ni inscription d’attente ni auteur fictif', async () => {
    // Adaptateur qui n'annonce JAMAIS d'agent : l'inscription faite à la réservation doit disparaître
    // au règlement. Restée inactive, elle serait élue auteur du livrable de la phase.
    class AdaptateurMuet implements ProviderAdapter {
      readonly id = 'muet'
      readonly supportsExecution = true
      async auth(): Promise<boolean> {
        return true
      }
      async *send(
        _messages: Message[],
        options: SendOptions = {}
      ): AsyncGenerator<StreamChunk, SendResult, void> {
        yield* [] as StreamChunk[]
        return { text: 'VALIDE', provider: this.id, systemInjected: Boolean(options.system) }
      }
    }
    const supervisor = new ExecutionSupervisor()
    const tache = 'scout les lenteurs du cache'
    const provider = new AdaptateurMuet()
    const vus: Array<{ agentTokens: string[]; agents: string[] }> = []
    const orch = new Orchestrator({
      registry: new ProviderRegistry(undefined, supervisor).register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'worker' },
        judge: { provider: provider.id, model: 'judge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\ws',
      worktrees: makeTestWorktrees('C:\\ws'),
      execPhases: ['scout'],
      currentExecutionQuote: () => supervisor.currentQuote(),
      currentExecutionUsage: () => supervisor.currentSnapshot(),
      onPhaseCompleted: (info) =>
        vus.push({
          agentTokens: info.phaseOutputs.flatMap((o) => (o.agentToken ? [o.agentToken] : [])),
          agents: (info.agents ?? []).map((a) => a.token)
        })
    })

    await supervisor.run(compileExecutionQuote(tache), undefined, () => orch.run(tache))

    const scoutTermine = vus.find((v) => v.agentTokens.length > 0 || v.agents.length > 0)
    expect(vus.length).toBeGreaterThan(1)
    expect(scoutTermine).toBeUndefined()
  })
})
