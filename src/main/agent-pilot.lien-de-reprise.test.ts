import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAutowinAppDataBase } from './app-data'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { pilotJournalEvents } from './runs/turn-journal-enrich'
import { appendTurnEvent, readTurnJournal } from './runs/turn-journal'
import { evenementResultatDurable } from './chat/durable-result-event'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * LE LIEN ENTRE UN ECHEC ET L'ACTION QUI LE RATTRAPE.
 *
 * Trois choses a prouver, et pas une de moins :
 *  - REPRISE : un succes sur la MEME cible porte `retryOf` = l'`actionId` de l'echec repare ;
 *  - ABANDON : un echec jamais repris est ECRIT (evenement `echecs-abandonnes`), pas deduit d'une
 *    absence — et un succes sur une AUTRE cible ne se fait pas passer pour un rattrapage ;
 *  - FRONTIERE : le champ survit a la recopie champ-par-champ (la seule facon connue de le perdre
 *    en silence) et se retrouve dans le FICHIER journal apres ecriture puis relecture.
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

  it('FRONTIÈRE — le lien survit à la recopie durable ET atterrit dans le fichier journal', () => {
    // 1. La recopie CHAMP PAR CHAMP est ici EXECUTEE (pas relue) : retirer la ligne `retryOf` de
    //    `evenementResultatDurable` rend ce test rouge, un simple renommage ne le casse pas.
    const durable = evenementResultatDurable(
      { actionId: '1:0', name: 'edit_file', ok: true, data: 'ok', retryOf: '0:0' },
      '9:9'
    )
    expect(durable).toEqual({
      kind: 'result',
      actionId: '1:0',
      name: 'edit_file',
      ok: true,
      data: 'ok',
      retryOf: '0:0'
    })
    // Un resultat sans rattrapage ne fabrique pas de lien vide.
    expect(evenementResultatDurable({ name: 'edit_file', ok: false }, '9:9')).toEqual({
      kind: 'result',
      actionId: '9:9',
      name: 'edit_file',
      ok: false,
      data: undefined
    })

    // 2. ... et le meme evenement, ecrit puis RELU sur disque, porte encore le lien.
    appendTurnEvent(racine, 'conv-frontiere', 'tour-1', { ...durable, at: 42 })
    const journal = readTurnJournal(racine, 'conv-frontiere', 'tour-1')
    expect(journal).toEqual([{ ...durable, at: 42 }])

    // 3. L'evenement d'ABANDON passe, lui, par la liste blanche du journal (kind inconnu de la
    //    recopie durable) : c'est le chemin REEL de `echecs-abandonnes`.
    const abandon = pilotJournalEvents(
      {
        kind: 'echecs-abandonnes',
        name: 'échecs abandonnés',
        data: [{ actionId: '0:0', cible: 'edit_file::a.ts' }]
      },
      7
    )
    expect(abandon[0].data).toEqual([{ actionId: '0:0', cible: 'edit_file::a.ts' }])
    // ... et lui aussi atterrit sur DISQUE, relu tel quel.
    appendTurnEvent(racine, 'conv-frontiere', 'tour-2', { ...abandon[0], at: 43 })
    expect(readTurnJournal(racine, 'conv-frontiere', 'tour-2')).toEqual([{ ...abandon[0], at: 43 }])
  })
})
