import { describe, expect, it, vi } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type RunWorktrees } from './orchestrator'
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
import { HookBus } from './hooks/hook-bus'
import type { RunLifecycleEvent } from '../shared/run-execution'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

class CapturingProvider implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    options.execution?.onProcess?.(4242, true)
    options.execution?.onProcess?.(4242, false)
    return {
      text: this.calls.length === 1 ? 'travail' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence:
        this.calls.length === 1
          ? [
              {
                type: 'file_change',
                kind: 'mutation',
                status: 'completed',
                ok: true,
                summary: 'm'
              },
              {
                type: 'command_execution',
                kind: 'verification',
                status: 'completed',
                ok: true,
                summary: 'v'
              }
            ]
          : undefined
    }
  }
}

function makeOrchestrator(worktrees?: RunWorktrees): {
  orch: Orchestrator
  provider: CapturingProvider
} {
  const provider = new CapturingProvider()
  const registry = new ProviderRegistry().register(provider)
  const roles = new RoleModelConfig({
    subagent: { provider: provider.id, model: 'worker' },
    judge: { provider: provider.id, model: 'judge' }
  })
  const orch = new Orchestrator({
    registry,
    roles,
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees
  })
  return { orch, provider }
}

function runWithLifecycle(
  orch: Orchestrator,
  task: string,
  onLifecycle: (event: RunLifecycleEvent) => void
) {
  return orch.run(
    task,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    onLifecycle
  )
}

