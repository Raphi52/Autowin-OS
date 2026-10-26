import { describe, expect, it } from 'vitest'
import {
  DEMANDE_MAX,
  LOTS_MAX,
  PARALLELE_MAX,
  bilanDuPlan,
  compteRenduDuLot,
  creerPlan,
  decisionDeDepot,
  interrompreAuDemarrage,
  lirePlanDeLots,
  lotsAPartir,
  marquerLance,
  noterFinDeTour,
  promptDeReveil,
  promptDuLot,
  relancerLot,
  reprendrePlan,
  statutApresLancements,
  type PlanDeLots
} from './plan-de-lots'

/*
 * SUPER CONVERSATION (conv-1150, 2026-10-26) — le plan de lots d'un fil chef, calcul pur.
 * Cas limites du cadrage : vide, un seul lot, mal typé, hors bornes, répété, fichiers partagés,
 * fin en double, fin hors plan, quota, plafond, redémarrage.
 *
 * fix-ok: conv-1150 (2026-10-26) — les ajouts au bloc « redémarrage » suivent des causes mesurées
 * dans plan-de-lots.ts, rouge puis vert : `noterFinDeTour` refusait la fin d'un lot `interrompu`
 * (garde `etat !== 'en-cours'`), `lotsAPartir`/`reprendrePlan` ignoraient un fil encore occupé
 * (5 rouges), et un agent mort avec l'app comptait comme une fin (2 rouges, d'où `perdu`).
 */

const lot = (n: number, fichiers: string[] = [`src/ecran-${n}.tsx`]): Record<string, unknown> => ({
  titre: `Lot ${n}`,
  demande: `/build traduis l'écran ${n}`,
  fichiers
})

function lu(brut: unknown): Extract<ReturnType<typeof lirePlanDeLots>, { ok: true }> {
  const r = lirePlanDeLots(brut)
  if (!r.ok) throw new Error(`lecture refusée : ${r.erreur}`)
  return r
}

function planAccepte(brut: unknown): PlanDeLots {
  const plan = creerPlan(lu(brut).plan, { id: 'plan-1', chef: 'conv-1', maintenant: 1000 })
  return { ...plan, statut: 'en-cours' }
}

/** Lance tout ce qui peut partir, avec des fils `conv-1xx` numérotés par rang. */
function lancerCeQuiPart(plan: PlanDeLots): PlanDeLots {
  let p = plan
  for (const rang of lotsAPartir(p)) p = marquerLance(p, rang, `conv-1${rang}0`, 2000)
  return p
}

