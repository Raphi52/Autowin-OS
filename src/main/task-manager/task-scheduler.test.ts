import { describe, expect, it, vi } from 'vitest'
import { TaskStore } from './task-store'
import {
  TaskScheduler,
  type SchedulerClock,
  type TaskDispatcher,
  type WindowsRelay
} from './task-scheduler'
import type { ScheduledTaskInput } from './types'

function input(
  mode: ScheduledTaskInput['mode'],
  overrides: Partial<ScheduledTaskInput> = {}
): ScheduledTaskInput {
  return {
    title: `Tâche ${mode}`,
    prompt: 'Exécute ce prompt.',
    enabled: true,
    mode,
    destination: { kind: 'existing', conversationId: 'conv-1' },
    schedule: {
      startDate: '2026-08-03',
      time: '09:30',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'day', interval: 1 }
    },
    ...overrides
  }
}

function harness(now: number): {
  store: TaskStore
  clock: SchedulerClock
  advanceTo: (value: number) => Promise<void>
  dispatch: TaskDispatcher
  relay: WindowsRelay
  dispatched: string[]
  relayCalls: Array<{ scheduledFor: number | null; occurrenceId: string | null }>
} {
  let current = now
  let timer:
    | {
        at: number
        callback: () => void
      }
    | undefined
  const dispatched: string[] = []
  const relayCalls: Array<{ scheduledFor: number | null; occurrenceId: string | null }> = []
  const store = new TaskStore({
    now: () => current,
    id: (() => {
      let sequence = 0
      return () => `id-${++sequence}`
    })()
  })
  return {
    store,
    clock: {
      now: () => current,
      setTimer: (callback, delayMs) => {
        timer = { at: current + delayMs, callback }
        return timer
      },
      clearTimer: (handle) => {
        if (timer === handle) timer = undefined
      }
    },
    advanceTo: async (value) => {
      current = value
      if (timer && timer.at <= current) {
        const callback = timer.callback
        timer = undefined
        callback()
        await vi.waitFor(() =>
          expect(timer?.at ?? Number.POSITIVE_INFINITY).toBeGreaterThan(current)
        )
      }
    },
    dispatch: {
      run: async (_task, occurrence) => {
        dispatched.push(occurrence.id)
        return { status: 'completed', conversationId: 'conv-1', turnId: 'turn-1' }
      }
    },
    relay: {
      arm: async (scheduledFor, occurrenceId) => {
        relayCalls.push({ scheduledFor, occurrenceId })
        return {
          available: true,
          scheduledFor,
          wakeToRun: true,
          startWhenAvailable: false,
          multipleInstances: 'IgnoreNew'
        }
      }
    },
    dispatched,
    relayCalls
  }
}

