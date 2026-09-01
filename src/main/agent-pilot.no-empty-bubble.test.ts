import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * LE CHAT NE REND JAMAIS UNE BULLE VIDE.
 *
 * Cause racine des « quasi toutes mes conversations échouent », vue en lisant conv-1141 : l'utilisateur
 * envoyait un prompt, le tour AGISSAIT (« [a exécuté exec (échec)] ») mais ne DISAIT rien, et le
 * message d'assistant final était VIDE. Ne sachant pas ce qui avait raté, il renvoyait le même prompt
 * cinq fois — cinq bulles vides. Une bulle vide est pire qu'une erreur : elle ne dit rien.
 *
 * Trois chemins produisaient ce vide (`agent-pilot.ts`, `text: ''`) ; ces tests les ferment.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const rolesClaude = {
  getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' as const })
}
const describePrompt = () => ({
  provider: 'claude',
  transport: 'fixture',
  messages: [],
  options: {},
  limitation: 'test'
})

/** Texte final du tour : le `done` porte la réponse persistée. */
function texteFinal(events: PilotEvent[]): string | undefined {
  const done = [...events].reverse().find((e) => e.kind === 'done') as
    { kind: 'done'; text?: string } | undefined
  return done?.text
}

describe('le chat ne rend jamais une bulle vide', () => {
  it('un tour qui A AGI mais n’a rien dit livre un repère, pas le silence (conv-1141)', async () => {
    // Le modèle émet une commande (donc AGIT), puis ne dit plus rien : c'est le cas exact de
    // conv-1141 (« [a exécuté exec (échec)] » suivi de bulles vides).
    const responses = ['<cmd>{"name":"probe","args":{}}</cmd>', '', '']
    const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
    const bus = {
      catalog: () => [{ name: 'probe', args: {}, description: 'sonde' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: false, error: 'échec sonde' })
    }
    const events: PilotEvent[] = []
    await new AgentPilot(
      { send, describePrompt } as never,
      rolesClaude as never,
      bus as never
    ).chat(
      [{ role: 'user', content: 'lance la sonde et corrige' }],
      (e) => events.push(e),
      undefined,
      6,
      'conv-vide-1'
    )
    const t = texteFinal(events)
    expect(t, 'le done final ne doit pas être vide').toBeTruthy()
    expect((t ?? '').trim().length).toBeGreaterThan(0)
    // Il oriente vers les cartes d'action, puisque le travail réel est là.
    expect(t).toMatch(/action|agi/i)
  })

  it('une réponse dite + un remember auxiliaire livre le TEXTE, pas du vide', async () => {
    // Le modèle répond ET sauve une mémoire : on jetait son texte et on émettait vide.
    //
    // LE DEPOT REUSSIT ICI, et c'est deliberé depuis le 2026-09-01 (conv-52) : un depot REFUSE rend
    // desormais la main au modele pour qu'il corrige, donc le texte final est celui de la reprise.
    // Ce test-ci porte sur la BULLE VIDE, pas sur le refus — le refus a son propre fichier
    // (`agent-pilot.remember-refus-visible.test.ts`), qui verifie la reprise ET le motif affiche.
    const responses = [
      'Voici le diagnostic complet.<cmd>{"name":"remember","args":{"type":"constraint"}}</cmd>',
      'ok'
    ]
    const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
    const bus = {
      catalog: () => [{ name: 'remember', args: {}, description: 'mémoire' }],
      snapshotForPrompt,
      exec: vi.fn().mockResolvedValue({ ok: true, data: { stored: true } })
    }
    const events: PilotEvent[] = []
    await new AgentPilot(
      { send, describePrompt } as never,
      rolesClaude as never,
      bus as never
    ).chat(
      [{ role: 'user', content: 'ajoute une contrainte en memoire' }],
      (e) => events.push(e),
      undefined,
      6,
      'conv-vide-2'
    )
    expect(texteFinal(events)).toContain('Voici le diagnostic complet.')
  })
})
