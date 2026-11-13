import { describe, expect, it } from 'vitest'
import { CoordinateurDesPlans, type DepsPlans } from './plans-de-lots-app'

/*
 * LE CHEF TRANCHE UN LOT EN ÉCHEC (2026-11-08, demande de l'utilisateur : « quand ça fait ça, ça
 * devrait remonter à la superconv »).
 *
 * Vécu sur le lot 2 de plan-43ed2d7d : son fil s'est déclaré « ⚠️ Non résolu » pour un test rouge
 * venu d'un autre fil, alors que son propre travail était fait. Le chef, réveillé, l'a vérifié
 * (69/69, typage vert, déjà intégré) et a répondu « je ne relance pas le lot 2 : son travail est
 * bon » — mais aucun outil ne lui permettait de le dire au tableau. Le lot restait « échec », avec
 * « Relancer le 2 » offert à l'utilisateur pour refaire un travail fini. Ici, le verdict du chef
 * passe dans le plan : le lot devient « fait », avec la preuve du chef pour raison.
 */

const BLOCAGE_SANS_RAPPORT = [
  'Le correctif est vérifié dans la copie de travail : 69 tests verts.',
  '',
  'J’ai rejoué la commande telle quelle : `edit-file-portee` passe, mais ⚠️ Non résolu pour `theme-malvoyant-planchers`, qui reste rouge sans lien avec mon travail.'
].join('\n')

const PREUVE =
  'vérifié dans conv-1715 : 5 fichiers de test 69/69, typage code 0, déjà intégré ; le rouge du thème vient d’un autre fil.'

const planDeDeux = () => ({
  titre: 'Kaizen',
  parallele: 1,
  plafondTours: 3,
  lots: [
    {
      titre: 'Cause A',
      demande: '/build corrige la cause A',
      critere: 'le résultat se constate et ses tests passent',
      fichiers: ['src/a.ts']
    },
    {
      titre: 'Bilan',
      demande: '/build fais le bilan',
      critere: 'le résultat se constate et ses tests passent',
      fichiers: [],
      apres: [1]
    }
  ]
})

function banc() {
  const lancements: Array<{ fil: string; prompt: string }> = []
  const fils = new Set(['conv-1'])
  let prochain = 100
  let horloge = 1_000
  let stocke = ''
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
    nouvelId: () => 'p1'
  }
  const coord = new CoordinateurDesPlans(deps)
  const plan = () => coord.plans()[0]
  const lot = (rang: number) => plan()?.lots.find((l) => l.rang === rang)
  return { coord, lancements, plan, lot }
}

/** Le lot 1 part dans conv-100 et finit en se déclarant bloqué par un rouge qui n'est pas le sien. */
async function lotBloqueSansRapport(b: ReturnType<typeof banc>): Promise<void> {
  await b.coord.outil('conv-1', { plan: planDeDeux() })
  await b.coord.surFinDeTour('conv-100', { ok: true, tour: 'tour-1', texte: BLOCAGE_SANS_RAPPORT })
  expect(b.lot(1)?.etat).toBe('echec')
  expect(b.lot(1)?.raison).toMatch(/^le fil se déclare bloqué : /)
  expect(b.plan()?.statut).toBe('bloque')
}

describe('plan_de_lots « valider » : le verdict du chef passe dans le tableau', () => {
  it('cas réel : le chef valide le lot bloqué par un rouge sans rapport — fait, sans tour, la suite part', async () => {
    const b = banc()
    await lotBloqueSansRapport(b)
    const toursAvant = b.plan()?.toursLances ?? 0

    const r = await b.coord.outil('conv-1', { action: 'valider', lot: 1, preuve: PREUVE })

    expect(r.ok).toBe(true)
    expect(b.lot(1)?.etat).toBe('fait')
    expect(b.lot(1)?.raison).toBe(`validé par le chef : ${PREUVE}`)
    // La validation ne lance rien dans le lot 1 : le seul tour en plus est celui du lot 2, qui l'attendait.
    expect(b.lancements.filter((l) => l.fil === 'conv-100')).toHaveLength(1)
    expect(b.lot(2)?.etat).toBe('en-cours')
    expect(b.plan()?.toursLances).toBe(toursAvant + 1)
    expect(b.plan()?.statut).toBe('en-cours')
    // Plus rien à relancer : le bouton « Relancer le 1 » disparaît avec l'état « échec ».
    await expect(b.coord.outil('conv-1', { action: 'relancer', lot: 1 })).rejects.toThrow(
      /lot 1 est fait/
    )
  })

  it('refus : sans preuve, sur un lot qui n’est pas en échec, ou depuis le fil d’un lot', async () => {
    const b = banc()
    await lotBloqueSansRapport(b)
    const avant = JSON.stringify(b.plan())

    await expect(b.coord.outil('conv-1', { action: 'valider', lot: 1 })).rejects.toThrow(/preuve/)
    await expect(
      b.coord.outil('conv-1', { action: 'valider', lot: 1, preuve: '   ' })
    ).rejects.toThrow(/preuve/)
    await expect(
      b.coord.outil('conv-1', { action: 'valider', lot: 2, preuve: PREUVE })
    ).rejects.toThrow(/lot 2 est à faire/)
    await expect(
      b.coord.outil('conv-1', { action: 'valider', lot: 9, preuve: PREUVE })
    ).rejects.toThrow(/lot 9 inconnu/)
    // Un lot ne se déclare pas fait lui-même : seul le chef tranche.
    await expect(
      b.coord.outil('conv-100', { action: 'valider', lot: 1, preuve: PREUVE })
    ).rejects.toThrow(/seul le fil chef/)

    expect(JSON.stringify(b.plan())).toBe(avant)
  })
})