describe('Task Manager — ordonnanceur durable', () => {
  it('exécute une échéance live une seule fois puis programme la suivante', async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('active-only'))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.start()
    await h.advanceTo(due)

    expect(h.dispatched).toEqual([`${task.id}@${due}`])
    expect(h.store.getOccurrence(`${task.id}@${due}`)).toMatchObject({ status: 'completed' })
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-04T07:30:00.000Z'))

    await scheduler.processLiveDue()
    expect(h.dispatched).toHaveLength(1)
  })

  it('agrège au démarrage les échéances passées sans les rattraper', async () => {
    const firstDue = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(Date.parse('2026-08-03T07:00:00.000Z'))
    const task = h.store.create(input('active-only'))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await h.advanceTo(Date.parse('2026-08-05T08:00:00.000Z'))
    await scheduler.start()

    expect(h.dispatched).toEqual([])
    expect(h.store.listOccurrences(task.id)).toEqual([
      expect.objectContaining({
        status: 'missed',
        scheduledFor: firstDue,
        lastMissedFor: Date.parse('2026-08-05T07:30:00.000Z'),
        missedCount: 3
      })
    ])
    expect(h.store.listAlerts()).toHaveLength(1)
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-06T07:30:00.000Z'))
  })

  it('agrège 24 heures de retards à la minute en une seule occurrence', async () => {
    const firstDue = Date.parse('2026-08-03T07:30:00.000Z')
    const scenario = async (
      heures: number
    ): Promise<{ h: ReturnType<typeof harness>; task: { id: string }; ms: number }> => {
      const h = harness(firstDue - 60_000)
      const task = h.store.create(
        input('active-only', {
          schedule: {
            ...input('active-only').schedule!,
            recurrence: { unit: 'minute', interval: 1 }
          }
        })
      )
      const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)
      await h.advanceTo(firstDue + heures * 60 * 60_000)
      const depart = performance.now()
      await scheduler.start()
      return { h, task, ms: performance.now() - depart }
    }
    /*
     * REPETE POUR SORTIR DU BRUIT D'HORLOGE. Un seul rattrapage coute ~0,1 ms — sous cette barre,
     * `performance.now()` mesure surtout sa propre resolution, et un rapport sur une mesure unique
     * varierait au hasard. On cumule donc 30 scenarios NEUFS par horizon : le total passe au-dessus
     * de la milliseconde, la ou le rapport redevient interpretable. Le banc d'essai est purement en
     * memoire, donc repeter est quasi gratuit.
     */
    const REPETITIONS = 30
    const cumuler = async (heures: number): Promise<number> => {
      let total = 0
      for (let essai = 0; essai < REPETITIONS; essai += 1) total += (await scenario(heures)).ms
      return total
    }
    /*
     * CHAUFFE AVANT DE COMPARER. Mesure du 2026-09-09 : sans elle, le premier horizon paie la
     * compilation a chaud et le rapport tombait a 0,6-0,74 — un 24 h APPAREMMENT moins cher qu'un
     * 12 h. Flatteur, et dangereux : ce credit d'environ 0,65 se multiplierait au rapport d'une
     * vraie regression quadratique (~4x) pour la ramener a ~2,6, sous le plafond de 3. Le biais
     * aurait donc masque exactement le defaut surveille.
     */
    await cumuler(12)
    await cumuler(24)
    const douzeHeures = await cumuler(12)
    const vingtQuatreHeures = await cumuler(24)
    const { h, task } = await scenario(24)

    expect(h.store.listOccurrences(task.id)).toEqual([
      expect.objectContaining({ missedCount: 1_441, lastMissedFor: firstDue + 24 * 60 * 60_000 })
    ])
    expect(h.store.listAlerts()).toHaveLength(1)
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(firstDue + 24 * 60 * 60_000 + 60_000)
    /*
     * LE RATTRAPAGE NE DOIT PAS COUTER PLUS CHER PARCE QU'IL Y A PLUS DE RETARDS.
     *
     * Cette assertion etait `< 250 ms`. Marge reelle mesuree le 2026-09-09 : 0,101 ms, soit 2478x.
     * A ce point elle n'attrapait RIEN — une regression rendant le rattrapage quadratique tiendrait
     * encore sous 250 ms pour 1 441 occurrences tres legeres, et le defaut n'apparaitrait qu'en
     * vrai, sur une semaine de retards. Un budget en millisecondes mesurait la machine, pas le code.
     *
     * Ce qui compte est l'ECHELLE : 12 h de retards a la minute font 721 occurrences, 24 h en font
     * 1 441 — deux fois plus. Le scheduler les AGREGE (une seule occurrence rendue, `missedCount`
     * arithmetique) : son cout doit donc rester quasi PLAT, pas doubler. Un plafond a 3 laisse
     * passer un doublement franc et le bruit residuel, mais une quadratique (~4x pour 2x l'entree,
     * et bien pire au-dela) le franchit.
     *
     * ENTREE QUI DOIT LE FAIRE ECHOUER : remplacer l'agregation par une boucle qui cree une
     * occurrence par minute manquee.
     */
    expect(vingtQuatreHeures / Math.max(douzeHeures, 0.5)).toBeLessThan(3)
  })

  it("ne rattrape pas les échéances d'une tâche réactivée après plusieurs jours", async () => {
    const now = Date.parse('2026-08-05T08:00:00.000Z')
    const h = harness(now)
    const task = h.store.create(input('active-only', { enabled: false }))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.start()
    h.store.update(task.id, { enabled: true })
    await scheduler.refresh()
    await h.advanceTo(now)

    expect(h.dispatched).toEqual([])
    expect(h.store.listOccurrences(task.id)).toEqual([])
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-06T07:30:00.000Z'))
  })

  it('programme une nouvelle tâche récurrente passée à sa première échéance future', () => {
    const h = harness(Date.parse('2026-08-05T08:00:00.000Z'))
    const task = h.store.create(input('active-only'))

    expect(task.nextRunAt).toBe(Date.parse('2026-08-06T07:30:00.000Z'))
  })

  it("marque l'échéance Windows dépassée avant un passage en actif uniquement", async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const now = Date.parse('2026-08-03T08:00:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('windows'))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.start()
    await h.advanceTo(now)
    h.store.update(task.id, { mode: 'active-only' })
    await scheduler.refresh()
    await h.advanceTo(now)

    expect(h.dispatched).toEqual([])
    expect(h.store.getOccurrence(`${task.id}@${due}`)).toMatchObject({
      mode: 'windows',
      status: 'missed'
    })
    expect(h.store.listAlerts()).toHaveLength(1)
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-04T07:30:00.000Z'))
  })

  it('honore l’occurrence demandée par le relais Windows puis refuse son doublon', async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('windows'))
    const occurrenceId = `${task.id}@${due}`
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await h.advanceTo(due + 5_000)
    await scheduler.start(occurrenceId)
    await scheduler.runOccurrence(occurrenceId)

    expect(h.dispatched).toEqual([occurrenceId])
    expect(h.store.getOccurrence(occurrenceId)?.status).toBe('completed')
    expect(h.relayCalls.at(-1)).toEqual({
      scheduledFor: Date.parse('2026-08-04T07:30:00.000Z'),
      occurrenceId: `${task.id}@${Date.parse('2026-08-04T07:30:00.000Z')}`
    })
  })

  it('refuse un relais Windows reçu trop tard et alerte sans envoyer le prompt', async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('windows'))
    const occurrenceId = `${task.id}@${due}`
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await h.advanceTo(due + 6 * 60_000)
    await scheduler.start(occurrenceId)

    expect(h.dispatched).toEqual([])
    expect(h.store.getOccurrence(occurrenceId)).toMatchObject({
      mode: 'windows',
      status: 'missed'
    })
    expect(h.store.listAlerts()).toHaveLength(1)
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-04T07:30:00.000Z'))
  })

  it('réserve les tâches Windows au relais et ne les exécute pas avec le timer interne', async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('windows'))
    const occurrenceId = `${task.id}@${due}`
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.start()
    await h.advanceTo(due)

    expect(h.dispatched).toEqual([])
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(due)

    await scheduler.runOccurrence(occurrenceId)
    expect(h.dispatched).toEqual([occurrenceId])
  })

  it('identifie explicitement un lancement manuel dans son occurrence', async () => {
    const now = Date.parse('2026-08-03T08:00:00.000Z')
    const h = harness(now)
    const task = h.store.create(input('active-only'))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.runNow(task.id)

    expect(h.store.getOccurrence(`${task.id}@manual-${now}`)).toMatchObject({
      status: 'completed',
      trigger: 'manual'
    })
  })

  it('rattache un reglement provider tardif a l occurrence deja terminee', async () => {
    const now = Date.parse('2026-08-03T08:00:00.000Z')
    const h = harness(now)
    const task = h.store.create(input('active-only'))
    let settleLate:
      | ((usage: { knownCostUsd?: number; totalTokens?: number; unpricedCalls?: number }) => void)
      | undefined
    const dispatch: TaskDispatcher = {
      run: async (_task, _occurrence, _claims, onLateUsageSettlement) => {
        settleLate = onLateUsageSettlement
        return { status: 'completed', knownCostUsd: 0.01, totalTokens: 100 }
      }
    }
    const scheduler = new TaskScheduler(h.store, dispatch, h.relay, h.clock)

    await scheduler.runNow(task.id)
    settleLate?.({ knownCostUsd: 0.03, totalTokens: 300 })

    expect(h.store.getOccurrence(`${task.id}@manual-${now}`)).toMatchObject({
      status: 'completed',
      knownCostUsd: 0.03,
      totalTokens: 300
    })
  })

  it('conserve le canal de causalite tardive sur le chemin watchdog uniquement', async () => {
    const now = Date.parse('2026-08-03T08:00:00.000Z')
    const h = harness(now)
    const task = h.store.create(
      input('active-only', {
        schedule: undefined,
        watchdog: {
          source: { kind: 'app-event', events: ['orchestration-red'] },
          guards: { dedupWindowMs: 0, maxTriggersPerHour: 12, maxChainDepth: 0, maxPerRoot: 20 }
        }
      })
    )
    const onLateMutationClaims = vi.fn()
    const dispatch = {
      run: vi.fn(async (_task, _occurrence, _onLateMutationClaims) => ({
        status: 'completed' as const
      }))
    } satisfies TaskDispatcher
    const scheduler = new TaskScheduler(h.store, dispatch, h.relay, h.clock)

    await scheduler.runWatchdog(
      task.id,
      {
        signature: 'red',
        rootSignature: 'red@1',
        context: 'red',
        depth: 0,
        source: 'app-event',
        observedAt: now
      },
      onLateMutationClaims
    )

    expect(dispatch.run.mock.calls[0][2]).toBe(onLateMutationClaims)
  })
})
