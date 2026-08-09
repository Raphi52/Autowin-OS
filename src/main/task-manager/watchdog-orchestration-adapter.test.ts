import { describe, expect, it, vi } from 'vitest'
import { runWatchdogOrchestration } from './watchdog-orchestration-adapter'
import type { ScheduledTask } from './types'

function task(destination: ScheduledTask['destination']): ScheduledTask {
  return {
    id: 'task-1',
    title: 'Surveiller',
    prompt: 'Traite l’incident.',
    enabled: true,
    mode: 'active-only',
    destination,
    watchdog: {
      source: { kind: 'app-event', events: ['orchestration-red'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 12, maxChainDepth: 0, maxPerRoot: 20 },
      action: 'orchestration'
    },
    nextRunAt: null,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('adaptateur orchestration watchdog', () => {
  it('conserve un gate ROUGE comme échec et restitue le tour et ses mutations', async () => {
    const exec = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: 'failed',
        gateBlocked: true,
        gateReasons: ['preuve manquante'],
        result: 'Le juge refuse.',
        turnId: 'turn-red'
      }
    })
    const readMutatedPaths = vi.fn().mockReturnValue(['C:/repo/src/a.ts'])

    const result = await runWatchdogOrchestration(
      { exec, readMutatedPaths },
      'conv-1',
      'prompt',
      task({
        kind: 'existing',
        conversationId: 'conv-1'
      })
    )

    expect(exec).toHaveBeenCalledWith('prompt', 'conv-1', 'ask', [])
    expect(readMutatedPaths).toHaveBeenCalledWith('conv-1', 'turn-red')
    expect(result).toMatchObject({
      ok: false,
      text: 'Le juge refuse.',
      turnId: 'turn-red',
      mutatedPaths: ['C:/repo/src/a.ts']
    })
    expect(result.error).toContain('preuve manquante')
  })

  it('utilise uniquement l’autorité de la tâche courante et conserve un succès vert', async () => {
    const exec = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: 'succeeded',
        gateBlocked: false,
        result: 'ISSUE: repair',
        turnId: 'turn-green'
      }
    })

    const result = await runWatchdogOrchestration(
      { exec, readMutatedPaths: () => [] },
      'conv-dedicated',
      'prompt',
      task({
        kind: 'new',
        title: 'Incidents',
        category: 'watchdog',
        provider: 'claude',
        authorityMode: 'auto',
        conversationId: 'conv-dedicated'
      })
    )

    expect(exec).toHaveBeenCalledWith('prompt', 'conv-dedicated', 'auto', [])
    expect(result).toMatchObject({ ok: true, text: 'ISSUE: repair', turnId: 'turn-green' })
  })

  it('conserve une erreur du bus sans inventer un statut orchestration', async () => {
    const result = await runWatchdogOrchestration(
      {
        exec: async () => ({ ok: false, error: 'Action interdite en mode Plan' }),
        readMutatedPaths: () => {
          throw new Error('ne doit pas lire un tour absent')
        }
      },
      'conv-1',
      'prompt',
      task({ kind: 'existing', conversationId: 'conv-1' })
    )

    expect(result).toEqual({ ok: false, error: 'Action interdite en mode Plan' })
  })

  it('transporte le fichier surveille jusqu au run sans le mettre dans le prompt', async () => {
    const exec = vi.fn().mockResolvedValue({
      ok: true,
      data: { status: 'succeeded', gateBlocked: false, turnId: 'turn-file' }
    })
    const fileTask = task({ kind: 'existing', conversationId: 'conv-1' })
    fileTask.watchdog!.source = {
      kind: 'file-match',
      path: 'C:/repo/logs/app.log',
      pattern: 'ERROR'
    }

    await runWatchdogOrchestration(
      { exec, readMutatedPaths: () => [] },
      'conv-1',
      'prompt sans chemin interne',
      fileTask
    )

    expect(exec).toHaveBeenCalledWith('prompt sans chemin interne', 'conv-1', 'ask', [
      'C:/repo/logs/app.log'
    ])
  })

  it('transporte le canal de causalite tardive jusqu au bus orchestration', async () => {
    const exec = vi.fn().mockResolvedValue({
      ok: true,
      data: { status: 'succeeded', gateBlocked: false, turnId: 'turn-late' }
    })
    const onLateMutationClaims = vi.fn()

    await runWatchdogOrchestration(
      { exec, readMutatedPaths: () => [] },
      'conv-1',
      'prompt',
      task({ kind: 'existing', conversationId: 'conv-1' }),
      onLateMutationClaims
    )

    expect(exec).toHaveBeenCalledWith('prompt', 'conv-1', 'ask', [], onLateMutationClaims)
  })
})
