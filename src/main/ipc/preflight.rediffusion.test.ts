/**
 * Le re-diagnostic manuel doit prevenir TOUTE l'app, pas seulement la page qui l'a demande.
 *
 * Symptome constate le 2026-09-10 : prerequis rouges au demarrage -> pastille « ! » sur l'onglet
 * Settings ; l'utilisateur repare, relance le diagnostic, la page affiche « Tous les prerequis sont
 * OK » et la pastille reste allumee. Cause : seul l'evenement `preflight:result` eteint la pastille,
 * et `preflight:recheck` ne l'emettait pas.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const send = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] }
}))

const runAppPreflight = vi.fn(async () => ({ ok: true, summary: 'OK', checks: [] }))
vi.mock('../preflight-probes', () => ({
  runAppPreflight: (...a: unknown[]) => runAppPreflight(...(a as [])),
  getLastAppPreflightResult: () => null,
  appPreflightProbes: () => ({ pingBrain: async () => true })
}))
vi.mock('../preflight-repair', () => ({ repairPreflightCheck: () => ({ started: false }) }))
vi.mock('../ipc-senders', () => ({ assertTrustedRendererSender: () => undefined }))

import { registerPreflightIpc } from './preflight'

describe('preflight:recheck', () => {
  beforeEach(() => {
    handlers.clear()
    send.mockClear()
    registerPreflightIpc({ preflightProviderOptions: () => ({ standbyProviders: [] }) })
  })

  it('rediffuse son resultat a toutes les fenetres', async () => {
    const result = await handlers.get('preflight:recheck')?.({}, true)
    expect(result).toEqual({ ok: true, summary: 'OK', checks: [] })
    expect(send).toHaveBeenCalledWith('preflight:result', result)
  })
})
