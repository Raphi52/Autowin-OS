import { execFileSync } from 'node:child_process'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutionEvidence } from '../providers/types'
import { appendPreparedCommitMutationEvidence } from '../providers/workspace-mutation-evidence'
import { WatchdogEngine } from './watchdog-engine'
import { captureFileGenerationMarker } from './watchdog-file-source'
import { lineFingerprint } from './watchdog-line'
import type { ScheduledTask, WatchdogSignal } from './types'

const roots: string[] = []
const clock = {
  now: () => 1_000_000,
  setTimer: () => undefined,
  clearTimer: () => undefined
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('watchdog causal evidence e2e', () => {
  it('le commit revendique un fragment sans LF que le moteur consomme une fois complete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autowin-watchdog-e2e-'))
    roots.push(root)
    const logPath = join(root, 'app.log')
    await writeFile(logPath, '')
    execFileSync('git', ['init'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@autowin.local'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Autowin Test'], { cwd: root })
    execFileSync('git', ['add', 'app.log'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'base'], { cwd: root })
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    const task: ScheduledTask = {
      id: 'rule',
      title: 'Rule',
      prompt: 'Repair',
      enabled: true,
      mode: 'active-only',
      destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
      watchdog: {
        source: { kind: 'file-match', path: logPath, pattern: 'ERROR' },
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 20, maxChainDepth: 0, maxPerRoot: 20 }
      },
      nextRunAt: null,
      createdAt: 0,
      updatedAt: 0
    }
    const calls: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [task],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          await appendFile(logPath, 'ERROR self sans LF')
          execFileSync('git', ['add', 'app.log'], { cwd: root })
          execFileSync('git', ['commit', '-m', 'agent'], { cwd: root })
          const agentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8'
          }).trim()
          const evidence: ExecutionEvidence[] = []
          await appendPreparedCommitMutationEvidence(root, baseSha, agentSha, [logPath], evidence)
          const delta = evidence[0]
          return {
            fired: true,
            mutatedPaths: [logPath],
            mutatedLineFingerprints: {
              [logPath]: delta.writtenLineFingerprintsByPath?.['app.log'] ?? []
            },
            mutatedPathGenerationMarkers: {
              [logPath]: delta.pathGenerationMarkers?.['app.log'] ?? ''
            }
          }
        }
      },
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR externe\n')
    await engine.poll()
    await engine.poll()
    await appendFile(logPath, '\n')
    await engine.poll()

    expect(calls).toHaveLength(1)
  })

  it('injecte une publication tardive dans le moteur deja vivant avant son prochain poll', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autowin-watchdog-late-e2e-'))
    roots.push(root)
    const logPath = join(root, 'app.log')
    await writeFile(logPath, '')
    const task: ScheduledTask = {
      id: 'late-rule',
      title: 'Late rule',
      prompt: 'Repair',
      enabled: true,
      mode: 'active-only',
      destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
      watchdog: {
        source: { kind: 'file-match', path: logPath, pattern: 'ERROR' },
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 20, maxChainDepth: 0, maxPerRoot: 20 }
      },
      nextRunAt: null,
      createdAt: 0,
      updatedAt: 0
    }
    const calls: WatchdogSignal[] = []
    let publish: (() => void) | undefined
    const engine = new WatchdogEngine(
      () => [task],
      {
        async runWatchdog(_taskId, signal, onLateMutationClaims) {
          calls.push(signal)
          const selfLine = 'ERROR self publie plus tard'
          await appendFile(logPath, `${selfLine}\r\n`)
          const generationMarker = await captureFileGenerationMarker(logPath)
          publish = () =>
            onLateMutationClaims?.({
              mutatedPaths: [logPath],
              mutatedLineFingerprints: { [logPath]: [lineFingerprint(selfLine)] },
              mutatedPathGenerationMarkers: generationMarker ? { [logPath]: generationMarker } : {}
            })
          return { fired: true }
        }
      },
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR externe\n')
    await engine.poll()
    expect(calls).toHaveLength(1)

    publish?.()
    await engine.poll()

    expect(calls).toHaveLength(1)
  })

  it('consomme une publication recuperee apres redemarrage sans callback originel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autowin-watchdog-recovered-e2e-'))
    roots.push(root)
    const logPath = join(root, 'app.log')
    await writeFile(logPath, '')
    const task: ScheduledTask = {
      id: 'recovered-rule',
      title: 'Recovered rule',
      prompt: 'Repair',
      enabled: true,
      mode: 'active-only',
      destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
      watchdog: {
        source: { kind: 'file-match', path: logPath, pattern: 'ERROR' },
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 20, maxChainDepth: 0, maxPerRoot: 20 }
      },
      nextRunAt: null,
      createdAt: 0,
      updatedAt: 0
    }
    const dispatches: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [task],
      {
        async runWatchdog(_taskId, signal) {
          dispatches.push(signal)
          return true
        }
      },
      clock
    )
    await engine.start()
    const selfLine = 'ERROR publication recuperee'
    await appendFile(logPath, `${selfLine}\r\n`)
    const generationMarker = await captureFileGenerationMarker(logPath)

    engine.rememberRecoveredMutationClaims({
      mutatedPaths: [logPath],
      mutatedLineFingerprints: { [logPath]: [lineFingerprint(selfLine)] },
      mutatedPathGenerationMarkers: generationMarker ? { [logPath]: generationMarker } : {}
    })
    await engine.poll()

    expect(dispatches).toEqual([])
  })

  it('oublie un claim recupere avant la baseline pour ne pas masquer un futur incident', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autowin-watchdog-prestart-claims-e2e-'))
    roots.push(root)
    const logPath = join(root, 'app.log')
    const selfLine = 'ERROR publication deja presente'
    await writeFile(logPath, `${selfLine}\r\n`)
    const task: ScheduledTask = {
      id: 'prestart-rule',
      title: 'Prestart rule',
      prompt: 'Repair',
      enabled: true,
      mode: 'active-only',
      destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
      watchdog: {
        source: { kind: 'file-match', path: logPath, pattern: 'ERROR' },
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 20, maxChainDepth: 0, maxPerRoot: 20 }
      },
      nextRunAt: null,
      createdAt: 0,
      updatedAt: 0
    }
    const dispatches: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [task],
      {
        async runWatchdog(_taskId, signal) {
          dispatches.push(signal)
          return true
        }
      },
      clock
    )
    const generationMarker = await captureFileGenerationMarker(logPath)
    engine.rememberRecoveredMutationClaims({
      eventId: 'worktree-publication:prestart:agent-sha',
      mutatedPaths: [logPath],
      mutatedLineFingerprints: { [logPath]: [lineFingerprint(selfLine)] },
      mutatedPathGenerationMarkers: generationMarker ? { [logPath]: generationMarker } : {}
    })

    await engine.start()
    await appendFile(logPath, `${selfLine}\r\n`)
    await engine.poll()

    expect(dispatches).toHaveLength(1)
  })

  it('oublie aussi le claim d une regle ajoutee apres start mais pas encore baselinee', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autowin-watchdog-dynamic-baseline-e2e-'))
    roots.push(root)
    const logPath = join(root, 'app.log')
    const selfLine = 'ERROR publication avant regle'
    await writeFile(logPath, `${selfLine}\r\n`)
    const tasks: ScheduledTask[] = []
    const dispatches: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => tasks,
      {
        async runWatchdog(_taskId, signal) {
          dispatches.push(signal)
          return true
        }
      },
      clock
    )
    await engine.start()
    tasks.push({
      id: 'dynamic-rule',
      title: 'Dynamic rule',
      prompt: 'Repair',
      enabled: true,
      mode: 'active-only',
      destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
      watchdog: {
        source: { kind: 'file-match', path: logPath, pattern: 'ERROR' },
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 20, maxChainDepth: 0, maxPerRoot: 20 }
      },
      nextRunAt: null,
      createdAt: 0,
      updatedAt: 0
    })
    const generationMarker = await captureFileGenerationMarker(logPath)
    engine.rememberRecoveredMutationClaims({
      eventId: 'worktree-publication:dynamic:agent-sha',
      mutatedPaths: [logPath],
      mutatedLineFingerprints: { [logPath]: [lineFingerprint(selfLine)] },
      mutatedPathGenerationMarkers: generationMarker ? { [logPath]: generationMarker } : {}
    })

    await engine.poll()
    await appendFile(logPath, `${selfLine}\r\n`)
    await engine.poll()

    expect(dispatches).toHaveLength(1)
  })

  it('ne sur-revendique pas une publication rejouee deux fois dans le meme processus', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autowin-watchdog-replayed-claims-e2e-'))
    roots.push(root)
    const logPath = join(root, 'app.log')
    await writeFile(logPath, '')
    const task: ScheduledTask = {
      id: 'replayed-rule',
      title: 'Replayed rule',
      prompt: 'Repair',
      enabled: true,
      mode: 'active-only',
      destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
      watchdog: {
        source: { kind: 'file-match', path: logPath, pattern: 'ERROR' },
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 20, maxChainDepth: 0, maxPerRoot: 20 }
      },
      nextRunAt: null,
      createdAt: 0,
      updatedAt: 0
    }
    const dispatches: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [task],
      {
        async runWatchdog(_taskId, signal) {
          dispatches.push(signal)
          return true
        }
      },
      clock
    )
    await engine.start()
    const selfLine = 'ERROR publication rejouee'
    await appendFile(logPath, `${selfLine}\r\n${selfLine}\r\n`)
    const generationMarker = await captureFileGenerationMarker(logPath)
    const claims = {
      eventId: 'worktree-publication:run-1:agent-sha',
      mutatedPaths: [logPath],
      mutatedLineFingerprints: { [logPath]: [lineFingerprint(selfLine)] },
      mutatedPathGenerationMarkers: generationMarker ? { [logPath]: generationMarker } : {}
    }

    engine.rememberRecoveredMutationClaims(claims)
    engine.rememberRecoveredMutationClaims(claims)
    await engine.poll()

    expect(dispatches).toHaveLength(1)
  })
})
