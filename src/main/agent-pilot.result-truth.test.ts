import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, commandResultSucceeded, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { shouldPersistClosingText } from './runs/turn-closing'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('verite visible des actions', () => {
  it('affiche verify en echec quand son resultat metier est rouge', async () => {
    const responses = [
      '<cmd>{"name":"verify","args":{}}</cmd>',
      'Les tests echouent, je ne declare pas la tache terminee.'
    ]
    const registry = {
      send: vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'codex' })),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [{ name: 'verify', args: {}, description: 'test' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({
        ok: true,
        data: { allowed: true, ok: false, exitCode: 1, output: '2 tests failed' }
      })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
    ).chat([{ role: 'user', content: 'verifie la suite' }], (event) => events.push(event))

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'result',
        name: 'verify',
        ok: false,
        data: expect.objectContaining({ ok: false, exitCode: 1 })
      })
    )
  })

  it('conserve la cloture d un orchestrate en erreur meme apres un preambule streame', async () => {
    const registry = {
      send: vi.fn(async () => ({
        text: 'Je lance le workflow.\n<cmd>{"name":"orchestrate","args":{"task":"corrige"}}</cmd>',
        provider: 'codex'
      })),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'transport indisponible' })
    }
    const events: PilotEvent[] = []

    await new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
    ).chat([{ role: 'user', content: 'corrige tout' }], (event) => events.push(event))

    const done = events.find((event) => event.kind === 'done')
    expect(done).toMatchObject({
      kind: 'done',
      outcome: { status: 'failed', error: 'transport indisponible' }
    })
    expect(done?.text).toContain('transport indisponible')
    expect(shouldPersistClosingText(true, done?.kind === 'done' ? done.outcome : undefined)).toBe(
      true
    )
  })
})

/*
 * UN REFUS TRANSPORTE DANS UN SUCCES N'EST PAS UNE REUSSITE — decision du 2026-09-01 (conv-52).
 *
 * Certaines commandes rendent `{ok:true}` en portant leur refus dans la charge : `remember`
 * (`stored:false`), `verify` et `brain_query` (`allowed:false`, rien n'a tourne). Ces resultats
 * passaient pour verts, donc aucune garde d'echec ne s'armait : ni pastille rouge, ni mur
 * enregistre, ni relance « corrige, puis poursuis ». Entree qui DOIT faire echouer ce test si la
 * lecture repart sur le seul `ok` : un `stored:false` declare reussi.
 */
describe('commandResultSucceeded — un refus dans la charge compte comme echec', () => {
  it('stored:false, allowed:false et refused:true sont des echecs', () => {
    expect(commandResultSucceeded({ ok: true, data: { stored: false, detail: 'portee' } })).toBe(
      false
    )
    expect(commandResultSucceeded({ ok: true, data: { allowed: false, reason: 'rien' } })).toBe(
      false
    )
    expect(commandResultSucceeded({ ok: true, data: { refused: true } })).toBe(false)
  })

  it('une charge sans marqueur de refus reste une reussite', () => {
    expect(commandResultSucceeded({ ok: true, data: { stored: true } })).toBe(true)
    expect(commandResultSucceeded({ ok: true, data: { allowed: true, exitCode: 0 } })).toBe(true)
    expect(commandResultSucceeded({ ok: true, data: { lu: true, totalLignes: 12 } })).toBe(true)
  })
})
