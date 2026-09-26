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
function busDeBase(extra: Record<string, unknown>, dernierMessage = 'vas-y') {
  const lances: string[] = []
  const os = {
    executionWorkspace: process.cwd(),
    conversations: { get: () => ({ id: 'conv-1', messages: [{ role: 'user', content: dernierMessage }] }), list: () => [], attachRun: () => undefined },
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

  // Depuis le kaizen conv-854 (commands.ts, règle de l'écran réel), le PREMIER desktop_act d'un tour est
  // toujours refusé et les suivants n'agissent que si le dernier message de l'utilisateur parle de SON
  // écran. Un appel unique après « vas-y » s'arrêtait donc là, sans jamais atteindre le contrôle de
  // confirmation de production que ces tests visent (conv-770, 2026-09-26). Ils rejouent le chemin
  // réel : demande explicite de l'écran, 1er appel refusé par la règle, 2e appel jusqu'au contrôle prod.
  const clic = { actions: [{ type: 'click', x: 1, y: 1 }] }
  const demandeEcran = 'clique sur mon écran'

  it('desktop_act est refusé tant qu’une confirmation de production attend', async () => {
    const actes: unknown[] = []
    const { b } = busDeBase(
      {
        desktop: { act: async (x: unknown) => (actes.push(x), { ok: true }) },
        guichetProd: { enAttente: () => [{ id: 'd1' }], demander: async () => undefined }
      },
      demandeEcran
    )
    const premier = (await b.exec('desktop_act', clic, 'conv-1', undefined, 'tour-1')) as {
      ok: boolean
    }
    expect(premier.ok).toBe(false) // règle de l'écran réel : intacte
    const r = (await b.exec('desktop_act', clic, 'conv-1', undefined, 'tour-1')) as {
      ok: boolean
      error?: string
    }
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/confirmation de production/i)
    expect(actes).toEqual([])
  })

  it('desktop_act passe quand aucune confirmation n’attend', async () => {
    const actes: unknown[] = []
    const { b } = busDeBase(
      {
        desktop: { act: async (x: unknown) => (actes.push(x), { ok: true }) },
        guichetProd: { enAttente: () => [], demander: async () => undefined }
      },
      demandeEcran
    )
    await b.exec('desktop_act', clic, 'conv-1', undefined, 'tour-1')
    expect(actes).toEqual([]) // 1er appel du tour : refusé par la règle de l'écran
    const r = (await b.exec('desktop_act', clic, 'conv-1', undefined, 'tour-1')) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(actes.length).toBe(1)
  })

  it('sans demande de l’écran, desktop_act n’agit jamais, même au 2e appel', async () => {
    const actes: unknown[] = []
    const { b } = busDeBase({
      desktop: { act: async (x: unknown) => (actes.push(x), { ok: true }) },
      guichetProd: { enAttente: () => [], demander: async () => undefined }
    })
    await b.exec('desktop_act', clic, 'conv-1', undefined, 'tour-1')
    const r = (await b.exec('desktop_act', clic, 'conv-1', undefined, 'tour-1')) as { ok: boolean }
    expect(r.ok).toBe(false)
    expect(actes).toEqual([])
  })
})
