import { describe, expect, it } from 'vitest'
import {
  CONTEXTE_MAX,
  CONTEXTE_MIN,
  DECISIONS_MAX,
  DECISION_MAX,
  DEMANDE_MAX,
  LOTS_MAX,
  TOURS_PAR_LOT_DEFAUT,
  ajouterLots,
  estUnMessageDuPlan,
  noterDecision,
  PARALLELE_MAX,
  bilanDuPlan,
  compteRenduDuLot,
  creerPlan,
  decisionDeDepot,
  empreintePlan,
  interrompreAuDemarrage,
  libelleEtat,
  lirePlanDeLots,
  lotsAPartir,
  marquerEchec,
  marquerLance,
  noterFinDeTour,
  plansPourLaListe,
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

/** Un contexte commun valide (au moins `CONTEXTE_MIN` caractères), conv-1284. */
const CONTEXTE =
  'Traduire les 113 écrans de l’app en anglais. Décidé : clés i18n en kebab-case, un fichier par écran, aucune chaîne en dur ne reste.'

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

/**
 * Plafond posé APRÈS lecture : un plan déjà sur disque peut avoir moins de tours que de lots (déposé
 * avant le refus de la lecture, conv-1273) ; le mécanisme « plafond atteint » doit rester juste.
 */
const avecPlafond = (plan: PlanDeLots, plafondTours: number): PlanDeLots => ({
  ...plan,
  plafondTours
})

/** Lance tout ce qui peut partir, avec des fils `conv-1xx` numérotés par rang. */
function lancerCeQuiPart(plan: PlanDeLots): PlanDeLots {
  let p = plan
  for (const rang of lotsAPartir(p)) p = marquerLance(p, rang, `conv-1${rang}0`, 2000)
  return p
}

describe('lirePlanDeLots — lecture stricte du plan déposé par le chef', () => {
  it('nominal : 4 lots, parallélisme 2, plafond par défaut de 2 tours par lot', () => {
    const r = lu({
      titre: 'Traduction',
      contexte: CONTEXTE,
      parallele: 2,
      lots: [lot(1), lot(2), lot(3), lot(4)]
    })
    expect(r.plan.lots).toHaveLength(4)
    expect(r.plan.parallele).toBe(2)
    expect(r.plan.plafondTours).toBe(8)
    expect(r.plan.contexte).toBe(CONTEXTE)
    expect(r.avertissements).toEqual([])
  })

  it('jumeau (conv-1284) : sans contexte commun, le plan passe mais le dit', () => {
    const r = lu({ lots: [lot(1), lot(2)] })
    expect(r.plan.contexte).toBeUndefined()
    expect(r.avertissements.join(' ')).toMatch(/aucun « contexte » commun/)
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

  it('refuse un plafond sous le nombre de lots : c’est un TOTAL, pas un nombre par lot', () => {
    // Cas réels (29/10) : 2 tours pour 5 lots (conv-1256), 3 pour 6 (conv-1236). Le chef croyait
    // donner « 2 par lot » : un seul lot partait à la fois, puis le plan s'arrêtait à mi-chemin.
    const r = lirePlanDeLots({ plafondTours: 2, lots: [lot(1), lot(2), lot(3), lot(4), lot(5)] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erreur).toMatch(/plafond de 2 tours pour 5 lots/)
      expect(r.erreur).toMatch(/TOTAL/)
      expect(r.erreur).toMatch(/au moins 5/)
    }
    // La borne basse (un tour par lot, aucune relance) reste acceptée.
    expect(lu({ plafondTours: 3, lots: [lot(1), lot(2), lot(3)] }).plan.plafondTours).toBe(3)
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
      avecPlafond(planAccepte({ parallele: 2, lots: [lot(1), lot(2), lot(3)] }), 2)
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

  /*
   * LIMITE D'USAGE PRISE POUR UN LOT « FAIT » (conv-1236, plan-c21413ba, 2026-10-28). Les lots 1,
   * 2 et 5 du thème Golden ont été notés « fait » sans une ligne écrite, et le plafond de 3 tours
   * s'est épuisé sur eux. Deux formes réelles, recopiées de turn-journals/ :
   *  - le tour du lot finit sans erreur, mais son `orchestrate` a buté sur la limite (conv-1237,
   *    tour 5bdd19cc : événement `outcome` « failed », réponse « Échec du workflow : … ») ;
   *  - le tour lui-même échoue sur la limite des 5 heures (conv-1236, tour 98f5030c), une forme que
   *    `estMurDeQuota` ne connaissait pas.
   */
  const murHebdo =
    "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie\n• claude (claude-opus-5-5) : Claude a interrompu l'appel : You've hit your weekly limit · resets 4am (Europe/Paris)"
  const mur5h =
    "Claude a interrompu l'appel : You've hit your 5-hour limit · resets 11pm (Europe/Paris)"

  it('tour ok dont l’orchestration a buté sur la limite d’usage : échec, plan suspendu, tour rendu', () => {
    const avant = deuxEnCours()
    const r = noterFinDeTour(
      avant,
      'conv-110',
      { ok: true, texte: `Échec du workflow : ${murHebdo}`, echecOrchestration: murHebdo },
      3000
    )
    expect(r.lot?.etat).toBe('echec')
    expect(r.lot?.raison).toMatch(/You've hit your weekly limit/)
    expect(r.plan.statut).toBe('suspendu-quota')
    expect(r.plan.toursLances).toBe(avant.toursLances - 1)
  })

  it('tour en échec sur la limite des 5 heures : échec, plan suspendu, tour rendu', () => {
    const avant = deuxEnCours()
    const r = noterFinDeTour(avant, 'conv-110', { ok: false, erreur: mur5h }, 3000)
    expect(r.lot?.etat).toBe('echec')
    expect(r.plan.statut).toBe('suspendu-quota')
    expect(r.plan.toursLances).toBe(avant.toursLances - 1)
  })

  // conv-1284 (2026-10-29, demande de l'utilisateur) : un tour qui n'a jamais démarré ne coûte rien.
  it('lancement qui n’a pas démarré : échec noté, tour rendu — une seule fois même s’il bute aussi sur la limite', () => {
    const avant = deuxEnCours()
    const r = noterFinDeTour(
      avant,
      'conv-110',
      { ok: false, erreur: 'lancement refusé : conversation introuvable', nonDemarre: true },
      3000
    )
    expect(r.lot).toMatchObject({
      etat: 'echec',
      raison: 'lancement refusé : conversation introuvable'
    })
    expect(r.plan.toursLances).toBe(avant.toursLances - 1)
    const mur = noterFinDeTour(
      avant,
      'conv-110',
      { ok: false, erreur: mur5h, nonDemarre: true },
      3000
    )
    expect(mur.plan.toursLances).toBe(avant.toursLances - 1)
    // Jumeau : un tour qui a démarré puis échoué garde son tour.
    const demarre = noterFinDeTour(avant, 'conv-110', { ok: false, erreur: 'build rouge' }, 3000)
    expect(demarre.plan.toursLances).toBe(avant.toursLances)
  })

  it('cas réel : 3 lots coupés par la limite ne vident pas le plafond, « Reprendre » les relance', () => {
    // Plan Golden : 6 lots, 3 en parallèle, plafond de 3 tours.
    let p = lancerCeQuiPart(
      avecPlafond(
        planAccepte({ parallele: 3, lots: [lot(1), lot(2), lot(3), lot(4), lot(5), lot(6)] }),
        3
      )
    )
    expect(p.toursLances).toBe(3)
    p = noterFinDeTour(p, 'conv-110', { ok: true, echecOrchestration: murHebdo }, 3000).plan
    p = noterFinDeTour(p, 'conv-120', { ok: true, echecOrchestration: mur5h }, 3001).plan
    p = noterFinDeTour(p, 'conv-130', { ok: false, erreur: mur5h }, 3002).plan
    expect(p.lots.filter((l) => l.etat === 'fait')).toEqual([])
    expect(p.toursLances).toBe(0)
    expect(p.statut).toBe('suspendu-quota')
    const repris = reprendrePlan(p)
    expect(repris.ok).toBe(true)
    if (repris.ok) expect(lotsAPartir(repris.plan)).toEqual([1, 2, 3])
  })

  it('une réponse qui CITE la limite sans que le tour y ait buté reste « fait »', () => {
    // Un lot qui travaille sur la détection du quota écrit ce texte dans son résumé.
    const texte = `J’ai ajouté la forme « ${mur5h} » au détecteur ; tests verts.`
    const r = noterFinDeTour(deuxEnCours(), 'conv-110', { ok: true, texte }, 3000)
    expect(r.lot?.etat).toBe('fait')
    expect(r.plan.statut).toBe('en-cours')
  })

  /*
   * UN TOUR « OK » QUI SE DÉCLARE BLOQUÉ (conv-1153, lot 1 du plan conv-1151, 2026-10-26) : le tour
   * finit sans erreur, mais l'agent écrit « ⛔ Bloqué » ou « ⚠️ Non résolu » (consigne de
   * `response-style.ts`). Noté « fait », le chef ne le relançait pas. Même lecture que la carte du
   * fil (`carte-du-fil.ts`, BLOCAGE_DECLARE).
   */
  it('tour ok dont la réponse se déclare « ⛔ Bloqué » : échec avec la ligne de blocage, relançable', () => {
    const texte = [
      'J’ai tenté deux corrections.',
      '',
      '⛔ Bloqué — les tests restent rouges : 3 échecs dans src/ecran-1.test.tsx.',
      '',
      'AUTOWIN_FIN_V1: bloqué sur les tests'
    ].join('\n')
    const r = noterFinDeTour(deuxEnCours(), 'conv-110', { ok: true, texte }, 3000)
    expect(r.lot?.etat).toBe('echec')
    expect(r.lot?.raison).toBe(
      'le fil se déclare bloqué : ⛔ Bloqué — les tests restent rouges : 3 échecs dans src/ecran-1.test.tsx.'
    )
    expect(r.plan.statut).toBe('en-cours')
    expect(lotsAPartir(r.plan)).toEqual([3])
    expect(relancerLot(r.plan, 1).ok).toBe(true)
    const cr = compteRenduDuLot(r.plan, r.lot!, texte)
    expect(cr).toMatch(/« Lot 1 » : échec dans conv-110 \(le fil se déclare bloqué : ⛔ Bloqué/)
  })

  it('« ⚠️ Non résolu » compte aussi ; un marqueur seul en titre prend la ligne qui l’explique', () => {
    const nonResolu = noterFinDeTour(
      deuxEnCours(),
      'conv-110',
      { ok: true, texte: 'Fait en partie.\n⚠️ Non résolu : le thème clair reste illisible.' },
      3000
    )
    expect(nonResolu.lot).toMatchObject({
      etat: 'echec',
      raison: 'le fil se déclare bloqué : ⚠️ Non résolu : le thème clair reste illisible.'
    })
    const titre = noterFinDeTour(
      deuxEnCours(),
      'conv-110',
      { ok: true, texte: '## ⛔ Bloqué\n\nLe build échoue : module `x` introuvable.' },
      3000
    )
    expect(titre.lot?.etat).toBe('echec')
    expect(titre.lot?.raison).toBe(
      'le fil se déclare bloqué : ⛔ Bloqué — Le build échoue : module `x` introuvable.'
    )
  })

  it('la raison d’un blocage déclaré reste bornée à 300 caractères', () => {
    const r = noterFinDeTour(
      deuxEnCours(),
      'conv-110',
      { ok: true, texte: `⛔ Bloqué : ${'z'.repeat(1000)}` },
      3000
    )
    expect(r.lot?.etat).toBe('echec')
    expect(r.lot?.raison?.length).toBe(300)
  })

  it('jumeaux : « bloqué » sans le marqueur, ou le marqueur dans une ligne invisible, laissent le lot fait', () => {
    // L'entrée qui ferait échouer une lecture trop large (/bloqué/i) : un verdict ordinaire.
    const verdict = noterFinDeTour(
      deuxEnCours(),
      'conv-110',
      { ok: true, texte: '- Verdict : fait — plus rien n’est bloqué, 12 tests verts.' },
      3000
    )
    expect(verdict.lot).toMatchObject({ etat: 'fait', raison: undefined })
    // Une suggestion invisible (retirée de l'affichage) n'est pas la réponse du fil.
    const suggestion = noterFinDeTour(
      deuxEnCours(),
      'conv-110',
      {
        ok: true,
        texte: 'Écran traduit.\nAUTOWIN_PROMPT_V1: [80] /build rends lisible le ⛔ Bloqué du carnet'
      },
      3000
    )
    expect(suggestion.lot?.etat).toBe('fait')
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

/*
 * DÉPENDANCE EXPLICITE « apres » (conv-1151, lot 2 du plan « Rendre la super conversation
 * parfaite », 2026-10-26). Avant : les lots étaient supposés indépendants, seul un fichier partagé
 * les ordonnait. Un lot qui a besoin du RÉSULTAT d'un autre l'annonce par « apres » : [rangs].
 * Sans ce champ, un prérequis en échec laissait le plan tomber en « plafond atteint » — faux, et
 * la relance du lot fautif y est refusée.
 */
describe('apres — dépendances explicites entre lots', () => {
  const dep = (n: number, apres: unknown, fichiers?: string[]): Record<string, unknown> => ({
    ...lot(n, fichiers),
    apres
  })

  it('lecture : « apres » facultatif, trié et dédoublonné ; absent = aucune dépendance', () => {
    const r = lu({ lots: [lot(1), lot(2), dep(3, [2, 1, 2]), dep(4, [])] })
    expect(r.plan.lots.map((l) => l.apres)).toEqual([[], [], [1, 2], []])
    const plan = creerPlan(r.plan, { id: 'plan-1', chef: 'conv-1', maintenant: 1 })
    expect(plan.lots[2].apres).toEqual([1, 2])
  })

  it.each([
    [{ lots: [lot(1), dep(2, 1)] }, /lot 2 : apres — liste de numéros de lots attendue/],
    [{ lots: [lot(1), dep(2, ['1'])] }, /lot 2 : apres — liste de numéros de lots attendue/],
    [{ lots: [lot(1), dep(2, [1.5])] }, /lot 2 : apres — liste de numéros de lots attendue/],
    [{ lots: [lot(1), dep(2, [3])] }, /lot 2 : apres — le lot 3 n’existe pas \(le plan a 2 lots\)/],
    [{ lots: [lot(1), dep(2, [0])] }, /lot 2 : apres — le lot 0 n’existe pas/],
    [{ lots: [lot(1), dep(2, [2])] }, /lot 2 : apres — un lot ne peut pas s’attendre lui-même/],
    [{ lots: [lot(1), { ...lot(2), après: [1] }] }, /lot 2 : « après » .*« apres »/]
  ])('refuse un « apres » mal formé en nommant le lot fautif (%j)', (brut, motif) => {
    const r = lirePlanDeLots(brut)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toMatch(motif)
  })

  it('refuse un cycle en nommant le lot fautif et le cycle entier', () => {
    const deux = lirePlanDeLots({ lots: [dep(1, [2]), dep(2, [1])] })
    expect(deux.ok).toBe(false)
    if (!deux.ok)
      expect(deux.erreur).toMatch(/^lot 1 : apres crée un cycle \(1 attend 2, qui attend 1\)/)
    const trois = lirePlanDeLots({ lots: [lot(1), dep(2, [4]), dep(3, [2]), dep(4, [3])] })
    expect(trois.ok).toBe(false)
    if (!trois.ok)
      expect(trois.erreur).toMatch(
        /^lot 2 : apres crée un cycle \(2 attend 4, qui attend 3, qui attend 2\)/
      )
  })

  it('jumeau : un losange (2 et 3 après 1, 4 après 2 et 3) n’est pas un cycle', () => {
    const r = lu({ lots: [lot(1), dep(2, [1]), dep(3, [1]), dep(4, [3, 2])] })
    expect(r.plan.lots[3].apres).toEqual([2, 3])
  })

  it('un lot ne part que quand TOUS ses prérequis sont faits ; un lot libre passe devant', () => {
    let p = lancerCeQuiPart(
      planAccepte({ parallele: 3, lots: [lot(1), lot(2), dep(3, [1, 2]), lot(4)] })
    )
    expect(p.lots.map((l) => l.etat)).toEqual(['en-cours', 'en-cours', 'a-faire', 'en-cours'])
    p = noterFinDeTour(p, 'conv-110', { ok: true }, 3000).plan
    expect(lotsAPartir(p)).toEqual([])
    p = noterFinDeTour(p, 'conv-120', { ok: true }, 3001).plan
    expect(lotsAPartir(p)).toEqual([3])
  })

  it('un lot qui attend ne réserve pas ses fichiers', () => {
    const p = planAccepte({
      parallele: 3,
      lots: [lot(1, ['a.ts']), dep(2, [1], ['b.ts']), lot(3, ['b.ts'])]
    })
    expect(lotsAPartir(p)).toEqual([1, 3])
  })

  it('un plan relu du disque sans « apres » (écrit avant ce champ) part comme avant', () => {
    const p = planAccepte({ parallele: 3, lots: [lot(1), lot(2)] })
    // Même forme que le fichier relu : la clé est absente, pas vide.
    const ancien = JSON.parse(
      JSON.stringify({ ...p, lots: p.lots.map((l) => ({ ...l, apres: undefined })) })
    ) as PlanDeLots
    expect(ancien.lots[0]).not.toHaveProperty('apres')
    expect(lotsAPartir(ancien)).toEqual([1, 2])
  })

  it('un prérequis en échec bloque ses dépendants : le plan ne reste pas « en cours » à vide, la raison nomme le lot bloquant', () => {
    let p = lancerCeQuiPart(
      planAccepte({ parallele: 2, lots: [lot(1), dep(2, [1]), dep(3, [2]), lot(4)] })
    )
    expect(p.lots.map((l) => l.etat)).toEqual(['en-cours', 'a-faire', 'a-faire', 'en-cours'])
    p = noterFinDeTour(p, 'conv-110', { ok: false, erreur: 'tests rouges' }, 3000).plan
    // Le lot 4 tourne encore : le plan reste en cours, mais rien d'autre ne part.
    expect(p.statut).toBe('en-cours')
    expect(lotsAPartir(p)).toEqual([])
    p = noterFinDeTour(p, 'conv-140', { ok: true }, 3001).plan
    expect(p.statut).toBe('bloque')
    expect(p.raison).toMatch(/le lot 1 \(échec\) bloque les lots 2 et 3/)
    expect(p.raison).toMatch(/relancer/)
    expect(lotsAPartir(p)).toEqual([])
    expect(promptDeReveil(p, [4])).toMatch(/le lot 1 \(échec\) bloque les lots 2 et 3/)
    // Le chef relance le lot bloquant : le plan repart, ses dépendants suivront.
    const r = relancerLot(p, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.statut).toBe('en-cours')
    expect(lotsAPartir(r.plan)).toEqual([1])
  })

  it('jumeau : l’échec d’un lot dont personne ne dépend laisse les autres finir, plan terminé', () => {
    let p = lancerCeQuiPart(planAccepte({ parallele: 3, lots: [lot(1), dep(2, [1]), lot(3)] }))
    p = noterFinDeTour(p, 'conv-130', { ok: false, erreur: 'rouge' }, 3000).plan
    p = noterFinDeTour(p, 'conv-110', { ok: true }, 3001).plan
    expect(p.statut).toBe('en-cours')
    expect(lotsAPartir(p)).toEqual([2])
    p = noterFinDeTour(lancerCeQuiPart(p), 'conv-120', { ok: true }, 3002).plan
    expect(p.statut).toBe('termine')
  })

  it('plusieurs lots bloquants : chacun est nommé avec les lots qu’il bloque', () => {
    let p = lancerCeQuiPart(
      planAccepte({ parallele: 2, lots: [lot(1), lot(2), dep(3, [1]), dep(4, [2]), dep(5, [2])] })
    )
    p = noterFinDeTour(p, 'conv-110', { ok: false, erreur: 'rouge' }, 3000).plan
    p = noterFinDeTour(p, 'conv-120', { ok: false, erreur: 'rouge' }, 3001).plan
    expect(p.statut).toBe('bloque')
    expect(p.raison).toMatch(
      /le lot 1 \(échec\) bloque le lot 3 ; le lot 2 \(échec\) bloque les lots 4 et 5/
    )
  })

  it('un lot qui n’a pas pu partir (fil non créé) bloque aussi ses dépendants', () => {
    const p = marquerEchec(planAccepte({ lots: [lot(1), dep(2, [1])] }), 1, 'fil non créé', 3000)
    expect(p.statut).toBe('bloque')
    expect(p.raison).toMatch(/le lot 1 \(échec\) bloque le lot 2/)
  })

  it('jumeau : plafond épuisé, le plan reste « plafond atteint » même si un prérequis a échoué', () => {
    let p = lancerCeQuiPart(
      avecPlafond(planAccepte({ parallele: 2, lots: [lot(1), dep(2, [1]), lot(3)] }), 2)
    )
    p = noterFinDeTour(p, 'conv-110', { ok: false, erreur: 'rouge' }, 3000).plan
    p = noterFinDeTour(p, 'conv-130', { ok: true }, 3001).plan
    expect(p.statut).toBe('plafond-atteint')
  })

  it('l’empreinte inclut « apres » ; sans dépendance, elle reste celle d’avant ce champ', () => {
    const sans = lu({ lots: [lot(1), lot(2)] }).plan
    // Valeur calculée avec la formule d'avant « apres » : les plans déjà sur disque gardent leur clé.
    expect(empreintePlan(sans)).toBe('63880bc3')
    expect(empreintePlan(lu({ lots: [lot(1), dep(2, [])] }).plan)).toBe('63880bc3')
    expect(empreintePlan(lu({ lots: [lot(1), dep(2, [1])] }).plan)).not.toBe('63880bc3')
    expect(empreintePlan(lu({ lots: [lot(1), lot(2), dep(3, [2, 1])] }).plan)).toBe(
      empreintePlan(lu({ lots: [lot(1), lot(2), dep(3, [1, 2, 1])] }).plan)
    )
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

  /*
   * LIGNES TECHNIQUES INVISIBLES (conv-1153, lot 1 du plan conv-1151, 2026-10-26). Le texte du lot
   * vient de `issueDuResultat` (`resultat.text` : le texte parlé du tour, commandes `<cmd>` déjà
   * retirées par le pilote, `agent-pilot.ts`). Mesure sur `turn-journals/` : 380 tours sur 471
   * finissent par une ligne `AUTOWIN_…_V1`, aucun ne garde un bloc `<cmd>`. Fin réelle ci-dessous,
   * copiée de conv-1139 (tour 6751c52b). Coupé par la FIN, le compte rendu gardait ce bruit.
   */
  const finReelle = [
    'J’ai traduit l’écran 1 et relu les captures dans les deux thèmes.',
    '',
    '📍 Maintenant',
    'Les fichiers sont modifiés dans `D:\\AutoWinOS` mais pas commités.',
    '',
    '⏳ Reste à faire',
    '- Aucune limite connue pour cet affichage.',
    '',
    'AUTOWIN_BESOIN_V1: suite',
    'AUTOWIN_FIN_V1: proposition « Bulles » implémentée et vérifiée'
  ].join('\n')

  it('le compte rendu retire les lignes techniques invisibles de la réponse du fil', () => {
    const fin = noterFinDeTour(p, 'conv-110', { ok: true, texte: finReelle }, 3000)
    const cr = compteRenduDuLot(fin.plan, fin.lot!, finReelle)
    expect(cr).not.toMatch(/AUTOWIN_/)
    expect(cr).toMatch(/⏳ Reste à faire\n- Aucune limite connue pour cet affichage\.$/)
  })

  it('les lignes techniques ne mangent plus la place du résumé dans une réponse longue', () => {
    // Trois suggestions de suite longues : 1 800 caractères de bruit, plus que la place gardée.
    const suggestions = [1, 2, 3].map(
      (n) => `AUTOWIN_PROMPT_V1: [${90 - n}] /build ${'étape suivante détaillée '.repeat(24)}`
    )
    const reponse = `${'Détail du travail. '.repeat(300)}\n\n${finReelle}\n${suggestions.join('\n')}`
    const fin = noterFinDeTour(p, 'conv-110', { ok: true, texte: reponse }, 3000)
    const cr = compteRenduDuLot(fin.plan, fin.lot!, reponse)
    expect(cr.length).toBeLessThanOrEqual(2000)
    expect(cr).not.toMatch(/AUTOWIN_/)
    expect(cr).toMatch(/⏳ Reste à faire\n- Aucune limite connue pour cet affichage\./)
    expect(cr).toMatch(/suite dans conv-110/)
  })

  it('jumeaux : un marqueur cité dans une phrase ou dans un bloc de code reste dans le compte rendu', () => {
    const reponse = [
      'J’ai corrigé la lecture de `AUTOWIN_FIN_V1` dans le pilote.',
      '```',
      'AUTOWIN_FIN_V1: exemple cité',
      '```',
      'AUTOWIN_FIN_V1: fini'
    ].join('\n')
    const fin = noterFinDeTour(p, 'conv-110', { ok: true, texte: reponse }, 3000)
    const cr = compteRenduDuLot(fin.plan, fin.lot!, reponse)
    expect(cr).toMatch(/lecture de `AUTOWIN_FIN_V1` dans le pilote/)
    expect(cr).toMatch(/```\nAUTOWIN_FIN_V1: exemple cité\n```$/)
  })

  it('une réponse faite SEULEMENT de lignes techniques : le compte rendu se réduit à son en-tête', () => {
    const fin = noterFinDeTour(p, 'conv-110', { ok: true }, 3000)
    const cr = compteRenduDuLot(fin.plan, fin.lot!, 'AUTOWIN_BESOIN_V1: suite\nAUTOWIN_FIN_V1: ok')
    expect(cr).not.toMatch(/Réponse du fil/)
    expect(cr).toMatch(/Lot 1\/3 « Lot 1 » : fait dans conv-110/)
  })

  it('le réveil du chef se présente comme un message de l’app et porte l’avancement', () => {
    const fin = noterFinDeTour(p, 'conv-110', { ok: true }, 3000)
    const texte = promptDeReveil(fin.plan, [1])
    expect(texte).toMatch(/message de l’app, pas de l’utilisateur/)
    expect(texte).toMatch(/1 fait, 0 en échec, 1 en cours, 1 à faire sur 3/)
    expect(texte).toMatch(/lot 1/i)
  })
})

describe('plansPourLaListe — le geste « tous » du canal os:plansDeLots (conv-1158)', () => {
  it('rend chef, fil, rang et total de chaque lot ouvert ; un plan sans fil ouvert est omis', () => {
    const lance = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2), lot(3)], parallele: 2 }))
    const sansFil = { ...planAccepte({ lots: [lot(1), lot(2)] }), id: 'plan-2', chef: 'conv-2' }
    expect(plansPourLaListe([lance, sansFil])).toEqual([
      {
        id: 'plan-1',
        chef: 'conv-1',
        total: 3,
        lots: [
          { rang: 1, fil: 'conv-110' },
          { rang: 2, fil: 'conv-120' }
        ]
      }
    ])
  })

  it('ne transporte ni demande ni titre : seulement de quoi ranger la liste', () => {
    const [plan] = plansPourLaListe([lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))])
    expect(Object.keys(plan).sort()).toEqual(['chef', 'id', 'lots', 'total'])
    expect(Object.keys(plan.lots[0]).sort()).toEqual(['fil', 'rang'])
  })
})

/*
 * conv-1284 (2026-10-29) — le meilleur des threads de claude.exe dans le plan de lots : contexte
 * commun (brief des « side sessions », refusé sous 80 caractères), décisions partagées (mémoire
 * des « Projects »), fratrie dans le message d'un lot (« Linked sessions now »), modèle par lot,
 * et lots ajoutés à un plan lancé (le coordinateur range une nouvelle demande dans le chantier).
 */
describe('contexte commun et modèle par lot (conv-1284)', () => {
  it('refuse un contexte trop court ou trop long, en disant pourquoi il compte', () => {
    const court = lirePlanDeLots({ contexte: 'traduire', lots: [lot(1), lot(2)] })
    expect(court.ok).toBe(false)
    if (!court.ok) expect(court.erreur).toMatch(/80 au moins.*ne sait rien d’autre/)
    const long = lirePlanDeLots({ contexte: 'x'.repeat(CONTEXTE_MAX + 1), lots: [lot(1), lot(2)] })
    expect(long.ok).toBe(false)
    expect(lu({ contexte: 'x'.repeat(CONTEXTE_MIN), lots: [lot(1), lot(2)] }).plan.contexte).toBe(
      'x'.repeat(CONTEXTE_MIN)
    )
    expect(lirePlanDeLots({ contexte: 42, lots: [lot(1), lot(2)] }).ok).toBe(false)
  })

  it('lit un modèle par lot ; refuse un nom qui n’en est pas un', () => {
    const r = lu({ lots: [{ ...lot(1), modele: 'haiku' }, lot(2)] })
    expect(r.plan.lots[0].modele).toBe('haiku')
    expect(r.plan.lots[1]).not.toHaveProperty('modele')
    for (const modele of ['', 'un modèle', 42, '-x', 'a'.repeat(61)]) {
      const refuse = lirePlanDeLots({ lots: [{ ...lot(1), modele }, lot(2)] })
      expect(refuse.ok, String(modele)).toBe(false)
      if (!refuse.ok) expect(refuse.erreur).toMatch(/lot 1 : modele/)
    }
  })

  it('un plan sans contexte ni modèle garde l’empreinte d’avant ces champs', () => {
    // Formule d'avant conv-1284, recopiée : un plan déjà sur disque ne doit pas changer de clé.
    const avant = (plan: ReturnType<typeof lu>['plan']): string => {
      const texte = JSON.stringify([
        plan.titre,
        plan.parallele,
        plan.plafondTours,
        plan.lots.map((l) => {
          const base = [l.titre, l.demande, l.fichiers.map((f) => f.toLowerCase())]
          return l.apres.length ? [...base, l.apres] : base
        })
      ])
      let h = 0x811c9dc5
      for (let i = 0; i < texte.length; i++) {
        h ^= texte.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return h.toString(16).padStart(8, '0')
    }
    const simple = lu({ lots: [lot(1), { ...lot(2), apres: [1] }] }).plan
    expect(empreintePlan(simple)).toBe(avant(simple))
    const avecModele = lu({ lots: [lot(1), { ...lot(2), apres: [1], modele: 'sonnet' }] }).plan
    expect(empreintePlan(avecModele)).not.toBe(empreintePlan(simple))
    const avecContexte = lu({ contexte: CONTEXTE, lots: [lot(1), { ...lot(2), apres: [1] }] }).plan
    expect(empreintePlan(avecContexte)).not.toBe(empreintePlan(simple))
  })
})

describe('promptDuLot — ce que sait le fil d’un lot (conv-1284)', () => {
  it('porte le contexte, les décisions, les autres lots et la règle de la question au chef', () => {
    let plan = lancerCeQuiPart(
      planAccepte({
        contexte: CONTEXTE,
        parallele: 2,
        lots: [lot(1), lot(2), lot(3, ['src/commun.ts'])]
      })
    )
    const note = noterDecision(plan, 'les clés suivent le nom du fichier', 'lot 1', 3000)
    if (!note.ok) throw new Error(note.erreur)
    plan = note.plan
    const texte = promptDuLot(plan, plan.lots[2])
    expect(texte.startsWith("/build traduis l'écran 3")).toBe(true)
    expect(texte).toContain(`Contexte commun du plan (le même pour tous les lots) :\n${CONTEXTE}`)
    expect(texte).toContain('- les clés suivent le nom du fichier (lot 1)')
    expect(texte).toContain(
      '- lot 1 « Lot 1 » : en cours, fil conv-110 — fichiers : src/ecran-1.tsx'
    )
    expect(texte).toContain('- lot 2 « Lot 2 » : en cours, fil conv-120')
    expect(texte).not.toContain('- lot 3 «')
    expect(texte).toMatch(/UNE question courte avec ecrire_a_un_fil \(destinataire conv-1\)/)
    expect(texte).toContain('« ⛔ Bloqué : j’attends la réponse du chef »')
    // conv-1284 (2026-10-29) : la réponse du chef arrive en ordre, les décisions par message.
    expect(texte).toContain('sa réponse arrivera comme un ordre qui relance ce fil')
    expect(texte).toContain('les lots en cours la reçoivent par message')
    expect(texte).toMatch(/action « noter »/)
    // Le message reste reconnu comme composé par le plan (garde des deux lectures, conv-1192).
    expect(estUnMessageDuPlan(texte)).toBe(true)
  })

  it('jumeau : sans contexte ni décision, aucune rubrique vide', () => {
    const plan = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))
    const texte = promptDuLot(plan, plan.lots[0])
    expect(texte).not.toMatch(/Contexte commun/)
    expect(texte).not.toMatch(/Décisions prises en route/)
    expect(estUnMessageDuPlan(texte)).toBe(true)
  })

  /*
   * conv-1284 (2026-10-29, demande de l'utilisateur) : un lot qui a posé sa question au chef
   * « attend le chef » — un état à part. Noté « échec » jusque-là, il passait pour un lot cassé
   * (bilan du chef dans le test réel de conv-1299 : « il attendait seulement, il n'avait pas échoué »).
   */
  it('la question bloquante d’un lot le met en « attend le chef », relançable (ni « fait » ni « échec »)', () => {
    const plan = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))
    const fin = noterFinDeTour(
      plan,
      'conv-110',
      { ok: true, texte: 'J’ai posé ma question.\n\n⛔ Bloqué : j’attends la réponse du chef' },
      4000
    )
    expect(fin.lot?.etat).toBe('attend-chef')
    expect(fin.lot?.raison).toMatch(/question posée au chef/)
    expect(libelleEtat('attend-chef')).toBe('attend le chef')
    expect(bilanDuPlan(fin.plan)).toMatchObject({ echecs: 0, attendChef: 1 })
    expect(bilanDuPlan(fin.plan).texte).toMatch(
      /0 en échec, 1 en cours, 0 à faire, 1 attend le chef sur 2/
    )
    expect(relancerLot(fin.plan, 1).ok).toBe(true)
    // Apostrophe droite tolérée : le marqueur est réécrit à la main par l'agent.
    const droite = noterFinDeTour(
      plan,
      'conv-110',
      { ok: true, texte: "⛔ Bloqué : j'attends la réponse du chef" },
      4000
    )
    expect(droite.lot?.etat).toBe('attend-chef')
  })

  it('un plan dont un lot attend le chef ne se termine pas ; il ne passe pas « bloqué » non plus', () => {
    const plan = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))
    const attente = noterFinDeTour(
      plan,
      'conv-110',
      { ok: true, texte: '⛔ Bloqué : j’attends la réponse du chef' },
      4000
    ).plan
    const fin = noterFinDeTour(attente, 'conv-120', { ok: true }, 4001).plan
    expect(fin.statut).toBe('en-cours')
    expect(fin.raison).toMatch(/le lot 1 attend la réponse du chef/)
    // Le lot repart (réponse du chef) : la raison s'efface, et sa fin termine le plan.
    const relance = relancerLot(fin, 1)
    if (!relance.ok) throw new Error(relance.erreur)
    expect(relance.plan.raison).toBeUndefined()
    const repart = lancerCeQuiPart(relance.plan)
    expect(noterFinDeTour(repart, 'conv-110', { ok: true }, 4002).plan.statut).toBe('termine')
    // Un lot qui en attend un autre en attente reste à faire, sans « bloqué ».
    const chaine = lancerCeQuiPart(planAccepte({ lots: [lot(1), { ...lot(2), apres: [1] }] }))
    const enAttente = noterFinDeTour(
      chaine,
      'conv-110',
      { ok: true, texte: '⛔ Bloqué : j’attends la réponse du chef' },
      4000
    ).plan
    expect(enAttente.statut).toBe('en-cours')
    expect(enAttente.lots[1].etat).toBe('a-faire')
  })

  // conv-1284 : rien ne tournait, rien n'est interrompu — le plan attend toujours le chef, dont la
  // réponse (un ordre) doit pouvoir relancer le lot sans clic « Reprendre ».
  it('redémarrage pendant que le plan attend le chef : le plan reste en cours, l’ordre relance', () => {
    const plan = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))
    let p = noterFinDeTour(
      plan,
      'conv-110',
      { ok: true, texte: '⛔ Bloqué : j’attends la réponse du chef' },
      4000
    ).plan
    p = noterFinDeTour(p, 'conv-120', { ok: true }, 4001).plan
    const apres = interrompreAuDemarrage(p)
    expect(apres).toBe(p)
    expect(relancerLot(apres, 1).ok).toBe(true)
    // Jumeau : un lot qui tournait au moment du redémarrage interrompt toujours le plan.
    const enCours = noterFinDeTour(
      plan,
      'conv-110',
      { ok: true, texte: '⛔ Bloqué : j’attends la réponse du chef' },
      4000
    ).plan
    expect(interrompreAuDemarrage(enCours).statut).toBe('interrompu')
  })

  it('jumeau : un blocage qui n’attend pas le chef reste un échec', () => {
    const plan = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))
    const fin = noterFinDeTour(
      plan,
      'conv-110',
      { ok: true, texte: '⛔ Bloqué : le build reste rouge, 3 tests en échec' },
      4000
    )
    expect(fin.lot?.etat).toBe('echec')
  })
})

