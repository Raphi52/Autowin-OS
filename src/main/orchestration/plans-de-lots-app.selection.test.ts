import { describe, expect, it } from 'vitest'
import { CoordinateurDesPlans, type DepsPlans } from './plans-de-lots-app'

/*
 * LE BOUTON DU WORKFLOW INTELLIGENT (2026-10-30) — ce qu'un clic NE doit PAS repayer. Un
 * lot coûte un run entier (11 $ pour une correction) ; le panneau perd son état « lancé »
 * dès qu'il remonte, donc la garde vit ici, avec le plan.
 */
function banc(): { coord: CoordinateurDesPlans; lots: () => string[] } {
  const lancements: string[] = []
  const fils = new Set(['chef'])
  let prochain = 1
  let contenu = ''
  const deps: DepsPlans = {
    creerFil: () => {
      const fil = `lot-${prochain++}`
      fils.add(fil)
      return fil
    },
    lancer: async (fil) => {
      lancements.push(fil)
      return { ok: true, turnId: `tour-${lancements.length}` }
    },
    tourActif: () => false,
    existe: (fil) => fils.has(fil),
    ecrire: () => undefined,
    stockage: {
      lire: () => contenu,
      ecrire: (texte) => {
        contenu = texte
      }
    },
    maintenant: () => 1_000,
    nouvelId: () => `p${prochain}`
  }
  return {
    coord: new CoordinateurDesPlans(deps),
    // Le chef est réveillé après chaque lot : ce n'est pas un lot de plus.
    lots: () => lancements.filter((fil) => fil !== 'chef')
  }
}

const selection = (nom = 'Piste'): unknown => ({
  titre: 'Sélection du scout : 2 pistes',
  contexte:
    'Pistes cochées par l’utilisateur dans le panneau des candidats du scout. Chaque lot ne traite que ses pistes.',
  lots: [1, 2].map((n) => ({
    titre: `${nom} ${n}`,
    demande: `Traite ce candidat issu du scout interne d'Autowin :\n\n1. ${nom} ${n}`,
    fichiers: [`src/${nom.toLowerCase()}-${n}.ts`]
  }))
})

describe('lancerSelection — un clic de trop ne repaie rien', () => {
  it('le 3e lot attend sa place : deux fils tournent, jamais plus que le plan n’en porte', async () => {
    const b = banc()
    await b.coord.lancerSelection('chef', selection())
    expect(b.lots()).toEqual(['lot-1', 'lot-2'])
  })

  it('la même sélection, plan terminé : aucun run ne repart', async () => {
    const b = banc()
    await b.coord.lancerSelection('chef', selection())
    await b.coord.surFinDeTour('lot-1', { ok: true, texte: 'fait' })
    await b.coord.surFinDeTour('lot-2', { ok: true, texte: 'fait' })
    expect(b.coord.planDuFil('chef')?.plan.statut).toBe('termine')

    const r = await b.coord.lancerSelection('chef', selection())
    expect(r.ok && r.deja).toBe(true)
    expect(b.lots()).toEqual(['lot-1', 'lot-2'])
  })

  it('jumeau : une AUTRE sélection, plan terminé, part bien', async () => {
    const b = banc()
    await b.coord.lancerSelection('chef', selection())
    await b.coord.surFinDeTour('lot-1', { ok: true, texte: 'fait' })
    await b.coord.surFinDeTour('lot-2', { ok: true, texte: 'fait' })

    const r = await b.coord.lancerSelection('chef', selection('Autre'))
    expect(r.ok && r.deja).toBeFalsy()
    expect(b.lots()).toEqual(['lot-1', 'lot-2', 'lot-3', 'lot-4'])
  })
})