describe('Orchestrator — flip live worktree', () => {
  it('ne bloque pas une mutation Git executee et verifiee sur le depot reel', async () => {
    class ExternalGitProvider extends CapturingProvider {
      constructor(
        private readonly target = 'C:\\base',
        private readonly prefix = ''
      ) {
        super()
      }

      override async *send(
        _m: Message[],
        options: SendOptions = {}
      ): AsyncGenerator<StreamChunk, SendResult, void> {
        this.calls.push(options)
        return {
          text: this.calls.length === 1 ? 'push effectue et refs alignees' : 'VALIDE',
          provider: this.id,
          systemInjected: Boolean(options.system),
          executionEvidence:
            this.calls.length === 1
              ? [
                  {
                    type: 'command_execution',
                    kind: 'mutation',
                    status: 'completed',
                    ok: true,
                    command: `${this.prefix}git -C "${this.target}" push origin main`,
                    summary: 'push termine'
                  },
                  {
                    type: 'command_execution',
                    kind: 'verification',
                    status: 'completed',
                    ok: true,
                    command:
                      `${this.prefix}git -C "${this.target}" rev-parse main; git -C "${this.target}" rev-parse origin/main`,
                    summary: 'main = origin/main'
                  }
                ]
              : undefined
        }
      }
    }

    const provider = new ExternalGitProvider()
    let runId = ''
    const orch = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'worker' },
        judge: { provider: provider.id, model: 'judge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\base',
      worktrees: {
        begin: (id) => {
          runId = id
          return 'C:\\wt\\run-1'
        },
        activity: () => [
          {
            agentId: runId,
            agentName: 'Agent',
            state: 'ready' as const,
            files: [],
            startedAtMs: 0
          }
        ],
        end: () => ({
          outcome: 'blocked' as const,
          agentId: 'run-1',
          reason: 'base-in-progress' as const
        })
      }
    })

    const result = await orch.run('mets a jour le depot reel C:\\base puis verifie les refs')

    expect(result.gateReasons).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.gateBlocked).toBe(false)

    const wrongTargetProvider = new ExternalGitProvider('C:\\other')
    let wrongTargetRunId = ''
    const wrongTargetOrch = new Orchestrator({
      registry: new ProviderRegistry().register(wrongTargetProvider),
      roles: new RoleModelConfig({
        subagent: { provider: wrongTargetProvider.id, model: 'worker' },
        judge: { provider: wrongTargetProvider.id, model: 'judge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\base',
      worktrees: {
        begin: (id) => {
          wrongTargetRunId = id
          return 'C:\\wt\\run-2'
        },
        activity: () => [
          {
            agentId: wrongTargetRunId,
            agentName: 'Agent',
            state: 'ready' as const,
            files: [],
            startedAtMs: 0
          }
        ],
        end: () => ({
          outcome: 'blocked' as const,
          agentId: 'run-2',
          reason: 'base-in-progress' as const
        })
      }
    })

    const wrongTargetResult = await wrongTargetOrch.run(
      'mets a jour le depot reel C:\\base puis verifie les refs'
    )
    expect(wrongTargetResult.gateBlocked).toBe(true)
    expect(wrongTargetResult.gateReasons).toContain('intégration locale non terminée')

    const mixedTargetProvider = new ExternalGitProvider(
      'C:\\other',
      'git -C "C:\\base" status; '
    )
    let mixedTargetRunId = ''
    const mixedTargetOrch = new Orchestrator({
      registry: new ProviderRegistry().register(mixedTargetProvider),
      roles: new RoleModelConfig({
        subagent: { provider: mixedTargetProvider.id, model: 'worker' },
        judge: { provider: mixedTargetProvider.id, model: 'judge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\base',
      worktrees: {
        begin: (id) => {
          mixedTargetRunId = id
          return 'C:\\wt\\run-3'
        },
        activity: () => [
          {
            agentId: mixedTargetRunId,
            agentName: 'Agent',
            state: 'ready' as const,
            files: [],
            startedAtMs: 0
          }
        ],
        end: () => ({
          outcome: 'blocked' as const,
          agentId: 'run-3',
          reason: 'base-in-progress' as const
        })
      }
    })

    const mixedTargetResult = await mixedTargetOrch.run(
      'mets a jour le depot reel C:\\base puis verifie les refs'
    )
    expect(mixedTargetResult.gateBlocked).toBe(true)
  })

  it('laisse un log ignore hors du worktree et ne fabrique aucun claim publiable', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-causal-base-'))
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-causal-worktrees-'))
    const worktree = join(worktreeRoot, 'run')
    try {
      execFileSync('git', ['init'], { cwd: base })
      writeFileSync(join(base, '.gitignore'), '*.log\n', 'utf8')
      writeFileSync(join(base, 'app.log'), 'initial\n', 'utf8')
      execFileSync('git', ['add', '.gitignore'], { cwd: base })
      execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'initial'],
        { cwd: base }
      )
      execFileSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: base })
      expect(existsSync(join(base, 'app.log'))).toBe(true)
      expect(existsSync(join(worktree, 'app.log'))).toBe(false)
      let call = 0
      const seenOptions: SendOptions[] = []
      const provider: ProviderAdapter = {
        id: 'causal-provider',
        supportsExecution: true,
        auth: async () => true,
        async *send(_messages, options = {}) {
          seenOptions.push(options)
          call += 1
          return {
            text: call === 1 ? 'travail' : 'VALIDE',
            provider: 'causal-provider',
            systemInjected: Boolean(options.system),
            executionEvidence:
              call === 1
                ? [
                    {
                      type: 'file_change',
                      kind: 'mutation',
                      status: 'completed',
                      ok: true,
                      summary: 'mutation'
                    },
                    {
                      type: 'command_execution',
                      kind: 'verification',
                      status: 'completed',
                      ok: true,
                      summary: 'preuve'
                    }
                  ]
                : undefined
          }
        }
      }
      const registry = new ProviderRegistry().register(provider)
      const roles = new RoleModelConfig({
        subagent: { provider: provider.id, model: 'worker' },
        judge: { provider: provider.id, model: 'judge' }
      })
      const orch = new Orchestrator({
        registry,
        roles,
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: base,
        worktrees: {
          begin: () => worktree,
          end: () => ({ outcome: 'merged', agentId: 'run', committed: true })
        }
      })

      const result = await orch.run(
        'modifie le projet',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [join(base, 'app.log')]
      )

      expect(seenOptions[0].execution?.causalWatchPaths).toBeUndefined()
      expect(result.causalMutationEvidence).toBeUndefined()
      expect(existsSync(join(base, 'app.log'))).toBe(true)
      expect(existsSync(join(worktree, 'app.log'))).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(worktreeRoot, { recursive: true, force: true })
    }
  })

  it('observe dans le worktree une source future absente au demarrage', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-causal-future-base-'))
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-causal-future-worktrees-'))
    const worktree = join(worktreeRoot, 'run')
    try {
      execFileSync('git', ['init'], { cwd: base })
      writeFileSync(join(base, 'tracked.txt'), 'initial\n', 'utf8')
      execFileSync('git', ['add', 'tracked.txt'], { cwd: base })
      execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'initial'],
        { cwd: base }
      )
      execFileSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: base })
      const futurePath = join(base, 'future.log')
      const seenOptions: SendOptions[] = []
      let call = 0
      const provider: ProviderAdapter = {
        id: 'future-provider',
        supportsExecution: true,
        auth: async () => true,
        async *send(_messages, options = {}) {
          seenOptions.push(options)
          call += 1
          if (call === 1) {
            writeFileSync(
              join(options.execution!.cwd!, 'future.log'),
              'ERROR auto-created\n',
              'utf8'
            )
          }
          return {
            text: call === 1 ? 'travail' : 'VALIDE',
            provider: 'future-provider',
            systemInjected: Boolean(options.system),
            executionEvidence:
              call === 1
                ? [
                    {
                      type: 'file_change',
                      kind: 'mutation',
                      status: 'completed',
                      ok: true,
                      summary: 'mutation'
                    },
                    {
                      type: 'command_execution',
                      kind: 'verification',
                      status: 'completed',
                      ok: true,
                      summary: 'preuve'
                    }
                  ]
                : undefined
          }
        }
      }
      const futureWorktrees: RunWorktrees = {
        begin: () => worktree,
        end: (_runId, options) => {
          execFileSync('git', ['add', '-A'], { cwd: worktree })
          execFileSync(
            'git',
            ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'agent'],
            { cwd: worktree }
          )
          const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: base,
            encoding: 'utf8'
          }).trim()
          const agentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: worktree,
            encoding: 'utf8'
          }).trim()
          options?.onPrepared?.({ baseSha, agentSha })
          execFileSync('git', ['merge', '--ff-only', agentSha], { cwd: base })
          options?.onPublished?.({ baseSha, agentSha })
          return { outcome: 'merged', agentId: 'run', committed: true }
        }
      }
      const registry = new ProviderRegistry().register(provider)
      const roles = new RoleModelConfig({
        subagent: { provider: provider.id, model: 'worker' },
        judge: { provider: provider.id, model: 'judge' }
      })
      const orch = new Orchestrator({
        registry,
        roles,
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: base,
        worktrees: futureWorktrees
      })

      const result = await orch.run(
        'modifie le projet',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [futurePath]
      )

      expect(seenOptions[0].execution?.causalWatchPaths).toEqual([join(worktree, 'future.log')])
      expect(result.causalMutationEvidence?.[0]).toMatchObject({
        type: 'workspace_delta',
        paths: ['future.log']
      })
      expect(
        result.causalMutationEvidence?.[0].writtenLineFingerprintsByPath?.['future.log']
      ).toHaveLength(1)
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(worktreeRoot, { recursive: true, force: true })
    }
  })

  it('attribue une ecriture tardive incluse dans le commit de publication', async () => {
    let publish: (() => void) | undefined
    const lateClaims = vi.fn()
    const base = mkdtempSync(join(tmpdir(), 'autowin-causal-late-base-'))
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-causal-late-worktrees-'))
    const worktree = join(worktreeRoot, 'run')
    try {
      execFileSync('git', ['init'], { cwd: base })
      writeFileSync(join(base, 'tracked.txt'), 'initial\n', 'utf8')
      execFileSync('git', ['add', 'tracked.txt'], { cwd: base })
      execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'initial'],
        { cwd: base }
      )
      execFileSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: base })
      let call = 0
      const provider: ProviderAdapter = {
        id: 'late-provider',
        supportsExecution: true,
        auth: async () => true,
        async *send(_messages, options = {}) {
          call += 1
          if (call === 1) writeFileSync(join(options.execution!.cwd!, 'code.ts'), 'done\n', 'utf8')
          return {
            text: call === 1 ? 'travail' : 'VALIDE',
            provider: 'late-provider',
            systemInjected: Boolean(options.system),
            executionEvidence:
              call === 1
                ? [
                    {
                      type: 'file_change',
                      kind: 'mutation',
                      status: 'completed',
                      ok: true,
                      summary: 'mutation'
                    },
                    {
                      type: 'command_execution',
                      kind: 'verification',
                      status: 'completed',
                      ok: true,
                      summary: 'preuve'
                    }
                  ]
                : undefined
          }
        }
      }
      const registry = new ProviderRegistry().register(provider)
      const roles = new RoleModelConfig({
        subagent: { provider: provider.id, model: 'worker' },
        judge: { provider: provider.id, model: 'judge' }
      })
      const orch = new Orchestrator({
        registry,
        roles,
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: base,
        worktrees: {
          begin: () => worktree,
          end: (_runId, options?: Parameters<RunWorktrees['end']>[1]) => {
            writeFileSync(join(worktree, 'future.log'), 'ERROR late-after-snapshot\n', 'utf8')
            execFileSync('git', ['add', '-A'], { cwd: worktree })
            execFileSync(
              'git',
              ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-m', 'agent'],
              { cwd: worktree }
            )
            const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
              cwd: base,
              encoding: 'utf8'
            }).trim()
            const agentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
              cwd: worktree,
              encoding: 'utf8'
            }).trim()
            options?.onPrepared?.({ baseSha, agentSha })
            execFileSync('git', ['merge', '--ff-only', agentSha], { cwd: base })
            publish = () => options?.onPublished?.({ baseSha, agentSha })
            return { outcome: 'merged', agentId: 'run', committed: true }
          }
        }
      })

      const result = await orch.run(
        'modifie le projet',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'conv-late',
        undefined,
        undefined,
        'turn-late',
        undefined,
        undefined,
        [join(base, 'future.log')],
        lateClaims
      )

      expect(result.causalMutationEvidence).toBeUndefined()
      publish?.()
      expect(
        result.causalMutationEvidence?.[0].writtenLineFingerprintsByPath?.['future.log']
      ).toHaveLength(1)
      expect(lateClaims).toHaveBeenCalledWith({
        eventId: expect.stringMatching(/^worktree-publication:run-[^:]+:[0-9a-f]{40}$/),
        mutatedPaths: [join(base, 'future.log')],
        mutatedLineFingerprints: {
          [join(base, 'future.log')]: expect.arrayContaining([expect.any(String)])
        },
        mutatedPathGenerationMarkers: {
          [join(base, 'future.log')]: expect.any(String)
        }
      })
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(worktreeRoot, { recursive: true, force: true })
    }
  })

  it('observe workspace, clôture open, Git réel puis clôture verte sur une mutation', async () => {
    const lifecycle: RunLifecycleEvent[] = []
    let currentRunId = ''
    const worktrees: RunWorktrees = {
      begin: (runId) => {
        currentRunId = runId
        return 'C:\\wt\\run-1'
      },
      end: () => ({ outcome: 'merged' as const, agentId: 'run-1', committed: true }),
      activity: () => [
        {
          agentId: currentRunId,
          agentName: 'Agent',
          state: 'merged' as const,
          files: [{ path: 'src/a.ts', kind: 'mod' as const }],
          startedAtMs: 100,
          endedAtMs: 200,
          workspacePath: 'C:\\base',
          worktreePath: 'C:\\wt\\run-1',
          baseBranch: 'main',
          baseSha: 'abc123',
          publishedSha: 'def456'
        }
      ]
    }
    const { orch } = makeOrchestrator(worktrees)

    await runWithLifecycle(orch, 'modifie le projet', (event) => lifecycle.push(event))

    expect(lifecycle.map((event) => event.stage)).toEqual([
      'workspace',
      'closure',
      'git',
      'closure'
    ])
    expect(lifecycle[0]).toMatchObject({
      stage: 'workspace',
      workspace: {
        mode: 'worktree',
        repositoryPath: 'C:\\base',
        path: 'C:\\wt\\run-1',
        baseBranch: 'main'
      }
    })
    expect(lifecycle[1]).toMatchObject({ stage: 'closure', closure: { status: 'open' } })
    expect(lifecycle[2]).toMatchObject({
      stage: 'git',
      git: {
        outcome: 'merged',
        rawOutcome: 'merged',
        commitSha: 'def456',
        baseBranch: 'main'
      }
    })
    expect(lifecycle[3]).toMatchObject({
      stage: 'closure',
      closure: { status: 'green' }
    })
  })

  /**
   * Le recu Git terminal doit EXPOSER la cause conservee par le coordinateur. Quand la finalisation
   * ne porte pas elle-meme de `detail` (cas d'une reprise de publication qui a jete et dont la cause
   * n'existe que dans l'activite persistee), le recu retombe sur `finalActivity?.detail` : sans cette
   * retombee, l'utilisateur lit « merge-failed » sans savoir quoi reparer.
   */
  it('expose dans le recu Git terminal la cause conservee par l’activite', async () => {
    const SENTINELLE = 'sentinelle-cause-publication-9f3c2a7e'
    const lifecycle: RunLifecycleEvent[] = []
    let currentRunId = ''
    const worktrees: RunWorktrees = {
      begin: (runId) => {
        currentRunId = runId
        return 'C:\\wt\\run-cause'
      },
      // Aucun `detail` ici : la cause ne vit que dans l'activite persistee.
      end: () => ({
        outcome: 'blocked' as const,
        agentId: currentRunId,
        files: ['src/a.ts'],
        reason: 'merge-failed' as const
      }),
      activity: () => [
        {
          agentId: currentRunId,
          agentName: 'Agent',
          state: 'blocked' as const,
          attentionReason: 'merge-failed' as const,
          files: [{ path: 'src/a.ts', kind: 'mod' as const }],
          startedAtMs: 100,
          endedAtMs: 200,
          workspacePath: 'C:\base',
          worktreePath: 'C:\\wt\\run-cause',
          baseBranch: 'main',
          baseSha: 'abc123',
          detail: SENTINELLE
        }
      ]
    }
    const { orch } = makeOrchestrator(worktrees)

    await runWithLifecycle(orch, 'modifie le projet', (event) => lifecycle.push(event))

    const recu = lifecycle.find((event) => event.stage === 'git')
    expect(recu).toMatchObject({
      stage: 'git',
      git: { outcome: 'blocked', reason: 'merge-failed', detail: SENTINELLE }
    })
  })

  it('refuse la cloture verte si un commit demande ne produit aucune identite Git', async () => {
    const lifecycle: RunLifecycleEvent[] = []
    const { orch } = makeOrchestrator({
      begin: () => 'C:\\wt\\run-sans-sha',
      end: () => ({ outcome: 'merged' as const, agentId: 'run-sans-sha', committed: true })
    })

    const result = await runWithLifecycle(
      orch,
      'modifie le projet et publie un commit',
      (event) => lifecycle.push(event)
    )

    expect(result.gateBlocked).toBe(true)
    expect(result.gateReasons).toContain(
      'Commit demande sans identite Git publiee verifiable'
    )
    expect(lifecycle.at(-1)).toMatchObject({
      stage: 'closure',
      closure: { status: 'red' }
    })
  })

  it('N1 — observe le dépôt de base et la clôture, sans événement Git', async () => {
    const lifecycle: RunLifecycleEvent[] = []
    const { orch } = makeOrchestrator({ begin: () => undefined, end: () => undefined })

    await runWithLifecycle(orch, 'analyse le projet sans rien changer', (event) =>
      lifecycle.push(event)
    )

    expect(lifecycle[0]).toMatchObject({
      stage: 'workspace',
      workspace: { mode: 'base', repositoryPath: 'C:\\base', path: 'C:\\base' }
    })
    expect(lifecycle.filter((event) => event.stage === 'git')).toHaveLength(0)
    expect(lifecycle.at(-1)).toMatchObject({
      stage: 'closure',
      closure: { status: 'green' }
    })
  })

  it('bloque une mutation si le moteur d’isolation est indisponible', async () => {
    const { orch, provider } = makeOrchestrator()

    await expect(orch.run('modifie le projet')).rejects.toThrow(/isolation/i)
    expect(provider.calls).toHaveLength(0)
  })

  it('ne réutilise pas un identifiant de run après recréation de l’orchestrateur', async () => {
    const ids: string[] = []
    for (let instance = 0; instance < 2; instance++) {
      const { orch } = makeOrchestrator({
        begin: (id) => {
          ids.push(id)
          return 'C:\\wt\\current'
        },
        end: () => undefined
      })
      await orch.run('modifie le projet')
    }

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('propage le cycle de vie du CLI au lease du worktree', async () => {
    const process = vi.fn()
    const { orch } = makeOrchestrator({
      begin: () => 'C:\\wt\\leased',
      end: () => undefined,
      process
    })

    await orch.run('modifie le projet')

    expect(process).toHaveBeenCalled()
    expect(process.mock.calls.every(([, pid]) => pid === 4242)).toBe(true)
    expect(process.mock.calls.some(([, , active]) => active === true)).toBe(true)
    expect(process.mock.calls.some(([, , active]) => active === false)).toBe(true)
    expect(new Set(process.mock.calls.map(([runId]) => runId)).size).toBe(1)
  })

  it('run de MUTATION : begin() route le cwd worktree dans les exécutions, end() est appelé', async () => {
    const begin = vi.fn((_id: string, _n: string, isMut: boolean) =>
      isMut ? 'C:\\wt\\run-1' : undefined
    )
    const end = vi.fn()
    const { orch, provider } = makeOrchestrator({ begin, end })

    await orch.run('modifie le projet')

    expect(begin).toHaveBeenCalledTimes(1)
    expect(begin.mock.calls[0][2]).toBe(true) // isMutation
    // Le sous-agent exécute dans la COPIE, pas dans la base.
    expect(provider.calls[0].execution?.cwd).toBe('C:\\wt\\run-1')
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('run NON-mutation : begin() renvoie undefined → cwd retombe sur la base', async () => {
    const begin = vi.fn(() => undefined)
    const end = vi.fn()
    const { orch, provider } = makeOrchestrator({ begin, end })

    await orch.run('analyse le projet sans rien changer')

    expect(provider.calls[0].execution?.cwd).toBe('C:\\base')
    expect(end).toHaveBeenCalledTimes(1) // end appelé même sans copie (no-op côté coordinateur)
  })

  it('end() est appelé même si le run échoue (finally)', async () => {
    const end = vi.fn()
    const failing = new ProviderRegistry() // aucun provider 'capture' → send jette
    const orch = new Orchestrator({
      registry: failing,
      roles: new RoleModelConfig({
        subagent: { provider: 'capture', model: 'w' },
        judge: { provider: 'capture', model: 'j' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\base',
      worktrees: { begin: () => 'C:\\wt\\run-1', end }
    })

    await expect(orch.run('modifie le projet')).rejects.toBeTruthy()
    expect(end).toHaveBeenCalledTimes(1)
    // Un run PLANTÉ ne ramène pas son travail dans la base.
    expect(end.mock.calls[0][1]).toMatchObject({ merge: false })
  })

  describe('le travail ne remonte dans la base QUE si le run est vert', () => {
    it('run VERT → end({ merge: true })', async () => {
      const end = vi.fn((_runId: string, _options?: { merge?: boolean }) => ({
        outcome: 'merged' as const,
        agentId: 'run-1',
        committed: true
      }))
      const { orch } = makeOrchestrator({ begin: () => 'C:\\wt\\run-1', end })

      const result = await orch.run('modifie le projet')

      expect(result.gateBlocked).toBe(false)
      expect(end.mock.calls[0][1]).toMatchObject({ merge: true })
    })

    it('run VERT retenu par un tournoi → aucune fusion et résultat encore vert', async () => {
      const end = vi.fn()
      let actualRunId = ''
      const { orch } = makeOrchestrator({
        begin: (runId) => {
          actualRunId = runId
          return 'C:\\wt\\tournoi'
        },
        end,
        activity: () => [
          {
            agentId: actualRunId,
            agentName: 'Tournoi',
            state: 'ready',
            files: [{ path: 'src/a.ts', kind: 'mod' }],
            startedAtMs: 1,
            worktreePath: 'C:\\wt\\tournoi',
            baseSha: 'abc123',
            verdict: 'green',
            publication: 'held'
          }
        ]
      })

      const result = await orch.run(
        'modifie le projet',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { publication: 'hold' }
      )

      expect(end).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          merge: false,
          retainGreen: true
        })
      )
      expect(result).toMatchObject({
        valid: true,
        gateBlocked: false,
        retainedWorkspace: { path: 'C:\\wt\\tournoi', baseSha: 'abc123' }
      })
    })

    it('un tournoi lecture seule force quand même un bureau isolé et le conserve', async () => {
      const end = vi.fn()
      let actualRunId = ''
      const begin = vi.fn((runId: string) => {
        actualRunId = runId
        return 'C:\\wt\\analyse'
      })
      const { orch } = makeOrchestrator({
        begin,
        end,
        activity: () => [
          {
            agentId: actualRunId,
            agentName: 'Tournoi',
            state: 'ready',
            files: [],
            startedAtMs: 1,
            worktreePath: 'C:\\wt\\analyse',
            baseSha: 'abc123',
            verdict: 'green',
            publication: 'held'
          }
        ]
      })

      const result = await orch.run(
        'analyse le projet',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { publication: 'hold' }
      )

      expect(begin).toHaveBeenCalledWith(expect.any(String), 'Agent', true, expect.any(Object))
      expect(end).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ merge: false, retainGreen: true })
      )
      expect(result.retainedWorkspace?.path).toBe('C:\\wt\\analyse')
    })

    it('run jugé vert mais finalisation bloquée → résultat rouge, reprise conservée et aucune clôture', async () => {
      const provider = new CapturingProvider()
      const close = vi.fn().mockResolvedValue(undefined)
      const onRunSettled = vi.fn()
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\\base',
        worktrees: {
          begin: () => 'C:\\wt\\run-1',
          end: () => ({
            outcome: 'blocked' as const,
            agentId: 'run-1',
            files: ['src/a.ts'],
            reason: 'base-dirty' as const
          })
        },
        onRunSettled,
        closeGreenRun: { begin: vi.fn(), close }
      })

      const result = await orch.run('modifie le projet')

      expect(result.gateBlocked).toBe(true)
      expect(result.valid).toBe(false)
      expect(result.gateReasons).toContain('intégration locale non terminée')
      // Sans la CAUSE, un run rouge est indiagnosticable : constate le 2026-08-10 sur conv-1080,
      // deux runs verts consécutifs bloqués par une base sale sans que le RUN.md ne le dise.
      expect(result.gateReasons).toContain(
        'blocage d’intégration: base-dirty — fichiers en cause: src/a.ts'
      )
      expect(onRunSettled).not.toHaveBeenCalled()
      expect(close).not.toHaveBeenCalled()
    })

    /*
     * DEFAUT MESURE le 2026-08-31 (conv-1, run « reprend-pardon-mthg437j », 2,13 $). Le rapport
     * rendu a l'utilisateur ne portait QU'UNE raison : `["intégration locale non terminée"]`.
     * Aucune cause — parce que la finalisation n'avait rendu AUCUN `reason` (verifie : la trace du
     * run ne contient aucun champ `reason`/`outcome`). L'utilisateur a donc paye un run dont les 16
     * fichiers existaient, sans jamais savoir ce qui bloquait leur arrivee dans la base.
     *
     * « Non terminee » decrit un ETAT, pas une CAUSE. Quand la finalisation se tait, le rapport doit
     * au moins nommer ce qu'on OBSERVE : l'issue brute et le fait qu'aucune cause n'a ete rendue.
     */
    /*
     * CAUSE RACINE du poste 5, etablie le 2026-08-31 sur DEUX temoins independants :
     *
     * 1. Le manifeste du run vecu (`.runs/run-f42d9a79ad99-1.json`) : `verdict: green`,
     *    `publication: "blocked"`, `conflictFile: JarvisWidget.tsx`. La finalisation avait donc
     *    une CAUSE — elle est simplement arrivee APRES le verdict du run.
     * 2. `commands.ts:3390` documente ce chemin exact, vecu conv-1404 : « Le coordinateur rend
     *    `undefined` quand la copie a encore des processus actifs — typiquement les workers
     *    `vitest` que la verification vient elle-meme de lancer : elle passe en attente et
     *    `retryRecovery` la publie ensuite. »
     *
     * `edit_file` a recu son correctif ; l'orchestrateur, NON. Le meme differe y devenait un rouge
     * sans cause — et face a un faux echec, l'agent RECOMMENCE (2,13 $ sur conv-1).
     */
    it('finalisation DIFFÉRÉE → l’attente est NOMMÉE, pas avouée comme une ignorance', async () => {
      const provider = new CapturingProvider()
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\base',
        worktrees: {
          begin: () => 'C:\\wt\\run-1',
          end: () => ({
            outcome: 'deferred' as const,
            agentId: 'run-1',
            files: ['src/a.ts'],
            reason: 'processes-still-running' as const,
            detail: 'des processus tournent encore dans la copie'
          })
        } as unknown as RunWorktrees
      })

      const result = await orch.run('modifie le projet')
      const raisons = result.gateReasons.join(' | ')

      expect(raisons).toContain('processes-still-running')
      expect(raisons).toContain('des processus tournent encore dans la copie')
      // L'aveu d'ignorance ne doit PLUS apparaitre : la cause existe et elle est nommee.
      expect(raisons).not.toContain('aucune cause')
    })

    it('finalisation MUETTE (aucun reason) → le rapport nomme quand même l’issue brute observée', async () => {
      const provider = new CapturingProvider()
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\base',
        worktrees: {
          begin: () => 'C:\\wt\\run-1',
          // Exactement le cas vecu : une issue SANS `reason` ni `detail`.
          end: () => ({ outcome: 'kept' as const, agentId: 'run-1', files: ['src/a.ts'] })
        } as unknown as RunWorktrees
      })

      const result = await orch.run('modifie le projet')

      expect(result.gateBlocked).toBe(true)
      expect(result.gateReasons).toContain('intégration locale non terminée')
      // La ligne qui manquait : l'issue OBSERVEE, et l'aveu que la cause n'a pas ete rendue.
      expect(
        result.gateReasons.some(
          (raison) => raison.includes('kept') && raison.includes('aucune cause')
        )
      ).toBe(true)
    })

    // Defaut vecu le 2026-08-18 (conv-1286) : la copie isolee portait 4 fichiers modifies, la
    // finalisation a renvoye `nothing`, le run a ete compte INTEGRE et l'utilisateur a lu
    // « fusion materialisee, verifiee hors-modele » alors que le correctif n'a jamais atteint main.
    it('run vert dont la copie a produit des fichiers mais qui finalise sur « rien » → rouge, integration vide nommee', async () => {
      const provider = new CapturingProvider()
      const close = vi.fn().mockResolvedValue(undefined)
      const onRunSettled = vi.fn()
      let runId = ''
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\base',
        worktrees: {
          begin: (id: string) => {
            runId = id
            return 'C:\\wt\\run-1'
          },
          activity: () => [
            {
              agentId: runId,
              agentName: 'Agent',
              state: 'ready' as const,
              files: [
                { path: 'src/renderer/src/assets/theme-modes.css', kind: 'mod' as const },
                { path: 'src/renderer/src/components/ChatView.css', kind: 'mod' as const }
              ],
              startedAtMs: 0
            }
          ],
          end: () => ({ outcome: 'nothing' as const, agentId: 'run-1' })
        },
        onRunSettled,
        closeGreenRun: { begin: vi.fn(), close }
      })

      const result = await orch.run('modifie le projet')

      expect(result.gateBlocked).toBe(true)
      expect(result.valid).toBe(false)
      expect(result.gateReasons).toContain(
        'intégration vide : 2 fichier(s) modifié(s) dans la copie isolée, rien publié'
      )
      expect(close).not.toHaveBeenCalled()
    })

    it('transmet à la clôture la plage Git exacte réellement publiée', async () => {
      const provider = new CapturingProvider()
      const close = vi.fn().mockResolvedValue(undefined)
      const baseSha = 'b'.repeat(40)
      const publishedSha = 'c'.repeat(40)
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\\base',
        worktrees: {
          begin: () => 'C:\\wt\\run-1',
          end: (_runId, options) => {
            options?.onPublished?.({ baseSha, agentSha: publishedSha })
            return {
              outcome: 'merged' as const,
              agentId: 'run-1',
              committed: true,
              baseSha,
              publishedSha
            }
          }
        },
        closeGreenRun: { begin: vi.fn(), close }
      })

      await orch.run('modifie le projet')

      expect(close).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPublication: { baseSha, publishedSha }
        })
      )
    })

    it('attend la publication distante avant d acquitter la fusion locale', async () => {
      const provider = new CapturingProvider()
      let finishClose!: () => void
      const close = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishClose = resolve
          })
      )
      let callbackFinished = false
      const baseSha = '8'.repeat(40)
      const publishedSha = '9'.repeat(40)
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\\base',
        worktrees: {
          begin: () => 'C:\\wt\\run-1',
          end: () => undefined,
          endAsync: async (_runId, options) => {
            await options?.onPublished?.({ baseSha, agentSha: publishedSha })
            callbackFinished = true
            return {
              outcome: 'merged' as const,
              agentId: 'run-1',
              committed: true,
              baseSha,
              publishedSha
            }
          }
        },
        closeGreenRun: { begin: vi.fn(), close }
      })

      const running = orch.run('modifie le projet')
      await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
      expect(callbackFinished).toBe(false)

      finishClose()
      await running

      expect(callbackFinished).toBe(true)
    })

    it('clôture aussi une publication différée après la fin du processus agent', async () => {
      const provider = new CapturingProvider()
      const close = vi.fn().mockResolvedValue(undefined)
      let publish: (() => void) | undefined
      const baseSha = 'd'.repeat(40)
      const publishedSha = 'e'.repeat(40)
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\\base',
        worktrees: {
          begin: () => 'C:\\wt\\run-1',
          end: (_runId, options) => {
            publish = () => options?.onPublished?.({ baseSha, agentSha: publishedSha })
            return undefined
          }
        },
        closeGreenRun: { begin: vi.fn(), close }
      })

      await orch.run('modifie le projet')
      expect(close).not.toHaveBeenCalled()

      publish?.()
      await Promise.resolve()

      expect(close).toHaveBeenCalledWith(
        expect.objectContaining({ projectPublication: { baseSha, publishedSha } })
      )
    })

    it('exécute le gate dans la copie isolée, pas dans le workspace principal', async () => {
      const hookCwds: string[] = []
      const hooks = new HookBus().register('pre-green', ({ cwd }) => {
        hookCwds.push(cwd ?? '')
        return {}
      })
      const provider = new CapturingProvider()
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\\base',
        hooks,
        worktrees: {
          begin: () => 'C:\\wt\\run-1',
          end: () => ({ outcome: 'merged' as const, agentId: 'run-1', committed: true })
        }
      })

      await orch.run('modifie le projet')

      expect(hookCwds).toEqual(['C:\\wt\\run-1'])
    })

    it('run ROUGE (juge en défaut) → end({ merge: false }) : la copie reste isolée', async () => {
      // Le juge répond DEFAUT → gate bloqué → le travail ne doit PAS être fusionné.
      class RedJudgeProvider extends CapturingProvider {
        async *send(
          m: Message[],
          options: SendOptions = {}
        ): AsyncGenerator<StreamChunk, SendResult, void> {
          const first = this.calls.length === 0
          const base = super.send(m, options)
          let step = await base.next()
          while (!step.done) step = await base.next()
          return first ? step.value : { ...step.value, text: 'DEFAUT: preuve insuffisante' }
        }
      }
      const provider = new RedJudgeProvider()
      const end = vi.fn()
      const orch = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id, model: 'worker' },
          judge: { provider: provider.id, model: 'judge' }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\\base',
        worktrees: { begin: () => 'C:\\wt\\run-1', end }
      })

      const result = await orch.run('modifie le projet')

      expect(result.gateBlocked).toBe(true)
      expect(end.mock.calls[0][1]).toMatchObject({ merge: false })
    })
  })
})

