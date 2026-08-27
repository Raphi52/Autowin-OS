import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  agentVerdict,
  settleCompletedDetachedPhase,
  preparePersistedRunForRelaunch,
  resumeActionFor,
  runLiveness,
  terminalizeInterruptedPersistedRun,
  waitUntilRunCanResume
} from './run-reattach'
import { loadOrchestrationStates, saveOrchestrationState } from './orchestration-state'
import { compileExecutionQuote } from '../execution-quote'
import { ExecutionSupervisor } from '../execution-supervisor'
import { writeSurvivableExit } from './stdout-journal'

describe('fin réussie pendant le rattachement', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('restaure les preuves outils Claude avec une phase terminee hors Electron', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-evidence-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'edit-1',
                name: 'Edit',
                input: {
                  file_path: 'src/main/example.ts',
                  old_string: 'before',
                  new_string: 'after'
                }
              }
            ]
          }
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'edit-1', is_error: false, content: 'updated' }
            ]
          }
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'test-1',
                name: 'Bash',
                input: { command: 'npm test -- --run' }
              }
            ]
          }
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'test-1',
                is_error: false,
                content: '4921 passed'
              }
            ]
          }
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'build completed',
          total_cost_usd: 0.2,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 0
          }
        })
      ].join('\n') + '\n'
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte critique avec verification')
    saveOrchestrationState(root, {
      runId: 'run-detached-evidence',
      task: 'corrige et verifie le code',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        activeReservationIds: ['reservation-build'],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build',
          reservationId: 'reservation-build',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const settled = settleCompletedDetachedPhase(root, 'run-detached-evidence')

    expect(settled?.phaseOutputs.at(-1)?.executionEvidence).toEqual([
      expect.objectContaining({ type: 'Edit', kind: 'mutation', ok: true }),
      expect.objectContaining({ type: 'Bash', kind: 'verification', ok: true })
    ])
  })

  it('récupère le résultat Claude dans la phase manquante au lieu de la relancer', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-success-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      [
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'travail' }] }
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'BUILD terminé et vérifié',
          total_cost_usd: 2.5,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 90,
            cache_creation_input_tokens: 40
          }
        })
      ].join('\n') + '\n'
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-detached-success',
      task: 'chantier critique',
      conversationId: 'conv-detached-success',
      phaseOutputs: [
        { phase: 'scout', text: 'scout acquis' },
        { phase: 'frame', text: 'frame acquis' },
        { phase: 'terrain', text: 'terrain acquis' }
      ],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 4,
        startedCalls: 4,
        completedCalls: 3,
        failedCalls: 0,
        activeCalls: 1,
        activeReservationIds: ['reservation-build'],
        inputTokens: 300,
        outputTokens: 30,
        cacheReadTokens: 250,
        totalTokens: 330,
        freshTokens: 80,
        knownCostUsd: 1,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build',
          reservationId: 'reservation-build',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          pid: 42,
          identity: 'mort',
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const recoveredUsage: unknown[] = []
    const settled = settleCompletedDetachedPhase(root, 'run-detached-success', (usage) =>
      recoveredUsage.push(usage)
    )

    expect(settled?.phaseOutputs.at(-1)).toEqual({
      phase: 'build',
      text: 'BUILD terminé et vérifié',
      agentToken: 'agent-build'
    })
    expect(settled?.usage).toMatchObject({
      completedCalls: 4,
      failedCalls: 0,
      activeCalls: 0,
      activeReservationIds: [],
      inputTokens: 440,
      outputTokens: 50,
      cacheReadTokens: 340,
      totalTokens: 490,
      freshTokens: 150,
      knownCostUsd: 3.5
    })
    expect(recoveredUsage).toEqual([
      expect.objectContaining({
        conversationId: 'conv-detached-success',
        callId: 'detached:run-detached-success:agent-build',
        phase: 'build',
        provider: 'claude',
        costUsd: 2.5,
        inputTokens: 140,
        outputTokens: 20,
        cacheReadTokens: 90
      })
    ])
    expect(
      loadOrchestrationStates(root)
        .find((state) => state.runId === 'run-detached-success')
        ?.phaseOutputs.at(-1)
    ).toEqual({
      phase: 'build',
      text: 'BUILD terminé et vérifié',
      agentToken: 'agent-build'
    })
  })

  it("refuse d'inventer la phase d'un ancien checkpoint même avec un seul journal", () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-unattributed-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'résultat sans attribution causale',
        total_cost_usd: 0.5,
        usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 3 }
      })}\n`
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-unattributed',
      task: 'chantier critique',
      phaseOutputs: [{ phase: 'scout', text: 'scout acquis' }],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 2,
        startedCalls: 2,
        completedCalls: 1,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [{ token: 'agent-legacy', active: true, fanOut: false, journalPath, offset: 0 }],
      startedAt: 1,
      updatedAt: 2
    })

    expect(settleCompletedDetachedPhase(root, 'run-unattributed')).toBeNull()
    expect(loadOrchestrationStates(root)[0].phaseOutputs).toHaveLength(1)
  })

  it.each([
    [
      'codex',
      [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'CODEX réellement terminé' }
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 12, output_tokens: 4, cached_input_tokens: 5 }
        })
      ],
      'CODEX réellement terminé',
      false
    ],
    ['gemini', ['GEMINI réellement terminé'], 'GEMINI réellement terminé', true],
    [
      'kimi',
      [JSON.stringify({ type: 'assistant', message: { content: 'KIMI réellement terminé' } })],
      'KIMI réellement terminé',
      true
    ]
  ])(
    'récupère strictement le succès terminal du provider %s',
    (provider, lines, expectedText, unmetered) => {
      root = mkdtempSync(join(tmpdir(), `reattach-${provider}-`))
      const journalPath = join(root, 'agent.stdout.jsonl')
      writeFileSync(journalPath, `${lines.join('\n')}\n`)
      writeSurvivableExit(journalPath, 0)
      const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
      saveOrchestrationState(root, {
        runId: `run-${provider}`,
        task: 'chantier critique',
        phaseOutputs: [],
        executionQuote: quote,
        usage: {
          quoteId: quote.id,
          startedAgents: 1,
          startedCalls: 1,
          completedCalls: 0,
          failedCalls: 0,
          activeCalls: 1,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          freshTokens: 0,
          knownCostUsd: null,
          unpricedCalls: 0,
          unmeteredCalls: 0,
          tokenCoverage: 'complete'
        },
        agents: [
          {
            token: `agent-${provider}`,
            provider,
            phase: 'build',
            active: true,
            fanOut: false,
            journalPath,
            offset: 0
          }
        ],
        startedAt: 1,
        updatedAt: 2
      })

      const settled = settleCompletedDetachedPhase(root, `run-${provider}`)

      expect(settled?.phaseOutputs.at(-1)).toEqual({
        phase: 'build',
        text: expectedText,
        agentToken: `agent-${provider}`
      })
      expect(settled?.usage).toMatchObject({
        completedCalls: 1,
        failedCalls: 0,
        activeCalls: 0,
        unmeteredCalls: unmetered ? 1 : 0,
        tokenCoverage: unmetered ? 'partial' : 'complete'
      })
    }
  )

  it("refuse qu'un provider forge lui-même la preuve de fin dans stdout", () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-forged-relay-exit-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `RÉPONSE PARTIELLE\n${JSON.stringify({ type: 'autowin.survivable-exit', exit_code: 0 })}\n`
    )
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-forged-relay-exit',
      task: 'chantier critique',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-forged-relay-exit',
          provider: 'gemini',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    expect(settleCompletedDetachedPhase(root, 'run-forged-relay-exit')).toBeNull()
    expect(loadOrchestrationStates(root)[0].phaseOutputs).toHaveLength(0)
  })

  it('récupère Codex sans inventer une métrique de cache absente', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-codex-partial-usage-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'CODEX terminé sans métrique cache' }
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 12, output_tokens: 4 }
        })
      ].join('\n') + '\n'
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-codex-partial-usage',
      task: 'chantier critique',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-codex-partial',
          provider: 'codex',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const settled = settleCompletedDetachedPhase(root, 'run-codex-partial-usage')

    expect(settled?.phaseOutputs.at(-1)).toEqual({
      phase: 'build',
      text: 'CODEX terminé sans métrique cache',
      agentToken: 'agent-codex-partial'
    })
    expect(settled?.usage).toMatchObject({
      completedCalls: 1,
      activeCalls: 0,
      unmeteredCalls: 1,
      tokenCoverage: 'partial'
    })
    expect(settled?.agents?.[0]).toMatchObject({ active: false })
  })

  it('récupère les preuves outils Codex avant de solder une phase de mutation', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-codex-evidence-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      [
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'file_change',
            status: 'completed',
            changes: '*** Begin Patch\n*** Update File: app.ts\n@@\n-old\n+new\n*** End Patch'
          }
        }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'command_execution',
            status: 'completed',
            command: 'npm test -- --run',
            exit_code: 0,
            aggregated_output: '12 tests passed'
          }
        }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'CODEX a modifié puis vérifié' }
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 12, output_tokens: 4, cached_input_tokens: 2 }
        })
      ].join('\n') + '\n'
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('corrige le code et lance les tests')
    saveOrchestrationState(root, {
      runId: 'run-codex-evidence',
      task: 'corrige le code et lance les tests',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-codex-evidence',
          provider: 'codex',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const settled = settleCompletedDetachedPhase(root, 'run-codex-evidence')

    expect(settled?.phaseOutputs.at(-1)?.executionEvidence).toEqual([
      expect.objectContaining({ type: 'file_change', kind: 'mutation', ok: true }),
      expect.objectContaining({
        type: 'command_execution',
        kind: 'verification',
        ok: true,
        command: 'npm test -- --run',
        exitCode: 0,
        stdout: '12 tests passed'
      })
    ])
  })

  it.each([
    ['cache négatif', { input_tokens: 12, output_tokens: 4, cached_input_tokens: -1 }],
    ['champ invalide malgré un autre champ absent', { input_tokens: 'invalide', output_tokens: 4 }],
    ['bloc usage non objet', 'invalide']
  ])('refuse une métrique Codex présente mais corrompue : %s', (_label, rawUsage) => {
    root = mkdtempSync(join(tmpdir(), 'reattach-codex-invalid-usage-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'ne doit pas être soldé' }
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: rawUsage
        })
      ].join('\n') + '\n'
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-codex-invalid-usage',
      task: 'chantier critique',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-codex-invalid',
          provider: 'codex',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    expect(settleCompletedDetachedPhase(root, 'run-codex-invalid-usage')).toBeNull()
  })

  it('refuse un journal non-Claude dont le relais annonce un code de sortie en échec', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-provider-failed-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(journalPath, 'réponse partielle\n')
    writeSurvivableExit(journalPath, 1)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-provider-failed',
      task: 'chantier critique',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-gemini',
          provider: 'gemini',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    expect(settleCompletedDetachedPhase(root, 'run-provider-failed')).toBeNull()
  })

  it('refuse de fabriquer un acquis sans événement terminal de succès', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-failed-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      [
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'ancien succès désormais invalide',
          total_cost_usd: 1,
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'échec final' })
      ].join('\n') + '\n'
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-detached-failed',
      task: 'chantier critique',
      phaseOutputs: [
        { phase: 'scout', text: 'scout acquis' },
        { phase: 'frame', text: 'frame acquis' },
        { phase: 'terrain', text: 'terrain acquis' }
      ],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    expect(settleCompletedDetachedPhase(root, 'run-detached-failed')).toBeNull()
  })

  it('règle un succès terminal AVANT de classer l’appel mort en échec lors de la relance directe', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-direct-success-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'BUILD acquis avant redémarrage',
        total_cost_usd: 0.75,
        usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 20 }
      })}\n`
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-direct-success',
      task: 'chantier critique',
      phaseOutputs: [
        { phase: 'scout', text: 'scout acquis' },
        { phase: 'frame', text: 'frame acquis' },
        { phase: 'terrain', text: 'terrain acquis' }
      ],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 4,
        startedCalls: 4,
        completedCalls: 3,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          pid: 42,
          identity: 'mort',
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const prepared = preparePersistedRunForRelaunch(root, 'run-direct-success', () => undefined)

    expect(prepared?.phaseOutputs.at(-1)).toEqual({
      phase: 'build',
      text: 'BUILD acquis avant redémarrage',
      agentToken: 'agent-build'
    })
    expect(prepared?.usage).toMatchObject({
      completedCalls: 4,
      failedCalls: 0,
      activeCalls: 0,
      knownCostUsd: 0.75
    })
  })

  it.each([
    [
      'son PID et son empreinte prouvent qu’il vit',
      { pid: 4242, identity: 'same-live-process' },
      () => 'same-live-process'
    ],
    ['son PID n’a pas encore été persisté', {}, () => undefined],
    [
      'la sonde de vivacité échoue',
      { pid: 4242, identity: 'same-live-process' },
      () => {
        throw new Error('sonde indisponible')
      }
    ]
  ])('ne règle pas un journal terminal tant que %s', (_label, process, identityOf) => {
    root = mkdtempSync(join(tmpdir(), 'reattach-live-terminal-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'BUILD écrit mais processus encore vivant',
        total_cost_usd: 0.75,
        usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 20 }
      })}\n`
    )
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-live-terminal',
      task: 'chantier critique',
      phaseOutputs: [{ phase: 'scout', text: 'scout acquis' }],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 2,
        startedCalls: 2,
        completedCalls: 1,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build-live',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          ...process,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const prepared = preparePersistedRunForRelaunch(root, 'run-live-terminal', identityOf)

    expect(prepared?.phaseOutputs).toEqual([{ phase: 'scout', text: 'scout acquis' }])
    expect(prepared?.usage).toMatchObject({ activeCalls: 1, completedCalls: 1, failedCalls: 0 })
    expect(prepared?.agents?.[0]).toMatchObject({ active: true })
  })

  it('attend un agent sans PID puis récupère son acquis dès que le relais certifie sa sortie', async () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-pending-certified-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'BUILD terminé après la fenêtre sans PID',
        total_cost_usd: 0.25,
        usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4 }
      })}\n`
    )
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-pending-certified',
      task: 'chantier critique',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build-pending',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const identityOf = (): undefined => undefined
    const beforeExit = loadOrchestrationStates(root).find(
      (state) => state.runId === 'run-pending-certified'
    )
    expect(resumeActionFor(beforeExit, identityOf)).toBe('rattacher')
    expect(
      preparePersistedRunForRelaunch(root, 'run-pending-certified', identityOf)?.usage?.activeCalls
    ).toBe(1)

    let pauses = 0
    const resumeAction = await waitUntilRunCanResume(
      () => {
        const latest = loadOrchestrationStates(root).find(
          (state) => state.runId === 'run-pending-certified'
        )
        return resumeActionFor(latest, identityOf)
      },
      async () => {
        pauses += 1
        writeSurvivableExit(journalPath, 0)
      }
    )
    expect(resumeAction).toBe('relancer')
    expect(pauses).toBe(1)
    const settled = preparePersistedRunForRelaunch(root, 'run-pending-certified', identityOf)
    expect(settled?.phaseOutputs).toContainEqual({
      phase: 'build',
      text: 'BUILD terminé après la fenêtre sans PID',
      agentToken: 'agent-build-pending'
    })
    expect(settled?.usage).toMatchObject({ activeCalls: 0, completedCalls: 1, failedCalls: 0 })
  })

  it('sort de l’attente et réconcilie un échec certifié avant que le PID soit persisté', async () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-pending-failed-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'résultat écrit avant une fermeture en échec',
        total_cost_usd: 0.25,
        usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4 }
      })}\n`
    )
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-pending-failed',
      task: 'chantier critique',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build-pending-failed',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    let pauses = 0
    const action = await waitUntilRunCanResume(
      () =>
        resumeActionFor(
          loadOrchestrationStates(root).find((state) => state.runId === 'run-pending-failed'),
          () => undefined
        ),
      async () => {
        pauses += 1
        if (pauses > 1) throw new Error('le sidecar d’échec n’a pas libéré l’attente')
        writeSurvivableExit(journalPath, 1)
      }
    )

    expect(action).toBe('relancer')
    const prepared = preparePersistedRunForRelaunch(root, 'run-pending-failed', () => undefined)
    expect(prepared?.phaseOutputs).toEqual([])
    expect(prepared?.usage).toMatchObject({ activeCalls: 0, completedCalls: 0, failedCalls: 1 })
  })

  it('refuse un succès Claude si le relais certifie une sortie non nulle', async () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-claude-failed-exit-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'résultat partiel avant exit 1',
        total_cost_usd: 0.25,
        usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4 }
      })}\n`
    )
    writeSurvivableExit(journalPath, 1)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-claude-failed-exit',
      task: 'chantier critique',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-claude-failed-exit',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          pid: 42,
          identity: 'mort',
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const action = await waitUntilRunCanResume(
      () =>
        resumeActionFor(
          loadOrchestrationStates(root).find((state) => state.runId === 'run-claude-failed-exit'),
          () => undefined
        ),
      async () => undefined
    )
    expect(action).toBe('relancer')
    const prepared = preparePersistedRunForRelaunch(root, 'run-claude-failed-exit', () => undefined)
    expect(prepared?.phaseOutputs).toEqual([])
    expect(prepared?.usage).toMatchObject({ activeCalls: 0, completedCalls: 0, failedCalls: 1 })
  })

  it('règle le seul agent courant sans confondre ses journaux historiques', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-current-agent-'))
    const oldJournalPath = join(root, 'scout.stdout.jsonl')
    const currentJournalPath = join(root, 'frame.stdout.jsonl')
    writeFileSync(oldJournalPath, '')
    writeFileSync(
      currentJournalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'FRAME réellement terminé',
        total_cost_usd: 0.5,
        usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 7 }
      })}\n`
    )
    writeSurvivableExit(currentJournalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-current-agent',
      task: 'chantier critique',
      phaseOutputs: [{ phase: 'scout', text: 'scout acquis' }],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 2,
        startedCalls: 2,
        completedCalls: 1,
        failedCalls: 0,
        activeCalls: 1,
        activeReservationIds: ['reservation-frame'],
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        totalTokens: 2,
        freshTokens: 2,
        knownCostUsd: 1,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-scout',
          phase: 'scout',
          active: false,
          fanOut: false,
          journalPath: oldJournalPath,
          offset: 0
        },
        {
          token: 'agent-frame',
          reservationId: 'reservation-frame',
          provider: 'claude',
          phase: 'frame',
          active: true,
          fanOut: false,
          pid: 43,
          identity: 'mort',
          journalPath: currentJournalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const settled = preparePersistedRunForRelaunch(root, 'run-current-agent', () => undefined)

    expect(settled?.phaseOutputs).toEqual([
      { phase: 'scout', text: 'scout acquis' },
      {
        phase: 'frame',
        text: 'FRAME réellement terminé',
        agentToken: 'agent-frame'
      }
    ])
    expect(settled?.usage).toMatchObject({ activeCalls: 0, completedCalls: 2, failedCalls: 0 })

    const repeatedJournalPath = join(root, 'frame-retry.stdout.jsonl')
    writeFileSync(
      repeatedJournalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'FRAME rejoué réellement terminé',
        total_cost_usd: 0.25,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 }
      })}\n`
    )
    writeSurvivableExit(repeatedJournalPath, 0)
    saveOrchestrationState(root, {
      ...settled!,
      usage: {
        ...settled!.usage!,
        startedAgents: 3,
        startedCalls: 3,
        activeCalls: 1,
        activeReservationIds: ['reservation-frame-retry']
      },
      agents: [
        ...settled!.agents!.map((agent) => ({ ...agent, active: false })),
        {
          token: 'agent-frame-retry',
          reservationId: 'reservation-frame-retry',
          provider: 'claude',
          phase: 'frame',
          active: true,
          fanOut: false,
          journalPath: repeatedJournalPath,
          offset: 0
        }
      ]
    })

    const repeated = settleCompletedDetachedPhase(root, 'run-current-agent')
    expect(repeated?.phaseOutputs.slice(-2)).toEqual([
      {
        phase: 'frame',
        text: 'FRAME réellement terminé',
        agentToken: 'agent-frame'
      },
      {
        phase: 'frame',
        text: 'FRAME rejoué réellement terminé',
        agentToken: 'agent-frame-retry'
      }
    ])
  })

  it('règle une reprise terminée de la même phase après onProcess(false)', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-repeated-phase-inactive-'))
    const journalPath = join(root, 'frame-current.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'FRAME COURANT TERMINE',
        total_cost_usd: 0.2,
        usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 3 }
      })}\n`
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-repeated-phase-inactive',
      task: 'chantier critique',
      phaseOutputs: [{ phase: 'frame', text: 'FRAME HISTORIQUE' }],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 2,
        startedCalls: 2,
        completedCalls: 1,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        totalTokens: 2,
        freshTokens: 2,
        knownCostUsd: 0.1,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-frame-current',
          provider: 'claude',
          phase: 'frame',
          active: false,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const settled = settleCompletedDetachedPhase(root, 'run-repeated-phase-inactive')

    expect(settled?.phaseOutputs).toEqual([
      { phase: 'frame', text: 'FRAME HISTORIQUE' },
      {
        phase: 'frame',
        text: 'FRAME COURANT TERMINE',
        agentToken: 'agent-frame-current'
      }
    ])
    expect(settled?.usage).toMatchObject({
      activeCalls: 0,
      completedCalls: 2,
      failedCalls: 0
    })
  })

  it('attribue au juge terminal son résultat même si le devis ne liste que les phases exec', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-terminal-judge-'))
    const journalPath = join(root, 'judge.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'VALIDE',
        total_cost_usd: 0.2,
        usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 4 }
      })}\n`
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    const phaseOutputs = quote.phases.map((phase) => ({ phase, text: `${phase} acquis` }))
    const judgeState = {
      runId: 'run-terminal-judge',
      task: 'chantier critique',
      phaseOutputs,
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: phaseOutputs.length + 1,
        startedCalls: phaseOutputs.length + 1,
        completedCalls: phaseOutputs.length,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-judge',
          provider: 'claude',
          phase: 'judge',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    } satisfies Parameters<typeof saveOrchestrationState>[1]

    saveOrchestrationState(root, {
      ...judgeState,
      agents: judgeState.agents.map((agent) => ({ ...agent, fanOut: true }))
    })
    expect(settleCompletedDetachedPhase(root, 'run-terminal-judge')).toBeNull()
    saveOrchestrationState(root, judgeState)

    const settled = settleCompletedDetachedPhase(root, 'run-terminal-judge')

    expect(settled?.phaseOutputs.at(-1)).toEqual({
      phase: 'judge',
      text: 'VALIDE',
      agentToken: 'agent-judge'
    })
    expect(settled?.usage).toMatchObject({
      activeCalls: 0,
      completedCalls: phaseOutputs.length + 1
    })
  })

  it.each([
    ['cache absent', { input_tokens: 1, output_tokens: 1 }, 1, false],
    [
      'cache non numérique',
      { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 'corrompu' },
      1,
      false
    ],
    [
      'métrique négative',
      { input_tokens: -1, output_tokens: 1, cache_read_input_tokens: 0 },
      1,
      false
    ],
    [
      'métrique fractionnaire',
      { input_tokens: 1.5, output_tokens: 1, cache_read_input_tokens: 0 },
      1,
      false
    ],
    [
      'somme input + cache hors entier sûr',
      {
        input_tokens: Number.MAX_SAFE_INTEGER,
        output_tokens: 1,
        cache_read_input_tokens: Number.MAX_SAFE_INTEGER
      },
      1,
      false
    ],
    [
      'création de cache présente mais invalide',
      {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 'corrompu'
      },
      1,
      false
    ],
    [
      'somme input + création de cache hors entier sûr',
      {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: Number.MAX_SAFE_INTEGER
      },
      1,
      false
    ],
    ['coût négatif', { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }, -1, false],
    [
      'coût non numérique',
      { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      'corrompu',
      false
    ],
    [
      'coût non fini',
      { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      Number.POSITIVE_INFINITY,
      false
    ],
    [
      'is_error texte',
      { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      1,
      'true'
    ],
    ['is_error numérique', { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }, 1, 0],
    ['is_error null', { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }, 1, null]
  ])(
    'refuse un succès dont les métriques sont invalides : %s',
    (_label, usage, costUsd, isError) => {
      root = mkdtempSync(join(tmpdir(), 'reattach-invalid-usage-'))
      const journalPath = join(root, 'agent.stdout.jsonl')
      writeFileSync(
        journalPath,
        `${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: isError,
          result: 'succès aux métriques invalides',
          total_cost_usd: costUsd,
          usage
        })}\n`
      )
      writeSurvivableExit(journalPath, 0)
      const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
      saveOrchestrationState(root, {
        runId: 'run-invalid-usage',
        task: 'chantier critique',
        phaseOutputs: [
          { phase: 'scout', text: 'scout acquis' },
          { phase: 'frame', text: 'frame acquis' },
          { phase: 'terrain', text: 'terrain acquis' }
        ],
        executionQuote: quote,
        usage: {
          quoteId: quote.id,
          startedAgents: 1,
          startedCalls: 1,
          completedCalls: 0,
          failedCalls: 0,
          activeCalls: 1,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          freshTokens: 0,
          knownCostUsd: 0,
          unpricedCalls: 0,
          unmeteredCalls: 0,
          tokenCoverage: 'complete'
        },
        agents: [
          {
            token: 'agent-build',
            provider: 'claude',
            phase: 'build',
            active: true,
            fanOut: false,
            journalPath,
            offset: 0
          }
        ],
        startedAt: 1,
        updatedAt: 2
      })

      expect(settleCompletedDetachedPhase(root, 'run-invalid-usage')).toBeNull()
    }
  )

  it('refuse un succès si son ajout ferait déborder les compteurs persistés', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-overflow-prior-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'succès qui ferait déborder le cumul',
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0 }
      })}\n`
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-overflow-prior',
      task: 'chantier critique',
      phaseOutputs: [
        { phase: 'scout', text: 'scout acquis' },
        { phase: 'frame', text: 'frame acquis' },
        { phase: 'terrain', text: 'terrain acquis' }
      ],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 4,
        startedCalls: 4,
        completedCalls: 3,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
        freshTokens: Number.MAX_SAFE_INTEGER,
        knownCostUsd: 0,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    expect(settleCompletedDetachedPhase(root, 'run-overflow-prior')).toBeNull()
    expect(loadOrchestrationStates(root)).toHaveLength(1)
  })

  it('refuse un coût positif absorbé par la précision du cumul existant', () => {
    root = mkdtempSync(join(tmpdir(), 'reattach-cost-precision-'))
    const journalPath = join(root, 'agent.stdout.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'succès dont le coût doit rester compté',
        total_cost_usd: 0.01,
        usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0 }
      })}\n`
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('refonte architecture sécurité migration critique')
    saveOrchestrationState(root, {
      runId: 'run-cost-precision',
      task: 'chantier critique',
      phaseOutputs: [
        { phase: 'scout', text: 'scout acquis' },
        { phase: 'frame', text: 'frame acquis' },
        { phase: 'terrain', text: 'terrain acquis' }
      ],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 4,
        startedCalls: 4,
        completedCalls: 3,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: 10_000_000_000_000_000,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-build',
          provider: 'claude',
          phase: 'build',
          active: true,
          fanOut: false,
          journalPath,
          offset: 0
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    expect(settleCompletedDetachedPhase(root, 'run-cost-precision')).toBeNull()
    expect(loadOrchestrationStates(root)[0].usage?.knownCostUsd).toBe(10_000_000_000_000_000)
  })
})