describe('lirePlanDeLots — lecture stricte du plan déposé par le chef', () => {
  it('nominal : 4 lots, parallélisme 2, plafond par défaut de 2 tours par lot', () => {
    const r = lu({ titre: 'Traduction', parallele: 2, lots: [lot(1), lot(2), lot(3), lot(4)] })
    expect(r.plan.lots).toHaveLength(4)
    expect(r.plan.parallele).toBe(2)
    expect(r.plan.plafondTours).toBe(8)
    expect(r.avertissements).toEqual([])
  })

  it('accepte un plan écrit en JSON texte (arguments d’outil sérialisés)', () => {
    expect(lu(JSON.stringify({ lots: [lot(1), lot(2)] })).plan.lots).toHaveLength(2)
  })

  it.each([
    [undefined, /plan absent/],
    [null, /plan absent/],
    ['{pas du json', /JSON illisible/],
    [{}, /lots/],
    [{ lots: 'trois lots' }, /lots : liste attendue/],
    [{ lots: [] }, /plan vide/]
  ])('refuse un plan absent, vide ou illisible (%j)', (brut, motif) => {
    const r = lirePlanDeLots(brut)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(motif)
  })

  it('refuse un seul lot : pas besoin de chef', () => {
    const r = lirePlanDeLots({ lots: [lot(1)] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(/un seul lot/)
  })

  it.each([
    [{ lots: [lot(1), 'lot deux'] }, /lot 2 : objet attendu/],
    [{ lots: [lot(1), { titre: 'sans demande' }] }, /lot 2 : demande vide/],
    [{ lots: [lot(1), { demande: '   ' }] }, /lot 2 : demande vide/],
    [{ lots: [lot(1), { demande: 42 }] }, /lot 2 : demande vide/],
    [{ lots: [lot(1), { demande: 'ok', titre: 7 }] }, /lot 2 : titre/],
    [{ lots: [lot(1), { demande: 'ok', fichiers: 'a.ts' }] }, /lot 2 : fichiers/],
    [{ lots: [lot(1), { demande: 'ok', fichiers: ['a.ts', 3] }] }, /lot 2 : fichiers/]
  ])('refuse un lot mal typé en nommant le lot et le champ (%j)', (brut, motif) => {
    const r = lirePlanDeLots(brut)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(motif)
  })

  it.each([0, -1, 1.5, 'deux', Number.NaN])('refuse un parallélisme hors bornes (%j)', (p) => {
    const r = lirePlanDeLots({ parallele: p, lots: [lot(1), lot(2)] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(/parallélisme/)
  })

  it(`ramène un parallélisme trop grand à ${PARALLELE_MAX}, et le dit`, () => {
    const r = lu({ parallele: 8, lots: [lot(1), lot(2), lot(3), lot(4)] })
    expect(r.plan.parallele).toBe(PARALLELE_MAX)
    expect(r.avertissements.join(' ')).toMatch(/ramené à 3/)
  })

  it(`refuse plus de ${LOTS_MAX} lots ; accepte exactement ${LOTS_MAX}`, () => {
    const trop = Array.from({ length: LOTS_MAX + 1 }, (_, i) => lot(i + 1))
    const r = lirePlanDeLots({ lots: trop })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(/20 lots au plus/)
    expect(lu({ lots: trop.slice(0, LOTS_MAX) }).plan.lots).toHaveLength(LOTS_MAX)
  })

  it(`refuse une demande de plus de ${DEMANDE_MAX} caractères ; accepte la borne`, () => {
    const longue = { demande: 'x'.repeat(DEMANDE_MAX + 1) }
    const r = lirePlanDeLots({ lots: [lot(1), longue] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(/lot 2 : demande de 4001 caractères/)
    expect(lu({ lots: [lot(1), { demande: 'x'.repeat(DEMANDE_MAX) }] }).plan.lots).toHaveLength(2)
  })

  it.each([0, -3, 2.5])('refuse un plafond de tours hors bornes (%j)', (plafond) => {
    const r = lirePlanDeLots({ plafondTours: plafond, lots: [lot(1), lot(2)] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(/plafond/)
  })

  it('refuse un plafond énorme (plus de 10 tours par lot) ; accepte la borne', () => {
    const r = lirePlanDeLots({ plafondTours: 21, lots: [lot(1), lot(2)] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(/10 par lot au plus/)
    expect(lu({ plafondTours: 20, lots: [lot(1), lot(2)] }).plan.plafondTours).toBe(20)
  })

  it('avertit quand le plafond ne couvre pas tous les lots', () => {
    const r = lu({ plafondTours: 2, lots: [lot(1), lot(2), lot(3)] })
    expect(r.plan.plafondTours).toBe(2)
    expect(r.avertissements.join(' ')).toMatch(/ne couvre que 2 lots sur 3/)
  })

  it('signale deux lots qui annoncent le même fichier (ils passeront l’un après l’autre)', () => {
    const r = lu({ lots: [lot(1, ['src/A.tsx']), lot(2, ['src\\a.tsx'])] })
    expect(r.avertissements.join(' ')).toMatch(/lots 1 et 2 .*même fichier/)
  })
})

describe('lotsAPartir — parallélisme, fichiers partagés et plafond', () => {
  it('ne lance jamais plus de lots que le parallélisme', () => {
    const p = lancerCeQuiPart(planAccepte({ parallele: 2, lots: [lot(1), lot(2), lot(3), lot(4)] }))
    expect(p.lots.filter((l) => l.etat === 'en-cours').map((l) => l.rang)).toEqual([1, 2])
    expect(lotsAPartir(p)).toEqual([])
  })

  it('jamais plus de 3 en cours, même avec 20 lots', () => {
    const lots = Array.from({ length: 20 }, (_, i) => lot(i + 1))
    const p = lancerCeQuiPart(planAccepte({ parallele: 9, lots }))
    expect(p.lots.filter((l) => l.etat === 'en-cours')).toHaveLength(3)
  })

  it('deux lots qui partagent un fichier ne tournent pas ensemble ; le suivant libre passe devant', () => {
    const p = lancerCeQuiPart(
      planAccepte({
        parallele: 3,
        lots: [lot(1, ['src/a.ts']), lot(2, ['./src/A.ts']), lot(3, ['src/c.ts'])]
      })
    )
    expect(p.lots.map((l) => l.etat)).toEqual(['en-cours', 'a-faire', 'en-cours'])
    // Fin du lot 1 : le lot 2 peut partir.
    const fin = noterFinDeTour(p, 'conv-110', { ok: true }, 3000)
    expect(lotsAPartir(fin.plan)).toEqual([2])
  })

  it('rien ne part tant que le plan n’est pas accepté', () => {
    const plan = creerPlan(lu({ lots: [lot(1), lot(2)] }).plan, {
      id: 'plan-1',
      chef: 'conv-1',
      maintenant: 1
    })
    expect(plan.statut).toBe('attente-accord')
    expect(lotsAPartir(plan)).toEqual([])
  })

  it('plafond atteint : plus aucun lot ne part, le plan s’arrête avec sa raison', () => {
    let p = lancerCeQuiPart(
      planAccepte({ parallele: 2, plafondTours: 2, lots: [lot(1), lot(2), lot(3)] })
    )
    expect(p.toursLances).toBe(2)
    p = noterFinDeTour(p, 'conv-110', { ok: true }, 3000).plan
    expect(lotsAPartir(p)).toEqual([])
    expect(p.statut).toBe('en-cours')
    p = noterFinDeTour(p, 'conv-120', { ok: true }, 3001).plan
    expect(p.statut).toBe('plafond-atteint')
    expect(p.raison).toMatch(/plafond de 2 tours atteint : 1 lot restant/)
  })
})

describe('noterFinDeTour — fin d’un fil enfant', () => {
  const deuxEnCours = (): PlanDeLots =>
    lancerCeQuiPart(planAccepte({ parallele: 2, lots: [lot(1), lot(2), lot(3), lot(4)] }))

  it('fin réussie : lot fait, et le lot suivant peut partir', () => {
    const r = noterFinDeTour(deuxEnCours(), 'conv-110', { ok: true, tour: 't1' }, 3000)
    expect(r.effet).toBe('note')
    expect(r.lot?.etat).toBe('fait')
    expect(lotsAPartir(r.plan)).toEqual([3])
  })

  it('fin en double : la seconde est ignorée', () => {
    const une = noterFinDeTour(deuxEnCours(), 'conv-110', { ok: true }, 3000)
    const deux = noterFinDeTour(une.plan, 'conv-110', { ok: true }, 3001)
    expect(deux.effet).toBe('deja-note')
    expect(deux.plan).toBe(une.plan)
  })

  it('fin d’un fil hors plan : ignorée, sans erreur', () => {
    const p = deuxEnCours()
    const r = noterFinDeTour(p, 'conv-999', { ok: true }, 3000)
    expect(r.effet).toBe('hors-plan')
    expect(r.plan).toBe(p)
  })

  it('fin d’un AUTRE tour du même fil que celui du lot : ignorée', () => {
    const p = { ...deuxEnCours() }
    p.lots = p.lots.map((l) => (l.rang === 1 ? { ...l, tour: 'tour-du-lot' } : l))
    expect(noterFinDeTour(p, 'conv-110', { ok: true, tour: 'autre-tour' }, 3000).effet).toBe(
      'autre-tour'
    )
  })

  it('échec : le lot passe en échec avec sa raison, n’est pas relancé, les autres continuent', () => {
    const r = noterFinDeTour(deuxEnCours(), 'conv-110', { ok: false, erreur: 'tests rouges' }, 3000)
    expect(r.lot?.etat).toBe('echec')
    expect(r.lot?.raison).toMatch(/tests rouges/)
    expect(r.plan.statut).toBe('en-cours')
    expect(lotsAPartir(r.plan)).toEqual([3])
  })

  it('tour arrêté : échec « tour arrêté »', () => {
    const r = noterFinDeTour(deuxEnCours(), 'conv-110', { ok: false, annule: true }, 3000)
    expect(r.lot?.raison).toMatch(/arrêté/)
  })

  it('limite de quota : plus AUCUN lot ne part, plan suspendu, sans reprise automatique', () => {
    const r = noterFinDeTour(
      deuxEnCours(),
      'conv-110',
      { ok: false, erreur: "You've hit your session limit · resets 2am" },
      3000
    )
    expect(r.lot?.etat).toBe('echec')
    expect(r.plan.statut).toBe('suspendu-quota')
    expect(lotsAPartir(r.plan)).toEqual([])
    // Le lot 2 encore en cours peut finir : il est noté, et rien ne repart pour autant.
    const suite = noterFinDeTour(r.plan, 'conv-120', { ok: true }, 3001)
    expect(suite.lot?.etat).toBe('fait')
    expect(lotsAPartir(suite.plan)).toEqual([])
    expect(suite.plan.statut).toBe('suspendu-quota')
  })

  it('tous les lots finis : plan terminé, bilan complet', () => {
    let p = lancerCeQuiPart(planAccepte({ parallele: 3, lots: [lot(1), lot(2), lot(3)] }))
    p = noterFinDeTour(p, 'conv-110', { ok: true }, 3000).plan
    p = noterFinDeTour(p, 'conv-120', { ok: false, erreur: 'build rouge' }, 3001).plan
    p = noterFinDeTour(p, 'conv-130', { ok: true }, 3002).plan
    expect(p.statut).toBe('termine')
    const b = bilanDuPlan(p)
    expect(b).toMatchObject({ total: 3, faits: 2, echecs: 1, enCours: 0, aFaire: 0 })
    expect(b.texte).toBe('2 faits, 1 en échec, 0 en cours, 0 à faire sur 3 — 3 tours sur 6')
  })
})

describe('décisions de dépôt, relance, reprise et redémarrage', () => {
  const lecture = (): ReturnType<typeof lu>['plan'] => lu({ lots: [lot(1), lot(2)] }).plan

  it('le même plan déposé deux fois rend le plan existant', () => {
    const p = creerPlan(lecture(), { id: 'plan-1', chef: 'conv-1', maintenant: 1 })
    const d = decisionDeDepot(
      [p],
      'conv-1',
      creerPlan(lecture(), { id: 'x', chef: 'conv-1', maintenant: 2 }).cle
    )
    expect(d).toEqual({ type: 'existant', plan: p })
  })

  it('un autre plan alors qu’un plan tourne dans ce fil : refus avec l’avancement', () => {
    const enCours = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2), lot(3)] }))
    const d = decisionDeDepot([enCours], 'conv-1', 'autre-cle')
    expect(d.type).toBe('refus')
    if (d.type === 'refus') expect(d.raison).toMatch(/un plan est déjà en cours \(0\/3 faits\)/)
  })

  it('un plan corrigé avant l’accord remplace le plan en attente ; un autre fil n’est pas concerné', () => {
    const attente = creerPlan(lecture(), { id: 'plan-1', chef: 'conv-1', maintenant: 1 })
    expect(decisionDeDepot([attente], 'conv-1', 'autre-cle')).toEqual({
      type: 'nouveau',
      remplace: 'plan-1'
    })
    expect(decisionDeDepot([attente], 'conv-2', attente.cle)).toEqual({ type: 'nouveau' })
  })

  it('redémarrage : lots en cours → interrompus, plan interrompu, rien ne repart seul', () => {
    const p = interrompreAuDemarrage(
      lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2), lot(3)] }))
    )
    expect(p.statut).toBe('interrompu')
    expect(p.lots.map((l) => l.etat)).toEqual(['interrompu', 'interrompu', 'interrompu'])
    expect(lotsAPartir(p)).toEqual([])
    // Reprise par l'utilisateur : les lots interrompus repartent, dans LEUR fil.
    const repris = reprendrePlan(p)
    expect(repris.ok).toBe(true)
    if (repris.ok) {
      expect(repris.plan.statut).toBe('en-cours')
      expect(lotsAPartir(repris.plan)).toEqual([1, 2, 3])
      expect(repris.plan.lots[0].fil).toBe('conv-110')
    }
  })

  it('relancer un lot en échec : accepté ; un lot fait ou un plan suspendu par le quota : refusé', () => {
    let p = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2), lot(3)] }))
    p = noterFinDeTour(p, 'conv-110', { ok: false, erreur: 'rouge' }, 3000).plan
    p = noterFinDeTour(p, 'conv-120', { ok: true }, 3001).plan
    const ok = relancerLot(p, 1)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(lotsAPartir(ok.plan)).toEqual([1])
    const fait = relancerLot(p, 2)
    expect(fait.ok).toBe(false)
    if (!fait.ok) expect(fait.erreur).toMatch(/lot 2 est fait/)
    expect(relancerLot(p, 9).ok).toBe(false)
    const quota = noterFinDeTour(
      p,
      'conv-130',
      { ok: false, erreur: 'session limit reached' },
      3002
    )
    const refus = relancerLot(quota.plan, 1)
    expect(refus.ok).toBe(false)
    if (!refus.ok) expect(refus.erreur).toMatch(/limite de quota/)
  })
})

