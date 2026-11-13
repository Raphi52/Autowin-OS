import { describe, expect, it } from 'vitest'
import { CoordinateurDesPlans, type DepsPlans } from './plans-de-lots-app'

/*
 * LE LOT DONT LA REPRISE ATTEND DANS LA FILE (plan-db54feb7, 12/11/2026).
 *
 * Rejoue le blocage du lot 1 : l'app redémarre à 12:01, le travail du lot est mis dans la file des
 * reprises, qui les fait repartir un par un et chacun jusqu'à sa fin. Le plan le remettait « en
 * cours » dès la mise en file : le fil est resté muet 5 h 14 (12:01 → 17:15), sa copie sans un
 * commit, et « relancer » répondait « le lot 1 est en cours : rien à relancer ». Ici, le plan sait
 * que rien ne tourne encore : il accepte la relance, et la reprise mise en file ne part plus quand
 * son tour arrive (deux agents dans le même fil, vécu à 17:15).
 */

const plan2Lots = {
  titre: 'RAM',
  parallele: 1,
  plafondTours: 6,
  lots: [
    {
      titre: 'Lecteurs',
      demande: '/build rends explicites les lecteurs',
      critere: 'le résultat se constate et ses tests passent',
      fichiers: ['src/a.ts']
    },
    {
      titre: 'Bascule',
      demande: '/build bascule',
      critere: 'le résultat se constate et ses tests passent',
      fichiers: ['src/b.ts'],
      apres: [1]
    }
  ]
}

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
    // Aucun tour de chat ne tourne : une reprise en file n'en a pas encore ouvert.
    tourActif: () => false,
    existe: (fil) => fils.has(fil),
    ecrire: () => undefined,
    stockage: { lire: () => stocke, ecrire: (c) => void (stocke = c) },
    maintenant: () => ++horloge,
    nouvelId: () => 'p1'
  }
  let coord = new CoordinateurDesPlans(deps)
  return {
    lancements,
    get coord() {
      return coord
    },
    /** L'app redémarre : le coordinateur relit le fichier des plans. */
    redemarrer() {
      coord = new CoordinateurDesPlans(deps)
    },
    lot(rang: number) {
      return coord.plans()[0]?.lots.find((l) => l.rang === rang)
    },
    statut() {
      return coord.plans()[0]?.statut
    }
  }
}

/** Le lot 1 part dans conv-100 (tour-1), puis l'app redémarre et met sa reprise en file. */
async function repriseMiseEnFile(): Promise<ReturnType<typeof banc>> {
  const b = banc()
  await b.coord.outil('conv-1', { plan: plan2Lots })
  expect(b.lot(1)).toMatchObject({ etat: 'en-cours', fil: 'conv-100', tour: 'tour-1' })
  b.redemarrer()
  expect(b.lot(1)?.etat).toBe('interrompu')
  b.coord.repriseEnFile('conv-100', 'tour-1')
  return b
}

describe('lot dont la reprise attend dans la file après un redémarrage', () => {
  it('le tableau le montre en cours, avec la raison : rien ne tourne encore', async () => {
    const b = await repriseMiseEnFile()
    expect(b.lot(1)?.etat).toBe('en-cours')
    expect(b.statut()).toBe('en-cours')
    expect(b.lot(1)?.raison).toMatch(/file des reprises/)
  })

  it('« relancer » est accepté et relance le lot tout de suite dans son fil', async () => {
    const b = await repriseMiseEnFile()
    const r = await b.coord.outil('conv-1', { action: 'relancer', lot: 1 })
    expect(r.ok).toBe(true)
    expect(b.lancements.map((l) => l.fil)).toEqual(['conv-100', 'conv-100'])
    expect(b.lot(1)).toMatchObject({ etat: 'en-cours', tour: 'tour-2' })
    expect(b.lot(1)?.raison).toBeUndefined()
    expect(b.lot(1)?.repriseEnFile).toBeUndefined()
  })

  it('la reprise mise en file ne part plus quand son tour arrive, et sa fin ne touche pas au lot relancé', async () => {
    const b = await repriseMiseEnFile()
    expect(b.coord.repriseAbandonnee('conv-100', 'tour-1')).toBe(false)
    await b.coord.outil('conv-1', { action: 'relancer', lot: 1 })
    expect(b.coord.repriseAbandonnee('conv-100', 'tour-1')).toBe(true)
    expect(b.coord.repriseAbandonnee('conv-100', 'tour-2')).toBe(false)

    await b.coord.surFinDeTour('conv-100', {
      ok: false,
      perdu: true,
      repris: true,
      tour: 'tour-1',
      erreur: 'run non repris : son lot a été relancé'
    })
    expect(b.lot(1)).toMatchObject({ etat: 'en-cours', tour: 'tour-2' })
  })

  it('une reprise qui démarre vraiment n’est plus relançable : un seul agent par fil', async () => {
    const b = await repriseMiseEnFile()
    b.coord.agentRepris('conv-100', 'tour-1')
    expect(b.lot(1)?.etat).toBe('en-cours')
    expect(b.lot(1)?.raison).toBeUndefined()
    expect(b.lot(1)?.repriseEnFile).toBeUndefined()
    await expect(b.coord.outil('conv-1', { action: 'relancer', lot: 1 })).rejects.toThrow(
      /rien à relancer/
    )
    expect(b.coord.repriseAbandonnee('conv-100', 'tour-1')).toBe(false)
    expect(b.lancements).toHaveLength(1)
  })

  it('un agent rattaché vivant au redémarrage reste non relançable', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan2Lots })
    b.redemarrer()
    b.coord.agentRepris('conv-100', 'tour-1')
    await expect(b.coord.outil('conv-1', { action: 'relancer', lot: 1 })).rejects.toThrow(
      /rien à relancer/
    )
  })

  it('un nouveau redémarrage vide la file : le lot redevient interrompu, sans marque de file', async () => {
    const b = await repriseMiseEnFile()
    b.redemarrer()
    expect(b.lot(1)?.etat).toBe('interrompu')
    expect(b.lot(1)?.repriseEnFile).toBeUndefined()
  })

  it('une reprise mise en file pour un AUTRE tour du fil n’adopte pas le lot', async () => {
    const b = banc()
    await b.coord.outil('conv-1', { plan: plan2Lots })
    b.redemarrer()
    b.coord.repriseEnFile('conv-100', 'tour-ancien')
    expect(b.lot(1)?.etat).toBe('interrompu')
  })
})
