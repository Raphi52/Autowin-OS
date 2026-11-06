import { describe, expect, it } from 'vitest'
import { ciblesNommees } from './root-execution-contract'
import { promptDuLot, type LotDuPlan, type PlanDeLots } from '../../shared/plan-de-lots'

/*
 * Le contexte commun d'un plan de lots est recopié dans la demande de CHAQUE lot. Il cite des
 * fichiers en exemple (« comme le jeton Teams, `src/main/ipc/chat.ts:3382` ») : le contrôle final
 * les prenait pour des fichiers à modifier et refusait des lots justes (lots 1 et 4 du plan du
 * coffre à clés, refusés pour `chat.ts` et `grok.ts` qu'aucun des deux ne devait toucher).
 */
function lot(rang: number, demande: string): LotDuPlan {
  return { rang, titre: `Lot ${rang}`, demande, fichiers: [], etat: 'en-cours' } as LotDuPlan
}

function plan(contexte: string, lots: LotDuPlan[]): PlanDeLots {
  return {
    id: 'plan-test',
    titre: 'Coffre à clés',
    chef: 'conv-1',
    contexte,
    lots
  } as unknown as PlanDeLots
}

const CONTEXTE =
  'Stockage chiffré par safeStorage, comme le jeton Teams, `src/main/ipc/chat.ts:3382`. ' +
  'Grok garde `envSansCleXai`, `src/main/providers/grok.ts:92`, appliqué en dernier.'

describe('ciblesNommees — le contexte commun d’un plan de lots n’exige aucun fichier', () => {
  it('les exemples chemin:ligne du contexte commun ne deviennent pas des fichiers exigés', () => {
    const l = lot(1, '/build Crée le cœur du coffre (voir le contexte du plan).')
    expect(ciblesNommees(promptDuLot(plan(CONTEXTE, [l]), l))).toEqual([])
  })

  it('la demande du lot garde ses propres cibles', () => {
    const l = lot(1, '/build Corrige `src/main/coffre-cles.ts:40`.')
    expect(ciblesNommees(promptDuLot(plan(CONTEXTE, [l]), l))).toEqual(['src/main/coffre-cles.ts'])
  })

  it('une demande hors plan qui nomme un fichier reste une demande', () => {
    expect(ciblesNommees('Corrige `src/main/ipc/chat.ts:3382`.')).toEqual(['src/main/ipc/chat.ts'])
  })
})
