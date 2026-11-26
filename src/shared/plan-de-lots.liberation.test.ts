import { describe, expect, it } from 'vitest'
import {
  attenteDuLot,
  creerPlan,
  libererFichiersDuLot,
  lirePlanDeLots,
  lotsAPartir,
  marquerLance,
  type PlanDeLots
} from './plan-de-lots'

/**
 * « Les lots devraient s'enchaîner pendant que les juges corrigent » (Raphaël, 26/11/2026,
 * plan-676a4b19). Mesuré : le lot 4 a réuni son travail sur main à 11:28, son juge a tourné
 * jusqu'à 11:41, et le lot 5, qui annonçait le même dossier, a attendu ces 13 minutes.
 * Dès que le juge d'un lot démarre, sa construction est finie : ses fichiers sont rendus.
 */
const CONTEXTE =
  'Rendre les écrans fonctionnels, un lot par famille. Décidé : chaque lot écrit son lecteur et son écrivain dans le même dossier du socle.'

const lot = (n: number, fichiers: string[]): Record<string, unknown> => ({
  titre: `Lot ${n}`,
  demande: `/build branche la famille ${n}`,
  critere: 'les écrans de la famille lisent la base et leurs gestes sont relus',
  fichiers
})

function planEnCours(lots: Record<string, unknown>[]): PlanDeLots {
  const r = lirePlanDeLots({ contexte: CONTEXTE, lots })
  if (!r.ok) throw new Error(r.erreur)
  const plan = creerPlan(r.plan, { id: 'plan-1', chef: 'conv-1', maintenant: 1000 })
  return { ...plan, statut: 'en-cours' }
}

function lancerCeQuiPart(plan: PlanDeLots): PlanDeLots {
  let p = plan
  for (const rang of lotsAPartir(p)) p = marquerLance(p, rang, `conv-1${rang}0`, 2000)
  return p
}

describe('libererFichiersDuLot — le lot suivant part pendant que le juge corrige', () => {
  const DOSSIER = 'Serveur/Socle/EcransGeneres/'

  it('le juge du lot 4 démarre : le lot 5, au même dossier, part sans attendre la fin du lot 4', () => {
    let p = lancerCeQuiPart(planEnCours([lot(4, [DOSSIER]), lot(5, [DOSSIER])]))
    expect(p.lots.map((l) => l.etat)).toEqual(['en-cours', 'a-faire'])
    expect(attenteDuLot(p, p.lots[1])).toEqual({ genre: 'fichiers', rang: 1, fichiers: [DOSSIER] })

    p = libererFichiersDuLot(p, 'conv-110', 2500)

    expect(p.lots[0]).toMatchObject({ etat: 'en-cours', fichiersLiberes: 2500 })
    expect(attenteDuLot(p, p.lots[1])).toBeUndefined()
    expect(lotsAPartir(p)).toEqual([2])
  })

  it('un lot relancé reconstruit : il reprend ses fichiers', () => {
    let p = lancerCeQuiPart(planEnCours([lot(1, ['src/a.ts']), lot(2, ['src/a.ts'])]))
    p = libererFichiersDuLot(p, 'conv-110', 2500)
    p = marquerLance(p, 1, 'conv-110', 3000)
    expect(p.lots[0].fichiersLiberes).toBeUndefined()
    expect(lotsAPartir(p)).toEqual([])
  })

  it('rien ne change pour un fil qui ne fait aucun lot en cours, ni pour un lot déjà libéré', () => {
    const p = lancerCeQuiPart(planEnCours([lot(1, ['src/a.ts']), lot(2, ['src/a.ts'])]))
    expect(libererFichiersDuLot(p, 'conv-999', 2500)).toBe(p)
    const libere = libererFichiersDuLot(p, 'conv-110', 2500)
    expect(libererFichiersDuLot(libere, 'conv-110', 2600)).toBe(libere)
  })
})
