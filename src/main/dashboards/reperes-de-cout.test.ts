import { describe, expect, it } from 'vitest'
import { CostAggregator } from './cost'
import { MESURES_MIN, ReperesDeCoutEnCours } from './reperes-de-cout'

const ligne = (
  conversationId: string,
  turnId: string,
  role: string,
  costUsd: number
): Parameters<ReperesDeCoutEnCours['ajouter']>[0] => ({
  provider: 'claude',
  role,
  conversationId,
  turnId,
  costUsd,
  inputTokens: 0,
  outputTokens: 0
})

describe('repères de coût servis à chaque tour', () => {
  it('dit ce que le fil a coûté, exécutions comprises, et compte ses tours de chat une fois', () => {
    const r = new ReperesDeCoutEnCours()
    r.ajouter(ligne('conv-1', 't1', 'supervisor', 0.5))
    r.ajouter(ligne('conv-1', 't1', 'supervisor', 0.25))
    r.ajouter(ligne('conv-1', 't1', 'subagent', 30))
    r.ajouter(ligne('conv-1', 't1', 'judge', 4))
    r.ajouter(ligne('conv-2', 'x', 'subagent', 999))
    expect(r.reperes('conv-1').ceFil).toEqual({
      depenseUsd: 35,
      dontExecutionsUsd: 34,
      toursDeChat: 1
    })
    expect(r.reperes('conv-3').ceFil).toBeUndefined()
  })

  it('rend la médiane, le 9 sur 10 et le pire d’une exécution, par tour qui l’a lancée', () => {
    const r = new ReperesDeCoutEnCours()
    // Dix exécutions de 1 à 10 $, la dixième en deux lignes (construction + contrôle).
    for (let i = 1; i <= 9; i++) r.ajouter(ligne(`conv-${i}`, 't', 'subagent', i))
    r.ajouter(ligne('conv-10', 't', 'subagent', 6))
    r.ajouter(ligne('conv-10', 't', 'judge', 4))
    expect(r.reperes().uneExecution).toEqual({
      medianeUsd: 5,
      neufSurDixSousUsd: 9,
      maxUsd: 10,
      mesurees: 10
    })
  })

  it('un tour qui a lancé une exécution ne compte pas comme un tour de chat', () => {
    const r = new ReperesDeCoutEnCours()
    for (let i = 1; i <= MESURES_MIN; i++) r.ajouter(ligne(`c${i}`, 't', 'supervisor', 0.4))
    r.ajouter(ligne('lourd', 't', 'supervisor', 0.01))
    r.ajouter(ligne('lourd', 't', 'subagent', 50))
    expect(r.reperes().unTourDeChat).toEqual({ medianeUsd: 0.4, mesures: MESURES_MIN })
  })

  it('sous le minimum de mesures, aucun ordre de grandeur inventé', () => {
    const r = new ReperesDeCoutEnCours()
    r.ajouter(ligne('conv-1', 't', 'subagent', 3))
    const reperes = r.reperes('conv-1')
    expect(reperes.uneExecution).toBeUndefined()
    expect(reperes.unTourDeChat).toBeUndefined()
    expect(reperes.legende).toContain('orchestrate')
  })

  it('le registre des coûts les tient à jour à chaque ligne, sans relire le fichier', () => {
    const cost = new CostAggregator()
    cost.add(ligne('conv-7', 't1', 'supervisor', 0.3))
    expect(cost.reperesDeCout('conv-7').ceFil?.depenseUsd).toBe(0.3)
    cost.add(ligne('conv-7', 't1', 'subagent', 12))
    expect(cost.reperesDeCout('conv-7').ceFil).toEqual({
      depenseUsd: 12,
      dontExecutionsUsd: 12,
      toursDeChat: 1
    })
  })

  it('rend la dépense brute d’un fil aux plans de lots, non arrondie, et rien pour un fil inconnu', () => {
    const r = new ReperesDeCoutEnCours()
    r.ajouter(ligne('conv-lot', 't1', 'supervisor', 0.333))
    r.ajouter(ligne('conv-lot', 't1', 'subagent', 89.4))
    expect(r.depenseDuFil('conv-lot')).toBeCloseTo(89.733, 3)
    expect(r.depenseDuFil('conv-inconnu')).toBeUndefined()
  })
})
