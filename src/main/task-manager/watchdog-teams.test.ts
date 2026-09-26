import { describe, expect, it, vi } from 'vitest'
// fix-ok: 3e edit = defaut reinjecte mal ecrit (precedence d operateurs laissait la garde en place), corrige ; le vrai defaut rend la suite rouge.
import { ScheduledChatDispatcher, type ScheduledChatRuntime } from './chat-dispatch'
import {
  MAIL_REPLY_END,
  MAIL_REPLY_START,
  NewUnreadMailDetector,
  mailWatchdogSeed
} from './watchdog-mail'
import type { ScheduledTask, TaskOccurrence } from './types'
import {
  TeamsGraphClient,
  chatsToSnapshot,
  parseTeamsItemId,
  replyTeams,
  teamsItemId,
  type TokenVault
} from './watchdog-teams'

const ME = 'user-me'

function chat(
  id: string,
  msgId: string,
  fromId: string,
  text = 'Peux-tu relire le devis ?',
  chatType = 'oneOnOne'
) {
  return {
    id,
    topic: null,
    chatType,
    lastMessagePreview: {
      id: msgId,
      createdDateTime: '2026-09-24T10:00:00Z',
      messageType: 'message',
      from: { user: { id: fromId, displayName: 'Alice' } },
      body: { contentType: 'html', content: `<p>${text}</p>` }
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('watchdog Teams', () => {
  it('identifiant Teams aller-retour ; un id Outlook n’est pas Teams', () => {
    const id = teamsItemId('19:abc@unq.gbl.spaces', '1727')
    expect(parseTeamsItemId(id)).toEqual({ chatId: '19:abc@unq.gbl.spaces', messageId: '1727' })
    expect(parseTeamsItemId('00000000ABCDEF')).toBeUndefined()
  })

  it('un nouveau message d’un autre déclenche, pas le sien (la réponse de l’agent ne boucle pas)', () => {
    const detector = new NewUnreadMailDetector()
    expect(detector.next(chatsToSnapshot([chat('c1', 'm1', 'alice')], ME))).toEqual([])
    const fresh = detector.next(
      chatsToSnapshot([chat('c1', 'm2', 'alice'), chat('c2', 'm3', ME)], ME)
    )
    expect(fresh.map((m) => m.id)).toEqual([teamsItemId('c1', 'm2')])
    expect(fresh[0].corps).toBe('Peux-tu relire le devis ?')
    detector.settle(fresh[0].id) // pris en charge par la surveillance
    expect(detector.next(chatsToSnapshot([chat('c1', 'm2', 'alice')], ME))).toEqual([])
  })

  it('ignore les conversations de groupe et de réunion : messages perso uniquement', () => {
    const snap = chatsToSnapshot(
      [
        chat('solo', 'm1', 'alice'),
        chat('grp', 'm2', 'alice', 'salut', 'group'),
        chat('reu', 'm3', 'alice', 'salut', 'meeting')
      ],
      ME
    )
    expect(snap.mails.map((m) => m.id)).toEqual([teamsItemId('solo', 'm1')])
  })

  it('code d’appareil puis réponse postée dans le même fil, jeton rangé dans le coffre', async () => {
    const saved: string[] = []
    const vault: TokenVault = { load: () => saved.at(-1), save: (t) => saved.push(t) }
    const calls: Array<{ url: string; body?: string }> = []
    let polls = 0
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, body: init?.body as string | undefined })
      if (url.endsWith('/devicecode'))
        return json({
          device_code: 'dc',
          user_code: 'ABCD',
          verification_uri: 'https://microsoft.com/devicelogin',
          interval: 1,
          expires_in: 60
        })
      if (url.endsWith('/token')) {
        if (polls++ === 0) return json({ error: 'authorization_pending' }, 400)
        return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
      }
      if (url.includes('/chats/') && url.endsWith('/messages')) return json({ id: 'new' }, 201)
      return json({}, 404)
    }
    const codes: string[] = []
    const client = new TeamsGraphClient(
      { clientId: 'cid', tenantId: 'organizations' },
      vault,
      (p) => codes.push(p.userCode),
      fetchImpl,
      () => 0,
      async () => {}
    )
    // Piste n°2 : la connexion part du bouton « Connecter Teams », plus de la surveillance.
    // fix-ok: mesure le 2026-09-26 — `reply()`/`snapshot()` lancaient eux-memes la demande de code (watchdog-teams.connexion.test.ts rouge : « connexion Teams refusée » sans aucun clic) ; ces deux tests decrivaient ce comportement retire.
    await client.connect()
    await client.signInSettled()
    const sent = await client.reply(teamsItemId('19:chat', 'm2'), 'Fait : devis relu.')
    expect(sent).toEqual({ ok: true })
    expect(codes).toEqual(['ABCD'])
    expect(saved).toEqual(['rt'])
    const post = calls.at(-1)!
    expect(post.url).toBe('https://graph.microsoft.com/v1.0/chats/19%3Achat/messages')
    expect(JSON.parse(post.body!)).toEqual({
      body: { contentType: 'text', content: 'Fait : devis relu.' }
    })
  })

  it('un code expiré ne relance aucune demande aux passages suivants : seul un nouveau clic le fait', async () => {
    let clock = 0
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.endsWith('/devicecode'))
        return json({ device_code: 'dc', user_code: `C${clock}`, interval: 1, expires_in: 1 })
      if (url.endsWith('/token')) {
        clock += 2000
        return json({ error: 'authorization_pending' }, 400)
      }
      return json({}, 404)
    }
    const codes: string[] = []
    const client = new TeamsGraphClient(
      { clientId: 'cid', tenantId: 'organizations' },
      { load: () => undefined, save: () => {} },
      (p) => codes.push(p.userCode),
      fetchImpl,
      () => clock,
      async () => {}
    )
    await client.connect()
    await client.signInSettled()
    expect(client.signInState()).toMatchObject({ state: 'disconnected' })
    for (let passage = 0; passage < 3; passage++)
      await expect(client.snapshot()).rejects.toThrow(/Connecter Teams/)
    expect(codes).toHaveLength(1)
    await client.connect()
    expect(codes).toHaveLength(2)
  })

  it('un refus Graph remonte en échec, jamais en succès', async () => {
    const vault: TokenVault = { load: () => 'rt', save: () => {} }
    const fetchImpl = async (url: string): Promise<Response> =>
      url.endsWith('/token') ? json({ access_token: 'at', expires_in: 3600 }) : json({}, 403)
    const client = new TeamsGraphClient(
      { clientId: 'c', tenantId: 't' },
      vault,
      () => {},
      fetchImpl
    )
    const sent = await client.reply(teamsItemId('c1', 'm1'), 'x')
    expect(sent.ok).toBe(false)
    expect(sent.erreur).toContain('403')
  })

  it('un message déjà présent au démarrage (ancien) ne déclenche rien', () => {
    const detector = new NewUnreadMailDetector()
    expect(detector.next(chatsToSnapshot([chat('c1', 'old', 'alice')], ME))).toEqual([])
    expect(detector.next(chatsToSnapshot([chat('c1', 'old', 'alice')], ME))).toEqual([])
  })

  it('sans réglage, Teams reste désactivé avec un message clair et rien ne part', async () => {
    const sent = await replyTeams(undefined, teamsItemId('c1', 'm1'), 'x')
    expect(sent).toEqual({
      ok: false,
      erreur: 'Teams non configuré (AUTOWIN_TEAMS_CLIENT_ID absent)'
    })
  })

  it('aucun jeton dans les erreurs remontées (connexion refusée, Graph refusé)', async () => {
    const SECRET_AT = 'ACCESS-SECRET-123'
    const SECRET_RT = 'REFRESH-SECRET-456'
    const vault: TokenVault = { load: () => SECRET_RT, save: () => {} }
    const graphDenied = new TeamsGraphClient(
      { clientId: 'c', tenantId: 't' },
      vault,
      () => {},
      async (url) =>
        url.endsWith('/token')
          ? json({ access_token: SECRET_AT, refresh_token: SECRET_RT, expires_in: 3600 })
          : json({ error: { message: `Bearer ${SECRET_AT}` } }, 401)
    )
    const signInDenied = new TeamsGraphClient(
      { clientId: 'c', tenantId: 't' },
      { load: () => undefined, save: () => {} },
      () => {},
      async (url) =>
        url.endsWith('/devicecode')
          ? json({ device_code: SECRET_RT, user_code: 'U', interval: 1, expires_in: 60 })
          : json({ error: 'access_denied', refresh_token: SECRET_RT }, 400),
      () => 0,
      async () => {}
    )
    // La connexion refusée passe par le bouton : sa raison est ce que le détail de la règle affiche.
    await signInDenied.connect()
    await signInDenied.signInSettled()
    const refus = signInDenied.signInState()
    const errors = [
      (await graphDenied.reply(teamsItemId('c1', 'm1'), 'x')).erreur,
      refus.state === 'disconnected' ? refus.erreur : undefined,
      (await signInDenied.reply(teamsItemId('c1', 'm1'), 'x')).erreur,
      await graphDenied.snapshot().then(
        () => 'ok',
        (e: Error) => e.message
      )
    ]
    expect(errors.every((e) => typeof e === 'string' && e.length > 0)).toBe(true)
    for (const e of errors) {
      expect(e).not.toContain(SECRET_AT)
      expect(e).not.toContain(SECRET_RT)
    }
  })
})

