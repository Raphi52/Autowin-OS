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
  it('déposer ne lance RIEN : le plan attend le clic de l’utilisateur', () => {
    const b = banc()
    const r = b.coord.deposer('conv-1', plan4)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.statut).toBe('attente-accord')
      expect(r.detail).toMatch(/RIEN N’EST LANCÉ/)
    }
    expect(b.lancements).toEqual([])
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
    const dep = (await b.coord.outil('conv-1', { plan: plan4 })) as { plan: { id: string } }
    await b.coord.accepter('conv-1', dep.plan.id)
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
