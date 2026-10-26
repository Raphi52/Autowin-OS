import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ActiveChatTurns } from './active-chat-turns'
import {
  annoncerLaFinDuTour,
  suivreLaFinDuTour,
  type ObservateurFinDeTour,
  type RunPilotChat
} from './chat/run-pilot-chat'
import { CoordinateurDesPlans } from './plans-de-lots-app'
import type { IssueDuTour } from '../shared/plan-de-lots'

/*
 * CHEF OCCUPÉ, AVEC LE VRAI REGISTRE DES TOURS (conv-1150, 2026-10-26, objection du juge).
 *
 * Défaut mesuré : l'annonce de fin partait de `createRunPilotChat`, donc de l'INTÉRIEUR de
 * `activeChatTurns.trackPreparation` (index.ts). Le chef restait compté « en cours » (`preparing`)
 * au moment même où sa fin était annoncée : le coordinateur le croyait occupé, gardait le compte
 * rendu, et plus rien ne le relançait — le dernier lot compris. Les tests du coordinateur ne le
 * voyaient pas : ils simulaient `tourActif`.
 *
 * Ici, rien n'est simulé de ce qui décide « occupé » : vrai `ActiveChatTurns`, vrai
 * `suivreLaFinDuTour`, vrai coordinateur, composés comme `index.ts` les compose (garde de source
 * en bas). Seul le corps du tour est faux : il s'enregistre dans le registre comme le vrai tour
 * (`set` au départ, `delete` dans son `finally`) puis attend qu'on le finisse. Aucun modèle appelé.
 *
 * fix-ok: conv-1150 (2026-10-26) — chaque édition de ce fichier suit une cause mesurée, rouge puis
 * vert : (1) fin annoncée dans `trackPreparation` → chef jamais réveillé (4 rouges sur 4) ; (2) le
 * faux `lancer` rendait un `turnId` alors que le vrai `lancerSansAttendre`
 * (chat/lancer-sans-attendre.ts:42) rend `{ ok: true }` sans identifiant ; (3) reprise après
 * redémarrage annoncée avant `activeChatTurns.delete(recoveryController)` → réveil du chef repris
 * perdu (contre-épreuve rouge) ; (4) retrait d'un forçage `as unknown as`, sans effet sur le test.
 */

const laisserFiler = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function bancReel(options: { contenu?: string; fils?: string[]; premierFil?: number } = {}): {
  coord: CoordinateurDesPlans
  turns: ActiveChatTurns
  lancements: Array<{ fil: string; prompt: string }>
  tourUtilisateur: (fil: string) => void
  finir: (fil: string) => Promise<void>
  reprise: (fil: string) => (issue: IssueDuTour, ordre?: 'apres' | 'avant') => Promise<void>
  stockage: () => string
} {
  const turns = new ActiveChatTurns()
  const fils = new Set(['conv-1', ...(options.fils ?? [])])
  const lancements: Array<{ fil: string; prompt: string }> = []
  const enAttente = new Map<string, Array<() => void>>()
  let stocke = options.contenu ?? ''
  let prochain = options.premierFil ?? 100
  let n = 0
  const corps: RunPilotChat = async (_s, _m, conversationId) => {
    const fil = conversationId ?? ''
    const controller = new AbortController()
    let clore!: () => void
    turns.set(fil, controller, new Promise<void>((r) => (clore = r)))
    try {
      await new Promise<void>((r) => enAttente.set(fil, [...(enAttente.get(fil) ?? []), r]))
      return { ok: true, cancelled: false, turnId: `t${++n}`, text: `fini ${fil}` }
    } finally {
      turns.delete(fil, controller)
      clore()
    }
  }
  // MÊME composition qu'index.ts : compté dès la réception, fin annoncée une fois relâché.
  const tourCompteDesReception: RunPilotChat = (...args) =>
    turns.trackPreparation(args[2], () => corps(...args))
  const surFin: ObservateurFinDeTour = (fil, issue) => coord.surFinDeTour(fil, issue)
  const runPilotChat = suivreLaFinDuTour(tourCompteDesReception, surFin)
  const coord: CoordinateurDesPlans = new CoordinateurDesPlans({
    creerFil: () => {
      const fil = `conv-${prochain++}`
      fils.add(fil)
      return fil
    },
    // Comme `lancerDansConversation` (`lancerSansAttendre`) : rend la main au DÉMARRAGE du tour,
    // pas à sa fin, et sans identifiant de tour — il n'est connu qu'à la fin.
    lancer: async (fil, prompt) => {
      lancements.push({ fil, prompt })
      void runPilotChat(undefined, [{ role: 'user', content: prompt }], fil)
      return { ok: true }
    },
    tourActif: (fil) => turns.isInFlight(fil),
    existe: (fil) => fils.has(fil),
    ecrire: () => {},
    stockage: {
      lire: () => stocke,
      ecrire: (c) => {
        stocke = c
      }
    },
    journaliser: () => {}
  })
  return {
    coord,
    turns,
    stockage: () => stocke,
    // MÊME ordre que `reprendreAppelChat` (index.ts) : réservation `setRecovered` à la reprise ; à la
    // fin, `delete` de la réservation PUIS annonce `repris`. `avant` rejoue l'ordre fautif.
    reprise: (fil) => {
      const controller = new AbortController()
      let clore!: () => void
      turns.setRecovered(fil, controller, new Promise<void>((r) => (clore = r)))
      return async (issue, ordre = 'apres') => {
        if (ordre === 'avant') annoncerLaFinDuTour(surFin, fil, { ...issue, repris: true })
        turns.delete(fil, controller)
        clore()
        if (ordre === 'apres') annoncerLaFinDuTour(surFin, fil, { ...issue, repris: true })
        await laisserFiler()
      }
    },
    lancements,
    tourUtilisateur: (fil) => {
      void runPilotChat(undefined, [{ role: 'user', content: 'question' }], fil)
    },
    finir: async (fil) => {
      const file = enAttente.get(fil) ?? []
      const suivant = file.shift()
      if (!suivant) throw new Error(`aucun tour en cours dans ${fil}`)
      suivant()
      await laisserFiler()
    }
  }
}