/**
 * LES CHEMINS DU RAPPORT — constaté le 2026-07-29, dit par l'agent en fin de run réel : « Le rapport
 * pointe vers un worktree qui n'existe plus. » Le run écrit dans la copie isolée, rédige son rapport
 * avec ces chemins, puis `end()` fusionne et SUPPRIME la copie. Preuve COMPORTEMENTALE : on fait dire
 * au provider un chemin de worktree et on lit le rapport rendu.
 */
class PathReportingProvider implements ProviderAdapter {
  readonly id = 'paths'
  readonly supportsExecution = true
  private calls = 0
  constructor(private readonly worktreeCwd: string) {}
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls += 1
    const first = this.calls === 1
    return {
      text: first ? `Module créé : ${this.worktreeCwd}\\src\\shared\\duree.ts` : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: first
        ? [
            { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
            {
              type: 'command_execution',
              kind: 'verification',
              status: 'completed',
              ok: true,
              summary: 'v'
            }
          ]
        : undefined
    }
  }
}

function orchestratorReportingPaths(worktreeCwd: string, worktrees: RunWorktrees): Orchestrator {
  const provider = new PathReportingProvider(worktreeCwd)
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees
  })
}

describe('le rapport ne pointe pas vers une copie supprimée', () => {
  const WT = 'C:\\wt\\run-1'

  it('FUSIONNÉ : le chemin cité devient celui du workspace de base', async () => {
    const orch = orchestratorReportingPaths(WT, {
      begin: () => WT,
      // `end` rend le verdict REEL de la fusion — c'est lui qui decide, pas `green`.
      end: () => ({ outcome: 'merged' as const, agentId: 'a1', committed: true })
    })

    const result = await orch.run('modifie le projet')

    expect(result.result).toContain('C:\\base\\src\\shared\\duree.ts')
    // Le chemin mort ne doit plus apparaitre : c'est tout le defaut.
    expect(result.result).not.toContain(WT)
  })

  it('CONFLIT malgré un run vert : le chemin de la copie est GARDÉ et signalé', async () => {
    const orch = orchestratorReportingPaths(WT, {
      begin: () => WT,
      end: () => ({
        outcome: 'conflict' as const,
        agentId: 'a1',
        files: ['src/a.ts'],
        baseSha: 'base111',
        agentSha: 'agent222'
      })
    })

    const result = await orch.run('modifie le projet')

    // Reecrire ici serait un MENSONGE : les fichiers sont restes dans la copie.
    expect(result.result).toContain(WT)
    expect(result.result).toContain('NON fusionné')
  })

  it('PUBLIÉ avec rangement différé : reste vert et pointe vers le workspace de base', async () => {
    const orch = orchestratorReportingPaths(WT, {
      begin: () => WT,
      end: () => ({
        outcome: 'cleanup-pending' as const,
        agentId: 'a1',
        files: ['src/a.ts'],
        publishedSha: 'agent222'
      })
    })

    const result = await orch.run('modifie le projet')

    expect(result.valid).toBe(true)
    expect(result.gateBlocked).toBe(false)
    expect(result.result).toContain('C:\\base\\src\\shared\\duree.ts')
    expect(result.result).not.toContain('NON fusionné')
  })

  it('PUBLIÉ avec nouveautés tardives protégées : reste vert et pointe vers la base', async () => {
    const orch = orchestratorReportingPaths(WT, {
      begin: () => WT,
      end: () => ({
        outcome: 'published-residue' as const,
        agentId: 'a1',
        files: ['late.tmp'],
        publishedSha: 'agent222'
      })
    })

    const result = await orch.run('modifie le projet')

    expect(result.valid).toBe(true)
    expect(result.gateBlocked).toBe(false)
    expect(result.result).toContain('C:\\base\\src\\shared\\duree.ts')
    expect(result.result).not.toContain('NON fusionné')
  })

  it('run SANS copie isolée : le rapport est rendu tel quel', async () => {
    const orch = orchestratorReportingPaths('C:\\base', {
      begin: () => undefined,
      end: () => undefined
    })

    const result = await orch.run('analyse le projet')

    expect(result.result).toContain('C:\\base\\src\\shared\\duree.ts')
    expect(result.result).not.toContain('NON fusionné')
  })
})

