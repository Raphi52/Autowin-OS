import { describe, expect, it, vi } from 'vitest'
import { registerTaskManagerIpc } from './task-manager-ipc'
import { TaskStore } from './task-store'
import {
  MailWatchMemory,
  mailDiagnostics,
  mailWatchdogSeed,
  splitMailWatchdogByChannel
} from './watchdog-mail'
import { TeamsGraphClient, type TokenVault } from './watchdog-teams'

// Piste n°2 du repérage du 2026-09-26 : Teams n'avait jamais été connecté, et le code de connexion
// n'allait que dans le journal de l'app. Il s'affiche maintenant dans le détail de la règle Teams,
// derrière un bouton « Connecter Teams » ; la surveillance, elle, ne demande plus aucun code seule.
// fix-ok: mesuré le 2026-09-26 avant correction : 5 rouges sur 5 — sans aucun clic, snapshot() demandait un code à Microsoft (« connexion Teams refusée : inconnue »), et connect() n'existait pas.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const config = { clientId: 'cid', tenantId: 'organizations' }
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('n°2 — connexion Teams par le bouton du détail de la règle', () => {
  it('sans clic, la surveillance ne demande JAMAIS de code, et son erreur dit quoi faire', async () => {
    const urls: string[] = []
    const codes: string[] = []
    const client = new TeamsGraphClient(
      config,
      { load: () => undefined, save: () => {} },
      (prompt) => codes.push(prompt.userCode),
      async (url) => {
        urls.push(url)
        return json({ device_code: 'dc', user_code: 'AUTO', interval: 1, expires_in: 60 })
      },
      () => 0,
      macrotask
    )

    await expect(client.snapshot()).rejects.toThrow(/Connecter Teams/)
    await expect(client.snapshot()).rejects.toThrow(/Connecter Teams/)

    expect(codes).toEqual([])
    expect(urls.filter((url) => url.endsWith('/devicecode'))).toEqual([])
    expect(client.signInState()).toMatchObject({ state: 'disconnected' })
  })

  it('le clic rend le code, la surveillance n’attend pas sa saisie, puis la règle est connectée', async () => {
    let clock = 0
    let typed = false
    const saved: string[] = []
    const vault: TokenVault = { load: () => saved.at(-1), save: (token) => saved.push(token) }
    const client = new TeamsGraphClient(
      config,
      vault,
      () => {},
      async (url, init) => {
        if (url.endsWith('/devicecode'))
          return json({
            device_code: 'dc',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://microsoft.com/devicelogin',
            interval: 1,
            expires_in: 900
          })
        if (url.endsWith('/token')) {
          const grant = new URLSearchParams(String(init?.body)).get('grant_type')
          if (grant === 'refresh_token')
            return json({ access_token: 'at2', refresh_token: 'rt', expires_in: 3600 })
          if (!typed) return json({ error: 'authorization_pending' }, 400)
          return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
        }
        if (url.includes('/me?')) return json({ id: 'me' })
        if (url.includes('/me/chats')) return json({ value: [] })
        return json({}, 404)
      },
      () => clock,
      async (ms) => {
        clock += ms
        await macrotask()
      }
    )

    const prompt = await client.connect()
    expect(prompt).toMatchObject({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresAt: 900_000
    })
    expect(client.signInState()).toMatchObject({ state: 'code', userCode: 'ABCD-EFGH' })
    // Un 2e clic pendant l'attente rend le MEME code, il n'en redemande pas un.
    expect((await client.connect()).userCode).toBe('ABCD-EFGH')

    // La lecture Teams échoue TOUT DE SUITE pendant l'attente : avant, elle attendait la saisie
    // (jusqu'à 15 min) et la lecture Outlook suivante était sautée pendant ce temps.
    await expect(client.snapshot()).rejects.toThrow(/en attente/)

    typed = true
    await client.signInSettled()
    expect(client.signInState()).toEqual({ state: 'connected' })
    expect(saved).toEqual(['rt'])
    await expect(client.snapshot()).resolves.toEqual({ ok: true, mails: [] })
  })

  it('un code expiré : « non connecté » avec la raison, et un nouveau clic redonne un code', async () => {
    let clock = 0
    let issued = 0
    const client = new TeamsGraphClient(
      config,
      { load: () => undefined, save: () => {} },
      () => {},
      async (url) => {
        if (url.endsWith('/devicecode'))
          return json({ device_code: 'dc', user_code: `C${issued++}`, interval: 1, expires_in: 1 })
        clock += 2_000
        return json({ error: 'authorization_pending' }, 400)
      },
      () => clock,
      macrotask
    )

    expect((await client.connect()).userCode).toBe('C0')
    await client.signInSettled()
    expect(client.signInState()).toMatchObject({
      state: 'disconnected',
      erreur: expect.stringMatching(/expirée/)
    })
    expect((await client.connect()).userCode).toBe('C1')
  })

  it('le détail de la règle Teams porte l’état de connexion ; la règle Outlook, non', () => {
    const store = new TaskStore()
    store.create(mailWatchdogSeed())
    splitMailWatchdogByChannel(store)
    const memory = new MailWatchMemory({ load: () => undefined, save: () => {} })
    const [outlook, teams] = ['outlook', 'teams'].map((channel) =>
      store
        .listTasks()
        .find(
          (task) =>
            task.watchdog?.source.kind === 'outlook-mail' &&
            task.watchdog.source.channel === channel
        )!
    )
    const state = { state: 'disconnected' as const }
    expect(mailDiagnostics(memory, teams, state).teamsSignIn).toEqual(state)
    expect(mailDiagnostics(memory, outlook, state).teamsSignIn).toBeUndefined()
  })

  it('appel task-manager:teams-connect : rend le code et rafraîchit l’écran, puis encore à la fin', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    let settle: () => void = () => {}
    const onChanged = vi.fn()
    const base = {
      ipc: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler)
        }
      } as never,
      store: new TaskStore(),
      scheduler: { refresh: async () => undefined } as never,
      watchdogDiagnostics: () => ({ admittedLastHour: 0 }),
      assertTrusted: () => undefined,
      onChanged
    }
    registerTaskManagerIpc({
      ...base,
      teams: {
        connect: async () => ({
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://microsoft.com/devicelogin',
          message: 'ne doit pas sortir',
          expiresAt: 900_000
        }),
        signInSettled: () => new Promise<void>((resolve) => (settle = resolve))
      }
    })
    const connect = handlers.get('task-manager:teams-connect')
    if (!connect) throw new Error('appel task-manager:teams-connect absent')

    await expect(connect({})).resolves.toEqual({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresAt: 900_000
    })
    expect(onChanged).toHaveBeenCalledTimes(1)
    settle()
    await macrotask()
    expect(onChanged).toHaveBeenCalledTimes(2)

    // Sans réglage Teams sur le poste : un échec clair, jamais un faux succès.
    handlers.clear()
    registerTaskManagerIpc(base)
    await expect(handlers.get('task-manager:teams-connect')!({})).resolves.toEqual({
      ok: false,
      erreur: expect.stringMatching(/AUTOWIN_TEAMS_CLIENT_ID/)
    })
  })
})
