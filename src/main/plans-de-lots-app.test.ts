import { describe, expect, it } from 'vitest'
import { CoordinateurDesPlans, type DepsPlans } from './plans-de-lots-app'
import { ecrireAUnFil, type ContexteFils } from './messages-entre-fils-app'
import { lignesDuJournal, type IoJournalFils } from '../shared/messages-entre-fils'

/*
 * SUPER CONVERSATION (conv-1150) — le coordinateur côté app, sur de faux fils : aucun appel de
 * modèle. Les comptes rendus passent par le VRAI `ecrireAUnFil` sur un journal en mémoire : c'est
 * le journal que lit le fil chef en tête de tour.
 */

interface Banc {
  coord: CoordinateurDesPlans
  lancements: Array<{ fil: string; prompt: string }>
  actifs: Set<string>
  fils: Set<string>
  journal: () => Array<Record<string, unknown>>
  stockage: { contenu: string }
  deps: DepsPlans
}

function banc(
  options: { lancer?: DepsPlans['lancer']; contenu?: string; premierFil?: number } = {}
): Banc {
  const lancements: Array<{ fil: string; prompt: string }> = []
  const actifs = new Set<string>()
  const fils = new Set<string>(['conv-1'])
  let prochain = options.premierFil ?? 100
  let texteJournal = ''
  const io: IoJournalFils = {
    lire: () => texteJournal,
    ajouter: (_p, ligne) => {
      texteJournal += `${ligne}\n`
    }
  }
  const contexte: ContexteFils = {
    dossierDe: (f) => (fils.has(f) ? 'D:/depot' : undefined),
    estActif: (f) => fils.has(f),
    filsActifs: () => [...fils]
  }
  const stockage = { contenu: options.contenu ?? '' }
  let horloge = 1_000
  let id = 0
  const deps: DepsPlans = {
    creerFil: () => {
      const fil = `conv-${prochain++}`
      fils.add(fil)
      return fil
    },
    lancer:
      options.lancer ??
      (async (fil, prompt) => {
        lancements.push({ fil, prompt })
        return { ok: true, turnId: `tour-${fil}-${lancements.length}` }
      }),
    tourActif: (fil) => actifs.has(fil),
    existe: (fil) => fils.has(fil),
    ecrire: (de, a, texte) => {
      ecrireAUnFil({ destinataire: a, texte }, { fil: de }, contexte, {
        journal: 'mem',
        io,
        maintenant: horloge
      })
    },
    stockage: {
      lire: () => stockage.contenu,
      ecrire: (c) => {
        stockage.contenu = c
      }
    },
    maintenant: () => ++horloge,
    nouvelId: () => `p${++id}`
  }
  return {
    coord: new CoordinateurDesPlans(deps),
    lancements,
    actifs,
    fils,
    journal: () => lignesDuJournal(texteJournal).filter((l) => l.type === 'message'),
    stockage,
    deps
  }
}

const plan4 = {
  titre: 'Traduction',
  parallele: 2,
  lots: [1, 2, 3, 4].map((n) => ({
    titre: `Écrans ${n}`,
    demande: `/build traduis le groupe ${n}`,
    fichiers: [`src/groupe-${n}.tsx`]
  }))
}

describe('CoordinateurDesPlans — dépôt et accord', () => {
  it('deposer() seul enregistre sans lancer : c’est l’outil qui lance', () => {
    const b = banc()
    const r = b.coord.deposer('conv-1', plan4)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.statut).toBe('attente-accord')
    expect(b.lancements).toEqual([])
  })

  /*
   * conv-1171 (2026-10-27) : « je ne veux pas avoir à confirmer, je veux que ça se lance tout seul ».
   * Le dépôt par l’outil de l’agent lance le plan : pas de clic « Lancer le plan ».
   */
  it('l’outil dépose ET lance : les premiers lots partent sans clic, une seule fois', async () => {
    const b = banc()
    const r = (await b.coord.outil('conv-1', { plan: plan4 })) as {
      plan: { id: string; statut: string }
      detail: string
    }
    expect(r.plan.statut).toBe('en cours')
    expect(r.detail).toMatch(/LANCÉ/)
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101'])
    // Le même plan redéposé ne relance rien.
    await b.coord.outil('conv-1', { plan: plan4 })
    expect(b.lancements).toHaveLength(2)
    expect(b.coord.plans()).toHaveLength(1)
  })

  it('refus de lecture : rien n’est enregistré', () => {
    const b = banc()
    const r = b.coord.deposer('conv-1', { lots: [] })
    expect(r.ok).toBe(false)
    expect(b.coord.plans()).toEqual([])
  })

  it('le même plan déposé deux fois rend le même plan ; un double clic ne crée pas un second jeu de fils', async () => {
    const b = banc()
    const a = b.coord.deposer('conv-1', plan4)
    const c = b.coord.deposer('conv-1', plan4)
    expect(a.ok && c.ok && a.plan.id === c.plan.id).toBe(true)
    if (!a.ok) return
    await Promise.all([
      b.coord.accepter('conv-1', a.plan.id),
      b.coord.accepter('conv-1', a.plan.id)
    ])
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101'])
    expect(b.coord.plans()).toHaveLength(1)
  })

  it('accepter depuis un autre fil que le chef : refusé', async () => {
    const b = banc()
    const a = b.coord.deposer('conv-1', plan4)
    if (!a.ok) throw new Error('dépôt refusé')
    const r = await b.coord.accepter('conv-2', a.plan.id)
    expect(r.ok).toBe(false)
    expect(b.lancements).toEqual([])
  })
})

