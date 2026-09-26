import { describe, expect, it, vi } from 'vitest'
import { parseTaskUpdate, registerTaskManagerIpc } from './task-manager-ipc'
import { TaskStore } from './task-store'
import {
  mailRuleHears,
  mailWatchdogSeed,
  rememberMailSender,
  senderKey,
  setMailSender,
  splitMailWatchdogByChannel
} from './watchdog-mail'
import { chatsToSnapshot } from './watchdog-teams'
import type { ScheduledTask } from './types'

// Pistes n°9 et n°13 du repérage du 2026-09-26 (interlocuteurs d'une règle mails / Teams).
// fix-ok: mesuré le 2026-09-26 avant correction : 5 rouges sur 5 — deux homonymes Teams avaient la même clé « teams:alice martin », setMailSender absent, et le formulaire enregistré effaçait la personne apprise pendant l'édition.

const ME = 'user-me'

function teamsChat(chatId: string, messageId: string, userId: string, displayName: string) {
  return {
    id: chatId,
    topic: null,
    chatType: 'oneOnOne',
    lastMessagePreview: {
      id: messageId,
      createdDateTime: '2026-09-26T10:00:00Z',
      messageType: 'message',
      from: { user: { id: userId, displayName } },
      body: { contentType: 'text', content: 'Tu peux regarder ?' }
    }
  }
}

function teamsRule(store: TaskStore): ScheduledTask {
  return store
    .listTasks()
    .find(
      (task) =>
        task.watchdog?.source.kind === 'outlook-mail' && task.watchdog.source.channel === 'teams'
    )!
}

function sendersOf(task: ScheduledTask | undefined): unknown {
  const source = task?.watchdog?.source
  return source?.kind === 'outlook-mail' ? source.senders : undefined
}

describe('n°13 — une personne Teams est reconnue par son identifiant Microsoft, pas par son nom', () => {
  it('deux homonymes ont chacun leur interrupteur', () => {
    const { mails } = chatsToSnapshot(
      [
        teamsChat('c1', 'm1', 'id-a', 'Alice Martin'),
        teamsChat('c2', 'm2', 'id-b', 'Alice Martin')
      ],
      ME
    )
    expect(senderKey('teams', mails[0])).not.toBe(senderKey('teams', mails[1]))
  })

  it('une personne coupée le reste après avoir changé de nom affiché', () => {
    const store = new TaskStore()
    store.create(mailWatchdogSeed())
    splitMailWatchdogByChannel(store)
    const avant = chatsToSnapshot([teamsChat('c1', 'm1', 'id-a', 'Alice Martin')], ME).mails[0]
    const key = senderKey('teams', avant)!
    rememberMailSender(store, 'teams', key, 'Alice Martin')
    setMailSender(store, teamsRule(store).id, key, false)

    const apres = chatsToSnapshot([teamsChat('c1', 'm2', 'id-a', 'Alice Dupont')], ME).mails[0]
    expect(mailRuleHears(teamsRule(store), 'teams', senderKey('teams', apres))).toBe(false)
  })
})

describe('n°9 — couper une personne depuis le détail de la règle', () => {
  it('ne change que cette personne, et garde celles apprises entre-temps', () => {
    const store = new TaskStore()
    const rule = store.create(mailWatchdogSeed())
    rememberMailSender(store, 'outlook', 'bob@x.fr', 'Bob')
    rememberMailSender(store, 'outlook', 'alice@x.fr', 'Alice')

    setMailSender(store, rule.id, 'bob@x.fr', false)

    expect(sendersOf(store.getTask(rule.id))).toEqual({
      'bob@x.fr': { name: 'Bob', enabled: false },
      'alice@x.fr': { name: 'Alice', enabled: true }
    })
    expect(() => setMailSender(store, rule.id, 'inconnu@x.fr', false)).toThrow(/inconnu/)
    expect(() => setMailSender(store, 'pas-une-regle', 'bob@x.fr', false)).toThrow()
  })

  it('le formulaire enregistré avec une liste périmée n’efface pas une personne apprise pendant l’édition', () => {
    const store = new TaskStore()
    const rule = store.create(mailWatchdogSeed())
    rememberMailSender(store, 'outlook', 'bob@x.fr', 'Bob')
    // Le formulaire est ouvert ICI : il ne connaît que Bob.
    const formulaire = structuredClone(store.getTask(rule.id)!)
    rememberMailSender(store, 'outlook', 'alice@x.fr', 'Alice') // arrive pendant l'édition
    const source = formulaire.watchdog!.source
    if (source.kind !== 'outlook-mail') throw new Error('règle mails attendue')
    source.senders = { 'bob@x.fr': { name: 'Bob', enabled: false } }

    const enregistre = parseTaskUpdate(store.getTask(rule.id)!, formulaire)

    expect(sendersOf(enregistre as ScheduledTask)).toEqual({
      'bob@x.fr': { name: 'Bob', enabled: false },
      'alice@x.fr': { name: 'Alice', enabled: true }
    })
  })

  it('appel dédié task-manager:set-sender : une seule personne, puis rafraîchissement', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const store = new TaskStore()
    const rule = store.create(mailWatchdogSeed())
    rememberMailSender(store, 'outlook', 'bob@x.fr', 'Bob')
    const refresh = vi.fn(async () => undefined)
    const onChanged = vi.fn()
    registerTaskManagerIpc({
      ipc: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler)
        }
      } as never,
      store,
      scheduler: { refresh } as never,
      watchdogDiagnostics: () => ({ admittedLastHour: 0 }),
      assertTrusted: () => undefined,
      onChanged
    })
    const setSender = handlers.get('task-manager:set-sender')
    if (!setSender) throw new Error('appel task-manager:set-sender absent')

    await setSender({}, rule.id, 'bob@x.fr', false)

    expect(sendersOf(store.getTask(rule.id))).toEqual({
      'bob@x.fr': { name: 'Bob', enabled: false }
    })
    expect(onChanged).toHaveBeenCalledOnce()
    await expect(setSender({}, rule.id, 'bob@x.fr', 'non')).rejects.toThrow(/enabled/)
  })
})

