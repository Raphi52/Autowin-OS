import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * UN REFUS DE MEMOIRE NE DISPARAIT PAS EN SILENCE.
 *
 * `onlyAuxiliaryRemember` clot le tour sans repayer une generation quand le modele a livre sa
 * reponse ET sauve une memoire — economie voulue. Mais l'ISSUE du depot etait jetee avec : un refus
 * deterministe (type inconnu, source invalide, Brain injoignable) n'atteignait ni le modele ni
 * l'utilisateur, alors que le texte venait d'annoncer « je retiens ca ».
 *
 * Vecu le 31/08 (conv-1569) : deux `remember` de suite, aucun retour, l'utilisateur constate
 * « ca a pas marche anyway » — rien dans le fil ne le disait.
 *
 * Entree qui DOIT faire echouer ce test si la garde saute : un `exec` qui refuse le remember alors
 * que le texte final ne porte aucune trace du refus.
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
function texteFinal(events: PilotEvent[]): string | undefined {
  const done = [...events].reverse().find((e) => e.kind === 'done') as
    | { kind: 'done'; text?: string }
    | undefined
  return done?.text
}

async function jouer(exec: ReturnType<typeof vi.fn>): Promise<string | undefined> {
  const responses = [
    'Je retiens la leçon.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>',
    'ok'
  ]
  const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'claude' }))
  const bus = {
    catalog: () => [{ name: 'remember', args: {}, description: 'mémoire' }],
    snapshotForPrompt,
    exec
  }
  const events: PilotEvent[] = []
  await new AgentPilot({ send, describePrompt } as never, rolesClaude as never, bus as never).chat(
    [{ role: 'user', content: 'retiens ça' }],
    (e) => events.push(e),
    undefined,
    6,
    'conv-refus-memoire'
  )
  return texteFinal(events)
}

describe('remember auxiliaire — le refus reste visible', () => {
  it('un depot REFUSE est dit dans la reponse, avec son motif', async () => {
    const texte = await jouer(vi.fn().mockResolvedValue({ ok: false, error: 'source invalide' }))
    expect(texte).toContain('Je retiens la leçon.')
    expect(texte).toContain('NON déposée')
    expect(texte).toContain('source invalide')
  })

  /*
   * CAS DE conv-33 (2026-09-01) — le plus couteux, et celui qui passait.
   *
   * Le Brain repond 200-hors-succes : `{ok:true, data:{allowed:true, stored:false, detail:'refuse
   * par le Brain : not found'}}`. Le transport a REUSSI, donc `commandResultSucceeded` disait vrai
   * et la garde restait muette : le tour se cloturait sur « je depose la lecon » sans rien deposer.
   * Le fait porteur est `stored`.
   */
  it('un depot rendu 200 avec stored:false est dit, avec le motif du serveur', async () => {
    const texte = await jouer(
      vi.fn().mockResolvedValue({
        ok: true,
        data: { allowed: true, stored: false, detail: 'refuse par le Brain : not found' }
      })
    )
    expect(texte).toContain('NON déposée')
    expect(texte).toContain('not found')
  })

  it('un depot REUSSI ne pollue pas la reponse', async () => {
    const texte = await jouer(vi.fn().mockResolvedValue({ ok: true, data: { stored: true } }))
    expect(texte).toContain('Je retiens la leçon.')
    expect(texte).not.toContain('NON déposée')
  })
})