const plan3 = {
  titre: 'Traduction',
  parallele: 2,
  lots: [1, 2, 3].map((n) => ({
    titre: `Écrans ${n}`,
    demande: `/build traduis le groupe ${n}`,
    fichiers: [`src/groupe-${n}.tsx`]
  }))
}

const reveilsDuChef = (b: ReturnType<typeof bancReel>): string[] =>
  b.lancements.filter((l) => l.fil === 'conv-1').map((l) => l.prompt)

async function planAccepte(): Promise<ReturnType<typeof bancReel>> {
  const b = bancReel()
  const d = b.coord.deposer('conv-1', plan3)
  if (!d.ok) throw new Error(d.erreur)
  await b.coord.accepter('conv-1', d.plan.id)
  await laisserFiler()
  expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101'])
  return b
}

describe('plans de lots — chef occupé, avec le vrai registre des tours', () => {
  it('un lot finit pendant un tour du chef : réveil à la fin de CE tour, une seule fois', async () => {
    const b = await planAccepte()
    b.tourUtilisateur('conv-1')
    await laisserFiler()
    await b.finir('conv-100')
    // Le lot 3 part, mais le chef n'est pas interrompu au milieu de son tour.
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101', 'conv-102'])
    expect(reveilsDuChef(b)).toEqual([])
    await b.finir('conv-1')
    expect(reveilsDuChef(b)).toHaveLength(1)
    expect(reveilsDuChef(b)[0]).toMatch(/lot 1 « Écrans 1 » : fait/)
    expect(b.turns.isInFlight('conv-1')).toBe(true)
    // La fin du tour de réveil, sans rien de neuf, ne relance pas le chef.
    await b.finir('conv-1')
    expect(reveilsDuChef(b)).toHaveLength(1)
    expect(b.turns.isInFlight('conv-1')).toBe(false)
  })

  it('des lots finissent pendant un réveil : aucun perdu, le dernier porte le bilan final', async () => {
    const b = await planAccepte()
    await b.finir('conv-100')
    expect(reveilsDuChef(b)).toHaveLength(1)
    // Pendant le réveil du chef, le lot 2 finit : pas de second réveil en même temps.
    await b.finir('conv-101')
    expect(reveilsDuChef(b)).toHaveLength(1)
    await b.finir('conv-1')
    expect(reveilsDuChef(b)).toHaveLength(2)
    expect(reveilsDuChef(b)[1]).toMatch(/lot 2 « Écrans 2 » : fait/)
    // Le DERNIER lot finit pendant le 2e réveil : son compte rendu attend, puis part.
    await b.finir('conv-102')
    expect(reveilsDuChef(b)).toHaveLength(2)
    await b.finir('conv-1')
    expect(reveilsDuChef(b)).toHaveLength(3)
    expect(reveilsDuChef(b)[2]).toMatch(/lot 3 « Écrans 3 » : fait/)
    expect(reveilsDuChef(b)[2]).toMatch(/Statut du plan : terminé/)
    await b.finir('conv-1')
    expect(reveilsDuChef(b)).toHaveLength(3)
  })
})

/*
 * REDÉMARRAGE PENDANT UN PLAN (objection du juge, conv-1150) : des agents survivent, l'app reprend
 * leur tour (`reprendreAppelChat`, index.ts) et les réserve par `setRecovered` — c'est cette
 * réservation, réelle ici, qui fait dire « occupé » au coordinateur.
 */
