import { describe, expect, it, vi } from 'vitest'
import { TaskStore } from './task-store'
import { WatchdogEngine } from './watchdog-engine'
import {
  MailChannelWatcher,
  MailWatchMemory,
  listeningChannels,
  mailDiagnostics,
  liftLegacyMailWatchdogCaps,
  MAIL_NO_REPLY,
  MAIL_REPLY_END,
  MAIL_REPLY_START,
  mailWatchdogSeed,
  rememberMailSender,
  retargetTeamsWatchdogPrompt,
  senderKey,
  splitMailWatchdogByChannel,
  teamsWatchdogPrompt
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

  it("un mail ordinaire qui cite un mot d'incident réveille quand même la règle", async () => {
    // Le filtre anti-bruit des INCIDENTS (abandon, quota, panne amont) s'appliquait aussi au texte
    // des mails : un humain qui écrit « Internal Server Error » ou « quota exceeded » était ignoré
    // sans trace. Un mail est une demande, pas un échec d'agent.
    // fix-ok: sans le garde source==='outlook-mail' de fire(), ce test rend 2 réveils sur 8 (suppressionFor : upstream-outage, non-actionable ×2 par canal) — mesuré 2026-09-26.
    const runWatchdog = vi.fn(async (_id: string, _s: unknown) => ({ fired: true }))
    const tasks = [
      task('o', { kind: 'outlook-mail', channel: 'outlook' }),
      task('t', { kind: 'outlook-mail', channel: 'teams' })
    ]
    const engine = new WatchdogEngine(() => tasks, { runWatchdog })
    const bodies = [
      'Bonjour, le portail client affiche « Internal Server Error » depuis ce matin, tu peux regarder ?',
      'Mon espace partagé dit quota exceeded, peux-tu voir avec le fournisseur ?',
      "L'orchestration annulée hier doit être relancée avant midi.",
      'Le VPN me demande de re-authenticate toutes les heures, normal ?'
    ]
    for (const [i, body] of bodies.entries()) {
      await engine.notifyMail({ itemId: `m${i}`, context: body, channel: 'outlook' })
      await engine.notifyMail({ itemId: `teams:c:${i}`, context: body, channel: 'teams' })
    }
    expect(runWatchdog).toHaveBeenCalledTimes(bodies.length * 2)
    expect(engine.lastSuppression('o')).toBeUndefined()
    expect(engine.lastSuppression('t')).toBeUndefined()
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

  it('la règle Teams reçoit une consigne Teams, pas celle du mail Outlook', () => {
    // Vécu sur le disque (règle 88ad3d84, 2026-09-26) : la séparation recopiait la consigne Outlook,
    // et l'agent Teams lisait « Un mail vient d'arriver dans ma boîte Outlook ».
    const nouvelle = new TaskStore()
    nouvelle.create(mailWatchdogSeed())
    splitMailWatchdogByChannel(nouvelle)
    const teamsWatchdog = {
      ...mailWatchdogSeed().watchdog!,
      source: { kind: 'outlook-mail' as const, channel: 'teams' as const }
    }
    const deja = new TaskStore()
    deja.create({
      ...mailWatchdogSeed(),
      title: 'Assistant Teams — répond aux messages Teams perso',
      watchdog: teamsWatchdog
    })
    const editee = deja.create({
      ...mailWatchdogSeed(),
      prompt: 'Ma consigne à moi',
      watchdog: teamsWatchdog
    })
    expect(retargetTeamsWatchdogPrompt(deja)).toBe(1)
    expect(retargetTeamsWatchdogPrompt(deja)).toBeUndefined()
    const isTeams = (t: ScheduledTask): boolean =>
      t.watchdog?.source.kind === 'outlook-mail' && t.watchdog.source.channel === 'teams'
    for (const store of [nouvelle, deja]) {
      const prompts = store
        .listTasks()
        .filter(isTeams)
        .filter((t) => t.id !== editee.id)
        .map((t) => t.prompt)
      expect(prompts).toEqual([teamsWatchdogPrompt()])
    }
    // Les marques de réponse gardent le mot « MAIL » : c'est le format que lit extractMailReply.
    expect(teamsWatchdogPrompt()).not.toMatch(/Outlook|Un mail vient/)
    expect(teamsWatchdogPrompt()).toMatch(/Teams/)
    for (const marque of [MAIL_REPLY_START, MAIL_REPLY_END, MAIL_NO_REPLY])
      expect(teamsWatchdogPrompt()).toContain(marque)
    expect(deja.getTask(editee.id)!.prompt).toBe('Ma consigne à moi')
  })

  it("l'ancien plafond 10/h + 60/jour passe à 240/h sans plafond du jour, une seule fois", () => {
    // Commit 85f21c18 (demande du 2026-09-24 : pas de plafond de volume) n'a changé que le modèle :
    // les deux règles déjà posées gardaient 10/h et 60/jour (lu sur le disque, 2026-09-26).
    // fix-ok: rouge avant correction (liftLegacyMailWatchdogCaps / retargetTeamsWatchdogPrompt absents) ; la ligne de séparation remise à `prompt: rest.prompt` refait échouer le test Teams (1 échec, mesuré 2026-09-26).
    const store = new TaskStore()
    const legacyGuards = {
      ...mailWatchdogSeed().watchdog!.guards,
      maxTriggersPerHour: 10,
      maxTriggersPerDay: 60
    }
    const ancienne = store.create({
      ...mailWatchdogSeed(),
      watchdog: { ...mailWatchdogSeed().watchdog!, guards: legacyGuards }
    })
    const choisie = store.create({
      ...mailWatchdogSeed(),
      watchdog: {
        ...mailWatchdogSeed().watchdog!,
        guards: { ...legacyGuards, maxTriggersPerHour: 5 }
      }
    })
    expect(liftLegacyMailWatchdogCaps(store)).toBe(1)
    expect(liftLegacyMailWatchdogCaps(store)).toBeUndefined()
    const guards = store.getTask(ancienne.id)!.watchdog!.guards
    expect(guards.maxTriggersPerHour).toBe(240)
    expect(guards.maxTriggersPerDay).toBeUndefined()
    expect(guards.dedupWindowMs).toBe(legacyGuards.dedupWindowMs)
    expect(store.getTask(choisie.id)!.watchdog!.guards).toEqual({
      ...legacyGuards,
      maxTriggersPerHour: 5
    })
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

// Pistes n°3, 6, 8 et 11 du repérage du 2026-09-26, et la relecture complète inutile.
// fix-ok: défauts réinjectés un par un (next() qui marque tout vu, watch() qui attend l'agent, ligne de base qui avale les non-lus après redémarrage, canaux interrogés sans règle active, refus sans trace) : chacun fait échouer son test ci-dessous.
describe('Watchdog mail/Teams — surveillance fiable et explicable', () => {
  const at = (hhmm: string): string => `2026-09-25T${hhmm}:00.0000000`
  type Row = { id: string; recu: string; nonLu?: boolean; adresse?: string }
  const inbox = (...mails: Row[]): unknown => ({
    ok: true,
    mails: mails.map((m) => ({
      id: m.id,
      nom: m.adresse === 'bob@x.fr' ? 'Bob' : 'Alice',
      adresse: m.adresse ?? 'alice@x.fr',
      sujet: `Sujet ${m.id}`,
      recuLe: at(m.recu),
      nonLu: m.nonLu ?? true,
      corps: 'aperçu'
    }))
  })
  const disk = (): { load(): string | undefined; save(text: string): void } => {
    let saved: string | undefined
    return { load: () => saved, save: (text) => void (saved = text) }
  }
  const storeWith = (...sources: WatchdogSource[]): TaskStore => {
    const store = new TaskStore()
    for (const source of sources)
      store.create({ ...mailWatchdogSeed(), watchdog: { ...mailWatchdogSeed().watchdog!, source } })
    return store
  }
  const bobOff: WatchdogSource = {
    kind: 'outlook-mail',
    channel: 'outlook',
    senders: { 'bob@x.fr': { name: 'Bob', enabled: false } }
  }

  it("n°8 : un canal n'est interrogé que si une règle ACTIVE l'écoute", () => {
    const outlookOff = {
      ...task('o', { kind: 'outlook-mail', channel: 'outlook' }),
      enabled: false
    }
    const teamsOn = task('t', { kind: 'outlook-mail', channel: 'teams' })
    expect(listeningChannels([outlookOff, teamsOn])).toEqual({ outlook: false, teams: true })
    expect(listeningChannels([task('l', { kind: 'outlook-mail' })])).toEqual({
      outlook: true,
      teams: true
    })
    expect(listeningChannels([])).toEqual({ outlook: false, teams: false })
  })

  it("n°11 : la lecture n'attend pas la fin de l'agent, et Teams n'attend pas Outlook", async () => {
    const store = storeWith(
      { kind: 'outlook-mail', channel: 'outlook' },
      { kind: 'outlook-mail', channel: 'teams' }
    )
    let release!: () => void
    const agentRunning = new Promise<void>((resolve) => (release = resolve))
    const notified: string[] = []
    const watcher = new MailChannelWatcher({
      store,
      memory: new MailWatchMemory(disk()),
      notifyMail: async (mail) => {
        notified.push(mail.itemId)
        mail.onDecision(store.listTasks()[0].id, 'fired')
        await agentRunning // l'agent tourne longtemps
      }
    })
    const context = async (): Promise<string> => 'c'
    await watcher.watch('outlook', inbox({ id: 'A', recu: '07:00' }), context)
    const later = inbox(
      { id: 'A', recu: '07:00' },
      { id: 'B', recu: '08:02' },
      { id: 'C', recu: '08:05' }
    )
    await watcher.watch('outlook', later, context)
    await watcher.watch('teams', { ok: true, mails: [] }, context)
    // Les deux lectures ont rendu la main pendant que l'agent de B tourne encore.
    expect(notified).toEqual(['B'])
    release()
    await watcher.drain('outlook')
    expect(notified).toEqual(['B', 'C'])
  })

  it("n°11 : une erreur sur un message ne perd pas les suivants, et il revient au passage d'après", async () => {
    const store = storeWith({ kind: 'outlook-mail', channel: 'outlook' })
    const notified: string[] = []
    const watcher = new MailChannelWatcher({
      store,
      memory: new MailWatchMemory(disk()),
      notifyMail: async (mail) => void notified.push(mail.itemId),
      warn: () => {}
    })
    let failB = true
    const context = async (mail: { id: string }): Promise<string> => {
      if (mail.id === 'B' && failB) throw new Error('relecture impossible')
      return 'c'
    }
    const later = inbox(
      { id: 'A', recu: '07:00' },
      { id: 'B', recu: '08:02' },
      { id: 'C', recu: '08:05' }
    )
    await watcher.watch('outlook', inbox({ id: 'A', recu: '07:00' }), context)
    await watcher.watch('outlook', later, context)
    await watcher.drain('outlook')
    expect(notified).toEqual(['C'])
    failB = false
    await watcher.watch('outlook', later, context)
    await watcher.drain('outlook')
    expect(notified).toEqual(['C', 'B'])
    await watcher.watch('outlook', later, context)
    await watcher.drain('outlook')
    expect(notified).toEqual(['C', 'B'])
  })

  it('relit le mail en entier seulement si une règle va y répondre', async () => {
    const store = storeWith(bobOff)
    const full: Record<string, boolean> = {}
    const watcher = new MailChannelWatcher({
      store,
      memory: new MailWatchMemory(disk()),
      notifyMail: async () => {}
    })
    const context = async (mail: { id: string }, isFull: boolean): Promise<string> => {
      full[mail.id] = isFull
      return 'c'
    }
    await watcher.watch('outlook', inbox({ id: 'A', recu: '07:00' }), context)
    await watcher.watch(
      'outlook',
      inbox(
        { id: 'A', recu: '07:00' },
        { id: 'B', recu: '08:02', adresse: 'bob@x.fr' },
        { id: 'C', recu: '08:05' }
      ),
      context
    )
    expect(full).toEqual({ B: false, C: true })
  })

  it("n°3 : un non-lu arrivé pendant que l'app était fermée est traité au redémarrage", async () => {
    const store = storeWith({ kind: 'outlook-mail', channel: 'outlook' })
    const file = disk()
    const notified: string[] = []
    const start = (): MailChannelWatcher =>
      new MailChannelWatcher({
        store,
        memory: new MailWatchMemory(file),
        notifyMail: async (mail) => {
          notified.push(mail.itemId)
          mail.onDecision(store.listTasks()[0].id, 'fired')
        }
      })
    const context = async (): Promise<string> => 'c'
    // Tout premier démarrage : aucun repère, la boîte déjà là ne déclenche rien.
    await start().watch('outlook', inbox({ id: 'OLD', recu: '07:00' }), context)
    expect(notified).toEqual([])
    // L'app est fermée, un mail arrive à 08:02, l'app redémarre (nouvel objet, même disque).
    const both = inbox({ id: 'OLD', recu: '07:00' }, { id: 'NEW', recu: '08:02' })
    const restarted = start()
    await restarted.watch('outlook', both, context)
    await restarted.drain('outlook')
    expect(notified).toEqual(['NEW'])
    // Redémarrage suivant : NEW est derrière le repère, il ne repart pas.
    const again = start()
    await again.watch('outlook', both, context)
    await again.drain('outlook')
    expect(notified).toEqual(['NEW'])
    // Seul le tout premier démarrage est noté « déjà là » (OLD, 1 non-lu), pas chaque redémarrage.
    const rule = store.listTasks()[0]
    const baselines = mailDiagnostics(new MailWatchMemory(file), rule).mailLog?.filter(
      (entry) => entry.outcome === 'baseline'
    )
    expect(baselines?.map((entry) => entry.detail)).toEqual([
      '1 non lu(s) déjà là au premier démarrage'
    ])
  })

  it('n°6 : chaque décision et la lecture en panne sont gardées sur le disque et affichables', async () => {
    const file = disk()
    const store = storeWith(bobOff)
    const rule = store.listTasks()[0]
    const memory = new MailWatchMemory(file)
    const runWatchdog = vi.fn(async (_id: string, _s: unknown) => ({ fired: true }))
    const engine = new WatchdogEngine(() => store.listTasks(), { runWatchdog })
    const watcher = new MailChannelWatcher({
      store,
      memory,
      notifyMail: (mail) => engine.notifyMail(mail),
      now: () => 1_000
    })
    const context = async (): Promise<string> => 'c'
    await watcher.watch('outlook', { ok: false, erreur: "Outlook n'est pas ouvert" }, context)
    expect(mailDiagnostics(new MailWatchMemory(file), rule).mailReadError).toEqual({
      channel: 'outlook',
      since: 1_000,
      erreur: "Outlook n'est pas ouvert"
    })
    await watcher.watch('outlook', inbox({ id: 'OLD', recu: '07:00' }), context)
    await watcher.watch(
      'outlook',
      inbox(
        { id: 'OLD', recu: '07:00' },
        { id: 'B', recu: '08:02', adresse: 'bob@x.fr' },
        { id: 'C', recu: '08:05' }
      ),
      context
    )
    await watcher.drain('outlook')
    // Le même mail revu par le moteur : refusé par la garde anti-doublon, et c'est écrit.
    await engine.notifyMail({
      itemId: 'C',
      context: 'c',
      channel: 'outlook',
      senderKey: 'alice@x.fr',
      onDecision: (taskId, outcome) =>
        memory.record(taskId, { at: 2_000, channel: 'outlook', outcome })
    })
    // Relu depuis le « disque » : ce que le détail de la règle affiche après un redémarrage.
    const shown = mailDiagnostics(new MailWatchMemory(file), rule)
    expect(shown.mailLog?.map((entry) => `${entry.from ?? '-'}:${entry.outcome}`)).toEqual([
      '-:dedup',
      'Alice:fired',
      'Bob:sender-off',
      '-:baseline'
    ])
    expect(shown.mailReadError).toBeUndefined() // la lecture suivante a réussi : panne levée
    expect(runWatchdog).toHaveBeenCalledTimes(1)
  })

  // Le 25/09 rejoué (.autowin-data/dev-app-stdout.log, lignes 44706-44994 ; launch-dev.log:19258) :
  // l'app lancée la veille à 21:30:57 a tourné jusqu'à 12:01:51, sa boucle de lecture vivait (demande de
  // code Teams toutes les ~15 min), le mail de 08:02 passait le filtre anti-incident, et il n'a rien
  // déclenché. L'ancien code avalait en silence une lecture Outlook en échec (`mailsOf` → rien) et
  // posait sa ligne de base à la première lecture réussie : une panne de lecture perdait le mail.
  it('25/09 : un mail arrivé pendant une panne de lecture Outlook part quand la lecture revient', async () => {
    const store = storeWith({ kind: 'outlook-mail', channel: 'outlook' })
    const file = disk()
    const notified: string[] = []
    let clock = Date.parse(at('07:00'))
    const start = (): MailChannelWatcher =>
      new MailChannelWatcher({
        store,
        memory: new MailWatchMemory(file),
        notifyMail: async (mail) => {
          notified.push(mail.itemId)
          mail.onDecision(store.listTasks()[0].id, 'fired')
        },
        now: () => clock
      })
    const context = async (): Promise<string> => 'c'
    // Une lecture réussie pose le repère sur le disque (dernier mail vu : 07:00).
    await start().watch('outlook', inbox({ id: 'OLD', recu: '07:00' }), context)
    // Redémarrage, puis des lectures en échec avant ET après l'arrivée du mail de 08:02.
    const app = start()
    for (const hhmm of ['07:30', '07:45', '08:05', '08:20', '08:35']) {
      clock = Date.parse(at(hhmm))
      await app.watch('outlook', { ok: false, erreur: 'Outlook ne répond pas' }, context)
    }
    const rule = store.listTasks()[0]
    expect(mailDiagnostics(new MailWatchMemory(file), rule).mailReadError).toEqual({
      channel: 'outlook',
      since: Date.parse(at('07:30')),
      erreur: 'Outlook ne répond pas'
    })
    // La lecture revient (Outlook relancé à 09:17) : le mail de 08:02 part, la panne s'efface.
    clock = Date.parse(at('09:17'))
    await app.watch(
      'outlook',
      inbox({ id: 'OLD', recu: '07:00' }, { id: 'M0802', recu: '08:02' }),
      context
    )
    await app.drain('outlook')
    expect(notified).toEqual(['M0802'])
    const shown = mailDiagnostics(new MailWatchMemory(file), rule)
    expect(shown.mailReadError).toBeUndefined()
    expect(shown.mailLog?.filter((entry) => entry.outcome === 'baseline')).toHaveLength(1)
  })
})