/**
 * LA CAUSE DOIT ATTEINDRE LE `RUN.md`, PAS SEULEMENT LE RECU.
 *
 * Mesure le 2026-08-27 (conv-1427) : un run vert — rouge->vert prouve, typecheck exit 0, juge
 * VALIDE, 2,47 $ — s'est clos en `red`. Le `RUN.md` portait pour tout diagnostic
 * « blocage d'integration: merge-failed ». Or `reason` nomme la CATEGORIE, `detail` porte la cause
 * reelle ; `detail` etait destructure ici puis jamais employe. Le recu Git l'exposait, le journal
 * que l'humain LIT ne le voyait pas — et le travail a du etre recupere a la main.
 */
describe('la cause d’un blocage atteint le journal du run', () => {
  it('joint le `detail` de la finalisation aux raisons du gate', async () => {
    const CAUSE = 'Filename too long: src/tres/long/chemin.ts'
    const { orch } = makeOrchestrator({
      begin: () => 'C:\wt\run-cause-journal',
      end: () => ({
        outcome: 'blocked' as const,
        agentId: 'run-cause-journal',
        files: ['src/a.ts'],
        reason: 'merge-failed' as const,
        detail: CAUSE
      })
    })

    const result = await runWithLifecycle(orch, 'modifie le projet', () => {})

    expect(result.gateBlocked).toBe(true)
    const diagnostic = result.gateReasons.find((r) => r.includes('merge-failed'))
    expect(diagnostic).toBeDefined()
    // La categorie ne suffit pas : sans la cause, le journal ne dit pas quoi reparer.
    expect(diagnostic).toContain(CAUSE)
  })
})
