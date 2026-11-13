import { describe, expect, it } from 'vitest'
import { CoordinateurDesPlans, type DepsPlans } from './plans-de-lots-app'

/*
 * LE LOT BLOQUÉ PAR LE TRAVAIL NON COMMITÉ D'UN AUTRE FIL (2026-11-06).
 *
 * Mesuré sur les trois plans du 06/11 : 27 des 58 essais des fils de lots ont fini VÉRIFIÉS mais
 * refusés à l'intégration, parce que leurs fichiers portaient le travail non commité d'un autre fil
 * dans le dossier partagé. Le plan les notait « échec », le chef les relançait, chaque relance
 * refaisait tout le travail et retombait sur le même mur (lot 2 du coffre : 12 essais, 9 refusés),
 * et l'utilisateur intervenait pour faire commiter le fil qui bloquait. Ici : le lot ATTEND sa
 * publication, l'app demande le commit au fil qui tient les fichiers, et le lot est noté fait
 * quand le travail gardé de côté finit publié (republication automatique).
 */

// La forme exacte du motif d’un vrai refus (lot 2 du coffre, 06/11).
const ECHEC_BASE =
  'refusé par le contrôle final : intégration locale non terminée ; blocage d’intégration: base-dirty — cause: des fichiers non committés de la base bloquent la publication — fichiers en cause: src/main/providers/claude.ts, src/main/commands/types.ts'

const plan2 = {
  titre: 'Coffre',
  parallele: 1,
  plafondTours: 2,
  lots: [
    {
      titre: 'Injection',
      demande: '/build injecte les clés',
      critere: 'le résultat se constate et ses tests passent',
      fichiers: ['src/main/providers/claude.ts']
    },
    {
      titre: 'Revue',
      demande: '/build relis le coffre',
      critere: 'le résultat se constate et ses tests passent',
      fichiers: [],
      apres: [1]
    }
  ]
}

function banc(options: { proprietaires?: string[]; ordreRefuse?: boolean } = {}) {
  const lancements: Array<{ fil: string; prompt: string }> = []
  const ordres: Array<{ de: string; a: string; texte: string }> = []
  const ecrits: Array<{ de: string; a: string; texte: string }> = []
  const demandesProprietaires: Array<{ chef: string; fichiers: readonly string[] }> = []
  const fils = new Set(['conv-1', 'conv-1650'])
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
    ecrire: (de, a, texte) => {
      ecrits.push({ de, a, texte })
    },
    proprietaires: (chef, fichiers) => {
      demandesProprietaires.push({ chef, fichiers })
      return options.proprietaires ?? []
    },
    ordonner: async (de, a, texte) => {
      if (options.ordreRefuse) throw new Error('plafond horaire des messages atteint')
      ordres.push({ de, a, texte })
    },
    stockage: { lire: () => stocke, ecrire: (c) => void (stocke = c) },
    maintenant: () => ++horloge,
    nouvelId: () => 'p1'
  }
  const coord = new CoordinateurDesPlans(deps)
  const lot = (rang: number) => coord.plans()[0]?.lots.find((l) => l.rang === rang)
  return {
    coord,
    lancements,
    ordres,
    ecrits,
    demandesProprietaires,
    lot,
    relire: () => stocke,
    deps
  }
}

async function lotBloqueParLaBase(b: ReturnType<typeof banc>): Promise<void> {
  await b.coord.outil('conv-1', { plan: plan2 })
  expect(b.lot(1)?.fil).toBe('conv-100')
  await b.coord.surFinDeTour('conv-100', {
    ok: true,
    tour: 'tour-1',
    texte: 'Échec du workflow : refusé par le contrôle final.',
    echecOrchestration: ECHEC_BASE
  })
}