/**
 * Le risque le plus grave de la survie des runs : au redémarrage, l'app relançait le travail SANS
 * vérifier qu'un agent tournait encore. Deux agents sur la même copie s'écrasent l'un l'autre.
 */
describe('un agent est-il encore au travail ?', () => {
  const vivant = () => 'demarre-a-100|C:/cli.exe'

  it('processus disparu → terminé', () => {
    expect(agentVerdict({ token: 't', pid: 42, identity: vivant() }, () => undefined).state).toBe(
      'termine'
    )
  })

  it('même pid, même empreinte → vivant', () => {
    expect(agentVerdict({ token: 't', pid: 42, identity: vivant() }, vivant).state).toBe('vivant')
  })

  it('même pid et même démarrage, chemin devenu lisible → vivant', () => {
    expect(
      agentVerdict(
        { token: 't', pid: 42, identity: '638904000000000000|' },
        () => '638904000000000000|C:\\Tools\\claude.exe'
      ).state
    ).toBe('vivant')
  })

  it('même pid et même démarrage, chemin devenu illisible → vivant', () => {
    expect(
      agentVerdict(
        { token: 't', pid: 42, identity: '638904000000000000|C:\\Tools\\claude.exe' },
        () => '638904000000000000|'
      ).state
    ).toBe('vivant')
  })

  it('même pid, empreinte DIFFÉRENTE → pid recyclé, pas notre agent', () => {
    // Sans ce contrôle, un processus étranger ayant hérité du numéro ferait croire que l'agent
    // travaille encore — et le run ne reprendrait jamais.
    const verdict = agentVerdict({ token: 't', pid: 42, identity: vivant() }, () => 'autre|X.exe')
    expect(verdict.state).toBe('pid-recycle')
  })

  it('sans pid connu → inconnu, on n’affirme rien', () => {
    expect(agentVerdict({ token: 't' }, vivant).state).toBe('inconnu')
  })

  it('sonde en échec → inconnu plutôt qu’un verdict inventé', () => {
    const verdict = agentVerdict({ token: 't', pid: 42 }, () => {
      throw new Error('sonde indisponible')
    })
    expect(verdict.state).toBe('inconnu')
  })

  it('pid vivant SANS empreinte capturée → on penche vers vivant', () => {
    // Relancer par-dessus un agent réel coûte plus cher qu'attendre : le doute profite à la prudence.
    expect(agentVerdict({ token: 't', pid: 42 }, vivant).state).toBe('vivant')
  })
})

