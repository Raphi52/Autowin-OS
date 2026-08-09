import { appendFile, mkdtemp, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureFileGenerationMarker } from './watchdog-file-source'
import { WatchdogEngine } from './watchdog-engine'
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

function task(path: string): ScheduledTask {
  return {
    id: 'rule',
    title: 'Rule',
    prompt: 'Repair',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
    watchdog: {
      source: { kind: 'file-match', path, pattern: 'ERROR' },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 20, maxChainDepth: 0, maxPerRoot: 20 }
    },
    nextRunAt: null,
    createdAt: 0,
    updatedAt: 0
  }
}

describe('watchdog claim generation', () => {
  it('ne consomme pas une claim de l ancien fichier apres rotation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autowin-watchdog-generation-'))
    roots.push(root)
    const path = join(root, 'app.log')
    await writeFile(path, '')
    const calls: WatchdogSignal[] = []
    const selfLine = 'ERROR same-text'
    const engine = new WatchdogEngine(
      () => [task(path)],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          if (calls.length === 1) {
            await appendFile(path, `${selfLine}\n`)
            return {
              fired: true,
              mutatedPaths: [path],
              mutatedLineFingerprints: { [path]: [lineFingerprint(selfLine)] },
              mutatedPathGenerationMarkers: {
                [path]: (await captureFileGenerationMarker(path))!
              }
            }
          }
          return true
        }
      },
      clock
    )
    await engine.start()
    await appendFile(path, 'ERROR externe\n')
    await engine.poll()

    await rename(path, `${path}.1`)
    await writeFile(path, `${selfLine}\n`)
    await utimes(path, new Date(2_000_000_000_000), new Date(2_000_000_000_000))
    await engine.poll()

    expect(calls).toHaveLength(2)
    expect(calls[1].depth).toBe(0)
  })

  it('ne consomme pas une claim apres truncate et reecriture de taille identique', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autowin-watchdog-rewrite-generation-'))
    roots.push(root)
    const path = join(root, 'app.log')
    await writeFile(path, '')
    const calls: WatchdogSignal[] = []
    const selfLine = 'ERROR same-text'
    const engine = new WatchdogEngine(
      () => [task(path)],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          if (calls.length === 1) {
            await writeFile(path, `${selfLine}\n`)
            return {
              fired: true,
              mutatedPaths: [path],
              mutatedLineFingerprints: { [path]: [lineFingerprint(selfLine)] },
              mutatedPathGenerationMarkers: {
                [path]: (await captureFileGenerationMarker(path))!
              }
            }
          }
          return true
        }
      },
      clock
    )
    await engine.start()
    await appendFile(path, 'ERROR externe\n')
    await engine.poll()

    await writeFile(path, `${selfLine}\n`)
    await utimes(path, new Date(2_000_000_000_000), new Date(2_000_000_000_000))
    await engine.poll()

    expect(calls).toHaveLength(2)
    expect(calls[1].depth).toBe(0)
  })
})