describe('CoordinateurDesPlans — 4 lots, 2 en parallèle', () => {
  async function demarre(): Promise<Banc & { planId: string }> {
    const b = banc()
    const a = b.coord.deposer('conv-1', plan4)
    if (!a.ok) throw new Error(a.erreur)
    await b.coord.accepter('conv-1', a.plan.id)
    return { ...b, planId: a.plan.id }
  }

  it('l’accord crée 2 fils et y lance la demande de chaque lot, demande en tête', async () => {
    const b = await demarre()
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101'])
    expect(b.lancements[0].prompt.startsWith('/build traduis le groupe 1')).toBe(true)
    expect(b.lancements[1].prompt).toMatch(/Lot 2 sur 4 du plan « Traduction »/)
  })

  it('une fin d’enfant : le 3e lot part, un compte rendu va de l’enfant au chef, le chef est réveillé', async () => {
    const b = await demarre()
    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      tour: 'tour-conv-100-1',
      texte: 'Groupe 1 traduit. npx vitest run → code 0.'
    })
    const fils = b.lancements.map((l) => l.fil)
    expect(fils).toEqual(['conv-100', 'conv-101', 'conv-102', 'conv-1'])
    const messages = b.journal()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ a: 'conv-1', de: { fil: 'conv-100' } })
    expect(String(messages[0].texte)).toMatch(/Lot 1\/4 « Écrans 1 » : fait dans conv-100/)
    expect(String(messages[0].texte)).toMatch(/code 0/)
    expect(b.lancements[3].prompt).toMatch(/message de l’app, pas de l’utilisateur/)
    const plan = b.coord.plans()[0]
    expect(plan.lots.map((l) => l.etat)).toEqual(['fait', 'en-cours', 'en-cours', 'a-faire'])
  })

  it('fin en double, ou fin d’un fil hors plan : aucun effet', async () => {
    const b = await demarre()
    await b.coord.surFinDeTour('conv-100', { ok: true })
    const apres = b.lancements.length
    await b.coord.surFinDeTour('conv-100', { ok: true })
    await b.coord.surFinDeTour('conv-777', { ok: true })
    expect(b.lancements).toHaveLength(apres)
    expect(b.journal()).toHaveLength(1)
  })

  it('chef occupé : le compte rendu attend, puis le chef est réveillé UNE seule fois à la fin de son tour', async () => {
    const b = await demarre()
    b.actifs.add('conv-1')
    await b.coord.surFinDeTour('conv-100', { ok: true })
    await b.coord.surFinDeTour('conv-101', { ok: false, erreur: 'tests rouges' })
    const reveils = (): number => b.lancements.filter((l) => l.fil === 'conv-1').length
    expect(reveils()).toBe(0)
    expect(b.journal()).toHaveLength(2)
    b.actifs.delete('conv-1')
    await b.coord.surFinDeTour('conv-1', { ok: true })
    expect(reveils()).toBe(1)
    const reveil = b.lancements.filter((l) => l.fil === 'conv-1')[0].prompt
    expect(reveil).toMatch(/lot 1 « Écrans 1 » : fait/)
    expect(reveil).toMatch(/lot 2 « Écrans 2 » : échec \(tests rouges\)/)
    // La fin du tour de réveil ne relance rien de plus.
    await b.coord.surFinDeTour('conv-1', { ok: true })
    expect(reveils()).toBe(1)
  })

  it('pendant un réveil, une autre fin de lot attend la fin de ce tour au lieu d’en lancer un second', async () => {
    const b = await demarre()
    await b.coord.surFinDeTour('conv-100', { ok: true })
    await b.coord.surFinDeTour('conv-101', { ok: true })
    expect(b.lancements.filter((l) => l.fil === 'conv-1')).toHaveLength(1)
    await b.coord.surFinDeTour('conv-1', { ok: true })
    expect(b.lancements.filter((l) => l.fil === 'conv-1')).toHaveLength(2)
  })

  it('limite de quota : plus aucun lot ne part, le chef est prévenu, rien ne reprend seul', async () => {
    const b = await demarre()
    await b.coord.surFinDeTour('conv-100', {
      ok: false,
      erreur: "You've hit your session limit · resets 2am"
    })
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101', 'conv-1'])
    expect(b.coord.plans()[0].statut).toBe('suspendu-quota')
    await b.coord.surFinDeTour('conv-101', { ok: true })
    expect(b.lancements.filter((l) => l.fil.startsWith('conv-10'))).toHaveLength(2)
    // L'agent du chef ne peut pas relancer après le quota ; l'utilisateur, si.
    await expect(b.coord.outil('conv-1', { action: 'relancer', lot: 1 })).rejects.toThrow(
      /limite de quota/
    )
    const repris = await b.coord.reprendre('conv-1', b.planId)
    expect(repris.ok).toBe(true)
    expect(b.lancements.map((l) => l.fil)).toContain('conv-102')
  })

  it('un lancement refusé compte comme un lot en échec, et le suivant part', async () => {
    let n = 0
    const b = banc({
      lancer: async (fil) => {
        n++
        return n === 1
          ? { ok: false, error: 'conversation introuvable' }
          : { ok: true, turnId: `t-${fil}` }
      }
    })
    const a = b.coord.deposer('conv-1', plan4)
    if (!a.ok) throw new Error(a.erreur)
    await b.coord.accepter('conv-1', a.plan.id)
    const plan = b.coord.plans()[0]
    expect(plan.lots[0]).toMatchObject({ etat: 'echec' })
    expect(plan.lots[0].raison).toMatch(/lancement refusé : conversation introuvable/)
    expect(plan.lots.filter((l) => l.etat === 'en-cours')).toHaveLength(2)
  })

  it('fil chef supprimé : plus aucun lot ne part', async () => {
    const b = await demarre()
    b.fils.delete('conv-1')
    await b.coord.surFinDeTour('conv-100', { ok: true })
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101'])
    expect(b.coord.plans()[0].statut).toBe('arrete')
    expect(b.coord.plans()[0].raison).toMatch(/fil chef/)
  })

  it('tous les lots finis : plan terminé et dernier réveil du chef avec le bilan', async () => {
    const b = await demarre()
    for (const fil of ['conv-100', 'conv-101', 'conv-102', 'conv-103']) {
      await b.coord.surFinDeTour(fil, { ok: true })
      await b.coord.surFinDeTour('conv-1', { ok: true })
    }
    const plan = b.coord.plans()[0]
    expect(plan.statut).toBe('termine')
    const dernier = b.lancements.filter((l) => l.fil === 'conv-1').at(-1)?.prompt ?? ''
    expect(dernier).toMatch(/4 faits, 0 en échec, 0 en cours, 0 à faire sur 4/)
    expect(dernier).toMatch(/Statut du plan : terminé/)
  })
})