describe('que faire du run au démarrage', () => {
  const mort = (): undefined => undefined
  const vivant = (): string => 'sig'

  it('un seul agent vivant suffit à INTERDIRE la relance', () => {
    const state = {
      agents: [
        { token: 'a', pid: 1, identity: 'sig' },
        { token: 'b', pid: 2, identity: 'autre' }
      ],
      phaseOutputs: []
    }
    const liveness = runLiveness(state, (pid) => (pid === 1 ? 'sig' : undefined))
    expect(liveness.working).toBe(true)
    expect(resumeActionFor(state, (pid) => (pid === 1 ? 'sig' : undefined))).toBe('rattacher')
  })

  it.each([
    ['PID pas encore persisté', { token: 'a', active: true }, () => undefined],
    [
      'sonde tri-état incertaine',
      { token: 'a', active: true, pid: 1, identity: 'sig' },
      () => null
    ],
    [
      'sonde qui lève',
      { token: 'a', active: true, pid: 1, identity: 'sig' },
      () => {
        throw new Error('sonde indisponible')
      }
    ]
  ])('un agent actif inconnu reste rattaché : %s', (_label, agent, identityOf) => {
    expect(resumeActionFor({ agents: [agent], phaseOutputs: [] }, identityOf)).toBe('rattacher')
  })

  it('un ancien agent inactif inconnu ne bloque pas la relance', () => {
    expect(
      resumeActionFor({ agents: [{ token: 'a', active: false }], phaseOutputs: [] }, () => null)
    ).toBe('relancer')
  })

  it('un agent historique inactif terminé → on relance', () => {
    const state = {
      agents: [{ token: 'a', pid: 1, identity: 'sig', active: false }],
      phaseOutputs: []
    }
    expect(resumeActionFor(state, mort)).toBe('relancer')
  })

  it('un appel actif terminé sans preuve récupérable est bloqué, jamais relancé', () => {
    const state = {
      agents: [{ token: 'a', pid: 1, identity: 'sig', active: true }],
      phaseOutputs: []
    }
    expect(resumeActionFor(state, mort)).toBe('bloquer')
  })

  it('un run sans agent et sans réservation active peut se relancer', () => {
    expect(resumeActionFor({ agents: [], phaseOutputs: [] }, vivant)).toBe('relancer')
  })

  it('une réservation active sans aucun agent identifiable est bloquée, jamais relancée', () => {
    expect(
      resumeActionFor(
        {
          agents: [],
          phaseOutputs: [],
          usage: { activeCalls: 1 }
        },
        vivant
      )
    ).toBe('bloquer')
  })

  it('aucun run à reprendre → on ne fait rien', () => {
    expect(resumeActionFor(null, vivant)).toBe('ignorer')
  })
})

