import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import type { Message, SendResult } from '../providers/types'
import { forgetChatSession } from '../runs/chat-session-store'
import { oublierCompteRenduNonVu } from '../runs/compte-rendu-non-vu-store'
import { commandeNonInjectable, routeSkillRequest } from '../skills/skill-routing'

/**
 * `/kaizen` TAPÉ DANS LE CHAT SE JOUE DANS LE FIL, PAS DANS UN RUN (2026-10-30).
 *
 * Rejeu, tour c7de932e-abac-4f8b-ba34-1b6335b62653 : « /kaizen tu aurais du tout
 * paralléliser avec une super conv » partait en `orchestrate` sans qu'aucun modèle ne lise le
 * message. Le fil restait muet, son RUN.md ne portait que « Orchestration lancée ». Saisie de
 * l'utilisateur : « kaizen lance une orchestration un peu opaque c'est naze ca pourrait le faire
 * comme une conv normale ». Le même mot SANS barre, lui, jouait déjà la skill dans le fil.
 */
const CONV = `conv-kaizen-fil-${process.pid}`
const DEMANDE_1332 = '/kaizen tu aurais du tout paralléliser avec une super conv'

function banc() {
  const evenements: PilotEvent[] = []
  const appelsModele: Message[][] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[]): Promise<SendResult> => {
      appelsModele.push(messages)
      return { text: 'Réponse du modèle.', provider: 'claude' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => false)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'orchestrate', args: {}, description: 'lancer un run' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async (name: string) =>
      name === 'orchestrate'
        ? { ok: true, data: { status: 'succeeded', valid: true, result: 'run payé' } }
        : { ok: true, data: { ok: true } }
    )
  }
  const pilote = new AgentPilot(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roles as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bus as any
  )
  const jouer = (demande: string) =>
    pilote.chat([{ role: 'user', content: demande }], (e) => evenements.push(e), undefined, 12, CONV)
  const executees = () => bus.exec.mock.calls.map((appel) => appel[0])
  const servi = () =>
    appelsModele
      .flat()
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n')
  return { jouer, executees, servi, appelsModele }
}

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'kaizen-fil-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  forgetChatSession(CONV)
  oublierCompteRenduNonVu(CONV)
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

describe('/kaizen tapé dans le chat', () => {
  it('rejeu de conv-1332 : aucun run, le modèle joue la skill dans le fil', async () => {
    const b = banc()
    await b.jouer(DEMANDE_1332)

    expect(b.executees()).not.toContain('orchestrate')
    expect(b.appelsModele).toHaveLength(1)
    expect(b.servi()).toContain('=== SKILL KAIZEN (kit) ===')
  })

  it('avec ou sans barre, le fil reçoit la même procédure', async () => {
    const sansBarre = banc()
    await sansBarre.jouer(DEMANDE_1332.slice(1))

    expect(sansBarre.executees()).not.toContain('orchestrate')
    expect(sansBarre.servi()).toContain('=== SKILL KAIZEN (kit) ===')
  })
})

describe('contrôles négatifs : le reste du routage ne bouge pas', () => {
  it('/scout part toujours directement en orchestration', async () => {
    const b = banc()
    await b.jouer('/scout trouve les failles')

    expect(b.executees()).toEqual(['orchestrate'])
    expect(b.appelsModele).toHaveLength(0)
  })

  it('un run qui porte /kaizen garde sa phase, et la commande reste non injectable en cours de tour', () => {
    // L'orchestrateur et `task-regime.ts` lisent `explicitPhase` : le profil de workflow Kaizen
    // et un `orchestrate` demandé nommément en dépendent.
    expect(routeSkillRequest(DEMANDE_1332)?.explicitPhase).toBe('kaizen')
    expect(commandeNonInjectable(DEMANDE_1332)).toBe('kaizen')
  })
})