describe('noterDecision — la mémoire partagée du plan (conv-1284)', () => {
  const plan = (): PlanDeLots => planAccepte({ lots: [lot(1), lot(2)] })

  it('note, dédoublonne sans casse, borne la longueur et le nombre', () => {
    const r = noterDecision(plan(), '  le port   reste 5173 ', 'chef', 10)
    if (!r.ok) throw new Error(r.erreur)
    expect(r.plan.decisions).toEqual([{ texte: 'le port reste 5173', de: 'chef', le: 10 }])
    expect(noterDecision(r.plan, 'LE PORT RESTE 5173', 'lot 2', 11)).toMatchObject({
      ok: true,
      deja: true
    })
    expect(noterDecision(plan(), '', 'chef', 1).ok).toBe(false)
    expect(noterDecision(plan(), 42, 'chef', 1).ok).toBe(false)
    expect(noterDecision(plan(), 'x'.repeat(DECISION_MAX + 1), 'chef', 1).ok).toBe(false)
    let p = plan()
    for (let i = 0; i < DECISIONS_MAX; i++) {
      const n = noterDecision(p, `décision ${i}`, 'chef', i)
      if (!n.ok) throw new Error(n.erreur)
      p = n.plan
    }
    expect(noterDecision(p, 'une de plus', 'chef', 99).ok).toBe(false)
  })

  it('refuse un plan écarté (refusé, remplacé) ; accepte un plan fini', () => {
    expect(noterDecision({ ...plan(), statut: 'remplace' }, 'x', 'chef', 1).ok).toBe(false)
    expect(noterDecision({ ...plan(), statut: 'refuse' }, 'x', 'chef', 1).ok).toBe(false)
    expect(noterDecision({ ...plan(), statut: 'termine' }, 'x', 'chef', 1).ok).toBe(true)
  })

  it('le réveil du chef montre les décisions des LOTS, pas les siennes', () => {
    let p = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))
    for (const [texte, de] of [
      ['nom retenu : carte-du-plan.ts', 'lot 2'],
      ['on garde le port 5173', 'chef']
    ]) {
      const n = noterDecision(p, texte, de, 1)
      if (!n.ok) throw new Error(n.erreur)
      p = n.plan
    }
    const reveil = promptDeReveil(p, [1])
    expect(reveil).toContain(
      'Décisions notées par les lots : « nom retenu : carte-du-plan.ts » (lot 2).'
    )
    expect(reveil).not.toContain('port 5173')
    expect(reveil).toMatch(/action « ajouter »/)
    // conv-1284 : la réponse à un lot bloqué part en ordre, sans « relancer » en plus.
    expect(reveil).toMatch(/réponds-lui avec ecrire_a_un_fil, nature « ordre »/)
    expect(reveil).toContain('ne le relance pas en plus')
  })
})