describe('plans de lots — redémarrage, avec le vrai registre des tours et de vraies reprises', () => {
  async function apresRedemarrage(): Promise<ReturnType<typeof bancReel>> {
    const avant = await planAccepte()
    return bancReel({ contenu: avant.stockage(), fils: ['conv-100', 'conv-101'], premierFil: 102 })
  }

  it('« Reprendre » pendant la reprise du lot 2 : adopté, aucun second agent ; sa fin le note et réveille le chef', async () => {
    const b = await apresRedemarrage()
    const finDeLaReprise = b.reprise('conv-101')
    const plan = b.coord.plans()[0]
    expect(plan.lots.map((l) => l.etat)).toEqual(['interrompu', 'interrompu', 'a-faire'])
    await b.coord.reprendre('conv-1', plan.id)
    await laisserFiler()
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100'])
    expect(b.coord.plans()[0].lots[1].etat).toBe('en-cours')
    await finDeLaReprise({ ok: true, texte: 'Groupe 2 traduit.' })
    expect(b.coord.plans()[0].lots[1].etat).toBe('fait')
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-102', 'conv-1'])
  })

  it('l’agent repris du lot 1 finit avant tout clic : lot noté, chef réveillé, rien ne repart seul', async () => {
    const b = await apresRedemarrage()
    await b.reprise('conv-100')({ ok: true })
    expect(b.coord.plans()[0].lots.map((l) => l.etat)).toEqual(['fait', 'interrompu', 'a-faire'])
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-1'])
  })

  it('le CHEF repris : un lot qui finit pendant sa reprise le réveille à la fin de la reprise', async () => {
    const b = await apresRedemarrage()
    const finDuChef = b.reprise('conv-1')
    await b.reprise('conv-100')({ ok: true })
    expect(reveilsDuChef(b)).toEqual([])
    await finDuChef({ ok: true })
    expect(reveilsDuChef(b)).toHaveLength(1)
  })

  it('contre-épreuve : annoncée AVANT de relâcher la réservation, la fin du chef repris perd son réveil', async () => {
    const b = await apresRedemarrage()
    const finDuChef = b.reprise('conv-1')
    await b.reprise('conv-100')({ ok: true })
    await finDuChef({ ok: true }, 'avant')
    expect(reveilsDuChef(b)).toEqual([])
  })
})

/*
 * Le site d'appel : la composition testée ci-dessus est celle d'index.ts. Si l'annonce repart de
 * `createRunPilotChat` (donc de l'intérieur de `trackPreparation`), ces deux tests restent verts
 * mais le chef de l'app réelle n'est plus réveillé : c'est ce que cette garde refuse.
 */
describe('plans de lots — branchement de la fin de tour dans index.ts', () => {
  const index = readFileSync(join(__dirname, 'index.ts'), 'utf8')

  it('la fin de tour est annoncée autour du tour compté dès sa réception', () => {
    expect(index).toMatch(
      /const tourCompteDesReception: typeof lancerTour = \(\.\.\.args\) =>\s+activeChatTurns\.trackPreparation\(args\[2\],/
    )
    expect(index).toMatch(/const runPilotChat = suivreLaFinDuTour\(\s*tourCompteDesReception,/)
  })

  it('un tour REPRIS est rejoué sans annonce, puis annoncé `repris` APRÈS le relâchement de sa réservation', () => {
    const debut = index.indexOf(
      'const reprendreAppelChat = (call: RecoverableChatProviderCall): void => {'
    )
    expect(debut).toBeGreaterThan(0)
    const reprise = index.slice(debut, index.indexOf('\n  }\n', debut))
    expect(reprise).toContain('await tourCompteDesReception(')
    expect(reprise).not.toContain('await runPilotChat(')
    const fin = reprise.slice(reprise.indexOf('} finally {'))
    const relache = fin.indexOf('activeChatTurns.delete(call.conversationId, recoveryController)')
    const annonce = fin.indexOf('repris: true')
    expect(relache).toBeGreaterThan(0)
    expect(annonce).toBeGreaterThan(relache)
    // Chaque clôture sans rejeu porte aussi son issue (sinon un lot adopté resterait en cours).
    expect(reprise).toMatch(
      /const closeWithoutRecovery = \(event: ChatTurnEvent\): void => \{\s+issueDeReprise = issueDeCloture\(event\)/
    )
  })

  it('la fabrique du tour ne reçoit plus l’observateur de fin (il annoncerait trop tôt)', () => {
    const appel = index.slice(index.indexOf('createRunPilotChat({'))
    const fabrique = appel.slice(0, appel.indexOf('\n  })\n'))
    expect(fabrique.length).toBeGreaterThan(0)
    expect(fabrique).not.toMatch(/surFinDeTour/)
  })
})