describe('n°10 — réglage « nouvelles personnes : répondre / ignorer »', () => {
  function withNewSenders(store: TaskStore, taskId: string, newSenders: 'reply' | 'ignore'): void {
    const task = store.getTask(taskId)!
    const source = task.watchdog!.source
    if (source.kind !== 'outlook-mail') throw new Error('règle mails attendue')
    store.update(taskId, { watchdog: { ...task.watchdog!, source: { ...source, newSenders } } })
  }

  it('sans réglage, une nouvelle personne reçoit une réponse (comportement inchangé)', () => {
    const store = new TaskStore()
    const rule = store.create(mailWatchdogSeed())
    rememberMailSender(store, 'outlook', 'news@x.fr', 'Newsletter')
    expect(sendersOf(store.getTask(rule.id))).toEqual({
      'news@x.fr': { name: 'Newsletter', enabled: true }
    })
    expect(mailRuleHears(store.getTask(rule.id)!, 'outlook', 'news@x.fr')).toBe(true)
  })

  it('« ignorer » : la nouvelle personne est ajoutée décochée et la règle ne lui répond pas', () => {
    const store = new TaskStore()
    const rule = store.create(mailWatchdogSeed())
    rememberMailSender(store, 'outlook', 'bob@x.fr', 'Bob') // déjà connu, coché
    withNewSenders(store, rule.id, 'ignore')

    rememberMailSender(store, 'outlook', 'news@x.fr', 'Newsletter')
    rememberMailSender(store, 'outlook', 'bob@x.fr', 'Bob')

    expect(sendersOf(store.getTask(rule.id))).toEqual({
      'bob@x.fr': { name: 'Bob', enabled: true },
      'news@x.fr': { name: 'Newsletter', enabled: false }
    })
    expect(mailRuleHears(store.getTask(rule.id)!, 'outlook', 'news@x.fr')).toBe(false)
    expect(mailRuleHears(store.getTask(rule.id)!, 'outlook', 'bob@x.fr')).toBe(true)
    // Cochée ensuite d'un clic, la personne est de nouveau entendue.
    setMailSender(store, rule.id, 'news@x.fr', true)
    expect(mailRuleHears(store.getTask(rule.id)!, 'outlook', 'news@x.fr')).toBe(true)
  })

  it('le réglage survit à l’enregistrement du formulaire ; une valeur inconnue retombe sur « répondre »', () => {
    const store = new TaskStore()
    const rule = store.create(mailWatchdogSeed())
    const formulaire = structuredClone(store.getTask(rule.id)!)
    const source = formulaire.watchdog!.source
    if (source.kind !== 'outlook-mail') throw new Error('règle mails attendue')

    source.newSenders = 'ignore'
    const ignore = parseTaskUpdate(store.getTask(rule.id)!, formulaire) as ScheduledTask
    expect(ignore.watchdog?.source).toMatchObject({ kind: 'outlook-mail', newSenders: 'ignore' })

    ;(source as { newSenders?: unknown }).newSenders = 'n-importe-quoi'
    const inconnu = parseTaskUpdate(store.getTask(rule.id)!, formulaire) as ScheduledTask
    expect(inconnu.watchdog?.source).not.toHaveProperty('newSenders')
  })
})
