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

  // conv-1151, lot 2 : sans annonce dans la description, l'agent du chef ignore que le champ existe.
  it('la description annonce le champ « apres » (dépendance explicite entre lots)', () => {
    const outil = CATALOG.find((c) => c.name === 'plan_de_lots')
    expect(outil?.description).toMatch(/« apres »/)
    expect(outil?.args?.plan).toMatch(/"apres"/)
  })

  it('« apres » au site d’appel : le lot dépendant ne part qu’après la fin réussie de son prérequis', async () => {
    const { bus, coord, lances } = banc()
    const ordonne = {
      titre: 'Ordre',
      lots: [
        { titre: 'Un', demande: '/build lot un', fichiers: ['a.ts'] },
        { titre: 'Deux', demande: '/build lot deux', fichiers: ['b.ts'], apres: [1] }
      ]
    }
    const r = await bus.exec('plan_de_lots', { plan: ordonne }, 'conv-A')
    expect(r.ok).toBe(true)
    await coord.accepter('conv-A', (r.data as { plan: { id: string } }).plan.id)
    expect(lances.map((l) => l.fil)).toEqual(['conv-L1'])
    await coord.surFinDeTour('conv-L1', { ok: true, texte: 'Lot un fait, code 0.' })
    expect(lances.map((l) => l.fil)).toContain('conv-L2')
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

  // Depuis conv-1171 (2026-10-27, « je ne veux pas avoir à confirmer, je veux que ça se lance tout
  // seul »), le dépôt par l'agent VAUT lancement : plus de clic « Lancer le plan » à attendre.
  it('le chef est le fil de l’appel ; déposer lance aussitôt ; un lot fini écrit au chef depuis SON fil', async () => {
    const { bus, coord, lances } = banc()
    const r = await bus.exec('plan_de_lots', { plan, chef: 'conv-pirate' }, 'conv-A')
    expect(r.ok).toBe(true)
    expect(coord.plans()[0].chef).toBe('conv-A')
    expect(lances.map((l) => l.fil)).toEqual(['conv-L1', 'conv-L2'])
    await coord.surFinDeTour('conv-L1', { ok: true, texte: 'Lot un fait, code 0.' })
    const messages = lignesDuJournal(readFileSync(cheminJournalMessagesFils(), 'utf8')).filter(
      (l) => l.type === 'message'
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ a: 'conv-A', de: { fil: 'conv-L1' }, nature: 'info' })
    expect(String(messages[0].texte)).toContain('Lot un fait, code 0.')
  })

  // conv-1284 (2026-10-29) : la réponse du chef à un lot bloqué, envoyée en ORDRE, relance le lot
  // par le coordinateur — sans « relancer » à part, et sans second agent dans le fil du lot.
  it('l’ordre du chef au fil d’un lot bloqué le relance ; un ordre d’un autre fil part tel quel', async () => {
    const { bus, coord, lances } = banc()
    await bus.exec('plan_de_lots', { plan }, 'conv-A')
    await coord.surFinDeTour('conv-L1', {
      ok: true,
      texte: '⛔ Bloqué : j’attends la réponse du chef'
    })
    expect(coord.plans()[0].lots[0].etat).toBe('attend-chef')
    const toursAvant = coord.plans()[0].toursLances
    const reveils: Array<{ fil: string; prompt: string }> = []
    bus.tourDeChatActif = () => false
    bus.lancerDansConversation = async (fil, prompt) => {
      reveils.push({ fil, prompt })
      return { ok: true, turnId: `ordre-${reveils.length}` }
    }
    const r = await bus.exec(
      'ecrire_a_un_fil',
      { destinataire: 'conv-L1', texte: 'Le module s’appelle carte.ts.', nature: 'ordre' },
      'conv-A'
    )
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ nature: 'ordre', reveil: 'lance' })
    expect(reveils).toHaveLength(1)
    expect(reveils[0].fil).toBe('conv-L1')
    expect(reveils[0].prompt).toMatch(/^Ordre de conv-A /)
    expect(reveils[0].prompt).toContain('Le module s’appelle carte.ts.')
    expect(reveils[0].prompt).toMatch(/Ce fil fait le lot 1 sur 2 du plan « Démo »/)
    expect(coord.plans()[0].lots[0]).toMatchObject({ etat: 'en-cours', tour: 'ordre-1' })
    expect(coord.plans()[0].toursLances).toBe(toursAvant + 1)
    expect(lances.filter((l) => l.fil === 'conv-L1')).toHaveLength(1)
    // Jumeau : un ordre du lot 2 vers le lot 1 n'est pas une réponse du chef — rien n'est ajouté.
    await coord.surFinDeTour('conv-L1', { ok: true, tour: 'ordre-1', texte: '⛔ Bloqué : encore' })
    await bus.exec(
      'ecrire_a_un_fil',
      { destinataire: 'conv-L1', texte: 'Regarde mon fichier b.ts.', nature: 'ordre' },
      'conv-L2'
    )
    expect(reveils).toHaveLength(2)
    expect(reveils[1].prompt).not.toMatch(/Ce fil fait le lot/)
    expect(coord.plans()[0].lots[0].etat).toBe('echec')
  })
})
