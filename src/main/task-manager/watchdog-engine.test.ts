import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WatchdogEngine, type WatchdogDispatch } from './watchdog-engine'
import { lineFingerprint } from './watchdog-line'
import { buildWatchdogPrompt, parseWatchdogOutcome } from './watchdog-prompt'
import type { ScheduledTask, WatchdogSignal } from './types'

const clock = {
  now: () => 1_000_000,
  setTimer: () => undefined,
  clearTimer: () => undefined
}

function watchdogTask(path: string, patch: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    title: 'Surveiller le log',
    prompt: 'Analyse cette erreur.',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'new', title: 'Incidents', category: 'ops', provider: 'claude' },
    watchdog: {
      source: { kind: 'file-match', path, pattern: 'ERROR' },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
    },
    nextRunAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch
  }
}

/** Espion de dispatch : ce moteur ne doit RIEN executer lui-meme, seulement deleguer. */
function spy(): WatchdogDispatch & { calls: WatchdogSignal[] } {
  const calls: WatchdogSignal[] = []
  return {
    calls,
    async runWatchdog(_taskId, signal) {
      calls.push(signal)
      return true
    }
  }
}

describe('WatchdogEngine — observer, filtrer, deleguer', () => {
  let directory: string
  let logPath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'watchdog-engine-'))
    logPath = join(directory, 'app.log')
    await writeFile(logPath, '')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('DoD : une ligne qui matche reveille un agent, sans horloge', async () => {
    const dispatch = spy()
    const task = watchdogTask(logPath)
    const engine = new WatchdogEngine(() => [task], dispatch, clock)
    await engine.start()

    await appendFile(logPath, 'INFO tout va bien\nERROR connexion perdue\n')
    await engine.poll()

    expect(dispatch.calls).toHaveLength(1)
    expect(dispatch.calls[0].context).toContain('ERROR connexion perdue')
    expect(dispatch.calls[0].source).toBe('file-match')
    expect(task.nextRunAt).toBeNull()
  })

  it('remet le VOISINAGE, pas seulement la ligne — sinon l agent devine', async () => {
    const dispatch = spy()
    const engine = new WatchdogEngine(() => [watchdogTask(logPath)], dispatch, clock)
    await engine.start()

    await appendFile(logPath, 'avant deux\navant une\nERROR le coeur\napres une\n')
    await engine.poll()

    expect(dispatch.calls[0].context).toContain('avant une')
    expect(dispatch.calls[0].context).toContain('apres une')
    expect(dispatch.calls[0].context).toContain(logPath)
  })

  it('ignore une ancienne regle app-event mal formee au lieu de faire tomber le main', async () => {
    const dispatch = spy()
    const malformed = watchdogTask(logPath, {
      watchdog: {
        source: { kind: 'app-event' } as never,
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
      }
    })
    const engine = new WatchdogEngine(() => [malformed], dispatch, clock)
    await engine.start()

    await expect(engine.notifyAppEvent('task-failed', 'incident')).resolves.toBeUndefined()
    expect(dispatch.calls).toHaveLength(0)
  })

  it('ne reveille jamais une regle sur un incident produit par sa propre conversation', async () => {
    const dispatch = spy()
    const task = watchdogTask(logPath, {
      destination: {
        kind: 'new',
        title: 'Auto-kaizen',
        category: 'Qualite',
        provider: 'claude',
        conversationId: 'conv-auto-kaizen'
      },
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'orchestration',
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
      }
    })
    const engine = new WatchdogEngine(() => [task], dispatch, clock)

    await engine.notifyAppEvent(
      'orchestration-red',
      'le run Auto-kaizen est rouge',
      'conv-auto-kaizen'
    )

    expect(dispatch.calls).toHaveLength(0)
    expect(engine.lastSuppression(task.id)).toBe('self-conversation')
  })

  /**
   * BOUT EN BOUT du défaut mesuré le 2026-09-02 : l'utilisateur clique Stop sur une orchestration,
   * elle finit `red` en le disant honnêtement, et la règle « Auto-kaizen — orchestration rouge »
   * (la SEULE règle active du poste, `scheduled-tasks.json`) lance un run PAYANT sur cet arrêt voulu.
   *
   * Le texte ci-dessous n'est pas inventé : il est composé exactement comme `index.ts:758-766`
   * compose le contexte d'un `orchestration-red`, et sa « Cause terminale » est le `e.message`
   * recopié du Journal de
   * `runs/conv-14/kaizen-conv-13-est-bloquee-mtk5a9fg-workspace/RUN.md`.
   *
   * C'est ce niveau-là qui compte : un test sur le seul prédicat ne dirait pas si le texte réel
   * arrive bien jusqu'à lui.
   */
  it('un Stop utilisateur remonté en orchestration rouge ne réveille AUCUN agent', async () => {
    const dispatch = spy()
    const task = watchdogTask(logPath, {
      destination: {
        kind: 'new',
        title: 'Auto-kaizen',
        category: 'Qualite',
        provider: 'claude',
        conversationId: 'conv-15'
      },
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'orchestration',
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
      }
    })
    const engine = new WatchdogEngine(() => [task], dispatch, clock)

    const causeTerminale =
      'Phase kaizen — appel du rôle subagent INTERROMPU avant sa fin : [abort] claude CLI ' +
      "interrompu : arret demande par l'utilisateur (Stop du chat)\nlast-event=none\nstderr=none. " +
      "Ce n'est pas une panne : ni claude ni le binding du rôle ne sont en cause."
    await engine.notifyAppEvent(
      'orchestration-red',
      "Une orchestration s'est terminée en ROUGE. RUN : .autowin-data/autowin-os/runs/conv-14/" +
        'kaizen-conv-13-est-bloquee-mtk5a9fg-workspace Conversation : conv-14\n' +
        `Cause terminale : ${causeTerminale}`,
      'conv-14'
    )

    expect(dispatch.calls).toHaveLength(0)
    expect(engine.lastSuppression(task.id)).toBe('aborted')
  })

  /**
   * CONTRÔLE NÉGATIF du test ci-dessus, et c'est lui qui rend la garde acceptable : le même
   * événement, la même règle, mais une orchestration rouge pour un VRAI défaut doit continuer de
   * réveiller un agent. Sans cette assertion, élargir la suppression rendrait les vrais échecs
   * invisibles — le défaut symétrique, et le plus coûteux.
   */
  it('CONTRÔLE NÉGATIF : une orchestration rouge sur un vrai défaut réveille toujours un agent', async () => {
    const dispatch = spy()
    const task = watchdogTask(logPath, {
      destination: {
        kind: 'new',
        title: 'Auto-kaizen',
        category: 'Qualite',
        provider: 'claude',
        conversationId: 'conv-15'
      },
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'orchestration',
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
      }
    })
    const engine = new WatchdogEngine(() => [task], dispatch, clock)

    await engine.notifyAppEvent(
      'orchestration-red',
      "Une orchestration s'est terminée en ROUGE. RUN : runs/conv-14/x Conversation : conv-14\n" +
        'Cause terminale : Le contrôle final a refusé le livrable : 3 tests rouges dans ' +
        'src/main/models.test.ts — expected 3 to be 4.',
      'conv-14'
    )

    expect(dispatch.calls).toHaveLength(1)
    expect(engine.lastSuppression(task.id)).toBeUndefined()
  })

  it('ne lance jamais deux occurrences de la meme regle en parallele', async () => {
    let release!: () => void
    const calls: WatchdogSignal[] = []
    const dispatch: WatchdogDispatch = {
      async runWatchdog(_taskId, signal) {
        calls.push(signal)
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return true
      }
    }
    const task = watchdogTask(logPath, {
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'orchestration',
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
      }
    })
    const engine = new WatchdogEngine(() => [task], dispatch, clock)

    const first = engine.notifyAppEvent('orchestration-red', 'incident un')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await engine.notifyAppEvent('orchestration-red', 'incident deux')

    expect(calls).toHaveLength(1)
    expect(engine.lastSuppression(task.id)).toBe('in-flight')
    release()
    await first
  })

  it('reinjecte un cout recupere apres crash dans le budget vivant de la regle', async () => {
    const dispatch = spy()
    const task = watchdogTask(logPath, {
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'chat',
        guards: {
          dedupWindowMs: 0,
          maxTriggersPerHour: 100,
          maxChainDepth: 0,
          maxPerRoot: 20,
          maxKnownCostUsdPerDay: 0.25
        }
      }
    })
    const engine = new WatchdogEngine(() => [task], dispatch, clock)

    expect(
      engine.rememberRecoveredUsage(task.id, {
        eventId: `${task.id}@watchdog-crash`,
        knownCostUsd: 0.26,
        resolvedModel: 'claude-haiku-real'
      })
    ).toBe(true)
    await engine.notifyAppEvent('orchestration-red', 'nouvel incident apres reprise')

    expect(dispatch.calls).toHaveLength(0)
    expect(engine.lastSuppression(task.id)).toBe('cost-budget')
  })

  it('DoD : l historique du fichier ne reveille PERSONNE au demarrage', async () => {
    await writeFile(logPath, 'ERROR vieille 1\nERROR vieille 2\n')
    const dispatch = spy()
    const engine = new WatchdogEngine(() => [watchdogTask(logPath)], dispatch, clock)

    await engine.start()
    await engine.poll()

    expect(dispatch.calls).toHaveLength(0)
  })

  it('DoD : une RAFALE de 100 lignes produit un nombre borne de reveils', async () => {
    const dispatch = spy()
    const task = watchdogTask(logPath)
    task.watchdog!.guards = {
      dedupWindowMs: 0,
      maxTriggersPerHour: 5,
      maxChainDepth: 0,
      maxPerRoot: 20
    }
    const engine = new WatchdogEngine(() => [task], dispatch, clock)
    await engine.start()

    await appendFile(
      logPath,
      Array.from({ length: 100 }, (_, i) => `ERROR incident distinct ${i}`).join('\n') + '\n'
    )
    await engine.poll()

    expect(dispatch.calls).toHaveLength(5)
  })

  it('borne le contexte remis au provider quand une ligne de log est géante', async () => {
    const dispatch = spy()
    const engine = new WatchdogEngine(() => [watchdogTask(logPath)], dispatch, clock)
    await engine.start()

    await appendFile(logPath, `ERROR ${'x'.repeat(900_000)}\n`)
    await engine.poll()

    expect(dispatch.calls).toHaveLength(1)
    expect(dispatch.calls[0].context.length).toBeLessThanOrEqual(16_000)
    expect(buildWatchdogPrompt('Analyse.', dispatch.calls[0]).length).toBeLessThanOrEqual(20_000)
  })

  it('DoD : une reparation qui reecrit dans le fichier surveille NE BOUCLE PAS', async () => {
    // Le scenario exact du risque critique : autorite `auto`, l'agent ecrit dans la source.
    const calls: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [watchdogTask(logPath)],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          // L'agent « repare » et son travail ecrit dans le log surveille.
          const selfLine = 'ERROR provoquee par la reparation'
          await appendFile(logPath, `${selfLine}\n`.repeat(12))
          return {
            fired: true,
            mutatedPaths: [logPath],
            mutatedLineFingerprints: {
              [logPath]: Array.from({ length: 12 }, () => lineFingerprint(selfLine))
            }
          }
        }
      },
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR declencheur initial\n')
    await engine.poll()
    await engine.poll()

    // Un seul reveil : le second est refuse par la garde de profondeur.
    expect(calls).toHaveLength(1)
    expect(calls[0].depth).toBe(0)
  })

  it('ne rejoue pas les anciennes erreurs apres une reecriture in-place', async () => {
    await writeFile(logPath, 'ERROR historique\nINFO cible\n')
    const calls: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [watchdogTask(logPath)],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          if (calls.length === 1) {
            await writeFile(logPath, 'ERROR historique\nINFO modifiee\nERROR declencheur\n')
            return {
              fired: true,
              mutatedPaths: [logPath],
              mutatedLineFingerprints: {
                [logPath]: [lineFingerprint('INFO modifiee')]
              }
            }
          }
          return true
        }
      },
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR declencheur\n')
    await engine.poll()
    await engine.poll()

    expect(calls).toHaveLength(1)
  })

  it('partage la causalite entre deux regles qui surveillent le meme fichier', async () => {
    const first = watchdogTask(logPath, { id: 'rule-a' })
    const second = watchdogTask(logPath, { id: 'rule-b' })
    const calls: Array<{ taskId: string; signal: WatchdogSignal }> = []
    const engine = new WatchdogEngine(
      () => [first, second],
      {
        async runWatchdog(taskId, signal) {
          calls.push({ taskId, signal })
          const selfLine = `ERROR auto ${taskId}`
          await appendFile(logPath, `${selfLine}\n`)
          return {
            fired: true,
            mutatedPaths: [logPath],
            mutatedLineFingerprints: { [logPath]: [lineFingerprint(selfLine)] }
          }
        }
      },
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR externe unique\n')
    await engine.poll()
    await engine.poll()

    expect(calls.map(({ taskId }) => taskId).sort()).toEqual(['rule-a', 'rule-b'])
    expect(calls.every(({ signal }) => signal.depth === 0)).toBe(true)
  })

  it('preserve plus de 256 lignes causales avec plus de seize regles sur la meme source', async () => {
    const tasks = Array.from({ length: 17 }, (_, index) =>
      watchdogTask(logPath, { id: `rule-${index}` })
    )
    const selfLines = Array.from({ length: 257 }, (_, index) => `ERROR self ${index}`)
    const calls: Array<{ taskId: string; signal: WatchdogSignal }> = []
    const engine = new WatchdogEngine(
      () => tasks,
      {
        async runWatchdog(taskId, signal) {
          calls.push({ taskId, signal })
          if (taskId === 'rule-0' && calls.length === 1) {
            await appendFile(logPath, `${selfLines.join('\n')}\n`)
            return {
              fired: true,
              mutatedPaths: [logPath],
              mutatedLineFingerprints: {
                [logPath]: selfLines.map(lineFingerprint)
              }
            }
          }
          return true
        }
      },
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR externe unique\n')
    await engine.poll()
    await engine.poll()

    expect(calls).toHaveLength(17)
    expect(new Set(calls.map(({ taskId }) => taskId)).size).toBe(17)
  })

  it('preserve plusieurs lots causaux produits pendant le meme poll', async () => {
    const task = watchdogTask(logPath, {
      watchdog: {
        source: { kind: 'file-match', path: logPath, pattern: 'ERROR' },
        guards: {
          dedupWindowMs: 0,
          maxTriggersPerHour: 240,
          maxChainDepth: 0,
          maxPerRoot: 240
        }
      }
    })
    const calls: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [task],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          const batch = calls.length
          const selfLines = Array.from(
            { length: 256 },
            (_, index) => `ERROR self batch ${batch} line ${index}`
          )
          await appendFile(logPath, `${selfLines.join('\n')}\n`)
          return {
            fired: true,
            mutatedPaths: [logPath],
            mutatedLineFingerprints: { [logPath]: selfLines.map(lineFingerprint) }
          }
        }
      },
      clock
    )
    await engine.start()

    await appendFile(
      logPath,
      'ERROR externe 1\nERROR externe 2\nERROR externe 3\nERROR externe 4\nERROR externe 5\n'
    )
    await engine.poll()
    expect(calls).toHaveLength(5)
    await engine.poll()

    expect(calls).toHaveLength(5)
  })

  it('expire une revendication qui ne se materialise pas avant une future ligne externe', async () => {
    const futureLine = 'ERROR future identique'
    const calls: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [watchdogTask(logPath)],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          return calls.length === 1
            ? {
                fired: true,
                mutatedPaths: [logPath],
                mutatedLineFingerprints: { [logPath]: [lineFingerprint(futureLine)] }
              }
            : true
        }
      },
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR declencheur\n')
    await engine.poll()
    await engine.poll()
    await appendFile(logPath, `${futureLine}\n`)
    await engine.poll()

    expect(calls).toHaveLength(2)
    expect(calls[1].context).toContain(futureLine)
    expect(calls[1].depth).toBe(0)
  })

  it('conserve la causalite tant que la ligne auto-ecrite attend encore son saut de ligne', async () => {
    const selfLine = 'ERROR self sans LF'
    const calls: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [watchdogTask(logPath)],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          if (calls.length === 1) {
            await appendFile(logPath, selfLine)
            return {
              fired: true,
              mutatedPaths: [logPath],
              mutatedLineFingerprints: { [logPath]: [lineFingerprint(selfLine)] }
            }
          }
          return true
        }
      },
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR initiale\n')
    await engine.poll()
    await engine.poll()
    await appendFile(logPath, '\n')
    await engine.poll()

    expect(calls).toHaveLength(1)
  })

  it('isole une ligne auto-ecrite sans perdre une ligne externe concurrente du meme fichier', async () => {
    let release!: () => void
    let selfWriteDone!: () => void
    const dispatchCanFinish = new Promise<void>((resolve) => {
      release = resolve
    })
    const selfWriteObserved = new Promise<void>((resolve) => {
      selfWriteDone = resolve
    })
    const selfLine = 'ERROR ecrite par le watchdog'
    const externalLine = 'ERROR ajoutee par un processus externe'
    const calls: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [watchdogTask(logPath)],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          if (calls.length === 1) {
            await appendFile(logPath, `${selfLine}\n`)
            selfWriteDone()
            await dispatchCanFinish
            return {
              fired: true,
              mutatedPaths: [logPath],
              mutatedLineFingerprints: { [logPath]: [lineFingerprint(selfLine)] }
            }
          }
          return true
        }
      },
      clock
    )
    await engine.start()
    await appendFile(logPath, 'ERROR declencheur initial\n')

    const firstPoll = engine.poll()
    await selfWriteObserved
    await appendFile(logPath, `${externalLine}\n`)
    release()
    await firstPoll
    await engine.poll()

    expect(calls).toHaveLength(2)
    expect(calls.map(({ depth }) => depth)).toEqual([0, 0])
    expect(calls[1].context).toContain(externalLine)
  })

  it('propage la cause racine et borne une cascade qui élargit ses signatures', async () => {
    const calls: WatchdogSignal[] = []
    const task = watchdogTask(logPath)
    task.watchdog = {
      source: { kind: 'app-event', events: ['task-failed'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 3, maxPerRoot: 1 }
    }
    const engine = new WatchdogEngine(
      () => [task],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          await engine.notifyAppEvent('task-failed', `symptôme enfant ${calls.length}`)
          return true
        }
      },
      clock
    )

    await engine.notifyAppEvent('task-failed', 'cause externe')

    expect(calls).toHaveLength(1)
  })

  it('ne perd pas une ligne externe arrivee pendant un dispatch long', async () => {
    let release!: () => void
    let started!: () => void
    const dispatchStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: WatchdogSignal[] = []
    const engine = new WatchdogEngine(
      () => [watchdogTask(logPath)],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          if (calls.length === 1) {
            started()
            await gate
          }
          return true
        }
      },
      clock
    )
    await engine.start()
    await appendFile(logPath, 'ERROR initiale\n')
    const firstPoll = engine.poll()
    await dispatchStarted
    await appendFile(logPath, 'ERROR externe concurrente\n')
    release()
    await firstPoll
    await engine.poll()

    expect(calls).toHaveLength(2)
  })

  it('reinitialise la lecture apres un passage temporaire par une source applicative', async () => {
    const dispatch = spy()
    const task = watchdogTask(logPath)
    const engine = new WatchdogEngine(() => [task], dispatch, clock)
    await engine.start()

    task.watchdog = {
      source: { kind: 'app-event', events: ['task-failed'] },
      guards: task.watchdog!.guards
    }
    await engine.notifyAppEvent('orchestration-red', 'force la reconciliation sans reveil')
    await appendFile(logPath, 'ERROR ecrite pendant la desactivation fichier\n')
    task.watchdog = {
      source: { kind: 'file-match', path: logPath, pattern: 'ERROR' },
      guards: task.watchdog.guards
    }
    await engine.poll()

    expect(dispatch.calls).toHaveLength(0)
  })

  it('ne confond pas un evenement externe concurrent avec la chaine du reveil en cours', async () => {
    let releaseFileDispatch!: () => void
    let fileDispatchStarted!: () => void
    const started = new Promise<void>((resolve) => {
      fileDispatchStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseFileDispatch = resolve
    })
    const calls: WatchdogSignal[] = []
    const fileTask = watchdogTask(logPath, { id: 'file' })
    const appTask = watchdogTask(logPath, { id: 'app' })
    appTask.watchdog = {
      source: { kind: 'app-event', events: ['task-failed'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
    }
    const engine = new WatchdogEngine(
      () => [fileTask, appTask],
      {
        async runWatchdog(_taskId, signal) {
          calls.push(signal)
          if (signal.source === 'file-match') {
            fileDispatchStarted()
            await release
          }
          return true
        }
      },
      clock
    )
    await engine.start()
    await appendFile(logPath, 'ERROR initiale\n')

    const filePoll = engine.poll()
    await started
    await engine.notifyAppEvent('task-failed', 'Incident independant')
    releaseFileDispatch()
    await filePoll

    expect(calls.map(({ source }) => source)).toEqual(['file-match', 'app-event'])
    expect(calls[1].depth).toBe(0)
  })

  it('applique immediatement un plafond resserre sans oublier les admissions passees', async () => {
    const dispatch = spy()
    const task = watchdogTask(logPath)
    task.watchdog = {
      source: { kind: 'app-event', events: ['task-failed'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
    }
    const engine = new WatchdogEngine(() => [task], dispatch, clock)
    await engine.start()
    await engine.notifyAppEvent('task-failed', 'incident un')

    task.watchdog.guards = { ...task.watchdog.guards, maxTriggersPerHour: 1 }
    await engine.notifyAppEvent('task-failed', 'incident deux')

    expect(dispatch.calls).toHaveLength(1)
  })

  it('change de fichier sans rejouer l historique de la nouvelle source', async () => {
    const secondPath = join(directory, 'second.log')
    await writeFile(secondPath, 'ERROR historique du second fichier\n')
    const dispatch = spy()
    const task = watchdogTask(logPath)
    const engine = new WatchdogEngine(() => [task], dispatch, clock)
    await engine.start()

    task.watchdog = {
      ...task.watchdog!,
      source: { kind: 'file-match', path: secondPath, pattern: 'ERROR' }
    }
    await engine.poll()

    expect(dispatch.calls).toHaveLength(0)
  })

  it('un evenement interne reveille les regles qui l ecoutent, et elles seules', async () => {
    const dispatch = spy()
    const listening = watchdogTask(logPath, { id: 'ecoute' })
    listening.watchdog = {
      source: { kind: 'app-event', events: ['task-failed'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
    }
    const other = watchdogTask(logPath, { id: 'autre' })
    other.watchdog = {
      source: { kind: 'app-event', events: ['orchestration-red'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
    }
    const engine = new WatchdogEngine(() => [listening, other], dispatch, clock)
    await engine.start()

    await engine.notifyAppEvent('task-failed', 'La tâche « backup » a échoué.')

    expect(dispatch.calls).toHaveLength(1)
    expect(dispatch.calls[0].source).toBe('app-event')
    expect(dispatch.calls[0].context).toContain('backup')
  })

  it('une tache DESACTIVEE n est jamais reveillee', async () => {
    const dispatch = spy()
    const engine = new WatchdogEngine(
      () => [watchdogTask(logPath, { enabled: false })],
      dispatch,
      clock
    )
    await engine.start()

    await appendFile(logPath, 'ERROR ignoree\n')
    await engine.poll()

    expect(dispatch.calls).toHaveLength(0)
  })

  it('SE PLAINT quand le fichier surveille est introuvable', async () => {
    const engine = new WatchdogEngine(
      () => [watchdogTask(join(directory, 'absent.log'))],
      spy(),
      clock
    )
    await engine.start()
    await engine.poll()

    expect(engine.complaint('task-1')).toContain('illisible')
  })

  it('purge une plainte devenue obsolète et signale les diagnostics en direct', async () => {
    const task = watchdogTask(join(directory, 'absent.log'))
    const diagnosticsChanged = vi.fn()
    const engine = new WatchdogEngine(() => [task], spy(), clock, 3_000, diagnosticsChanged)
    await engine.start()
    await engine.poll()
    expect(engine.complaint(task.id)).toContain('illisible')

    task.watchdog = {
      source: { kind: 'app-event', events: ['task-failed'] },
      guards: task.watchdog!.guards
    }
    await engine.notifyAppEvent('task-failed', 'incident')

    expect(engine.complaint(task.id)).toBeUndefined()
    expect(engine.admittedLastHour(task.id)).toBe(1)
    expect(diagnosticsChanged).toHaveBeenCalled()
  })

  it('compte les reveils admis, pour rendre le cout visible', async () => {
    const engine = new WatchdogEngine(() => [watchdogTask(logPath)], spy(), clock)
    await engine.start()

    await appendFile(logPath, 'ERROR une\nERROR deux distincte\n')
    await engine.poll()

    expect(engine.admittedLastHour('task-1')).toBe(2)
  })

  it('conserve le dedoublonnage apres un redemarrage du moteur', async () => {
    const task = watchdogTask(logPath, {
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        guards: {
          dedupWindowMs: 300_000,
          maxTriggersPerHour: 2,
          maxChainDepth: 0,
          maxPerRoot: 1
        }
      }
    })
    const firstDispatch = spy()
    const first = new WatchdogEngine(() => [task], firstDispatch, clock)
    await first.start()
    await first.notifyAppEvent('orchestration-red', 'meme run rouge')
    const admitted = firstDispatch.calls[0]

    const restartedDispatch = spy()
    const restarted = new WatchdogEngine(
      () => [task],
      restartedDispatch,
      clock,
      3_000,
      undefined,
      () => [
        {
          signature: admitted.signature,
          rootSignature: admitted.rootSignature,
          admittedAt: admitted.observedAt
        }
      ]
    )
    await restarted.start()
    await restarted.notifyAppEvent('orchestration-red', 'meme run rouge')

    expect(restartedDispatch.calls).toHaveLength(0)
    expect(restarted.admittedLastHour(task.id)).toBe(1)
    expect(restarted.lastSuppression(task.id)).toBe('dedup')
  })

  it('conserve le plafond horaire apres un redemarrage du moteur', async () => {
    const task = watchdogTask(logPath, {
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        guards: {
          dedupWindowMs: 0,
          maxTriggersPerHour: 2,
          maxChainDepth: 0,
          maxPerRoot: 20
        }
      }
    })
    const dispatch = spy()
    const restarted = new WatchdogEngine(
      () => [task],
      dispatch,
      clock,
      3_000,
      undefined,
      () => [
        { signature: 'red:a', rootSignature: 'root:a', admittedAt: clock.now() - 2_000 },
        { signature: 'red:b', rootSignature: 'root:b', admittedAt: clock.now() - 1_000 }
      ]
    )
    await restarted.start()
    await restarted.notifyAppEvent('orchestration-red', 'troisieme run rouge')

    expect(dispatch.calls).toHaveLength(0)
    expect(restarted.admittedLastHour(task.id)).toBe(2)
    expect(restarted.lastSuppression(task.id)).toBe('rate')
  })

  it('solde le cout du dispatch avant d admettre le reveil suivant', async () => {
    const task = watchdogTask(logPath, {
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        guards: {
          dedupWindowMs: 0,
          maxTriggersPerHour: 100,
          maxTriggersPerDay: 100,
          maxKnownCostUsdPerDay: 0.25,
          maxChainDepth: 0,
          maxPerRoot: 20
        }
      }
    })
    const runWatchdog = vi.fn(async () => ({ fired: true, knownCostUsd: 0.26 }))
    const engine = new WatchdogEngine(() => [task], { runWatchdog }, clock)
    await engine.start()

    await engine.notifyAppEvent('orchestration-red', 'premier incident')
    await engine.notifyAppEvent('orchestration-red', 'second incident')

    expect(runWatchdog).toHaveBeenCalledTimes(1)
    expect(engine.lastSuppression(task.id)).toBe('cost-budget')
  })
})

describe('watchdog-prompt — ce que l agent recoit et ce qu il doit rendre', () => {
  const signal: WatchdogSignal = {
    signature: 'sig',
    rootSignature: 'sig',
    context: 'Source : fichier surveillé /var/app.log\nLigne déclenchante : ERROR disque plein',
    depth: 0,
    source: 'file-match',
    observedAt: 0
  }

  it('remet le contexte de l evenement ET reclame un tri explicite', () => {
    const prompt = buildWatchdogPrompt('Analyse cette erreur.', signal)

    expect(prompt).toContain('Analyse cette erreur.')
    expect(prompt).toContain('ERROR disque plein')
    expect(prompt).toContain('ISSUE: benign | report | investigate | repair')
    expect(prompt).toContain("Tu n'as pas été lancé par une horloge")
  })

  it('lit le tri rendu par l agent', () => {
    expect(parseWatchdogOutcome('Analyse faite.\n\nISSUE: benign')).toBe('benign')
    expect(parseWatchdogOutcome('**ISSUE:** repair')).toBe('repair')
    expect(parseWatchdogOutcome('issue : investigation')).toBe('investigate')
  })

  it('prend la DERNIERE mention : l agent peut citer les valeurs en chemin', () => {
    const reply = 'Les issues possibles sont ISSUE: benign ou autre.\nConclusion.\nISSUE: repair'
    expect(parseWatchdogOutcome(reply)).toBe('repair')
  })

  it('rend undefined plutot que de DEVINER quand le tri manque', () => {
    // Deviner « sans doute benin » serait exactement le faux acquis que ce systeme doit eviter.
    expect(parseWatchdogOutcome('J ai regarde, rien de special.')).toBeUndefined()
    expect(parseWatchdogOutcome(undefined)).toBeUndefined()
    expect(parseWatchdogOutcome('ISSUE: quelquechose')).toBeUndefined()
  })
})

describe('WatchdogEngine — ce qui ne mérite AUCUN agent', () => {
  it('ne réveille personne sur un quota épuisé', async () => {
    // Mesuré le 2026-08-04 : quota codex épuisé → 2924 incidents en 3 h 09, chaque run rappelant
    // codex pour échouer sur le même mur. Aucune modification de code ne rétablit un quota acheté.
    const dispatch = spy()
    const listening = watchdogTask('x', { id: 'quota' })
    listening.watchdog = {
      source: { kind: 'app-event', events: ['orchestration-red'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
    }
    const engine = new WatchdogEngine(() => [listening], dispatch, clock)
    await engine.start()

    await engine.notifyAppEvent('orchestration-red', 'usage limit reached — purchase more credits')

    expect(dispatch.calls).toHaveLength(0)
    expect(engine.lastSuppression('quota')).toBe('non-actionable')
  })

  it('ne lance pas Auto-kaizen sur le budget interne déjà épuisé', async () => {
    // Incident réel du dogfood Tickets : aucune phase supplémentaire ne peut rentrer dans le devis
    // déjà consommé. Le relancer a pourtant ouvert scout et risquait de repayer un pipeline complet.
    const dispatch = spy()
    const listening = watchdogTask('x', { id: 'budget-interne' })
    listening.watchdog = {
      source: { kind: 'app-event', events: ['orchestration-red'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
    }
    const engine = new WatchdogEngine(() => [listening], dispatch, clock)
    await engine.start()

    for (const terminalCause of [
      'Budget tokens total depasse (7825566/6000000)',
      'Budget USD depasse (3.42/3)',
      "Budget d'appels provider atteint (6)",
      'Budget tokens frais entierement reserve (900000)',
      'Budget duree depasse (1200000 ms)'
    ]) {
      await engine.notifyAppEvent('orchestration-red', terminalCause)
    }

    expect(dispatch.calls).toHaveLength(0)
    expect(engine.lastSuppression('budget-interne')).toBe('non-actionable')
  })

  it('réveille bien un agent sur un VRAI défaut, lui', async () => {
    // Le contre-test : la suppression ne doit pas devenir un filtre qui avale tout.
    const dispatch = spy()
    const listening = watchdogTask('x', { id: 'vrai' })
    listening.watchdog = {
      source: { kind: 'app-event', events: ['workflow-unverified'] },
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 100, maxChainDepth: 0, maxPerRoot: 20 }
    }
    const engine = new WatchdogEngine(() => [listening], dispatch, clock)
    await engine.start()

    await engine.notifyAppEvent(
      'workflow-unverified',
      'Le workflow a terminé sans preuve de validation globale'
    )

    expect(dispatch.calls).toHaveLength(1)
    expect(engine.lastSuppression('vrai')).toBeUndefined()
  })
})
