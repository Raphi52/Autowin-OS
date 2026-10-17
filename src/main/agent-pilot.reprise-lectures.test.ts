import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type RecoveredPilotProviderCall } from './agent-pilot'
import { bilanDesOutilsNatifsRecuperes } from './chat-turn-messages'
import type { PromptSnapshot } from './commands'
import type { ExecutionEvidence } from './providers/types'

/**
 * REPRISE APRES REDEMARRAGE : LES LECTURES DE L'APPEL RECUPERE COMPTENT.
 *
 * MESURE le 2026-10-16 sur `conv-1002`, tour 9296f09c-6986-41f9-8b6d-f4c2b2a9c2bc. L'appel coupe par
 * le redemarrage avait lu 9 captures et joue le controle de rendu : son journal de relais
 * (275f3911-9e1b-4803-b9f1-4cf537402fee) porte 13 outils natifs, dont 12 lectures au sens de
 * `statusEstUneLecture`. Mais ces lectures n'avaient leve `anyReadExecuted` que dans le process MORT
 * (battements `chunk.status`) ; le process repris l'a vu a faux, et la garde « question sans
 * lecture » a relance le modele : promptCall du 14:53:07.216Z, iteration 1, 932 942 jetons
 * d'entree, 1,70 $ et 56 s, pour un second « ✅ Fait » empile sous le premier.
 */

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const ASK =
  '<cmd>{"name":"ask","args":{"question":"Quelle antenne garder ?","options":["1","2"]}}</cmd>'

const LECTURE_CAPTURE: ExecutionEvidence = {
  type: 'Read',
  kind: 'inspection',
  status: 'completed',
  ok: true,
  summary: 'Read artifacts/draft-hdesk/l860-onglet-1.png',
  path: 'artifacts/draft-hdesk/l860-onglet-1.png',
  paths: ['artifacts/draft-hdesk/l860-onglet-1.png']
}

const reprendre = async (
  executionEvidence: ExecutionEvidence[] | undefined
): Promise<{ appelsModele: number }> => {
  let appelsModele = 0
  const registry = {
    send: vi.fn(async () => {
      appelsModele += 1
      return { text: 'Je relis le code avant de reposer la question.', provider: 'claude' }
    }),
    describePrompt: () => ({
      provider: 'claude',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const bus = {
    catalog: () => ['ask', 'read_file'].map((name) => ({ name, args: {}, description: name })),
    snapshotForPrompt,
    exec: vi.fn().mockResolvedValue({ ok: true, data: { ok: true } })
  }
  const recovered: RecoveredPilotProviderCall = {
    iteration: 0,
    attempt: 0,
    streamId: '0:0',
    streamedPrefix: '',
    result: {
      text: 'Contrôle à 0. Je relis les 6 onglets.\n\n' + ASK,
      provider: 'claude',
      systemInjected: true,
      ...(executionEvidence ? { executionEvidence } : {})
    }
  }
  await new AgentPilot(
    registry as never,
    { getBinding: () => ({ provider: 'claude', model: 'fixture' }) } as never,
    bus as never
  ).chat(
    [{ role: 'user', content: '2' }],
    () => undefined,
    undefined,
    4,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    recovered
  )
  return { appelsModele }
}

describe('reprise de tour — les outils natifs de l appel recupere comptent', () => {
  it('ne relance PAS « question sans lecture » quand l appel recupere a lu', async () => {
    const { appelsModele } = await reprendre([LECTURE_CAPTURE])
    // Le resultat recupere est consomme sans nouvel appel, et la question clot le tour.
    expect(appelsModele).toBe(0)
  })

  it('relance toujours quand l appel recupere n a RIEN lu — la garde reste entiere', async () => {
    const { appelsModele } = await reprendre(undefined)
    expect(appelsModele).toBeGreaterThan(0)
  })

  it('classe les preuves avec les memes regles que les battements du direct', () => {
    const preuve = (type: string, champ: Partial<ExecutionEvidence>): ExecutionEvidence => ({
      type,
      kind: 'other',
      status: 'completed',
      ok: true,
      summary: type,
      ...champ
    })
    expect(bilanDesOutilsNatifsRecuperes([LECTURE_CAPTURE])).toEqual({
      lecture: true,
      action: false
    })
    expect(bilanDesOutilsNatifsRecuperes([preuve('Grep', {})]).lecture).toBe(true)
    expect(
      bilanDesOutilsNatifsRecuperes([preuve('Bash', { command: 'sed -n 1,40p src/a.ts' })])
    ).toEqual({ lecture: true, action: false })
    expect(bilanDesOutilsNatifsRecuperes([preuve('Write', { path: 'x.html' })])).toEqual({
      lecture: false,
      action: true
    })
    expect(bilanDesOutilsNatifsRecuperes([preuve('Bash', { command: 'rm -f x.html' })])).toEqual({
      lecture: false,
      action: true
    })
    expect(bilanDesOutilsNatifsRecuperes(undefined)).toEqual({ lecture: false, action: false })
  })
})