describe('lot vérifié mais bloqué par le travail non commité d’un autre fil', () => {
  it('le lot attend sa publication, n’est pas en échec, et le plan reste en cours malgré le plafond', async () => {
    const b = banc({ proprietaires: ['conv-1650'] })
    await lotBloqueParLaBase(b)
    expect(b.lot(1)?.etat).toBe('attend-publication')
    expect(b.lot(1)?.raison).toMatch(/src\/main\/providers\/claude\.ts/)
    expect(b.lot(1)?.raison).toMatch(/conv-1650/)
    const plan = b.coord.plans()[0]
    // 1 tour sur 2 dépensé : ni « bloqué », ni « plafond atteint ».
    expect(plan.statut).toBe('en-cours')
    expect(plan.raison).toMatch(/publication/)
    // Le lot 2 dépend du lot 1 : il ne part pas sur une base qui n'a pas encore son travail.
    expect(b.lancements.map((l) => l.fil)).not.toContain('conv-101')
  })

  it('l’app demande le commit au fil qui tient les fichiers, au nom du lot, avec les fichiers nommés', async () => {
    const b = banc({ proprietaires: ['conv-1650', 'conv-100', 'conv-1650'] })
    await lotBloqueParLaBase(b)
    expect(b.demandesProprietaires).toEqual([
      { chef: 'conv-1', fichiers: ['src/main/providers/claude.ts', 'src/main/commands/types.ts'] }
    ])
    // Une seule demande, jamais au fil du lot lui-même.
    expect(b.ordres).toHaveLength(1)
    expect(b.ordres[0].de).toBe('conv-100')
    expect(b.ordres[0].a).toBe('conv-1650')
    expect(b.ordres[0].texte).toMatch(/src\/main\/providers\/claude\.ts/)
    expect(b.ordres[0].texte).toMatch(/src\/main\/commands\/types\.ts/)
    expect(b.ordres[0].texte).toMatch(/commite/i)
    expect(b.ordres[0].texte).toMatch(/sans pousser/)
  })

  it('le réveil du chef dit d’attendre : ni relance, ni report à la main', async () => {
    const b = banc({ proprietaires: ['conv-1650'] })
    await lotBloqueParLaBase(b)
    const reveil = b.lancements.find((l) => l.fil === 'conv-1')?.prompt ?? ''
    expect(reveil).toMatch(/attend sa publication/)
    expect(reveil).toMatch(/ne le relance pas/)
    expect(reveil).toMatch(/à la main/)
  })

  it('le chef ne peut pas relancer un lot qui attend sa publication : il referait le travail', async () => {
    const b = banc({ proprietaires: ['conv-1650'] })
    await lotBloqueParLaBase(b)
    await expect(b.coord.outil('conv-1', { action: 'relancer', lot: 1 })).rejects.toThrow(
      /attend sa publication/
    )
    expect(b.lot(1)?.etat).toBe('attend-publication')
  })

  it('le travail gardé de côté finit publié : le lot est à recevoir, le suivant part à sa réception', async () => {
    const b = banc({ proprietaires: ['conv-1650'] })
    await lotBloqueParLaBase(b)
    await b.coord.surFinDeTour('conv-1', { ok: true })
    // Le run bloqué du lot, vu dans l'activité : il est retenu comme celui qui publiera le lot.
    b.coord.surActiviteDesRuns([
      { agentId: 'run-a', conversationId: 'conv-100', publication: 'blocked', verdict: 'green' },
      // Le travail publié d'un AUTRE fil ne touche pas le lot.
      { agentId: 'run-x', conversationId: 'conv-1650', publication: 'published', verdict: 'green' }
    ])
    expect(b.lot(1)?.etat).toBe('attend-publication')
    b.coord.surActiviteDesRuns([
      { agentId: 'run-a', conversationId: 'conv-100', publication: 'published', verdict: 'green' }
    ])
    await new Promise((r) => setTimeout(r, 0))
    // Publié n'est pas reçu : le chef le vérifie comme tout lot rendu.
    expect(b.lot(1)?.etat).toBe('a-recevoir')
    expect(b.lancements.map((l) => l.fil)).not.toContain('conv-101')
    expect(
      b.ecrits.some(
        (e) => e.a === 'conv-1' && /Lot 1\/2 « Injection » : à recevoir par le chef/.test(e.texte)
      )
    ).toBe(true)
    await b.coord.outil('conv-1', {
      action: 'valider',
      lot: 1,
      preuve: 'capture lue : le coffre masque les valeurs, tests verts'
    })
    expect(b.lot(1)?.etat).toBe('fait')
    expect(b.lot(2)?.fil).toBe('conv-101')
    expect(b.lancements.map((l) => l.fil)).toContain('conv-101')
  })

  it('un ancien run du même fil déjà publié avant le blocage ne fait pas passer le lot', async () => {
    const b = banc({ proprietaires: ['conv-1650'] })
    await lotBloqueParLaBase(b)
    b.coord.surActiviteDesRuns([
      {
        agentId: 'run-ancien',
        conversationId: 'conv-100',
        publication: 'complete',
        verdict: 'green'
      },
      { agentId: 'run-a', conversationId: 'conv-100', publication: 'blocked', verdict: 'green' }
    ])
    b.coord.surActiviteDesRuns([
      {
        agentId: 'run-ancien',
        conversationId: 'conv-100',
        publication: 'complete',
        verdict: 'green'
      },
      { agentId: 'run-a', conversationId: 'conv-100', publication: 'blocked', verdict: 'green' }
    ])
    expect(b.lot(1)?.etat).toBe('attend-publication')
  })

  it('l’attente survit à un redémarrage : le run retenu est relu du disque et le plan reste en cours', async () => {
    const b = banc({ proprietaires: ['conv-1650'] })
    await lotBloqueParLaBase(b)
    b.coord.surActiviteDesRuns([
      { agentId: 'run-a', conversationId: 'conv-100', publication: 'blocked', verdict: 'green' }
    ])
    const relu = new CoordinateurDesPlans({
      ...b.deps,
      stockage: { lire: () => b.relire(), ecrire: () => undefined }
    })
    expect(relu.plans()[0].statut).toBe('en-cours')
    expect(relu.plans()[0].lots[0].etat).toBe('attend-publication')
    relu.surActiviteDesRuns([
      {
        agentId: 'run-a',
        conversationId: 'conv-100',
        publication: 'cleanup-pending',
        verdict: 'green'
      }
    ])
    expect(relu.plans()[0].lots[0].etat).toBe('a-recevoir')
  })

  it('aucun fil connu ne tient les fichiers : aucune demande, et le chef apprend qu’il faut les commiter', async () => {
    const b = banc({ proprietaires: [] })
    await lotBloqueParLaBase(b)
    expect(b.ordres).toEqual([])
    expect(b.lot(1)?.etat).toBe('attend-publication')
    expect(b.lot(1)?.raison).toMatch(/aucun fil connu/)
  })

  it('une demande de commit refusée ne casse pas la note du lot', async () => {
    const b = banc({ proprietaires: ['conv-1650'], ordreRefuse: true })
    await lotBloqueParLaBase(b)
    expect(b.lot(1)?.etat).toBe('attend-publication')
    expect(b.lancements.some((l) => l.fil === 'conv-1')).toBe(true)
  })

  it('un conflit de contenu (merge-failed) reste un échec : l’arbitrer revient à l’utilisateur', async () => {
    const b = banc({ proprietaires: ['conv-1650'] })
    await b.coord.outil('conv-1', { plan: plan2 })
    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      tour: 'tour-1',
      echecOrchestration:
        'refusé par le contrôle final : blocage d’intégration: merge-failed — cause: la fusion dans la base a été refusée — fichiers en cause: src/main/providers/claude.ts'
    })
    expect(b.lot(1)?.etat).toBe('echec')
    expect(b.ordres).toEqual([])
  })
})
