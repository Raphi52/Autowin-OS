import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { PromptSnapshot } from './commands'
import { CostAggregator } from './dashboards/cost'
import { ecrireLangueReglee } from './langue-reglage'
import { Orchestrator } from './orchestrator'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { ProviderRegistry } from './providers/registry'
import type { ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'

/**
 * LA LANGUE DE RÉPONSE ARRIVE VRAIMENT À L'AGENT (conv-1146) — le chemin réel, pas la fonction
 * seule : la consigne de départ du chat ET celle de chaque étape d'un run (et de son juge).
 * Entrée qui doit faire échouer ce fichier : retirer `blocLangueDeReponse()` d'un des sites qui
 * plient le profil (`agent-pilot.ts`, `orchestrator.ts`), ou le servir en français.
 * Même montage que le test du profil (`profil-utilisateur.test.ts`) : une racine de données à soi.
 */
const TITRE = '=== LANGUE DE RÉPONSE : ANGLAIS'

let racine: string
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'langue-consigne-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(racine, { recursive: true, force: true })
})

class CapturingProvider implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []

  async auth(): Promise<boolean> {
    return true
  }

  // Faux fournisseur qui rend sans rien émettre : require-yield n'a pas lieu d'être ici.
  // eslint-disable-next-line require-yield
  async *send(
    _messages: unknown,
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return {
      text: this.calls.length === 1 ? 'analyse faite' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system)
    }
  }
}

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

async function systemeDuChat(): Promise<string> {
  const send = vi.fn().mockResolvedValue({ text: 'Réponse', provider: 'codex' })
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'codex',
      transport: 'fetch',
      messages: [],
      options: {},
      limitation: 'opaque'
    })
  }
  const roles = { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) }
  const bus = { catalog: () => [], snapshotForPrompt }
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    [{ role: 'user', content: 'bonjour' }],
    () => {}
  )
  return String(send.mock.calls[0]?.[2]?.system ?? '')
}

async function systemesDUnRun(): Promise<string[]> {
  const ws = join(racine, 'projet')
  mkdirSync(ws, { recursive: true })
  const provider = new CapturingProvider()
  await new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id },
      judge: { provider: provider.id }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: ws,
    worktrees: makeTestWorktrees(ws)
  }).run('analyse le projet, ne modifie rien')
  return provider.calls.map((call) => String(call.system ?? ''))
}

describe('langue de réponse — servie au chat et aux étapes des runs', () => {
  it('chat : absente en français, présente dès que l’anglais est choisi, retirée au retour', async () => {
    expect(await systemeDuChat()).not.toContain(TITRE)
    ecrireLangueReglee('en')
    const systeme = await systemeDuChat()
    expect(systeme).toContain(TITRE)
    expect(systeme).toContain('### Bilan de l’étape')
    ecrireLangueReglee('fr')
    expect(await systemeDuChat()).not.toContain(TITRE)
  })

  it('run : chaque étape et son juge reçoivent la consigne d’anglais', async () => {
    const sans = await systemesDUnRun()
    expect(sans.length).toBeGreaterThanOrEqual(2)
    for (const systeme of sans) expect(systeme).not.toContain(TITRE)

    ecrireLangueReglee('en')
    const avec = await systemesDUnRun()
    expect(avec.length).toBeGreaterThanOrEqual(2)
    for (const systeme of avec) expect(systeme).toContain(TITRE)
  })
})
