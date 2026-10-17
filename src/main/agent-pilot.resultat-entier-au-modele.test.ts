import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * LE MODELE RECOIT LE RESULTAT ENTIER DU RUN — l'affichage seul reste borne.
 *
 * Vecu dans conv-914 (« t'as trouvé que ce candidat ? c bizarre non ? ») : le scout avait rendu
 * 6 pistes, le fil n'en montrait qu'une. Le compte-rendu d'un run etait coupe a ses 4 000 premiers
 * caracteres par `formatOrchestrationOutcome`, et CE texte coupe servait deux lecteurs a la fois :
 * la bulle affichee ET l'agent du chat, qui le recevait comme « issue autoritative ». L'agent ne
 * pouvait donc ni citer, ni enchainer sur ce que le run avait trouve au-dela de la coupe.
 *
 * Deux chemins remettent ce compte-rendu au modele, les deux sont verrouilles ici :
 *   1. `orchestrate` emis PAR le modele : le resultat lui revient dans la meme boucle ;
 *   2. `/phase` route par l'app (sans le modele) : le compte-rendu est reinjecte au tour suivant,
 *      quand la session est reprise (voir `agent-pilot.trou-de-session.test.ts`).
 */
const piste = (n: number): string => `| ${n} | PISTE-${n} ${'détail '.repeat(120)}|`
const RESULTAT_SCOUT = ['| # | Piste |', '|---|---|', ...[1, 2, 3, 4, 5, 6].map(piste)].join('\n')
const issueDuRun = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  runPath: 'C:/runs/conv/vitesse-livraison-workspace/RUN.md',
  result: RESULTAT_SCOUT
}

describe('le résultat d’un run arrive ENTIER à l’agent du chat', () => {
  it('prémisse : la 6e piste est bien au-delà de la coupe d’affichage', () => {
    expect(RESULTAT_SCOUT.indexOf('PISTE-6')).toBeGreaterThan(4_000)
  })

  it('orchestrate émis par le modèle : la boucle lui rend toutes les pistes', async () => {
    const reponses = [
      'Je lance.<cmd>{"name":"orchestrate","args":{"task":"trouve des pistes","phase":"scout"}}</cmd>',
      'Le run a trouvé 6 pistes.'
    ]
    const send = vi.fn(async (_p: string, _messages: Message[]) => ({
      text: reponses.shift() ?? 'Terminé.',
      provider: 'codex'
    }))
    const registry = {
      send,
      describePrompt: () => ({ provider: 'codex', transport: 'fixture', messages: [], options: {} })
    }
    const roles = { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) }
    const bus = {
      catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
      snapshotForPrompt: async () => ({ tab: 'chat' }),
      exec: vi.fn().mockResolvedValue({ ok: true, data: issueDuRun })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AgentPilot(registry as any, roles as any, bus as any).chat(
      [{ role: 'user', content: 'fais tout' }],
      () => {},
      undefined,
      12,
      'conv-entier-1'
    )

    expect(send).toHaveBeenCalledTimes(2)
    const recuParLeModele = JSON.stringify(send.mock.calls[1]?.[1] ?? '')
    expect(recuParLeModele).toContain('ISSUE AUTORITATIVE')
    expect(recuParLeModele).toContain('PISTE-6')
    expect(recuParLeModele).not.toContain('[tronqué')
  })

  it('/scout routé par l’app : la bulle reste bornée, le tour suivant reçoit tout', async () => {
    const envoyes: string[] = []
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
        envoyes.push(messages.at(-1)?.content ?? '')
        return { text: 'réponse du modèle', sessionId: 'sess-entier' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
      honoursSessionResume: vi.fn(() => true)
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = {
      catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn(async (name: string) =>
        name === 'orchestrate' ? { ok: true, data: issueDuRun } : { ok: true, data: { ok: true } }
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pilot = new AgentPilot(registry as any, roles as any, bus as any)
    const CONV = 'conv-entier-2'

    // Tour 1 — normal : ouvre la session que le tour 3 reprendra.
    await pilot.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)

    // Tour 2 — `/scout` : l'app orchestre sans le modèle et affiche SA bulle.
    const events: PilotEvent[] = []
    await pilot.chat(
      [{ role: 'user', content: '/scout comment livrer plus vite ?' }],
      (event) => events.push(event),
      undefined,
      12,
      CONV
    )
    const bulle =
      (events.find((e) => e.kind === 'done') as { text?: string } | undefined)?.text ?? ''
    // L'AFFICHAGE garde sa coupe, et dit ce qui manque.
    expect(bulle).toContain('[tronqué')
    expect(bulle).not.toContain('PISTE-6')

    // Tour 3 — la question de conv-914 : le modèle doit voir les 6 pistes.
    await pilot.chat(
      [{ role: 'user', content: 't’as trouvé que ce candidat ?' }],
      () => {},
      undefined,
      12,
      CONV
    )
    const recuParLeModele = envoyes.at(-1) ?? ''
    expect(recuParLeModele).toContain('PISTE-6')
    expect(recuParLeModele).not.toContain('[tronqué')
  })
})