/*
 * Un agent qui a SURVÉCU au redémarrage (objection du juge, conv-1150) : l'app reprend son tour
 * (`reprendreAppelChat`, index.ts). Sa fin doit encore compter, et « Reprendre » ne doit jamais
 * lancer un second agent dans un fil encore occupé.
 */
describe('redémarrage : lot dont l’agent a survécu', () => {
  const interrompu = (): PlanDeLots =>
    interrompreAuDemarrage(
      lancerCeQuiPart(planAccepte({ parallele: 2, lots: [lot(1), lot(2), lot(3)] }))
    )
  const occupe = (fils: string[]) => (fil: string) => fils.includes(fil)

  it('fin du tour repris d’un lot interrompu : notée, le chef aura son compte rendu, rien ne repart seul', () => {
    const r = noterFinDeTour(
      interrompu(),
      'conv-110',
      { ok: true, repris: true, texte: 'fini' },
      5000
    )
    expect(r.effet).toBe('note')
    expect(r.lot?.etat).toBe('fait')
    expect(r.plan.statut).toBe('interrompu')
    expect(lotsAPartir(r.plan)).toEqual([])
  })

  it('jumeau : la fin d’un tour ORDINAIRE dans le fil d’un lot interrompu ne compte pas', () => {
    const p = interrompu()
    const r = noterFinDeTour(p, 'conv-110', { ok: true }, 5000)
    expect(r.effet).toBe('deja-note')
    expect(r.plan).toBe(p)
  })

  it('agent mort avec l’app (reprise sans signe de vie) : le lot RESTE interrompu, « Reprendre » le relancera', () => {
    const p = interrompu()
    const r = noterFinDeTour(p, 'conv-110', { ok: false, repris: true, perdu: true }, 5000)
    expect(r.effet).toBe('deja-note')
    const repris = reprendrePlan(r.plan)
    expect(repris.ok && repris.plan.lots[0].etat).toBe('a-faire')
  })

  it('jumeau : un lot ADOPTÉ en cours dont l’agent repris est perdu passe en échec, avec sa raison', () => {
    const r0 = reprendrePlan(interrompu(), (f) => f === 'conv-110')
    if (!r0.ok) throw new Error(r0.erreur)
    const r = noterFinDeTour(
      r0.plan,
      'conv-110',
      { ok: false, repris: true, perdu: true, erreur: 'agent perdu' },
      5000
    )
    expect(r.lot).toMatchObject({ etat: 'echec', raison: 'agent perdu' })
  })

  it('le dernier lot interrompu fini par son agent repris, sans lot restant : plan terminé', () => {
    let p = interrompreAuDemarrage(lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] })))
    p = noterFinDeTour(p, 'conv-110', { ok: true, repris: true }, 5000).plan
    expect(p.statut).toBe('interrompu')
    p = noterFinDeTour(p, 'conv-120', { ok: false, repris: true, erreur: 'rouge' }, 5001).plan
    expect(p.statut).toBe('termine')
    expect(bilanDuPlan(p)).toMatchObject({ faits: 1, echecs: 1, interrompus: 0 })
  })

  it('« Reprendre » pendant que l’agent repris tourne : le lot est ADOPTÉ en cours, sans nouveau tour', () => {
    const p = interrompu()
    const r = reprendrePlan(p, occupe(['conv-110']))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.lots[0]).toMatchObject({ etat: 'en-cours', fil: 'conv-110' })
    expect(r.plan.lots[1].etat).toBe('a-faire')
    expect(r.plan.toursLances).toBe(p.toursLances)
    // Le lot adopté prend sa place : un seul autre lot part (parallélisme 2).
    expect(lotsAPartir(r.plan)).toEqual([2])
  })

  it('jumeau : « Reprendre » avec des fils libres remet les lots interrompus à faire', () => {
    const r = reprendrePlan(interrompu(), occupe([]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.lots.map((l) => l.etat)).toEqual(['a-faire', 'a-faire', 'a-faire'])
  })

  it('un lot à faire dont le fil est occupé attend sans prendre de place ; le suivant libre part', () => {
    let p = lancerCeQuiPart(planAccepte({ parallele: 2, lots: [lot(1), lot(2), lot(3)] }))
    p = noterFinDeTour(p, 'conv-110', { ok: false, erreur: 'rouge' }, 3000).plan
    const relance = relancerLot(p, 1)
    expect(relance.ok).toBe(true)
    if (!relance.ok) return
    expect(lotsAPartir(relance.plan, occupe(['conv-110']))).toEqual([3])
    // Jumeau : fil libre, le lot relancé repart en premier.
    expect(lotsAPartir(relance.plan, occupe([]))).toEqual([1])
  })

  it('un lot qui attend son fil occupé n’arrête pas le plan sur un faux « plafond atteint »', () => {
    let p = lancerCeQuiPart(planAccepte({ parallele: 1, lots: [lot(1), lot(2)] }))
    p = noterFinDeTour(p, 'conv-110', { ok: false, erreur: 'rouge' }, 3000).plan
    p = marquerLance(p, 2, 'conv-120', 3001)
    p = noterFinDeTour(p, 'conv-120', { ok: true }, 3002).plan
    const relance = relancerLot(p, 1)
    expect(relance.ok).toBe(true)
    if (!relance.ok) return
    expect(lotsAPartir(relance.plan, occupe(['conv-110']))).toEqual([])
    expect(statutApresLancements(relance.plan).statut).toBe('en-cours')
  })
})

