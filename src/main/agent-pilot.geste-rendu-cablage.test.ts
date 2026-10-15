import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import { signatureDEchec } from './chat-turn-messages'
import type { Message, SendOptions, SendResult } from './providers/types'
import { enregistrerMur } from './runs/murs-store'

/**
 * Cas réel conv-843, tour c4e319ca-783f-4b49-9b87-971cd6392c8e (saisie ts 1790275899514
 * « fais le ») : une action de bureau A ÉCHOUÉ (keys "ctrl+t" refusé), puis la clôture a rendu
 * « À faire : Va dans Brave… Saisis le code ». La relance « échec tu » (iteration 5 du journal
 * des tours) est partie la première ; la garde du geste rendu ne doit pas être éteinte par elle.
 *
 * ÉTAT POSÉ PAR LE TEST, jamais hérité (mesuré 2026-10-12) : AgentPilot lit et écrit les murs dans
 * `murs-rencontres.json` de la racine de données, PARTAGÉE et stable entre deux lancements
 * (`autowin-tests-appdata`, vitest.config.ts). Le test ne passait que si un lancement PRÉCÉDENT y
 * avait laissé le mur de conv-843 : rouge 2/2 sur un dossier vierge, vert 2/2 avec le reste — d'où
 * un rouge « instable ». Sur dossier vierge, la reprise « corrige et poursuis » (non escaladée)
 * n'allume pas `relanceDeFormeUtilisee` : ce n'est pas le cas visé. Le cas du commit e329ea87
 * (« rouge avant, vert après »), c'est une relance d'échec qui ALLUME ce drapeau avant la garde
 * du geste — ici l'escalade, parce que ce mur a déjà été rencontré dans un tour précédent.
 */
const ERREUR_TOUCHES = 'keys doit contenir entre 1 et 8 touches'
let racineDonnees = ''

beforeEach(() => {
  racineDonnees = mkdtempSync(join(tmpdir(), 'autowin-geste-rendu-'))
  configureAutowinAppDataBase(racineDonnees)
  enregistrerMur('conv-843', signatureDEchec('desktop_act', ERREUR_TOUCHES))
})

afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(racineDonnees, { recursive: true, force: true })
})
function pilot(responses: string[]) {
  const sent: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: responses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'desktop_act', args: {}, description: 'bureau' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: false, error: ERREUR_TOUCHES }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

const ACTION = '<cmd>{"name":"desktop_act","args":{"actions":[{"type":"key","keys":"ctrl+t"}]}}</cmd>'
const A_FAIRE =
  "Je n'ai pas pu saisir le code.\n\n**À faire :**\n1. Va dans Brave.\n2. Saisis le code **CAP56FNHZ**."

describe('garde du geste rendu — câblage (tour c4e319ca)', () => {
  it('relance « fais le geste » même après la relance d’échec du même tour', async () => {
    const { pilot: p, sent } = pilot([ACTION, A_FAIRE, A_FAIRE, 'Code saisi, page confirmée.'])
    await p
      .chat([{ role: 'user', content: 'fais le' }], () => {}, undefined, 8, 'conv-843',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, true)
      .catch(() => undefined)
    expect(sent.some((c) => c.includes('ta clôture confie à l’utilisateur un geste d’écran'))).toBe(true)
  })
})
