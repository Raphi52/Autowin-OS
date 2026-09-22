import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'
import { isForbidden } from './edit-file-command'

/**
 * LES TROIS RESTES DE LA PROTECTION DE PRODUCTION (conv-738, 2026-09-21).
 * (a) edit_file/create_file/move_file/delete_file partagent `isForbidden` : les réglages de la
 *     protection doivent y être interdits ; (b) `run` d'un client SQL sans porte branchée doit
 *     être REFUSÉ, pas lancé sans contrôle ; (c) `desktop_act` ne doit pas pouvoir cliquer
 *     « continuer » dans la fenêtre de confirmation pendant qu'une demande attend.
 */
function busDeBase(extra: Record<string, unknown>) {
  const lances: string[] = []
  const os = {
    executionWorkspace: process.cwd(),
    conversations: { get: () => ({ id: 'conv-1', messages: [{ role: 'user', content: 'vas-y' }] }), list: () => [], attachRun: () => undefined },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  const b = new AppCommandBus(os as never, () => {})
  Object.assign(b as unknown as Record<string, unknown>, {
    spawnVerify: async (argv: string[]) => {
      lances.push(argv.join(' '))
      return { allowed: true, output: 'ok', exitCode: 0 }
    },
    ...extra
  })
  return { b, lances }
}

describe('protection prod — trois restes', () => {
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'autowin-prod-restes-'))))

  it.each(['prod-niveau.json', 'prod-autorite.json', 'prod-passphrase.json', 'C:/x/Prod-Niveau.json'])(
    'isForbidden refuse %s',
    (chemin) => {
      expect(isForbidden(chemin)).toBeTruthy()
    }
  )

  it('run sqlcmd sans porte de production branchée est refusé et rien ne part', async () => {
    const { b, lances } = busDeBase({ porteProd: undefined })
    const r = (await b.exec('run', { commande: 'sqlcmd -S srv-prod -d Ventes -Q "DELETE FROM t"' }, 'conv-1')) as {
      data?: { lance?: boolean }
    }
    expect(r.data?.lance).toBe(false)
    expect(lances).toEqual([])
  })

  it('desktop_act est refusé tant qu’une confirmation de production attend', async () => {
    const actes: unknown[] = []
    const { b } = busDeBase({
      desktop: { act: async (x: unknown) => (actes.push(x), { ok: true }) },
      guichetProd: { enAttente: () => [{ id: 'd1' }], demander: async () => undefined }
    })
    const r = (await b.exec('desktop_act', { actions: [{ type: 'click', x: 1, y: 1 }] }, 'conv-1')) as {
      ok: boolean
      error?: string
    }
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/confirmation/i)
    expect(actes).toEqual([])
  })

  it('desktop_act passe quand aucune confirmation n’attend', async () => {
    const actes: unknown[] = []
    const { b } = busDeBase({
      desktop: { act: async (x: unknown) => (actes.push(x), { ok: true }) },
      guichetProd: { enAttente: () => [], demander: async () => undefined }
    })
    await b.exec('desktop_act', { actions: [{ type: 'click', x: 1, y: 1 }] }, 'conv-1')
    expect(actes.length).toBe(1)
  })
})
