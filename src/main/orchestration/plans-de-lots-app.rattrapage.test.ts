import { describe, expect, it } from 'vitest'
import { CoordinateurDesPlans, type DepsPlans } from './plans-de-lots-app'

/*
 * LE LOT EN ÉCHEC RATTRAPÉ DANS SON PROPRE FIL (2026-11-06).
 *
 * Vécu sur le lot 3 du plan du coffre à clés : refusé par le contrôle final, le lot a été repris à
 * la main dans son fil, et ce second travail a été validé par le contrôle final puis intégré. Le
 * tableau l'affichait pourtant encore « échec » : seule la fin du tour d'un lot EN COURS comptait,
 * et le bouton « Relancer » proposait de refaire 16 $ de travail déjà fait. Ici, un travail validé
 * dans le fil d'un lot en échec le passe « fait » ; une simple réponse dans ce fil ne change rien.
 */

const REFUS =
  'refusé par le contrôle final : Échec déjà déclaré ; Promis mais pas fait : « Cible nommee dans la demande reellement modifiee : src/main/crash-handlers.ts ».'

const planDeDeux = (plafondTours: number) => ({
  titre: 'Coffre',
  parallele: 1,
  plafondTours,
  lots: [
    {
      titre: 'Masquage',
      demande: '/build masque les valeurs',
      critere: 'le résultat se constate et ses tests passent',
      fichiers: ['src/a.ts']
    },
    {
      titre: 'Revue',
      demande: '/build relis le coffre',
      critere: 'le résultat se constate et ses tests passent',
      fichiers: [],
      apres: [1]
    }
  ]
})

function banc() {
  const lancements: Array<{ fil: string; prompt: string }> = []
  const ecrits: Array<{ de: string; a: string; texte: string }> = []
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
    ecrire: (de, a, texte) => {
      ecrits.push({ de, a, texte })
    },
    stockage: { lire: () => stocke, ecrire: (c) => void (stocke = c) },
    maintenant: () => ++horloge,
    nouvelId: () => 'p1'
  }
  const coord = new CoordinateurDesPlans(deps)
  const plan = () => coord.plans()[0]
  const lot = (rang: number) => plan()?.lots.find((l) => l.rang === rang)
  return { coord, lancements, ecrits, plan, lot }
}

/** Le lot 1 part dans conv-100 et finit refusé par le contrôle final. */
async function lotEnEchec(b: ReturnType<typeof banc>, plafondTours: number): Promise<void> {
  await b.coord.outil('conv-1', { plan: planDeDeux(plafondTours) })
  expect(b.lot(1)?.fil).toBe('conv-100')
  await b.coord.surFinDeTour('conv-100', {
    ok: true,
    tour: 'tour-1',
    texte: `Échec du workflow : ${REFUS}`,
    echecOrchestration: REFUS
  })
  expect(b.lot(1)?.etat).toBe('echec')
}

describe('lot en échec rattrapé dans son propre fil', () => {
  it('un travail validé par le contrôle final rend le lot à recevoir ; le chef le reçoit et le lot suivant part', async () => {
    const b = banc()
    await lotEnEchec(b, 3)
    expect(b.plan()?.statut).toBe('bloque')
    const toursAvant = b.plan()?.toursLances
    const ecritsAvant = b.ecrits.length

    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      tour: 'tour-repris-a-la-main',
      texte: '✅ Fait\n1. Lot repris et validé par le contrôle final.',
      orchestrationReussie: true
    })

    // Validé par le contrôle final du fil, pas encore par le chef : le lot 2 attend sa réception.
    expect(b.lot(1)?.etat).toBe('a-recevoir')
    expect(b.lot(1)?.raison).toMatch(/le chef le vérifie sur son critère/)
    expect(b.lot(2)?.etat).toBe('a-faire')
    expect(b.plan()?.statut).toBe('en-cours')
    // Le rattrapage n'a pas été lancé par le plan : il ne coûte aucun tour au plafond.
    expect(b.plan()?.toursLances).toBe(toursAvant)
    const compteRendu = b.ecrits.slice(ecritsAvant).find((e) => e.a === 'conv-1')
    expect(compteRendu?.de).toBe('conv-100')
    expect(compteRendu?.texte).toMatch(/Lot repris et validé/)
    await b.coord.outil('conv-1', {
      action: 'valider',
      lot: 1,
      preuve: 'capture lue : le coffre masque les valeurs, tests verts'
    })
    expect(b.lot(1)?.etat).toBe('fait')
    // Le seul tour en plus est celui du lot 2, qui attendait le lot 1.
    expect(b.plan()?.toursLances).toBe((toursAvant ?? 0) + 1)
    expect(b.lot(2)?.etat).toBe('en-cours')
  })

  it('plan arrêté par le plafond : le lot est rendu puis reçu, le plan reste arrêté', async () => {
    const b = banc()
    await lotEnEchec(b, 2)
    // Relancé une fois par le chef, refusé de nouveau : les 2 tours du plan sont épuisés.
    await b.coord.outil('conv-1', { action: 'relancer', lot: 1 })
    expect(b.lot(1)?.etat).toBe('en-cours')
    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      texte: `Échec du workflow : ${REFUS}`,
      echecOrchestration: REFUS
    })
    expect(b.lot(1)?.etat).toBe('echec')
    expect(b.plan()?.statut).toBe('plafond-atteint')

    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      tour: 'tour-repris-a-la-main',
      texte: '✅ Fait',
      orchestrationReussie: true
    })

    expect(b.lot(1)?.etat).toBe('a-recevoir')
    expect(b.plan()?.statut).toBe('plafond-atteint')
    await b.coord.outil('conv-1', {
      action: 'valider',
      lot: 1,
      preuve: 'capture lue : le coffre masque les valeurs, tests verts'
    })
    expect(b.lot(1)?.etat).toBe('fait')
    expect(b.plan()?.statut).toBe('plafond-atteint')
    expect(b.plan()?.toursLances).toBe(2)
    expect(b.lot(2)?.etat).toBe('a-faire')
  })

  it('jumeau : une simple réponse dans le fil du lot en échec ne change rien', async () => {
    const b = banc()
    await lotEnEchec(b, 3)
    const avant = JSON.stringify(b.plan())
    const ecritsAvant = b.ecrits.length

    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      tour: 'tour-question',
      texte: 'Le tableau reste rouge parce que seul le premier essai a compté.'
    })

    expect(JSON.stringify(b.plan())).toBe(avant)
    expect(b.ecrits.length).toBe(ecritsAvant)
  })

  it('jumeau : un travail validé dont la réponse se déclare bloquée ne rattrape pas le lot', async () => {
    const b = banc()
    await lotEnEchec(b, 3)

    await b.coord.surFinDeTour('conv-100', {
      ok: true,
      tour: 'tour-bloque',
      texte: '⛔ Bloqué : j’attends la réponse du chef',
      orchestrationReussie: true
    })

    expect(b.lot(1)?.etat).toBe('echec')
    expect(b.lot(1)?.raison).toMatch(/contrôle final/)
  })
})