describe('textes remis aux fils', () => {
  const p = lancerCeQuiPart(
    planAccepte({ titre: 'Traduction', parallele: 2, lots: [lot(1), lot(2), lot(3)] })
  )

  it('le message d’un lot garde la demande EN TÊTE (une commande /skill doit rester reconnue)', () => {
    const texte = promptDuLot(p, p.lots[0])
    expect(texte.startsWith("/build traduis l'écran 1")).toBe(true)
    expect(texte).toMatch(/Lot 1 sur 3 du plan « Traduction »/)
    expect(texte).toMatch(/conv-1/)
    expect(texte).toMatch(/src\/ecran-1\.tsx/)
  })

  it('un compte rendu tient en 2 000 caractères et renvoie au fil enfant quand il est coupé', () => {
    const fin = noterFinDeTour(p, 'conv-110', { ok: true }, 3000)
    const court = compteRenduDuLot(fin.plan, fin.lot!, 'Écran 1 traduit, 12 tests verts.')
    expect(court).toMatch(/Lot 1\/3 « Lot 1 » : fait dans conv-110/)
    expect(court).toMatch(/12 tests verts/)
    const long = compteRenduDuLot(fin.plan, fin.lot!, 'y'.repeat(5000))
    expect(long.length).toBeLessThanOrEqual(2000)
    expect(long).toMatch(/suite dans conv-110/)
  })

  it('le réveil du chef se présente comme un message de l’app et porte l’avancement', () => {
    const fin = noterFinDeTour(p, 'conv-110', { ok: true }, 3000)
    const texte = promptDeReveil(fin.plan, [1])
    expect(texte).toMatch(/message de l’app, pas de l’utilisateur/)
    expect(texte).toMatch(/1 fait, 0 en échec, 1 en cours, 1 à faire sur 3/)
    expect(texte).toMatch(/lot 1/i)
  })
})
