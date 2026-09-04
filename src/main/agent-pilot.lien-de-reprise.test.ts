import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAutowinAppDataBase } from './app-data'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { pilotJournalEvents } from './runs/turn-journal-enrich'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * LE LIEN ENTRE UN ECHEC ET L'ACTION QUI LE RATTRAPE.
 *
 * Trois choses a prouver, et pas une de moins :
 *  - REPRISE : un succes sur la MEME cible porte `retryOf` = l'`actionId` de l'echec repare ;
 *  - ABANDON : un echec jamais repris est ECRIT (evenement `echecs-abandonnes`), pas deduit d'une
 *    absence — et un succes sur une AUTRE cible ne se fait pas passer pour un rattrapage ;
 *  - FRONTIERE : le champ survit aux deux recopies champ-par-champ qui menent au journal, la seule
 *    facon connue de perdre un champ en silence dans cette chaine.
 */
function pilot(reponses: string[], echoueSi: (args: Record<string, unknown>) => boolean) {
  const registry = {
    send: vi.fn(
      async (_p: string, _m: Message[], _o: SendOptions): Promise<SendResult> =>
        ({ text: reponses.shift() ?? '', sessionId: 'sess' }) as SendResult
    ),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'edit_file', args: { path: '' }, description: 'edite' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async (_n: string, args: Record<string, unknown>) =>
      echoueSi(args) ? { ok: false, error: 'ENOENT: chemin introuvable' } : { ok: true, data: 'ok' }
    )
  }
  const events: PilotEvent[] = []
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: new AgentPilot(registry as any, roles as any, bus as any),
    events,
    onEvent: (e: PilotEvent) => events.push(e)
  }
}

const historique: Message[] = [{ role: 'user', content: 'repare a.ts' }]
const cmd = (path: string) => `<cmd>{"name":"edit_file","args":{"path":"${path}"}}</cmd>`
const CLOTURE = '✅ Fait.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'lien-reprise-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

describe('journal des tours : lien entre un échec et l’action qui le rattrape', () => {
  it('REPRISE — le succès sur la même cible porte l’actionId de l’échec réparé', async () => {
    let premier = true
    const { p, events, onEvent } = pilot(
      [`Tentative.${cmd('a.ts')}`, `Je reprends.${cmd('a.ts')}`, CLOTURE],
      () => {
        const echoue = premier
        premier = false
        return echoue
      }
    )
    await p.chat(historique, onEvent, undefined, 8, 'conv-reprise')
    const resultats = events.filter((e) => e.kind === 'result')
    expect(resultats.length).toBe(2)
    expect(resultats[0].ok).toBe(false)
    expect(resultats[1].ok).toBe(true)
    expect(resultats[1].retryOf).toBe(resultats[0].actionId)
    // Un échec, lui, ne rattrape rien.
    expect(resultats[0].retryOf).toBeUndefined()
  })

  it('ABANDON — l’échec jamais repris est ÉCRIT, et un succès ailleurs ne le rattrape pas', async () => {
    const { p, events, onEvent } = pilot(
      [`Tentative.${cmd('a.ts')}`, `Autre fichier.${cmd('b.ts')}`, CLOTURE],
      (args) => args.path === 'a.ts'
    )
    await p.chat(historique, onEvent, undefined, 8, 'conv-abandon')
    const resultats = events.filter((e) => e.kind === 'result')
    // Le succès sur b.ts ne se fait PAS passer pour la réparation de a.ts.
    expect(resultats[1].ok).toBe(true)
    expect(resultats[1].retryOf).toBeUndefined()
    const abandons = events.filter((e) => e.kind === 'echecs-abandonnes')
    expect(abandons.length).toBe(1)
    const cibles = abandons[0].data as { actionId: string; cible: string }[]
    expect(cibles.map((x) => x.cible)).toEqual(['edit_file::a.ts'])
    expect(cibles[0].actionId).toBe(resultats[0].actionId)
  })

  it('FRONTIÈRE — le lien survit aux deux recopies champ par champ qui mènent au journal', () => {
    // 1. La frontière durable de `run-pilot-chat` recopie explicitement `retryOf`.
    const frontiere = readFileSync(join(process.cwd(), 'src/main/chat/run-pilot-chat.ts'), 'utf8')
    expect(frontiere).toMatch(
      /\.\.\.\(pilotEvent\.retryOf \? \{ retryOf: pilotEvent\.retryOf \} :/u
    )
    // ... et le type durable partagé le porte, sinon la recopie ne compilerait pas.
    expect(readFileSync(join(process.cwd(), 'src/shared/chat-turn.ts'), 'utf8')).toMatch(
      /retryOf\?: string/u
    )
    // 2. La liste blanche du journal laisse passer `retryOf` ET l’événement d’abandon complet.
    const ligne = pilotJournalEvents(
      { kind: 'echec-rattrape', actionId: '1:1', name: 'edit_file', retryOf: '0:0' },
      42
    )
    expect(ligne).toEqual([
      { kind: 'echec-rattrape', actionId: '1:1', name: 'edit_file', retryOf: '0:0', at: 42 }
    ])
    const abandon = pilotJournalEvents(
      {
        kind: 'echecs-abandonnes',
        name: 'échecs abandonnés',
        data: [{ actionId: '0:0', cible: 'edit_file::a.ts' }]
      },
      7
    )
    expect(abandon[0].data).toEqual([{ actionId: '0:0', cible: 'edit_file::a.ts' }])
  })
})
