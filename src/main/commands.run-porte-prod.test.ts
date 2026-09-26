import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'
import { PorteProd } from './prod-gate'
import type { NiveauProtectionProd } from '../shared/prod-protection'

/**
 * LA COMMANDE `run` PASSE PAR LA PORTE DE PRODUCTION (évaluation conv-738, 2026-09-21).
 *
 * Deux failles : (1) seul `sql_query` passait par `PorteProd` — `run sqlcmd -S prod …` partait sans
 * rien demander ; (2) `run` pouvait réécrire `prod-niveau.json` et poser le niveau « aucun » : l'agent
 * coupait la protection tout seul. Ces tests passent par le vrai site d'appel (`bus.exec('run')`).
 */
function bus(niveau: NiveauProtectionProd, confirme: boolean) {
  const lances: string[] = []
  const demandes: unknown[] = []
  const os = {
    executionWorkspace: process.cwd(),
    conversations: { get: () => ({ id: 'conv-1', messages: [{ role: 'user', content: 'vas-y' }] }), list: () => [], attachRun: () => undefined },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  const b = new AppCommandBus(os as never, () => {})
  const porte = new PorteProd({
    autorite: () => ({ entrees: [] }) as never,
    coffre: () => ({ consommer: () => ({ autorise: false, motif: 'jeton refusé' }) }) as never,
    phraseDefinie: () => false,
    niveau: () => niveau
  })
  const guichet = {
    demander: async (d: unknown) => {
      demandes.push(d)
      return confirme ? ({ type: 'confirme' } as const) : undefined
    }
  }
  Object.assign(b as unknown as Record<string, unknown>, {
    porteProd: porte,
    guichetProd: guichet,
    spawnVerify: async (argv: string[]) => {
      lances.push(argv.join(' '))
      return { allowed: true, output: 'ok', exitCode: 0 }
    }
  })
  const lancer = async (commande: string): Promise<string> => {
    const r = (await b.exec('run', { commande }, 'conv-1')) as { detail?: unknown }
    return typeof r?.detail === 'string' ? r.detail : JSON.stringify(r)
  }
  return { lancer, lances, demandes }
}

describe('run — porte de production', () => {
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'autowin-run-prod-'))))

  it.each([
    'sqlcmd -S srv-prod -d Ventes -Q "DELETE FROM clients"',
    'SQLCMD.EXE -S srv -d Ventes -i script.sql',
    'osql -S srv -d Ventes -Q "select 1"',
    'bcp Ventes.dbo.clients out c.txt -S srv -T',
    'powershell -Command Invoke-Sqlcmd -ServerInstance srv -Database Ventes -Query x',
    'C:/Tools/SQL/sqlcmd.exe -S srv -d Ventes'
  ])('client SQL sans confirmation : REFUSÉ et la fenêtre est ouverte — %s', async (commande) => {
    const { lancer, lances, demandes } = bus('confirmation', false)
    const r = await lancer(commande)
    expect(lances).toEqual([])
    expect(r).toMatch(/refusée/i)
    expect(demandes.length).toBe(1)
    expect(JSON.stringify(demandes[0])).toContain('base:')
  })

  it('bcp : la base est celle de la cible qualifiée', async () => {
    const { lancer, demandes } = bus('confirmation', false)
    await lancer('bcp Ventes.dbo.clients out c.txt -S srv -T')
    expect(JSON.stringify(demandes[0])).toContain('base:Ventes')
  })

  it('client SQL confirmé par un clic : la commande PART', async () => {
    const { lancer, lances } = bus('confirmation', true)
    const r = await lancer('sqlcmd -S srv -d Ventes -Q "select 1"')
    expect(lances.length).toBe(1)
    expect(r).not.toMatch(/refusée/i)
  })

  it('niveau « aucun » choisi par l’utilisateur : rien ne change', async () => {
    const { lancer, lances, demandes } = bus('aucun', false)
    await lancer('sqlcmd -S srv -d Ventes -Q "select 1"')
    expect(lances.length).toBe(1)
    expect(demandes).toEqual([])
  })

  it('commande sans client SQL : aucune fenêtre', async () => {
    const { lancer, lances, demandes } = bus('confirmation', false)
    await lancer('git status --porcelain')
    await lancer('npx vitest run src/main/sqlcmd-runner.test.ts')
    expect(lances.length).toBe(2)
    expect(demandes).toEqual([])
  })

  it.each([
    'powershell -Command Set-Content prod-niveau.json \'{"niveau":"aucun"}\'',
    'node -e require("fs").writeFileSync(process.env.APPDATA+"/autowin-os/prod-niveau.json","{}")',
    'cmd /c del C:/Users/x/AppData/Roaming/autowin-os/PROD-AUTORITE.JSON',
    'powershell Remove-Item prod-passphrase.json'
  ])('réglages de protection : TOUJOURS refusés, même au niveau « aucun » — %s', async (commande) => {
    const { lancer, lances } = bus('aucun', true)
    const r = await lancer(commande)
    expect(lances).toEqual([])
    expect(r).toMatch(/refusée/i)
  })
})
