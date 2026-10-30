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

function bancReel(
  options: {
    contenu?: string
    fils?: string[]
    premierFil?: number
    /** Reprises réservées AVANT le chargement du coordinateur, comme `reprendreAppelChat` (index.ts). */
    reprisDesLeChargement?: string[]
  } = {}
): {
  coord: CoordinateurDesPlans
  turns: ActiveChatTurns
  lancements: Array<{ fil: string; prompt: string }>
  tourUtilisateur: (fil: string) => void
  finir: (fil: string) => Promise<void>
  reprise: (fil: string) => (issue: IssueDuTour, ordre?: 'apres' | 'avant') => Promise<void>
  finDeReprise: (fil: string) => (issue: IssueDuTour) => Promise<void>
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
  // MÊME ordre que `reprendreAppelChat` (index.ts) : réservation `setRecovered` à la reprise ; à la
  // fin, `delete` de la réservation PUIS annonce `repris`. `avant` rejoue l'ordre fautif.
  const reprise = (fil: string) => {
    const controller = new AbortController()
    let clore!: () => void
    turns.setRecovered(fil, controller, new Promise<void>((r) => (clore = r)))
    return async (issue: IssueDuTour, ordre: 'apres' | 'avant' = 'apres'): Promise<void> => {
      if (ordre === 'avant') annoncerLaFinDuTour(surFin, fil, { ...issue, repris: true })
      turns.delete(fil, controller)
      clore()
      if (ordre === 'apres') annoncerLaFinDuTour(surFin, fil, { ...issue, repris: true })
      await laisserFiler()
    }
  }
  const reprisesDuChargement = new Map(
    (options.reprisDesLeChargement ?? []).map((fil) => [fil, reprise(fil)])
  )
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
    reprise,
    finDeReprise: (fil) => {
      const fin = reprisesDuChargement.get(fil)
      if (!fin) throw new Error(`aucune reprise réservée au chargement pour ${fil}`)
      return fin
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
 * LE PLAN SUIT L'AGENT QUI A SURVÉCU (conv-1308, 2026-10-30, demande de l'utilisateur). Vécu sur
 * plan-b4358910 : l'app redémarre pendant le lot 1, l'agent continue, le chef affiche « interrompu »
 * alors que le fil du lot tourne. « Reprendre » y aurait lancé un second agent, et rien ne devait
 * enchaîner les lots 2 et 3 à sa fin. Un lot dont l'agent vit n'est pas interrompu ; seul un lot
 * dont l'agent est mort attend encore le clic.
 */
describe('plans de lots — le plan suit l’agent qui a survécu au redémarrage', () => {
  const planEnChaine = {
    titre: 'Navigateur',
    parallele: 3,
    lots: [1, 2, 3].map((n) => ({
      titre: `Étape ${n}`,
      demande: `/build étape ${n}`,
      fichiers: [`src/etape-${n}.ts`],
      apres: n > 1 ? [n - 1] : []
    }))
  }

  /** Le plan tourne, seul le lot 1 est parti ; l'app redémarre sur le disque ainsi laissé. */
  async function disqueDuPlanEnChaine(): Promise<string> {
    const avant = bancReel()
    const d = avant.coord.deposer('conv-1', planEnChaine)
    if (!d.ok) throw new Error(d.erreur)
    await avant.coord.accepter('conv-1', d.plan.id)
    await laisserFiler()
    expect(avant.lancements.map((l) => l.fil)).toEqual(['conv-100'])
    return avant.stockage()
  }

  const etats = (b: ReturnType<typeof bancReel>): string[] =>
    b.coord.plans()[0].lots.map((l) => l.etat)

  it('agent réservé avant le chargement : le plan reste en cours, rien n’est relancé', async () => {
    const b = bancReel({
      contenu: await disqueDuPlanEnChaine(),
      fils: ['conv-100'],
      premierFil: 101,
      reprisDesLeChargement: ['conv-100']
    })
    expect(b.coord.plans()[0].statut).toBe('en-cours')
    expect(b.coord.plans()[0].raison).toBeUndefined()
    expect(etats(b)).toEqual(['en-cours', 'a-faire', 'a-faire'])
    expect(b.lancements).toEqual([])
  })

  it('sa fin note le lot, enchaîne le lot suivant et réveille le chef, sans aucun clic', async () => {
    const b = bancReel({
      contenu: await disqueDuPlanEnChaine(),
      fils: ['conv-100'],
      premierFil: 101,
      reprisDesLeChargement: ['conv-100']
    })
    await b.finDeReprise('conv-100')({ ok: true, texte: 'Étape 1 livrée.' })
    expect(etats(b)).toEqual(['fait', 'en-cours', 'a-faire'])
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-101', 'conv-1'])
    expect(reveilsDuChef(b)[0]).toMatch(/lot 1 « Étape 1 » : fait/)
    // La chaîne continue : le lot 2 fini, le lot 3 part à son tour.
    await b.finir('conv-101')
    expect(etats(b)).toEqual(['fait', 'fait', 'en-cours'])
  })

  it('agent connu APRÈS le chargement (inventaire, run rattaché) : même résultat', async () => {
    const b = bancReel({
      contenu: await disqueDuPlanEnChaine(),
      fils: ['conv-100'],
      premierFil: 101
    })
    expect(b.coord.plans()[0].statut).toBe('interrompu')
    b.coord.agentRepris('conv-100')
    expect(b.coord.plans()[0].statut).toBe('en-cours')
    expect(etats(b)).toEqual(['en-cours', 'a-faire', 'a-faire'])
    expect(b.lancements).toEqual([])
    await b.coord.surFinDeTour('conv-100', { ok: true, repris: true })
    expect(etats(b)).toEqual(['fait', 'en-cours', 'a-faire'])
  })

  it('« Reprendre » n’a plus rien à faire : aucun second agent dans le fil du lot', async () => {
    const b = bancReel({
      contenu: await disqueDuPlanEnChaine(),
      fils: ['conv-100'],
      premierFil: 101
    })
    b.coord.agentRepris('conv-100')
    const r = await b.coord.reprendre('conv-1', b.coord.plans()[0].id)
    expect(r.ok).toBe(false)
    expect(b.lancements).toEqual([])
  })

  it('un lot mort à côté du survivant : le plan attend le clic, le survivant finit quand même', async () => {
    const avant = await planAccepte()
    const b = bancReel({
      contenu: avant.stockage(),
      fils: ['conv-100', 'conv-101'],
      premierFil: 102
    })
    b.coord.agentRepris('conv-100')
    expect(b.coord.plans()[0].statut).toBe('interrompu')
    expect(etats(b)).toEqual(['en-cours', 'interrompu', 'a-faire'])
    await b.coord.surFinDeTour('conv-100', { ok: true, repris: true })
    expect(etats(b)).toEqual(['fait', 'interrompu', 'a-faire'])
    // Rien ne repart seul pour le lot mort ; le chef, lui, est prévenu.
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-1'])
    await b.finir('conv-1')
    await b.coord.reprendre('conv-1', b.coord.plans()[0].id)
    await laisserFiler()
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-1', 'conv-101', 'conv-102'])
  })

  it('un plan arrêté par l’utilisateur le reste : le lot finit, aucun autre ne part', async () => {
    const avant = bancReel()
    const d = avant.coord.deposer('conv-1', planEnChaine)
    if (!d.ok) throw new Error(d.erreur)
    await avant.coord.accepter('conv-1', d.plan.id)
    await laisserFiler()
    avant.coord.arreter('conv-1', d.plan.id)
    const b = bancReel({ contenu: avant.stockage(), fils: ['conv-100'], premierFil: 101 })
    b.coord.agentRepris('conv-100')
    expect(b.coord.plans()[0].statut).toBe('arrete')
    expect(etats(b)).toEqual(['en-cours', 'a-faire', 'a-faire'])
    await b.coord.surFinDeTour('conv-100', { ok: true, repris: true })
    expect(b.coord.plans()[0].statut).toBe('arrete')
    expect(etats(b)).toEqual(['fait', 'a-faire', 'a-faire'])
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-1'])
  })

  it('un run d’un AUTRE tour du même fil n’adopte pas le lot', async () => {
    const avant = bancReel()
    const d = avant.coord.deposer('conv-1', planEnChaine)
    if (!d.ok) throw new Error(d.erreur)
    await avant.coord.accepter('conv-1', d.plan.id)
    await laisserFiler()
    const brut = JSON.parse(avant.stockage()) as {
      plans: Array<{ lots: Array<{ tour?: string }> }>
    }
    brut.plans[0].lots[0].tour = 'tour-du-lot'
    const b = bancReel({
      contenu: JSON.stringify(brut),
      fils: ['conv-100'],
      premierFil: 101
    })
    b.coord.agentRepris('conv-100', 'tour-ancien')
    expect(b.coord.plans()[0].statut).toBe('interrompu')
    b.coord.agentRepris('conv-100', 'tour-du-lot')
    expect(b.coord.plans()[0].statut).toBe('en-cours')
  })

  it('l’agent adopté meurt sans résultat : lot en échec, suite bloquée, chef prévenu', async () => {
    const b = bancReel({
      contenu: await disqueDuPlanEnChaine(),
      fils: ['conv-100'],
      premierFil: 101
    })
    b.coord.agentRepris('conv-100')
    await b.coord.surFinDeTour('conv-100', {
      ok: false,
      repris: true,
      perdu: true,
      erreur: 'agent resté sans signe de vie'
    })
    expect(etats(b)).toEqual(['echec', 'a-faire', 'a-faire'])
    expect(b.coord.plans()[0].statut).toBe('bloque')
    expect(reveilsDuChef(b)).toHaveLength(1)
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-1'])
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

  /*
   * conv-1308 : index.ts ne se démarre pas sous test. Le comportement est prouvé plus haut et dans
   * `relaunch-resumable-run.test.ts` ; ici, le branchement des deux chemins de reprise.
   */
  it('une reprise d’appel chat prévient le plan dès qu’elle réserve le fil', () => {
    const debut = index.indexOf(
      'const reprendreAppelChat = (call: RecoverableChatProviderCall): void => {'
    )
    const reprise = index.slice(debut, index.indexOf('\n  }\n', debut))
    const reserve = reprise.indexOf('activeChatTurns.setRecovered(')
    const adopte = reprise.indexOf('suiviDesPlans.coordinateur?.agentRepris(')
    expect(reserve).toBeGreaterThan(0)
    expect(adopte).toBeGreaterThan(reserve)
  })

  it('un run repris au démarrage (rattaché ou relancé) est adopté avant toute attente', () => {
    const debut = index.indexOf('for (const resumableRun of resumableRuns) {')
    const boucle = index.slice(debut, index.indexOf('const preflightStartedAt', debut))
    expect(boucle).toMatch(
      /reprise === 'rattacher' \|\| reprise === 'relancer'[\s\S]{0,200}suiviDuPlan\.agentRepris\(/
    )
    expect(boucle.indexOf('suiviDuPlan.agentRepris(')).toBeLessThan(
      boucle.indexOf(
        'void waitUntilRunCanResume(',
        boucle.indexOf("if (reprise === 'rattacher') {")
      )
    )
  })

  it('un rattachement clos sans relance annonce sa fin au plan', () => {
    const debut = index.indexOf('for (const resumableRun of resumableRuns) {')
    const boucle = index.slice(debut, index.indexOf('const preflightStartedAt', debut))
    const rattache = boucle.slice(boucle.indexOf("if (reprise === 'rattacher') {"))
    expect(rattache.match(/annoncerFinDuRunRepris\(/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('la relance d’un run reçoit le suivi du plan', () => {
    const appel = index.slice(index.indexOf('creerRelanceDeRunReprenable({'))
    const deps = appel.slice(0, appel.indexOf('\n  })\n'))
    expect(deps).toContain('plansDeLots: suiviDuPlan')
    const debut = index.indexOf('const suiviDuPlan: SuiviDuPlan = {')
    const suivi = index.slice(debut, index.indexOf('\n  }\n', debut))
    expect(suivi).toContain('suiviDesPlans.coordinateur?.agentRepris(')
    expect(suivi).toContain('annoncerLaFinDuTour(observateurDesPlans,')
    // Le démarrage et l'enregistrement des canaux n'ont pas la même portée : le suivi passe par ici.
    expect(index).toContain('const suiviDuPlan = registerChatIpc()')
  })

  it('la fabrique du tour ne reçoit plus l’observateur de fin (il annoncerait trop tôt)', () => {
    const appel = index.slice(index.indexOf('createRunPilotChat({'))
    const fabrique = appel.slice(0, appel.indexOf('\n  })\n'))
    expect(fabrique.length).toBeGreaterThan(0)
    expect(fabrique).not.toMatch(/surFinDeTour/)
  })
})
