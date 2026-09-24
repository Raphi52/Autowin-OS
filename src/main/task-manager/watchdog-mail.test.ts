// fix-ok: 3e édition = typage du runtime simulé (erreur tsc mesurée, typecheck:node exit 0 après) + reconversion CRLF->LF
import { describe, expect, it, vi } from 'vitest'
import { ScheduledChatDispatcher, type ScheduledChatRuntime } from './chat-dispatch'
import { TaskStore } from './task-store'
import { WatchdogEngine } from './watchdog-engine'
import {
  MAIL_REPLY_END,
  MAIL_REPLY_START,
  NewUnreadMailDetector,
  extractMailReply,
  mailWatchdogSeed,
  seedMailWatchdogTask
} from './watchdog-mail'
import type { ScheduledTask, TaskOccurrence } from './types'

const mail = (id: string, nonLu = true) => ({ id, nonLu, sujet: 's', corps: 'c' })
const snap = (...mails: unknown[]) => ({ ok: true, mails })

describe('Watchdog mail — détection des nouveaux mails', () => {
  it('la boîte déjà pleine au démarrage ne déclenche rien, un mail neuf non lu oui', () => {
    const detector = new NewUnreadMailDetector()
    expect(detector.next(snap(mail('A'), mail('B')))).toEqual([])
    expect(detector.next(snap(mail('C'), mail('D', false), mail('A'))).map((m) => m.id)).toEqual([
      'C'
    ])
    expect(detector.next(snap(mail('C')))).toEqual([])
  })

  it('Outlook fermé ne pose pas de ligne de base vide', () => {
    const detector = new NewUnreadMailDetector()
    expect(detector.next({ ok: false })).toEqual([])
    expect(detector.next(snap(mail('A')))).toEqual([])
  })
})

describe('Watchdog mail — extraction du compte rendu', () => {
  it('extrait le bloc, refuse l’absence et le refus explicite', () => {
    expect(
      extractMailReply(`bla\n${MAIL_REPLY_START}\nFait.\n${MAIL_REPLY_END}\nISSUE: repair`)
    ).toBe('Fait.')
    expect(extractMailReply('pas de bloc')).toBeUndefined()
    expect(
      extractMailReply(`${MAIL_REPLY_START}\nAUCUNE_REPONSE\n${MAIL_REPLY_END}`)
    ).toBeUndefined()
  })
})

describe('Watchdog mail — règle visible dans l’onglet Watchdog', () => {
  it('est posée une seule fois comme vraie tâche watchdog', () => {
    const store = new TaskStore()
    const id = seedMailWatchdogTask(store)
    expect(id).toBeTruthy()
    expect(store.listTasks().find((t) => t.id === id)?.watchdog?.source).toEqual({
      kind: 'outlook-mail'
    })
    expect(seedMailWatchdogTask(store)).toBeUndefined()
  })
})

function mailTask(): ScheduledTask {
  return {
    ...mailWatchdogSeed(),
    id: 'mail-1',
    destination: { kind: 'existing', conversationId: 'conv-mail' },
    nextRunAt: null,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('Watchdog mail — agent en mode auto puis réponse au mail', () => {
  const occurrence: TaskOccurrence = {
    id: 'mail-1@w',
    taskId: 'mail-1',
    scheduledFor: 1,
    mode: 'active-only',
    status: 'claimed',
    claimedAt: 1,
    trigger: 'watchdog',
    watchdog: {
      signature: 'outlook-mail:AB',
      rootSignature: 'outlook-mail:AB',
      context: 'De : x',
      depth: 0,
      source: 'outlook-mail',
      observedAt: 1,
      mail: { itemId: 'ABCDEF0123456789' }
    }
  }

  function runtime(
    text: string,
    overrides: Partial<ScheduledChatRuntime> = {}
  ): ScheduledChatRuntime {
    return {
      hasConversation: vi.fn(() => true),
      createConversation: vi.fn(() => ({ id: 'conv-new' })),
      bindConversation: vi.fn(),
      isConversationBusy: vi.fn(() => false),
      interruptAndWait: vi.fn(async () => false),
      runPrompt: vi.fn(async () => ({ ok: true, turnId: 't', text })),
      replyToMail: vi.fn(async () => ({ ok: true })),
      ...overrides
    }
  }

  it('lance le tour en écriture (mode auto) et envoie le compte rendu', async () => {
    const target = runtime(`${MAIL_REPLY_START}\nC'est fait.\n${MAIL_REPLY_END}\nISSUE: repair`)
    const result = await new ScheduledChatDispatcher(target).run(mailTask(), occurrence)
    const policy = vi.mocked(target.runPrompt).mock.calls[0][3]
    expect(policy).toMatchObject({ readOnly: false, background: true })
    expect(policy!.maxIterations).toBeGreaterThan(1)
    expect(target.replyToMail).toHaveBeenCalledWith('ABCDEF0123456789', "C'est fait.")
    expect(result.status).toBe('completed')
  })

  it('une demande refusée ne part pas en réponse', async () => {
    const target = runtime(`${MAIL_REPLY_START}\nAUCUNE_REPONSE\n${MAIL_REPLY_END}`)
    await new ScheduledChatDispatcher(target).run(mailTask(), occurrence)
    expect(target.replyToMail).not.toHaveBeenCalled()
  })

  it('un échec d’envoi rend l’occurrence rouge', async () => {
    const target = runtime(`${MAIL_REPLY_START}\nok\n${MAIL_REPLY_END}`, {
      replyToMail: vi.fn(async () => ({ ok: false, erreur: 'Outlook fermé' }))
    })
    const result = await new ScheduledChatDispatcher(target).run(mailTask(), occurrence)
    expect(result.status).toBe('failed')
  })

  it('le moteur réveille la règle avec l’identifiant du mail', async () => {
    const runWatchdog = vi.fn(async (_taskId: string, _signal: unknown) => ({ fired: true }))
    const engine = new WatchdogEngine(() => [mailTask()], { runWatchdog })
    await engine.notifyMail({ itemId: 'ABCDEF0123456789', context: 'De : x' })
    await engine.notifyMail({ itemId: 'ABCDEF0123456789', context: 'De : x' })
    expect(runWatchdog).toHaveBeenCalledTimes(1)
    expect(runWatchdog.mock.calls[0][1]).toMatchObject({
      source: 'outlook-mail',
      mail: { itemId: 'ABCDEF0123456789' }
    })
  })
})