describe('CoordinateurDesPlans — outil du chat et redémarrage', () => {
  it('l’outil dépose, rend l’état et relance un lot en échec', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan4 })
    await b.coord.surFinDeTour('conv-100', { ok: false, erreur: 'build rouge' })
    const etat = (await b.coord.outil('conv-1', { action: 'etat' })) as { tableau: string }
    expect(etat.tableau).toMatch(/1\. Écrans 1 — échec \(build rouge\) — conv-100/)
    await b.coord.surFinDeTour('conv-1', { ok: true })
    await b.coord.outil('conv-1', { action: 'relancer', lot: 1 })
    // Deux lots tournent (2 et 3) : le lot relancé attend une place, il ne double pas le parallélisme.
    expect(b.coord.plans()[0].lots[0].etat).toBe('a-faire')
    await b.coord.surFinDeTour('conv-101', { ok: true })
    expect(b.coord.plans()[0].lots[0].etat).toBe('en-cours')
    // Relancé dans SON fil, pas dans un nouveau.
    expect(b.lancements.filter((l) => l.fil === 'conv-100')).toHaveLength(2)
  })

  it('action inconnue ou sans fil : refus lisible', async () => {
    const b = banc()
    await expect(b.coord.outil('conv-1', { action: 'detruire' })).rejects.toThrow(
      /deposer, etat, relancer/
    )
    await expect(b.coord.outil('', { plan: plan4 })).rejects.toThrow(/fil/)
  })

  it('redémarrage : le plan relu du disque a ses lots en cours interrompus, et rien ne repart seul', async () => {
    const b = banc()
    const a = b.coord.deposer('conv-1', plan4)
    if (!a.ok) throw new Error(a.erreur)
    await b.coord.accepter('conv-1', a.plan.id)
    const relu = banc({ contenu: b.stockage.contenu })
    const plan = relu.coord.plans()[0]
    expect(plan.statut).toBe('interrompu')
    expect(plan.lots.map((l) => l.etat)).toEqual(['interrompu', 'interrompu', 'a-faire', 'a-faire'])
    expect(relu.lancements).toEqual([])
  })

  /*
   * Agents qui ont SURVÉCU au redémarrage (objection du juge, conv-1150) : l'app reprend leur tour
   * (`reprendreAppelChat`, index.ts) et annonce leur fin avec `repris`. Ici, les lots 1 et 2
   * tournaient dans conv-100 et conv-101 au moment du redémarrage.
   */
  async function redemarre(): Promise<Banc & { planId: string }> {
    const b = banc()
    const a = b.coord.deposer('conv-1', plan4)
    if (!a.ok) throw new Error(a.erreur)
    await b.coord.accepter('conv-1', a.plan.id)
    const relu = banc({ contenu: b.stockage.contenu, premierFil: 102 })
    relu.fils.add('conv-100')
    relu.fils.add('conv-101')
    return { ...relu, planId: a.plan.id }
  }

  it('redémarrage : l’agent repris du lot 1 finit — lot noté, compte rendu au chef, réveil, rien ne repart seul', async () => {
    const r = await redemarre()
    await r.coord.surFinDeTour('conv-100', { ok: true, repris: true, texte: 'Groupe 1 traduit.' })
    const plan = r.coord.plans()[0]
    expect(plan.lots.map((l) => l.etat)).toEqual(['fait', 'interrompu', 'a-faire', 'a-faire'])
    expect(plan.statut).toBe('interrompu')
    expect(r.journal()).toHaveLength(1)
    expect(r.journal()[0]).toMatchObject({ a: 'conv-1', de: { fil: 'conv-100' } })
    expect(r.lancements.map((l) => l.fil)).toEqual(['conv-1'])
  })

  it('« Reprendre » pendant que l’agent repris du lot 2 tourne : aucun second agent dans son fil', async () => {
    const r = await redemarre()
    r.actifs.add('conv-101')
    const rep = await r.coord.reprendre('conv-1', r.planId)
    expect(rep.ok).toBe(true)
    expect(r.lancements.filter((l) => l.fil === 'conv-101')).toEqual([])
    // Lot 1 repart dans son fil libre ; le lot 2 est adopté (il garde sa place) : rien d'autre.
    expect(r.lancements.map((l) => l.fil)).toEqual(['conv-100'])
    expect(r.coord.plans()[0].lots.map((l) => l.etat)).toEqual([
      'en-cours',
      'en-cours',
      'a-faire',
      'a-faire'
    ])
    // Sa fin, une fois le fil relâché, note le lot 2 et lance le lot suivant.
    r.actifs.delete('conv-101')
    await r.coord.surFinDeTour('conv-101', { ok: true, repris: true })
    expect(r.coord.plans()[0].lots[1].etat).toBe('fait')
    expect(r.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-102', 'conv-1'])
  })

  it('jumeau : « Reprendre » avec des fils libres relance les lots interrompus dans LEUR fil', async () => {
    const r = await redemarre()
    await r.coord.reprendre('conv-1', r.planId)
    expect(r.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101'])
  })

  it('un lot relancé dont le fil est occupé attend la fin de ce tour, puis repart dans son fil', async () => {
    const b = banc()
    const a = b.coord.deposer('conv-1', { ...plan4, lots: plan4.lots.slice(0, 2) })
    if (!a.ok) throw new Error(a.erreur)
    await b.coord.accepter('conv-1', a.plan.id)
    await b.coord.surFinDeTour('conv-100', { ok: false, erreur: 'build rouge' })
    await b.coord.surFinDeTour('conv-101', { ok: true })
    await b.coord.surFinDeTour('conv-1', { ok: true })
    // Quelqu'un tape dans conv-100 pendant que le chef relance le lot 1.
    b.actifs.add('conv-100')
    const avant = b.lancements.length
    await b.coord.relancer('conv-1', 1)
    expect(b.lancements.slice(avant).filter((l) => l.fil === 'conv-100')).toEqual([])
    b.actifs.delete('conv-100')
    await b.coord.surFinDeTour('conv-100', { ok: true })
    expect(b.lancements.slice(avant).map((l) => l.fil)).toEqual(['conv-100'])
    expect(b.coord.plans()[0].lots[0].etat).toBe('en-cours')
  })

  /*
   * conv-1151, lot 3 : l'utilisateur relance au bouton du tableau, qui nomme le plan qu'il voit.
   * Même règle que l'agent : le lot repart dans SON fil et compte un tour du plafond.
   */
  it('relance par l’utilisateur (plan nommé) : le lot repart dans son fil et compte un tour', async () => {
    const b = banc()
    const a = b.coord.deposer('conv-1', { ...plan4, lots: plan4.lots.slice(0, 2) })
    if (!a.ok) throw new Error(a.erreur)
    await b.coord.accepter('conv-1', a.plan.id)
    await b.coord.surFinDeTour('conv-100', { ok: false, erreur: 'build rouge' })
    await b.coord.surFinDeTour('conv-101', { ok: true })
    await b.coord.surFinDeTour('conv-1', { ok: true })
    const avant = b.coord.plans()[0]
    expect(avant.statut).toBe('termine')
    const r = await b.coord.relancer('conv-1', 1, a.plan.id)
    expect(r.ok).toBe(true)
    const apres = b.coord.plans()[0]
    expect(apres.lots[0]).toMatchObject({ etat: 'en-cours', fil: 'conv-100' })
    expect(apres.toursLances).toBe(avant.toursLances + 1)
    expect(apres.statut).toBe('en-cours')
    expect(b.lancements.filter((l) => l.fil === 'conv-100')).toHaveLength(2)
  })

  it('relance par l’utilisateur refusée : plan d’un autre fil, ou plafond de tours épuisé', async () => {
    const b = banc()
    const a = b.coord.deposer('conv-1', {
      ...plan4,
      plafondTours: 2,
      lots: plan4.lots.slice(0, 2)
    })
    if (!a.ok) throw new Error(a.erreur)
    await b.coord.accepter('conv-1', a.plan.id)
    await b.coord.surFinDeTour('conv-100', { ok: false, erreur: 'build rouge' })
    await b.coord.surFinDeTour('conv-101', { ok: true })
    // Un tableau périmé ou un autre fil ne relance pas le lot d'un plan qui n'est pas le sien.
    const ailleurs = await b.coord.relancer('conv-2', 1, a.plan.id)
    expect(ailleurs).toMatchObject({ ok: false, erreur: expect.stringMatching(/inconnu/) })
    const epuise = await b.coord.relancer('conv-1', 1, a.plan.id)
    expect(epuise).toMatchObject({ ok: false, erreur: expect.stringMatching(/plafond de 2 tours/) })
    const lancesAvant = b.lancements.filter((l) => l.fil === 'conv-100')
    expect(lancesAvant).toHaveLength(1)
    expect(b.coord.plans()[0].lots[0].etat).toBe('echec')
  })

  it('un fichier de plans illisible ne bloque pas le démarrage', () => {
    const b = banc({ contenu: '{pas du json' })
    expect(b.coord.plans()).toEqual([])
  })
})

