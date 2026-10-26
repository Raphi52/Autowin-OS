import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { outilsDuChat } from './chat-mcp'
import { AppCommandBus, CATALOG } from './commands'
import { cheminJournalMessagesFils } from './messages-entre-fils-app'
import { CoordinateurDesPlans } from './plans-de-lots-app'
import { lignesDuJournal } from '../shared/messages-entre-fils'

/*
 * conv-1150 — l'outil `plan_de_lots` AU SITE D'APPEL : le vrai bus, le vrai coordinateur, le vrai
 * journal des messages entre fils. Ce qui est verrouillé : le chef est le fil de l'APPEL (jamais un
 * argument), l'outil ne lance rien, et le compte rendu d'un lot part du fil enfant vers le chef par
 * `ecrireDepuisLeFil` (mêmes règles que `ecrire_a_un_fil`).
 */
let base: string
const maintenant = Date.now()

function banc(): {
  bus: AppCommandBus
  coord: CoordinateurDesPlans
  lances: Array<{ fil: string; prompt: string }>
} {
  const depot = process.cwd()
  const fils: Array<{ id: string; projectPath: string; updatedAt: number; messages: [] }> = [
    { id: 'conv-A', projectPath: depot, updatedAt: maintenant, messages: [] }
  ]
  const os = {
    executionWorkspace: depot,
    conversations: { get: (id: string) => fils.find((f) => f.id === id), list: () => fils },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  const bus = new AppCommandBus(os as never, () => undefined)
  const lances: Array<{ fil: string; prompt: string }> = []
  let n = 0
  const coord = new CoordinateurDesPlans({
    creerFil: (chef) => {
      const id = `conv-L${++n}`
      fils.push({
        id,
        projectPath: fils.find((f) => f.id === chef)?.projectPath ?? depot,
        updatedAt: Date.now(),
        messages: []
      })
      return id
    },
    lancer: async (fil, prompt) => {
      lances.push({ fil, prompt })
      return { ok: true, turnId: `t-${fil}` }
    },
    tourActif: () => false,
    existe: (fil) => fils.some((f) => f.id === fil),
    ecrire: (de, a, texte) => bus.ecrireDepuisLeFil(de, a, texte),
    stockage: { lire: () => '', ecrire: () => undefined }
  })
  bus.plansDeLots = coord
  return { bus, coord, lances }
}

const plan = {
  titre: 'Démo',
  parallele: 2,
  lots: [
    { titre: 'Un', demande: '/build lot un', fichiers: ['a.ts'] },
    { titre: 'Deux', demande: '/build lot deux', fichiers: ['b.ts'] }
  ]
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bus-plan-lots-'))
  configureAutowinAppDataBase(base)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(base, { recursive: true, force: true })
})

describe('plan_de_lots par le bus', () => {
  it('est un outil natif du chat', () => {
    expect(CATALOG.some((c) => c.name === 'plan_de_lots')).toBe(true)
    expect(outilsDuChat(CATALOG)).toContain('plan_de_lots')
  })

  it('sans coordinateur câblé : refus lisible', async () => {
    const bus = new AppCommandBus(
      { conversations: { get: () => undefined } } as never,
      () => undefined
    )
    const r = await bus.exec('plan_de_lots', { plan }, 'conv-A')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/non câblé/)
  })

  it('le chef est le fil de l’appel ; déposer ne lance rien ; un lot fini écrit au chef depuis SON fil', async () => {
    const { bus, coord, lances } = banc()
    const r = await bus.exec('plan_de_lots', { plan, chef: 'conv-pirate' }, 'conv-A')
    expect(r.ok).toBe(true)
    const depot = r.data as { plan: { id: string } }
    expect(coord.plans()[0].chef).toBe('conv-A')
    expect(lances).toEqual([])
    await coord.accepter('conv-A', depot.plan.id)
    expect(lances.map((l) => l.fil)).toEqual(['conv-L1', 'conv-L2'])
    await coord.surFinDeTour('conv-L1', { ok: true, texte: 'Lot un fait, code 0.' })
    const messages = lignesDuJournal(readFileSync(cheminJournalMessagesFils(), 'utf8')).filter(
      (l) => l.type === 'message'
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ a: 'conv-A', de: { fil: 'conv-L1' }, nature: 'info' })
    expect(String(messages[0].texte)).toContain('Lot un fait, code 0.')
  })
})
