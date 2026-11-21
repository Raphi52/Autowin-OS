import { describe, expect, it } from 'vitest'
import { attenteDuLot, lotsAPartir, type LotDuPlan, type PlanDeLots } from './plan-de-lots'

/*
 * L'écran dit pourquoi un lot attend (`attenteDuLot`), le coordinateur décide s'il part
 * (`lotsAPartir`). Les deux doivent dire la même chose : un lot sans raison d'attente part, un
 * lot qui ne part pas en a une (2026-11-21 : « si on peut pas paralléliser, faut être cohérent
 * sur pourquoi »).
 */
const lot = (rang: number, etat: LotDuPlan['etat'], fichiers: string[], apres: number[] = []): LotDuPlan =>
  ({ rang, titre: `Lot ${rang}`, demande: '', fichiers, apres, etat }) as LotDuPlan

const plan = (modif: Partial<PlanDeLots> = {}): PlanDeLots =>
  ({
    id: 'plan-test',
    statut: 'en-cours',
    parallele: 6,
    plafondTours: 36,
    toursLances: 24,
    lots: [
      lot(9, 'fait', ['Serveur/Recopie']),
      lot(10, 'en-cours', ['Serveur/Recopie', 'Base/migrations'], [9]),
      lot(11, 'a-faire', ['serveur\\recopie', 'Base/v2'], [9]),
      lot(13, 'a-faire', ['Outils/Passage'], [7]),
      lot(7, 'en-cours', ['Outils/Transfert']),
      lot(17, 'a-faire', ['Base/migrations', 'Pont']),
      lot(18, 'a-faire', ['Outils/Repetition'], [9])
    ],
    ...modif
  }) as unknown as PlanDeLots

const coherent = (p: PlanDeLots): void => {
  const partent = lotsAPartir(p)
  for (const l of p.lots.filter((x) => x.etat === 'a-faire'))
    expect([l.rang, attenteDuLot(p, l) === undefined]).toEqual([l.rang, partent.includes(l.rang)])
}

describe('attenteDuLot', () => {
  it('nomme le lot en cours qui tient le même fichier, et le chemin commun', () => {
    const p = plan()
    expect(attenteDuLot(p, p.lots[2])).toEqual({ genre: 'fichiers', rang: 10, fichiers: ['Serveur/Recopie'] })
    expect(attenteDuLot(p, p.lots[3])).toEqual({ genre: 'prerequis', rangs: [7] })
    expect(attenteDuLot(p, p.lots[5])).toEqual({ genre: 'fichiers', rang: 10, fichiers: ['Base/migrations'] })
    expect(attenteDuLot(p, p.lots[6])).toBeUndefined()
  })
  it('places prises puis plafond atteint', () => {
    const pleine = plan({ parallele: 2 })
    expect(attenteDuLot(pleine, pleine.lots[6])).toEqual({ genre: 'place' })
    const usee = plan({ toursLances: 36 })
    expect(attenteDuLot(usee, usee.lots[6])).toEqual({ genre: 'plafond' })
  })
  it('un lot parti, fait, ou un plan arrêté : aucune attente', () => {
    const p = plan()
    expect(attenteDuLot(p, p.lots[1])).toBeUndefined()
    const fini = plan({ statut: 'termine' } as Partial<PlanDeLots>)
    expect(attenteDuLot(fini, fini.lots[2])).toBeUndefined()
  })
  it('dit la même chose que le coordinateur, quel que soit le réglage', () => {
    coherent(plan())
    coherent(plan({ parallele: 2 }))
    coherent(plan({ toursLances: 36 }))
  })
})
