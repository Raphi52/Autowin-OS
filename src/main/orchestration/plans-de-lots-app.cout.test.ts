import { describe, expect, it } from 'vitest'
import { CoordinateurDesPlans, type DepsPlans } from './plans-de-lots-app'

/*
 * LE COÛT D'UN PLAN, MESURÉ (kaizen de conv-2153, 2026-11-28). Rejoue plan-676a4b19 : au dépôt de 18
 * lots, le chef a annoncé « entre 100 et 400 $ », faute d'autre repère que le coût d'une exécution
 * (médiane 5 $) ; chaque fil de lot a coûté de 30 à 220 $, le plan environ 2 000 $, et aucun réveil
 * ne montrait la dépense. Ici, le dépôt rend le coût mesuré d'un lot, et chaque réveil la dépense
 * réelle face à l'estimation. Rien n'est bloqué (« ni budget ni blocage », 2026-10-28).
 */

/** Cinq lots déjà faits sur le poste, dans des fils qui ont coûté 40 à 200 $ (médiane 90 $). */
const ANCIEN = {
  id: 'plan-ancien',
  chef: 'conv-9',
  cle: 'ancien',
  titre: 'Ancien chantier',
  parallele: 20,
  plafondTours: 10,
  toursLances: 5,
  statut: 'termine',
  avertissements: [],
  creeLe: 1,
  lots: [40, 60, 90, 120, 200].map((usd, i) => ({
    rang: i + 1,
    titre: `Ancien ${i + 1}`,
    demande: '/build x',
    critere: 'le résultat se constate et ses tests passent',
    fichiers: [],
    etat: 'fait',
    fil: `conv-a${usd}`
  }))
}

const COUTS: Record<string, number> = {
  'conv-a40': 40,
  'conv-a60': 60,
  'conv-a90': 90,
  'conv-a120': 120,
  'conv-a200': 200
}

const planDeTrois = () => ({
  titre: 'Refonte',
  contexte: 'BUT : chaque écran lit la base et ses gestes écrivent, comme dans l’original.'.repeat(
    2
  ),
  lots: [1, 2, 3].map((n) => ({
    titre: `Lot ${n}`,
    demande: `/build écran ${n}`,
    critere: 'un geste joué puis relu sur au moins 3 écrans',
    fichiers: [`src/e${n}.tsx`],
    ...(n === 3 ? { apres: [1] } : {})
  }))
})

function banc(opts: { avecAncien: boolean; avecRegistre: boolean }) {
  const lancements: Array<{ fil: string; prompt: string }> = []
  const fils = new Set(['conv-1'])
  const couts: Record<string, number> = { ...COUTS }
  let prochain = 100
  let horloge = 1_000
  let stocke = opts.avecAncien ? JSON.stringify({ plans: [ANCIEN] }) : ''
  const deps: DepsPlans = {
    creerFil: () => {
      const fil = `conv-${prochain++}`
      fils.add(fil)
      return fil
    },
    lancer: async (fil, prompt) => {
      lancements.push({ fil, prompt })
      return { ok: true, turnId: `tour-${lancements.length}` }
    },
    tourActif: () => false,
    existe: (fil) => fils.has(fil),
    ecrire: () => {},
    stockage: { lire: () => stocke, ecrire: (c) => void (stocke = c) },
    maintenant: () => ++horloge,
    nouvelId: () => 'p1',
    ...(opts.avecRegistre ? { depenseDuFil: (fil: string) => couts[fil] } : {})
  }
  const coord = new CoordinateurDesPlans(deps)
  const plan = () => coord.plans().find((p) => p.id === 'plan-p1')
  return { coord, lancements, plan, couts }
}