/*
 * conv-1284 (2026-10-29) — les gestes repris des threads de claude.exe, au niveau du coordinateur :
 * un lot ne lance pas de plan (claude.exe refuse qu'une session lancée par une autre en démarre
 * une), une décision notée par un lot atteint les lots suivants, le chef ajoute des lots à son plan
 * lancé, et le modèle d'un lot part avec son tour.
 */
describe('CoordinateurDesPlans — décisions, ajouts, modèle et garde des lots (conv-1284)', () => {
  const plan2 = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    titre: 'Chantier',
    parallele: 1,
    lots: [
      { titre: 'Cœur', demande: '/build le cœur', fichiers: ['src/coeur.ts'] },
      { titre: 'Écran', demande: '/build l’écran', fichiers: ['src/ecran.tsx'] }
    ],
    ...extra
  })

  it('le fil d’un lot ne dépose pas de plan tant que le sien vit ; le chef le peut après la fin', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan2() })
    const r = b.coord.deposer('conv-100', plan4)
    expect(r).toMatchObject({
      ok: false,
      erreur: expect.stringMatching(
        /lot 1 du plan plan-p1 \(chef conv-1\).*un lot ne lance pas de plan/
      )
    })
    await expect(b.coord.outil('conv-100', { plan: plan4 })).rejects.toThrow(/un lot ne lance pas/)
    // Jumeau : plan fini, le fil redevient libre de mener un chantier à lui.
    await b.coord.surFinDeTour('conv-100', { ok: true })
    await b.coord.surFinDeTour('conv-101', { ok: true })
    expect(b.coord.plans()[0].statut).toBe('termine')
    expect(b.coord.deposer('conv-100', plan4).ok).toBe(true)
  })

  it('une décision notée par un lot part dans le message du lot suivant et dans le réveil du chef', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan2() })
    const note = (await b.coord.outil('conv-100', {
      action: 'noter',
      decision: 'le module s’appelle carte-du-plan.ts'
    })) as { detail: string }
    expect(note.detail).toMatch(/décision notée \(lot 1\)/)
    expect(b.coord.plans()[0].decisions).toEqual([
      { texte: 'le module s’appelle carte-du-plan.ts', de: 'lot 1', le: expect.any(Number) }
    ])
    await b.coord.surFinDeTour('conv-100', { ok: true })
    const suivant = b.lancements.find((l) => l.fil === 'conv-101')
    expect(suivant?.prompt).toContain('- le module s’appelle carte-du-plan.ts (lot 1)')
    const reveil = b.lancements.find((l) => l.fil === 'conv-1')
    expect(reveil?.prompt).toContain(
      'Décisions notées par les lots : « le module s’appelle carte-du-plan.ts » (lot 1).'
    )
    // Un fil hors de tout plan n'a rien où noter.
    await expect(b.coord.outil('conv-9', { action: 'noter', decision: 'x' })).rejects.toThrow(
      /aucun plan dans ce fil/
    )
  })

  it('le chef ajoute des lots à son plan lancé ; un lot ne le peut pas', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan2({ parallele: 2 }) })
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101'])
    await expect(
      b.coord.outil('conv-100', { action: 'ajouter', plan: { lots: [{ demande: 'x' }] } })
    ).rejects.toThrow(/seul le fil chef/)
    const r = (await b.coord.outil('conv-1', {
      action: 'ajouter',
      plan: JSON.stringify({
        lots: [
          { titre: 'Tests', demande: '/build les tests', fichiers: ['src/x.test.ts'], apres: [1] }
        ]
      })
    })) as { detail: string }
    expect(r.detail).toMatch(/1 lot ajouté \(rang 3\), plafond porté à 6 tours/)
    const plan = b.coord.plans()[0]
    expect(plan.lots[2]).toMatchObject({ rang: 3, etat: 'a-faire', apres: [1] })
    // Il attend le lot 1 : il part dès sa fin, sans geste du chef.
    await b.coord.surFinDeTour('conv-100', { ok: true })
    expect(
      b.lancements.some((l) => l.fil === 'conv-102' && l.prompt.startsWith('/build les tests'))
    ).toBe(true)
  })

  it('le modèle d’un lot part avec son tour ; un lot sans modèle n’en impose aucun', async () => {
    const appels: Array<{ fil: string; modele?: string; args: number }> = []
    const b = banc({
      lancer: async (...args) => {
        appels.push({ fil: args[0], modele: args[2], args: args.length })
        return { ok: true, turnId: `t-${args[0]}` }
      }
    })
    const avecModele = plan2({ parallele: 2 })
    ;(avecModele.lots as Array<Record<string, unknown>>)[1].modele = 'haiku'
    await b.coord.outil('conv-1', { plan: avecModele })
    expect(appels).toEqual([
      { fil: 'conv-100', modele: undefined, args: 2 },
      { fil: 'conv-101', modele: 'haiku', args: 3 }
    ])
  })

  /*
   * conv-1284 (2026-10-29, demande de l'utilisateur) : une décision notée part AUSSI par message aux
   * lots déjà en cours — avant, seuls les lots partis ensuite la recevaient.
   */
  it('une décision notée part par message aux lots EN COURS : ni à son auteur, ni aux lots finis', async () => {
    const b = banc()
    const plan3 = plan2({ parallele: 3 })
    ;(plan3.lots as unknown[]).push({
      titre: 'Tests',
      demande: '/build les tests',
      fichiers: ['src/t.test.ts']
    })
    await b.coord.outil('conv-1', { plan: plan3 })
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-101', 'conv-102'])
    await b.coord.surFinDeTour('conv-100', { ok: true })
    const avant = b.journal().length
    // Le lot 2 note : seul le lot 3, encore en cours, est prévenu — pas le lot 1 (fini) ni le lot 2 lui-même.
    const parLot = (await b.coord.outil('conv-101', {
      action: 'noter',
      decision: 'les états restent en français côté moteur'
    })) as { detail: string }
    const duLot = b.journal().slice(avant)
    expect(duLot.map((m) => [(m.de as { fil: string }).fil, m.a])).toEqual([
      ['conv-101', 'conv-102']
    ])
    expect(String(duLot[0].texte)).toMatch(
      /^Décision notée dans le plan « Chantier » \(plan-p1\) par lot 2 : les états restent en français côté moteur\n/
    )
    expect(parLot.detail).toMatch(/envoyée aux lots en cours : conv-102/)
    // Le chef note : les deux lots en cours sont prévenus, de la part du chef.
    const parChef = (await b.coord.outil('conv-1', {
      action: 'noter',
      decision: 'en anglais, « lot » se dit « batch »'
    })) as { detail: string }
    const duChef = b.journal().slice(avant + 1)
    expect(duChef.map((m) => [(m.de as { fil: string }).fil, m.a])).toEqual([
      ['conv-1', 'conv-101'],
      ['conv-1', 'conv-102']
    ])
    expect(parChef.detail).toMatch(/envoyée aux lots en cours : conv-101, conv-102/)
    // La même décision notée deux fois ne repart pas.
    await b.coord.outil('conv-1', {
      action: 'noter',
      decision: 'en anglais, « lot » se dit « batch »'
    })
    expect(b.journal().length).toBe(avant + 3)
  })

  it('aucun lot en cours : la décision est notée sans message, le détail le dit', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan2() })
    await b.coord.surFinDeTour('conv-100', { ok: true })
    await b.coord.surFinDeTour('conv-101', { ok: true })
    const avant = b.journal().length
    const r = (await b.coord.outil('conv-1', { action: 'noter', decision: 'x vaut y' })) as {
      detail: string
    }
    expect(b.journal().length).toBe(avant)
    expect(r.detail).toMatch(/aucun lot en cours à prévenir/)
  })

  /*
   * conv-1284 (2026-10-29, demande de l'utilisateur) : la réponse du chef à un lot bloqué part en
   * ORDRE et relance elle-même le fil du lot ; le coordinateur le suit comme une relance.
   */
  const bloque = async (b: Banc): Promise<void> => {
    await b.coord.outil('conv-1', { plan: plan2() })
    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      texte: 'Il me manque le nom du module.\n\n⛔ Bloqué : j’attends la réponse du chef'
    })
  }
  const ordre =
    'Ordre de conv-1 (message msg-1, écrit par l’agent de ce fil) :\n\nle module s’appelle carte.ts'

  it('l’ordre du chef relance le lot bloqué dans SON fil : en cours, un tour compté, sa fin notée', async () => {
    const b = banc()
    await bloque(b)
    const avantOrdre = b.coord.plans()[0]
    expect(avantOrdre.lots[0]).toMatchObject({ etat: 'attend-chef', fil: 'conv-100' })
    const lances: Array<{ fil: string; prompt: string }> = []
    const r = await b.coord.lancerParOrdre('conv-1', 'conv-100', ordre, async (fil, prompt) => {
      lances.push({ fil, prompt })
      return { ok: true, turnId: 'tour-ordre' }
    })
    expect(r).toEqual({ ok: true, turnId: 'tour-ordre' })
    expect(lances).toHaveLength(1)
    expect(lances[0].fil).toBe('conv-100')
    expect(lances[0].prompt.startsWith(ordre)).toBe(true)
    expect(lances[0].prompt).toMatch(/Ce fil fait le lot 1 sur 2 du plan « Chantier »/)
    expect(lances[0].prompt).toMatch(/inutile de lui écrire en plus/)
    const pendant = b.coord.plans()[0]
    expect(pendant.lots[0]).toMatchObject({ etat: 'en-cours', fil: 'conv-100', tour: 'tour-ordre' })
    expect(pendant.toursLances).toBe(avantOrdre.toursLances + 1)
    // Aucun second tour : l'app n'a pas relancé le lot elle-même.
    expect(b.lancements.filter((l) => l.fil === 'conv-100')).toHaveLength(1)
    const avant = b.journal().length
    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      tour: 'tour-ordre',
      texte: 'Fait : carte.ts créé.'
    })
    expect(b.coord.plans()[0].lots[0].etat).toBe('fait')
    const cr = b.journal().slice(avant)
    expect(cr.map((m) => [(m.de as { fil: string }).fil, m.a])).toEqual([['conv-100', 'conv-1']])
    expect(String(cr[0].texte)).toMatch(/^Lot 1\/2 « Cœur » : fait dans conv-100/)
  })

  /*
   * conv-1284 (2026-10-29, demande de l'utilisateur) : « attend le chef » est un état à part — le
   * tableau, le compte rendu et le réveil du chef le disent, et le plan ne se clôt pas sans réponse.
   */
  it('un lot qui pose sa question au chef « attend le chef » : compte rendu, réveil, plan ouvert', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan2({ parallele: 2 }) })
    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      texte: 'Quel nom pour le module ?\n\n⛔ Bloqué : j’attends la réponse du chef'
    })
    const plan = b.coord.plans()[0]
    expect(plan.lots[0]).toMatchObject({ etat: 'attend-chef', fil: 'conv-100' })
    const cr = b.journal().at(-1)
    expect(String(cr?.texte)).toMatch(
      /^Lot 1\/2 « Cœur » : attend le chef dans conv-100 \(question posée au chef/
    )
    const reveil = b.lancements.filter((l) => l.fil === 'conv-1').at(-1)
    expect(reveil?.prompt).toMatch(/lot 1 « Cœur » : attend le chef/)
    expect(reveil?.prompt).toMatch(/un lot qui attend ta réponse \(état « attend le chef »\)/)
    // L'autre lot finit : le plan reste ouvert, il attend la réponse du chef.
    await b.coord.surFinDeTour('conv-101', { ok: true })
    expect(b.coord.plans()[0]).toMatchObject({
      statut: 'en-cours',
      raison: expect.stringMatching(/le lot 1 attend la réponse du chef/)
    })
    // Le relu du disque garde l'état (un état inconnu ferait sauter tout le plan).
    expect(banc({ contenu: b.stockage.contenu }).coord.plans()[0].lots[0].etat).toBe('attend-chef')
  })

  it('l’ordre du chef relance le lot avec SON modèle (pas celui du fil par défaut)', async () => {
    const b = banc()
    const avecModele = plan2()
    ;(avecModele.lots as Array<Record<string, unknown>>)[0].modele = 'sonnet'
    await b.coord.outil('conv-1', { plan: avecModele })
    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      texte: '⛔ Bloqué : j’attends la réponse du chef'
    })
    const appels: Array<{ fil: string; modele?: string }> = []
    await b.coord.lancerParOrdre('conv-1', 'conv-100', ordre, async (fil, _prompt, modele) => {
      appels.push({ fil, modele })
      return { ok: true }
    })
    expect(appels).toEqual([{ fil: 'conv-100', modele: 'sonnet' }])
  })

  it('jumeaux : ordre d’un autre fil, ou vers un lot qui n’est pas en échec — lancement inchangé, plan intact', async () => {
    const b = banc()
    await bloque(b)
    const plan = b.coord.plans()[0]
    const lances: string[] = []
    const lancer = async (_fil: string, prompt: string): Promise<{ ok: boolean }> => {
      lances.push(prompt)
      return { ok: true }
    }
    await b.coord.lancerParOrdre('conv-9', 'conv-100', ordre, lancer)
    await b.coord.lancerParOrdre('conv-1', 'conv-101', ordre, lancer)
    expect(lances).toEqual([ordre, ordre])
    expect(b.coord.plans()[0]).toEqual(plan)
  })

  it('plafond de tours épuisé : l’ordre ne relance pas le lot, la raison remonte', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan2({ plafondTours: 2 }) })
    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      texte: '⛔ Bloqué : j’attends la réponse du chef'
    })
    expect(b.coord.plans()[0].toursLances).toBe(2)
    let appele = false
    const r = await b.coord.lancerParOrdre('conv-1', 'conv-100', ordre, async () => {
      appele = true
      return { ok: true }
    })
    expect(appele).toBe(false)
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/lot 1 .*plafond de 2 tours atteint/)
    })
    expect(b.coord.plans()[0].lots[0].etat).toBe('attend-chef')
  })

  /*
   * conv-1284 (2026-10-29, demande de l'utilisateur) : une relance compte un tour AVANT de lancer
   * (la place est réservée). Si le tour ne démarre pas, ce tour n'a rien coûté : il est rendu au
   * plafond, que la relance vienne du chef, de l'utilisateur ou d'un ordre.
   */
  const bancARefus = (): { b: Banc; refuser: (oui: boolean) => void } => {
    let refus = false
    const b = banc({
      lancer: async (fil) =>
        refus ? { ok: false, error: 'conversation introuvable' } : { ok: true, turnId: `t-${fil}` }
    })
    return { b, refuser: (oui) => (refus = oui) }
  }
  const enEchec = async (b: Banc): Promise<number> => {
    await b.coord.outil('conv-1', { plan: plan2({ parallele: 2 }) })
    await b.coord.surFinDeTour('conv-100', { ok: false, erreur: 'build rouge' })
    expect(b.coord.plans()[0].lots[0].etat).toBe('echec')
    return b.coord.plans()[0].toursLances
  }

  it('relance du chef qui ne démarre pas : lot en échec, tour rendu au plafond', async () => {
    const { b, refuser } = bancARefus()
    const tours = await enEchec(b)
    refuser(true)
    await b.coord.outil('conv-1', { action: 'relancer', lot: 1 })
    const plan = b.coord.plans()[0]
    expect(plan.lots[0]).toMatchObject({ etat: 'echec' })
    expect(plan.lots[0].raison).toMatch(/lancement refusé : conversation introuvable/)
    expect(plan.toursLances).toBe(tours)
    // Jumeau : la relance qui démarre garde son tour.
    refuser(false)
    await b.coord.outil('conv-1', { action: 'relancer', lot: 1 })
    expect(b.coord.plans()[0].lots[0].etat).toBe('en-cours')
    expect(b.coord.plans()[0].toursLances).toBe(tours + 1)
  })

  it('relance de l’utilisateur (bouton du tableau) qui ne démarre pas : tour rendu', async () => {
    const { b, refuser } = bancARefus()
    const tours = await enEchec(b)
    refuser(true)
    const r = await b.coord.relancer('conv-1', 1, b.coord.plans()[0].id)
    expect(r.ok).toBe(true)
    expect(b.coord.plans()[0].lots[0].etat).toBe('echec')
    expect(b.coord.plans()[0].toursLances).toBe(tours)
  })

  it('ordre du chef dont le tour ne démarre pas : lot en échec, tour rendu', async () => {
    const { b } = bancARefus()
    const tours = await enEchec(b)
    const r = await b.coord.lancerParOrdre(
      'conv-1',
      'conv-100',
      'Ordre de conv-1 : vas-y',
      async () => ({
        ok: false,
        error: 'session introuvable'
      })
    )
    expect(r.ok).toBe(false)
    const plan = b.coord.plans()[0]
    expect(plan.lots[0].etat).toBe('echec')
    expect(plan.lots[0].raison).toMatch(
      /réveil par l’ordre du chef non lancé : session introuvable/
    )
    expect(plan.toursLances).toBe(tours)
  })

  it('le premier lancement d’un lot qui ne démarre pas ne compte pas non plus de tour', async () => {
    const { b, refuser } = bancARefus()
    refuser(true)
    await b.coord.outil('conv-1', { plan: plan2() })
    const plan = b.coord.plans()[0]
    expect(plan.lots.map((l) => l.etat)).toEqual(['echec', 'echec'])
    expect(plan.toursLances).toBe(0)
  })

  it('le contexte et les décisions survivent au disque ; une décision abîmée est sautée', async () => {
    const b = banc()
    await b.coord.outil('conv-1', {
      plan: plan2({
        contexte:
          'Refondre le tableau des lots. Décidé : aucune couleur en dur, les textes passent par textes-ecrans.'
      })
    })
    await b.coord.outil('conv-1', { action: 'noter', decision: 'on garde le nom TableauDesLots' })
    const disque = JSON.parse(b.stockage.contenu) as { plans: Array<Record<string, unknown>> }
    ;(disque.plans[0].decisions as unknown[]).push({ texte: 42 })
    const relu = banc({ contenu: JSON.stringify(disque) })
    const plan = relu.coord.plans()[0]
    expect(plan.contexte).toMatch(/^Refondre le tableau des lots/)
    expect(plan.decisions).toEqual([
      { texte: 'on garde le nom TableauDesLots', de: 'chef', le: expect.any(Number) }
    ])
  })
})