describe('ajouterLots — un plan lancé grandit au lieu d’en exiger un second (conv-1284)', () => {
  it('ajoute à la suite, « apres » peut viser un lot déjà là, le plafond grandit', () => {
    const plan = lancerCeQuiPart(planAccepte({ parallele: 1, lots: [lot(1), lot(2)] }))
    const r = ajouterLots(plan, { lots: [{ ...lot(3), apres: [1], modele: 'haiku' }, lot(4)] })
    if (!r.ok) throw new Error(r.erreur)
    expect(r.plan.lots.map((l) => [l.rang, l.etat, l.apres])).toEqual([
      [1, 'en-cours', []],
      [2, 'a-faire', []],
      [3, 'a-faire', [1]],
      [4, 'a-faire', []]
    ])
    expect(r.plan.lots[2].modele).toBe('haiku')
    expect(r.plan.plafondTours).toBe(plan.plafondTours + 2 * TOURS_PAR_LOT_DEFAUT)
    expect(r.plan.statut).toBe('en-cours')
  })

  it('un plan terminé repart avec les lots ajoutés ; accepte aussi une liste nue en JSON texte', () => {
    let plan = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))
    plan = noterFinDeTour(plan, 'conv-110', { ok: true }, 5).plan
    plan = noterFinDeTour(plan, 'conv-120', { ok: true }, 6).plan
    expect(plan.statut).toBe('termine')
    const r = ajouterLots(plan, JSON.stringify([lot(3)]))
    if (!r.ok) throw new Error(r.erreur)
    expect(r.plan.statut).toBe('en-cours')
    expect(lotsAPartir(r.plan)).toEqual([3])
  })

  it('refuse : plan suspendu ou arrêté, cycle, rang inconnu, trop de lots, rien à ajouter', () => {
    const plan = lancerCeQuiPart(planAccepte({ lots: [lot(1), lot(2)] }))
    const suspendu = ajouterLots({ ...plan, statut: 'suspendu-quota' }, [lot(3)])
    expect(suspendu.ok).toBe(false)
    if (!suspendu.ok) expect(suspendu.erreur).toMatch(/Reprendre/)
    expect(ajouterLots({ ...plan, statut: 'arrete' }, [lot(3)]).ok).toBe(false)
    const cycle = ajouterLots(plan, [
      { ...lot(3), apres: [4] },
      { ...lot(4), apres: [3] }
    ])
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.erreur).toMatch(/cycle/)
    const inconnu = ajouterLots(plan, [{ ...lot(3), apres: [9] }])
    expect(inconnu.ok).toBe(false)
    if (!inconnu.ok) expect(inconnu.erreur).toMatch(/lot 3 : apres — le lot 9 n’existe pas/)
    const trop = ajouterLots(
      plan,
      Array.from({ length: LOTS_MAX - 1 }, (_, i) => lot(i + 3))
    )
    expect(trop.ok).toBe(false)
    expect(ajouterLots(plan, []).ok).toBe(false)
    expect(ajouterLots(plan, { lots: 'non' }).ok).toBe(false)
  })

  it('un lot ajouté qui annonce le fichier d’un lot vivant : averti, et jamais en même temps', () => {
    const plan = lancerCeQuiPart(planAccepte({ parallele: 3, lots: [lot(1), lot(2)] }))
    const r = ajouterLots(plan, [lot(3, ['src/ecran-1.tsx'])])
    if (!r.ok) throw new Error(r.erreur)
    expect(r.avertissements.join(' ')).toMatch(/lot 3 annonce un fichier du lot 1/)
    expect(lotsAPartir(r.plan)).toEqual([])
  })
})
