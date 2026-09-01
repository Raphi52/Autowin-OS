import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * UN REFUS DE MEMOIRE SE CORRIGE, PUIS SE DIT S'IL PERSISTE.
 *
 * `onlyAuxiliaryRemember` clot le tour sans repayer une generation quand le modele a livre sa
 * reponse ET sauve une memoire — economie voulue. Mais l'ISSUE du depot etait jetee avec : un refus
 * deterministe (type inconnu, source invalide, Brain injoignable) n'atteignait ni le modele ni
 * l'utilisateur, alors que le texte venait d'annoncer « je retiens ca ».
 *
 * Vecu le 31/08 (conv-1569) : deux `remember` de suite, aucun retour, l'utilisateur constate
 * « ca a pas marche anyway » — rien dans le fil ne le disait. Puis conv-49/52 (2026-09-01) :
 * refus « portee manquante », tour CLOS sur le constat. Le motif partait a l'utilisateur mais
 * jamais au MODELE, qui ne pouvait donc pas ajouter l'argument manquant. Decision : une reprise
 * bornee rend la main aux commandes, et le refus qui SURVIT suit le tour jusqu'a sa cloture.
 *
 * Entrees qui DOIVENT faire echouer ces tests si la garde saute : un `exec` qui refuse le remember
 * sans qu'aucune reprise soit tentee, ou un refus absent du texte final.
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
    { kind: 'done'; text?: string } | undefined
  return done?.text
}

interface Partie {
  texte: string | undefined
  /** Nombre de depots REELLEMENT tentes : 2 prouve que la reprise a eu lieu. */
  depots: number
  /** Tout ce qui a ete envoye au modele : le motif du refus doit y figurer. */
  vuParLeModele: string
}

async function jouerAvec(
  exec: ReturnType<typeof vi.fn>,
  responses: string[] = [
    'Je retiens la leçon.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>',
    'ok'
  ]
): Promise<Partie> {
  const restantes = [...responses]
  const promptsVus: string[] = []
  const send = vi.fn(async (...args: unknown[]) => {
    promptsVus.push(JSON.stringify(args))
    return { text: restantes.shift() ?? '', provider: 'claude' }
  })
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
  return {
    texte: texteFinal(events),
    depots: exec.mock.calls.filter((appel) => appel[0] === 'remember').length,
    vuParLeModele: promptsVus.join(String.fromCharCode(10))
  }
}

async function jouer(exec: ReturnType<typeof vi.fn>): Promise<string | undefined> {
  return (await jouerAvec(exec)).texte
}

describe('remember auxiliaire — le refus reste visible', () => {
  it('un depot REFUSE est dit dans la reponse, avec son motif', async () => {
    const texte = await jouer(vi.fn().mockResolvedValue({ ok: false, error: 'source invalide' }))
    expect(texte).toContain('NON déposée')
    expect(texte).toContain('source invalide')
  })

  /*
   * LE MOTIF ATTEINT LE MODELE, ET LA COMMANDE EST REJOUEE.
   *
   * C'est le defaut de conv-49 : le refus etait AFFICHE mais jamais REINJECTE, donc un refus
   * reparable en un argument (« portee manquante ») restait un echec definitif.
   */
  it('un refus reparable est REINJECTE au modele, qui rejoue le depot', async () => {
    const partie = await jouerAvec(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          data: { stored: false, detail: 'portée manquante — le projet concerné, ou « global »' }
        })
        .mockResolvedValue({ ok: true, data: { stored: true } }),
      [
        'Je retiens la leçon.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>',
        'Je redépose avec la portée.<cmd>{"name":"remember","args":{"type":"lesson","scope":"autowin-os"}}</cmd>',
        'Retenu.'
      ]
    )
    expect(partie.vuParLeModele).toContain('portée manquante')
    expect(partie.depots).toBe(2)
    // Le depot rejoue a REUSSI : la cloture ne doit plus porter la mention de refus.
    expect(partie.texte).not.toContain('NON déposée')
  })

  /* La reprise est BORNEE : un refus qui persiste ne boucle pas, il se DIT. */
  it('un refus qui persiste apres la reprise est dit, une seule reprise', async () => {
    const partie = await jouerAvec(
      vi.fn().mockResolvedValue({ ok: true, data: { stored: false, detail: 'portée manquante' } }),
      [
        'Je retiens.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>',
        'Je redépose.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>',
        'Le dépôt a été refusé deux fois.'
      ]
    )
    expect(partie.depots).toBe(2)
    expect(partie.texte).toContain('NON déposée')
    expect(partie.texte).toContain('portée manquante')
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