describe('watchdog Teams — réponse de l’agent dans le même fil', () => {
  const itemId = teamsItemId('19:chat', 'm2')
  const task: ScheduledTask = {
    ...mailWatchdogSeed(),
    id: 'mail-1',
    destination: { kind: 'existing', conversationId: 'conv-mail' },
    nextRunAt: null,
    createdAt: 1,
    updatedAt: 1
  }
  const occurrence: TaskOccurrence = {
    id: 'mail-1@teams',
    taskId: 'mail-1',
    scheduledFor: 1,
    mode: 'active-only',
    status: 'claimed',
    claimedAt: 1,
    trigger: 'watchdog',
    watchdog: {
      signature: `outlook-mail:${itemId}`,
      rootSignature: `outlook-mail:${itemId}`,
      context: 'Source : message Teams reçu',
      depth: 0,
      source: 'outlook-mail',
      observedAt: 1,
      mail: { itemId }
    }
  }
  const runtime = (text: string): ScheduledChatRuntime => ({
    hasConversation: vi.fn(() => true),
    createConversation: vi.fn(() => ({ id: 'conv-new' })),
    bindConversation: vi.fn(),
    isConversationBusy: vi.fn(() => false),
    interruptAndWait: vi.fn(async () => false),
    runPrompt: vi.fn(async () => ({ ok: true, turnId: 't', text })),
    replyToMail: vi.fn(async () => ({ ok: true }))
  })

  it('extrait le bloc de réponse et le poste avec l’identifiant Teams', async () => {
    const target = runtime(`bla
${MAIL_REPLY_START}
Devis relu.
${MAIL_REPLY_END}
ISSUE: repair`)
    const result = await new ScheduledChatDispatcher(target).run(task, occurrence)
    expect(target.replyToMail).toHaveBeenCalledWith(itemId, 'Devis relu.')
    expect(result.status).toBe('completed')
  })

  it('AUCUNE_REPONSE : rien n’est posté dans Teams', async () => {
    const target = runtime(`${MAIL_REPLY_START}
AUCUNE_REPONSE
${MAIL_REPLY_END}`)
    await new ScheduledChatDispatcher(target).run(task, occurrence)
    expect(target.replyToMail).not.toHaveBeenCalled()
  })
})