describe('plan de lots — le coût se mesure au dépôt et se montre à chaque réveil', () => {
  it('le dépôt rend le coût mesuré d’un lot et le garde comme estimation du plan', async () => {
    const b = banc({ avecAncien: true, avecRegistre: true })
    const r = (await b.coord.outil('conv-1', { plan: planDeTrois() })) as { detail: string }
    expect(r.detail).toContain(
      'COÛT ATTENDU, mesuré sur ce poste : un lot de plan coûte 90 $ en médiane'
    )
    expect(r.detail).toContain('9 sur 10 sous 120 $, sur 5 lots faits')
    expect(r.detail).toContain(
      'ces 3 lots ≈ 270 $, jusqu’à 360 $ si chacun reste dans les 9 sur 10'
    )
    expect(r.detail).toMatch(/pas le coût d’une exécution/)
    expect(r.detail).toMatch(/Dis-le-lui en une phrase, coût compris/)
    expect(b.plan()?.estimationUsd).toBe(360)
  })

  it('chaque réveil du chef porte la dépense réelle et signale le dépassement', async () => {
    const b = banc({ avecAncien: true, avecRegistre: true })
    await b.coord.outil('conv-1', { plan: planDeTrois() })
    // Les lots 1 et 2 partent dans conv-100 et conv-101 ; le lot 1 coûte déjà 350 $.
    b.couts['conv-100'] = 350
    b.couts['conv-101'] = 30
    b.couts['conv-1'] = 12
    await b.coord.surFinDeTour('conv-100', { ok: true, tour: 'tour-1', texte: 'Fait.' })
    const reveil = b.lancements.find((l) => l.fil === 'conv-1')?.prompt ?? ''
    expect(reveil).toContain(
      'Dépensé jusqu’ici : 380 $ dans les fils des lots, plus 12 $ dans ton fil — estimé au dépôt : jusqu’à 360 $ — DÉPASSÉ'
    )
  })

  it('contrôle négatif : sous l’estimation, la dépense se dit sans alerte — même avec un fil chef chargé', async () => {
    const b = banc({ avecAncien: true, avecRegistre: true })
    await b.coord.outil('conv-1', { plan: planDeTrois() })
    b.couts['conv-100'] = 50
    // Un fil chef qui portait 900 $ de tours avant le plan : l’estimation ne compte que les lots.
    b.couts['conv-1'] = 900
    await b.coord.surFinDeTour('conv-100', { ok: true, tour: 'tour-1', texte: 'Fait.' })
    const reveil = b.lancements.find((l) => l.fil === 'conv-1')?.prompt ?? ''
    expect(reveil).toContain(
      'Dépensé jusqu’ici : 50 $ dans les fils des lots, plus 900 $ dans ton fil — estimé au dépôt : jusqu’à 360 $.'
    )
    expect(reveil).not.toContain('DÉPASSÉ')
  })

  it('moins de 5 lots mesurés : aucun chiffre avancé, et surtout pas celui d’une exécution', async () => {
    const b = banc({ avecAncien: false, avecRegistre: true })
    const r = (await b.coord.outil('conv-1', { plan: planDeTrois() })) as { detail: string }
    expect(r.detail).toContain('aucun ordre de grandeur fiable')
    expect(r.detail).toContain('N’annonce pas un chiffre tiré du coût d’une exécution')
    expect(b.plan()?.estimationUsd).toBeUndefined()
  })

  it('sans registre des coûts câblé : le dépôt et le réveil restent ceux d’avant', async () => {
    const b = banc({ avecAncien: true, avecRegistre: false })
    const r = (await b.coord.outil('conv-1', { plan: planDeTrois() })) as { detail: string }
    expect(r.detail).not.toContain('COÛT')
    expect(r.detail).toMatch(/Dis-le-lui en une phrase, puis termine ton tour/)
    await b.coord.surFinDeTour('conv-100', { ok: true, tour: 'tour-1', texte: 'Fait.' })
    const reveil = b.lancements.find((l) => l.fil === 'conv-1')?.prompt ?? ''
    expect(reveil).toContain('RÉVEIL DU PLAN DE LOTS')
    expect(reveil).not.toContain('Dépensé')
  })
})
