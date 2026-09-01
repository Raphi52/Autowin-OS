import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * UNE RÉPONSE DE L'UTILISATEUR NE DOIT PAS ANNULER LES ACTIONS DÉJÀ DÉCIDÉES.
 *
 * Mesure du 2026-09-01 (conv-65). L'utilisateur répond pendant que le tour se termine ; sa réponse
 * était traitée comme « cette réponse est périmée » et la réponse ENTIÈRE du modèle était jetée,
 * commandes comprises. Le tour portait un `ask` : aucun bouton n'est jamais apparu, et un `remember`
 * du même souffle a disparu — d'où « quand je réponds ça marche pas ». Preuve hors-modèle : aucun
 * `tool-call` pour ces deux commandes dans `causal-trace/conv-65.jsonl`.
 *
 * Le texte, lui, peut légitimement être périmé (il ne connaît pas encore la réponse) : ce cas reste
 * couvert par « ne perd pas une directive arrivée pendant la réponse finale » (turn-contract).
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const roles = {
  getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
}

function pilote(reponses: string[], queue: string[]) {
  // Les DEUX faux appels portent leur signature reelle : sans elle, `mock.calls[i][j]` est un
  // tuple VIDE pour TypeScript, et les assertions qui lisent les arguments ne compilent pas.
  const send = vi.fn(async (_role: unknown, _messages: unknown[], ..._reste: unknown[]) => ({
    text: reponses.shift() ?? 'fin',
    provider: 'codex'
  }))
  const exec = vi.fn(async (_nom: string, ..._reste: unknown[]) => ({ ok: true, data: {} }))
  const registry = {
    send,
    describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
  }
  const bus = {
    catalog: () => [
      { name: 'get_state', args: {}, description: 'état' },
      { name: 'remember', args: {}, description: 'retenir' },
      { name: 'ask', args: {}, description: 'question' }
    ],
    snapshotForPrompt,
    exec
  }
  const drain = (): string[] => queue.splice(0, queue.length)
  const lancer = (): Promise<unknown> =>
    new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'go' }],
      () => undefined,
      undefined,
      6,
      'conv-65',
      undefined,
      drain
    )
  return { send, exec, lancer }
}

describe('directive utilisateur arrivée en fin de tour', () => {
  it('exécute quand même la commande que le modèle venait d’émettre', async () => {
    const queue: string[] = []
    const reponses = ['<cmd>{"name":"get_state","args":{}}</cmd>Je regarde l’état.', 'Terminé']
    const { send, exec, lancer } = pilote(reponses, queue)
    // La réponse de l'utilisateur arrive PENDANT l'appel provider qui portait la commande.
    send.mockImplementationOnce(async () => {
      queue.push('Les deux')
      return { text: reponses.shift()!, provider: 'codex' }
    })
    await lancer()
    expect(exec.mock.calls.map((appel) => appel[0])).toContain('get_state')
    const second = (send.mock.calls[1][1] as Array<{ content: string }>)[0].content
    expect(second).toContain('DIRECTIVE INJECTÉE EN COURS DE TOUR')
    expect(second).toContain('Les deux')
  })

  it('ne repose PAS une question à laquelle l’utilisateur vient de répondre, et ne clôt pas le tour', async () => {
    const queue: string[] = []
    const reponses = [
      '<cmd>{"name":"ask","args":{"question":"Lequel ?","options":["A","B"]}}</cmd>',
      'Je traite « Les deux ».'
    ]
    const { send, exec, lancer } = pilote(reponses, queue)
    send.mockImplementationOnce(async () => {
      queue.push('Les deux')
      return { text: reponses.shift()!, provider: 'codex' }
    })
    await lancer()
    // La question n'est pas reposée…
    expect(exec.mock.calls.map((appel) => appel[0])).not.toContain('ask')
    // …et le tour CONTINUE avec la réponse au lieu de s'arrêter sur la question.
    expect(send).toHaveBeenCalledTimes(2)
    const second = (send.mock.calls[1][1] as Array<{ content: string }>)[0].content
    expect(second).toContain('DÉJÀ répondu')
    expect(second).toContain('Les deux')
  })
})