describe('réconciliation persistée avant relance', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('terminalise et solde une réservation historique sans agent identifiable', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-orphan-reservation-'))
    roots.push(root)
    const quote = compileExecutionQuote('corrige puis teste')
    saveOrchestrationState(root, {
      runId: 'run-orphan-reservation',
      task: 'corrige puis teste',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [],
      startedAt: 1,
      updatedAt: 2
    })

    const terminal = terminalizeInterruptedPersistedRun(
      root,
      'run-orphan-reservation',
      () => undefined,
      9
    )

    expect(terminal?.terminal).toMatchObject({ status: 'interrupted' })
    expect(terminal?.usage).toMatchObject({
      activeCalls: 0,
      failedCalls: 1,
      unpricedCalls: 1,
      unmeteredCalls: 1,
      tokenCoverage: 'partial'
    })
    expect(resumeActionFor(terminal, () => undefined)).toBe('ignorer')
  })

  it('un PID historique inactif ne masque pas une réservation orpheline', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-inactive-pid-'))
    roots.push(root)
    const quote = compileExecutionQuote('corrige puis teste')
    saveOrchestrationState(root, {
      runId: 'run-inactive-pid-reservation',
      task: 'corrige puis teste',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [{ token: 'historique', active: false, pid: 42 }],
      startedAt: 1,
      updatedAt: 2
    })

    const terminal = terminalizeInterruptedPersistedRun(
      root,
      'run-inactive-pid-reservation',
      () => 'processus-sans-rapport',
      9
    )

    expect(terminal?.terminal?.status).toBe('interrupted')
    expect(terminal?.usage?.activeCalls).toBe(0)
  })

  it('classe l’appel actif comme échoué seulement après preuve que son PID est mort', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-dead-'))
    roots.push(root)
    const journalPath = join(root, 'provider-exit-1.jsonl')
    writeFileSync(journalPath, '')
    writeSurvivableExit(journalPath, 1)
    saveOrchestrationState(root, {
      runId: 'run-dead-provider',
      task: 'reprendre sans doubler',
      phaseOutputs: [{ phase: 'build', text: 'acquis' }],
      usage: {
        quoteId: 'quote-1',
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        activeReservationIds: ['reservation-agent-1'],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-1',
          reservationId: 'reservation-agent-1',
          pid: 42,
          identity: 'ancienne-identité',
          active: true,
          journalPath
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(root, 'run-dead-provider', () => undefined, 9)

    expect(reconciled?.usage).toMatchObject({
      activeCalls: 0,
      failedCalls: 1,
      unpricedCalls: 1,
      unmeteredCalls: 1,
      tokenCoverage: 'partial'
    })
    expect(loadOrchestrationStates(root)[0]).toEqual(reconciled)
    expect(reconciled?.updatedAt).toBe(9)
  })

  it('terminalise sans retry un appel dont le PID est mort sans preuve récupérable', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-dead-unproven-'))
    roots.push(root)
    saveOrchestrationState(root, {
      runId: 'run-dead-unproven-provider',
      task: 'ne jamais doubler',
      phaseOutputs: [],
      usage: {
        quoteId: 'quote-1',
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [{ token: 'agent-1', pid: 42, identity: 'ancienne-identité', active: true }],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(
      root,
      'run-dead-unproven-provider',
      () => undefined,
      9
    )

    expect(reconciled?.terminal).toEqual({
      status: 'interrupted',
      reason: 'PID provider disparu sans preuve de sortie — relance automatique interdite',
      decidedAt: 9
    })
    expect(reconciled?.usage).toMatchObject({
      activeCalls: 0,
      failedCalls: 1,
      unpricedCalls: 1,
      unmeteredCalls: 1,
      tokenCoverage: 'partial'
    })
    expect(reconciled?.agents?.[0]).toMatchObject({ active: false })
    expect(reconciled?.updatedAt).toBe(9)
    expect(resumeActionFor(reconciled, () => undefined)).toBe('ignorer')

    const secondPass = preparePersistedRunForRelaunch(
      root,
      'run-dead-unproven-provider',
      () => undefined,
      12
    )
    expect(secondPass).toEqual(reconciled)
  })

  it('termine le PID identifie mais bloque lorsque son journal a expire', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-stale-live-'))
    roots.push(root)
    saveOrchestrationState(root, {
      runId: 'run-stale-live-provider',
      task: 'ne jamais attendre indefiniment',
      phaseOutputs: [],
      usage: {
        quoteId: 'quote-1',
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-1',
          pid: 42,
          identity: 'identite-live',
          active: true,
          journalPath: join(root, 'agent.jsonl')
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })
    let terminatedPid: number | undefined
    const terminatePid = (pid: number): boolean => {
      terminatedPid = pid
      return true
    }

    const reconciled = terminalizeInterruptedPersistedRun(
      root,
      'run-stale-live-provider',
      () => 'identite-live',
      20 * 60_000,
      false,
      { lastWriteMs: () => 1, terminatePid }
    )

    expect(terminatedPid).toBe(42)
    expect(reconciled?.terminal?.status).toBe('interrupted')
    expect(reconciled?.usage?.activeCalls).toBe(0)
  })

  it('ne relance jamais un exit=0 dont le résultat terminal est non décodable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-exit-zero-invalid-'))
    roots.push(root)
    const journalPath = join(root, 'claude-invalid-usage.jsonl')
    writeFileSync(
      journalPath,
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'travail potentiellement facturé',
        usage: { input_tokens: 10, output_tokens: 4 }
      })}\n`
    )
    writeSurvivableExit(journalPath, 0)
    const quote = compileExecutionQuote('reprendre sans double coût')
    saveOrchestrationState(root, {
      runId: 'run-exit-zero-invalid',
      task: 'reprendre sans double coût',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        activeReservationIds: ['reservation-exit-zero'],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-exit-zero',
          reservationId: 'reservation-exit-zero',
          provider: 'claude',
          phase: 'build',
          fanOut: false,
          active: true,
          pid: 42,
          identity: 'ancienne-identité',
          journalPath
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(
      root,
      'run-exit-zero-invalid',
      () => undefined,
      9
    )

    expect(reconciled?.usage).toMatchObject({ activeCalls: 1, failedCalls: 0 })
    let executeCalled = false
    await expect(
      new ExecutionSupervisor().run(
        quote,
        undefined,
        async () => {
          executeCalled = true
          return 'ne doit jamais partir'
        },
        reconciled?.usage
      )
    ).rejects.toThrow(/appel.*actif|activeCalls/i)
    expect(executeCalled).toBe(false)
  })

  it.each([
    ['appel actif avant échec historique', false],
    ['échec historique avant appel actif', true]
  ])(
    'ne laisse jamais un fan-out historique libérer le mauvais appel — %s',
    async (_label, reverseAgents) => {
      const root = mkdtempSync(join(tmpdir(), 'autowin-resume-causal-reservation-'))
      roots.push(root)
      const activeJournal = join(root, 'active-exit-zero-invalid.jsonl')
      const historicalJournal = join(root, 'historical-exit-one.jsonl')
      writeFileSync(
        activeJournal,
        `${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'appel A potentiellement facturé',
          usage: { input_tokens: 10, output_tokens: 4 }
        })}\n`
      )
      writeSurvivableExit(activeJournal, 0)
      writeFileSync(historicalJournal, '')
      writeSurvivableExit(historicalJournal, 1)
      const quote = compileExecutionQuote('reprendre le bon membre du fan-out')
      const activeAgent = {
        token: 'agent-a-active',
        provider: 'claude',
        phase: 'build' as const,
        fanOut: false,
        active: true,
        reservationId: 'reservation-a-active',
        pid: 41,
        identity: 'ancienne-identité-a',
        journalPath: activeJournal
      }
      const historicalAgent = {
        token: 'agent-b-historical-failure',
        provider: 'claude',
        phase: 'build' as const,
        fanOut: true,
        active: false,
        reservationId: 'reservation-b-historical',
        pid: 42,
        identity: 'ancienne-identité-b',
        journalPath: historicalJournal
      }
      const validState: Parameters<typeof saveOrchestrationState>[1] = {
        runId: `run-causal-reservation-${reverseAgents ? 'reverse' : 'forward'}`,
        task: 'reprendre le bon membre du fan-out',
        phaseOutputs: [],
        executionQuote: quote,
        usage: {
          quoteId: quote.id,
          startedAgents: 2,
          startedCalls: 2,
          completedCalls: 0,
          failedCalls: 1,
          activeCalls: 1,
          activeReservationIds: ['reservation-a-active'],
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          freshTokens: 0,
          knownCostUsd: null,
          unpricedCalls: 1,
          unmeteredCalls: 1,
          tokenCoverage: 'partial'
        },
        agents: reverseAgents ? [historicalAgent, activeAgent] : [activeAgent, historicalAgent],
        startedAt: 1,
        updatedAt: 2
      }
      saveOrchestrationState(root, validState)
      expect(() =>
        saveOrchestrationState(root, {
          ...validState,
          usage: {
            ...validState.usage!,
            activeReservationIds: ['reservation-b-historical']
          }
        })
      ).toThrow(/checkpoint.*causalement invalide/i)
      const runId = `run-causal-reservation-${reverseAgents ? 'reverse' : 'forward'}`

      const reconciled = preparePersistedRunForRelaunch(root, runId, () => undefined, 9)

      expect(reconciled?.usage).toMatchObject({ activeCalls: 1, failedCalls: 1 })
      let executeCalled = false
      await expect(
        new ExecutionSupervisor().run(
          quote,
          undefined,
          async () => {
            executeCalled = true
            return 'ne doit jamais partir'
          },
          reconciled?.usage
        )
      ).rejects.toThrow(/appel.*actif|activeCalls/i)
      expect(executeCalled).toBe(false)
    }
  )

  it('libère un fan-out terminé après crash pour que la phase soit rejouée au lieu de rester bloquée', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-fanout-success-'))
    roots.push(root)
    const quote = compileExecutionQuote('scoute puis améliore la vue')
    const journals = ['a', 'b'].map((suffix) => {
      const journalPath = join(root, `fanout-${suffix}.jsonl`)
      writeFileSync(
        journalPath,
        `${JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: `résultat ${suffix}`,
          total_cost_usd: 0.1,
          usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 0 }
        })}\n`
      )
      writeSurvivableExit(journalPath, 0)
      return journalPath
    })
    saveOrchestrationState(root, {
      runId: 'run-fanout-success',
      task: 'scoute puis améliore la vue',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 2,
        startedCalls: 2,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 2,
        activeReservationIds: ['reservation-a', 'reservation-b'],
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: journals.map((journalPath, index) => ({
        token: `agent-${index}`,
        reservationId: index === 0 ? 'reservation-a' : 'reservation-b',
        provider: 'claude',
        phase: 'scout' as const,
        active: true,
        fanOut: true,
        pid: 40 + index,
        identity: `ancienne-identité-${index}`,
        journalPath
      })),
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(
      root,
      'run-fanout-success',
      () => undefined,
      9
    )

    expect(reconciled?.usage).toMatchObject({ activeCalls: 0, failedCalls: 2 })
    expect(reconciled?.agents?.every((agent) => agent.active === false)).toBe(true)
    expect(resumeActionFor(reconciled, () => undefined)).toBe('relancer')
  })

  it('ne libère pas un appel legacy sans provenance avec un ancien échec inactif', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-legacy-inactive-failure-'))
    roots.push(root)
    const historicalJournal = join(root, 'historical-exit-one.jsonl')
    writeFileSync(historicalJournal, '')
    writeSurvivableExit(historicalJournal, 1)
    const quote = compileExecutionQuote('conserver un appel legacy incertain')
    saveOrchestrationState(root, {
      runId: 'run-legacy-inactive-failure',
      task: 'conserver un appel legacy incertain',
      phaseOutputs: [],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 2,
        startedCalls: 2,
        completedCalls: 0,
        failedCalls: 1,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 1,
        unmeteredCalls: 1,
        tokenCoverage: 'partial'
      },
      agents: [
        {
          token: 'agent-historique-inactif',
          provider: 'claude',
          phase: 'build',
          fanOut: false,
          active: false,
          journalPath: historicalJournal
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(
      root,
      'run-legacy-inactive-failure',
      () => undefined,
      9
    )

    expect(reconciled?.usage).toMatchObject({ activeCalls: 1, failedCalls: 1 })
    let executeCalled = false
    await expect(
      new ExecutionSupervisor().run(
        quote,
        undefined,
        async () => {
          executeCalled = true
          return 'ne doit jamais partir'
        },
        reconciled?.usage
      )
    ).rejects.toThrow(/appel.*actif|activeCalls/i)
    expect(executeCalled).toBe(false)
  })

  it('ne touche pas au compteur si la preuve de mort est incomplète', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-unknown-'))
    roots.push(root)
    saveOrchestrationState(root, {
      runId: 'run-unknown-provider',
      task: 'ne pas doubler',
      phaseOutputs: [],
      usage: {
        quoteId: 'quote-1',
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [{ token: 'agent-1' }],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(
      root,
      'run-unknown-provider',
      () => undefined,
      9
    )

    expect(reconciled?.usage?.activeCalls).toBe(1)
    expect(reconciled?.updatedAt).toBe(2)
  })

  it('rend réellement le snapshot admissible au supervisor après disparition du PID', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-supervisor-'))
    roots.push(root)
    const journalPath = join(root, 'provider-supervisor-exit-1.jsonl')
    writeFileSync(journalPath, '')
    writeSurvivableExit(journalPath, 1)
    const quote = compileExecutionQuote('reprendre le build interrompu')
    saveOrchestrationState(root, {
      runId: 'run-supervisor-retry',
      task: 'reprendre le build interrompu',
      phaseOutputs: [{ phase: 'build', text: 'acquis' }],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      },
      agents: [
        {
          token: 'agent-1',
          pid: 42,
          identity: 'ancienne-identité',
          active: true,
          journalPath
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(root, 'run-supervisor-retry', () => undefined)
    // Reservation d'un appel ORPHELIN : une PART du budget, `cap / appels restants`. Elle suit donc
    // le prereglage du regime, et ces litteraux en sont l'arithmetique exacte :
    //   6 000 000 / 40 = 150 000  ·  750 000 / 40 = 18 750   (`maxProviderCalls` standard, 40).
    // Ils valaient 500 000 / 62 500 quand ce prereglage etait a 12, releve le 2026-08-25 apres deux
    // tours tues sur un compteur d'ETAPES. Les budgets EUX-MEMES (6 M / 750 k) n'ont pas bouge : la
    // part est plus petite parce qu'il y a plus de parts, pas parce que la garde s'est relachee.
    // Si un prereglage rebouge, ce test doit redevenir ROUGE — c'est sa raison d'etre.
    expect(reconciled?.usage).toMatchObject({
      totalTokens: 150_000,
      freshTokens: 18_750,
      unpricedCalls: 1,
      unmeteredCalls: 1
    })
    let executeCalled = false

    await expect(
      new ExecutionSupervisor().run(
        quote,
        undefined,
        async () => {
          executeCalled = true
          return 'repris'
        },
        reconciled?.usage
      )
    ).resolves.toBe('repris')
    expect(executeCalled).toBe(true)
  })
})

/**
 * CÂBLAGE. La logique de vivacité ne sert à rien si le démarrage ne la consulte pas — c'était
 * précisément le défaut : la reprise relançait sans jamais poser la question.
 */
describe('câblage — le démarrage consulte la garde avant de relancer', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

  it('parcourt TOUS les runs reprenables plutôt qu’un seul', () => {
    expect(source).toContain('const resumableRuns = os.resumableOrchestrations()')
    expect(source).toContain('for (const resumableRun of resumableRuns)')
    expect(source).not.toContain('const resumableRun = os.resumableOrchestration()')
  })

  it('terminalise les PID morts avant de décider quels tours restent streaming', () => {
    const reconciliation = source.indexOf('os.terminalizeAbandonedOrchestrations(')
    const hydration = source.indexOf('const resumableTurnIds = new Set([')
    expect(reconciliation).toBeGreaterThanOrEqual(0)
    expect(hydration).toBeGreaterThan(reconciliation)
  })

  it('la reprise au démarrage passe par resumeActionFor', () => {
    expect(source).toContain('const reprise = resumeActionFor(')
    expect(source).toContain('persistedJournalLastWriteMs')
  })

  it('elle ne relance QUE si le verdict est « relancer »', () => {
    expect(source).toContain("if (reprise === 'relancer') {")
    expect(source).toContain(
      'void startupResumeQueue.enqueue(() => relaunchResumableRun(resumableRun))'
    )
  })

  it('serialise globalement les reprises de plusieurs conversations', () => {
    expect(source).toContain('const startupResumeQueue = new StartupResumeQueue()')
    expect(source).toContain('await startupResumeQueue.enqueue(() => relaunchResumableRun(latest))')
    // `await resumedRuntime` vivait ici : la relance est sortie dans son propre module et le fait
    // qu'elle ATTENDE la fin de son run — la condition qui rend cette file serialisable — est
    // desormais exerce : relaunch-resumable-run.test.ts > « ne rend la main qu une fois le run
    // termine ». Une chaine presente ne prouvait pas que la promesse etait reellement attendue.
  })

  /**
   * La reconciliation des appels morts est APPELEE dans le test du module extrait, et son REFUS y
   * arrete la relance (« n engage rien quand la reconciliation refuse le checkpoint ») — plus fort
   * qu'un `toContain` qui survivait a un resultat ignore.
   */

  it('un agent encore au travail est SIGNALÉ, pas passé sous silence', () => {
    expect(source).toContain('un agent travaille ENCORE')
  })

  it("publie un échec durable à l'expiration sans relancer le provider incertain", () => {
    expect(source).toContain("if ((action === 'ignorer' || action === 'bloquer') && latest)")
    expect(source).toContain('Rattachement expiré sans preuve de fin')
    expect(source).toContain('durableLiveReattachment?.fail(reason, false)')
  })

  it('publie immédiatement un échec durable pour une terminaison non prouvée', () => {
    expect(source).toContain("if (reprise === 'bloquer') {")
    expect(source).toContain('relance bloquée pour éviter un double coût')
  })
})

/**
 * CÂBLAGE DU REJEU. Détecter l'agent vivant ne suffit pas : sans relecture de son journal, le
 * travail produit pendant l'absence reste invisible — donc réputé perdu, donc relancé à la main.
 */
describe('câblage — le démarrage rejoue le journal et mémorise où il s’est arrêté', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
  const bloc = source.slice(
    source.indexOf("if ((reprise === 'rattacher' || reprise === 'bloquer')")
  )

  it('il relit chaque journal DEPUIS l’offset déjà lu', () => {
    expect(bloc).toContain('tailJournalOnce(agent.journalPath, agent.offset ?? 0')
  })

  it('il remet le récapitulatif dans la conversation', () => {
    expect(bloc).toContain('os.conversations.append(conversationId')
  })

  it('il repersiste l’offset atteint — sinon le même texte serait remontré', () => {
    expect(bloc).toContain('os.rememberAgentOffsets(resumableRun.runId, agentsApres)')
  })

  it('un échec de rattachement ne casse pas le démarrage', () => {
    expect(bloc).toContain('rattachement impossible')
  })
})

describe('surveillance continue apres rattachement', () => {
  it("relance des la sortie de l'agent sans exiger un nouveau redemarrage", async () => {
    const actions = ['rattacher', 'rattacher', 'relancer'] as const
    let reads = 0
    let waits = 0

    const result = await waitUntilRunCanResume(
      () => actions[Math.min(reads++, actions.length - 1)],
      async () => {
        waits += 1
      }
    )

    expect(result).toBe('relancer')
    expect(reads).toBe(3)
    expect(waits).toBe(2)
  })

  it("borne l'attente si aucune preuve de fin n'arrive jamais", async () => {
    let waits = 0

    const result = await waitUntilRunCanResume(
      () => 'rattacher',
      async () => {
        waits += 1
        if (waits > 2) throw new Error('attente non bornée')
      },
      2
    )

    expect(result).toBe('ignorer')
    expect(waits).toBe(2)
  })
})

/**
 * LA CAUSE RACINE DU RUN ZOMBIE — l'empreinte n'était JAMAIS capturée.
 *
 * `agentVerdict` ne peut distinguer « notre agent vit encore » de « un inconnu a hérité du pid »
 * que si l'empreinte a été relevée AU LANCEMENT (`orchestrator.ts` : `this.deps.processIdentity`).
 * Or `os.ts` ne fournissait pas cette sonde : aucun agent persisté ne portait d'`identity`, donc
 * `agentVerdict` retombait sur son défaut prudent « vivant » — À VIE.
 *
 * Constaté sur l'état réel le 2026-08-07 : `run-state/run-135d936755f8-1.json` porte
 * `{"token":…,"journalPath":…,"pid":5396}` — sans `identity`. Conséquence dans conv-1056 : le
 * démarrage concluait « rattacher » à chaque fois, rouvrait le tour en `streaming` et empilait
 * quatre fois « l'agent … travaille encore ». Le run ne pouvait JAMAIS être déclaré terminé.
 */
describe('câblage — l’empreinte du processus est réellement capturée au lancement', () => {
  const source = readFileSync(join(__dirname, '..', 'os.ts'), 'utf8')

  it('os.ts fournit la sonde d’empreinte à l’orchestrateur', () => {
    expect(source).toContain('processIdentity: defaultProcessIdentity')
  })

  it('sans empreinte capturée, un pid vivant reste présumé vivant — le défaut à ne pas subir', () => {
    // Le comportement lui-même est correct et volontaire ; ce qui manquait, c'est la capture.
    expect(agentVerdict({ token: 'a', pid: 42 }, () => 'inconnu|autre.exe').state).toBe('vivant')
    // Avec l'empreinte, le pid recyclé est démasqué et le run peut enfin être déclaré terminé.
    expect(
      agentVerdict({ token: 'a', pid: 42, identity: 'nous' }, () => 'inconnu|autre.exe').state
    ).toBe('pid-recycle')
  })
})

/**
 * CÂBLAGE DE LA SORTIE D'ATTENTE. Clore le tour au chargement ne sert à rien si le démarrage ne
 * dit pas QUELS tours vont réellement reprendre : sans ce discriminant, un run repris serait
 * annoncé interrompu, ou — le défaut mesuré — aucun tour ne serait annoncé du tout.
 */
describe('câblage — le chargement des conversations connaît les runs reprenables', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

  it('persistConversations reçoit les tours des checkpoints encore sur disque', () => {
    expect(source).toContain('resumableTurnIds')
    expect(source).toMatch(/persistConversations\(\s*os\.conversations/)
  })
})
