import { describe, expect, it, vi } from 'vitest'
import { TaskStore } from './task-store'
import { WatchdogEngine } from './watchdog-engine'
import {
  mailWatchdogSeed,
  rememberMailSender,
  senderKey,
  splitMailWatchdogByChannel
} from './watchdog-mail'
import type { ScheduledTask, WatchdogSource } from './types'

const task = (id: string, source: WatchdogSource): ScheduledTask =>
  ({
    ...mailWatchdogSeed(),
    id,
    watchdog: { ...mailWatchdogSeed().watchdog!, source },
    nextRunAt: null,
    createdAt: 0,
    updatedAt: 0
  }) as ScheduledTask

describe('Watchdog mail/Teams — deux règles et interlocuteurs', () => {
  it('chaque règle ne réveille que son canal, et pas un interlocuteur décoché', async () => {
    const runWatchdog = vi.fn(async (_id: string, _s: unknown) => ({ fired: true }))
    const tasks = [
      task('o', {
        kind: 'outlook-mail',
        channel: 'outlook',
        senders: { 'bob@x.fr': { name: 'Bob', enabled: false } }
      }),
      task('t', { kind: 'outlook-mail', channel: 'teams' })
    ]
    const engine = new WatchdogEngine(() => tasks, { runWatchdog })
    await engine.notifyMail({ itemId: 'm1', context: 'c', channel: 'outlook', senderKey: 'bob@x.fr' })
    expect(runWatchdog).not.toHaveBeenCalled()
    await engine.notifyMail({ itemId: 'm2', context: 'c', channel: 'outlook', senderKey: 'al@x.fr' })
    await engine.notifyMail({ itemId: 'teams:c:1', context: 'c', channel: 'teams', senderKey: 'teams:al' })
    expect(runWatchdog.mock.calls.map(([id]) => id)).toEqual(['o', 't'])
  })

  it('la règle unique est séparée une seule fois en Outlook + Teams', () => {
    const store = new TaskStore()
    store.create(mailWatchdogSeed())
    expect(splitMailWatchdogByChannel(store)).toBeTruthy()
    expect(splitMailWatchdogByChannel(store)).toBeUndefined()
    const channels = store
      .listTasks()
      .map((t) => (t.watchdog?.source.kind === 'outlook-mail' ? t.watchdog.source.channel : '-'))
      .sort()
    expect(channels).toEqual(['outlook', 'teams'])
  })

  it('un nouvel interlocuteur est ajouté coché, sans écraser un choix existant', () => {
    const store = new TaskStore()
    store.create(mailWatchdogSeed())
    splitMailWatchdogByChannel(store)
    const key = senderKey('teams', { id: 'x', nom: ' Alice ' })!
    expect(key).toBe('teams:alice')
    rememberMailSender(store, 'teams', key, 'Alice')
    const teams = store
      .listTasks()
      .find((t) => t.watchdog?.source.kind === 'outlook-mail' && t.watchdog.source.channel === 'teams')!
    const src = teams.watchdog!.source
    expect(src.kind === 'outlook-mail' && src.senders).toEqual({
      'teams:alice': { name: 'Alice', enabled: true }
    })
    const outlook = store
      .listTasks()
      .find((t) => t.watchdog?.source.kind === 'outlook-mail' && t.watchdog.source.channel === 'outlook')!
    const o = outlook.watchdog!.source
    expect(o.kind === 'outlook-mail' && o.senders).toBeFalsy()
  })
})
