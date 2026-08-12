import { describe, expect, it } from 'vitest'
import { pickAcquiredAnalysis } from './orchestration-state'
import type { OrchestrationRunState } from './orchestration-state'

/**
 * NE PAS REPAYER UNE ANALYSE DÉJÀ PRODUITE DANS LA MÊME CONVERSATION.
 *
 * Levier n°3 (score 86) du scout coût joué dans Autowin (conv-1120, 2026-08-12), adossé aux
 * conversations réelles : sur `conv-1061`, scout + frame + terrain coûtent 11,20 $, soit 73,9 %
 * des 15,16 $ de sous-agents du fil.
 *
 * Le mécanisme de reprise existe déjà (`resumedPhases.has(phase) → continue`) mais son
 * appariement exige la MÊME tâche (`normalizeTaskKey(state.task) !== wanted`,
 * orchestration-state.ts:806). Or le parcours réel enchaîne deux libellés DIFFÉRENTS dans la même
 * conversation — « scout des améliorations de la vue Chat » puis « Fais tout. Mène les chantiers
 * retenus… » — donc l'acquis n'est jamais reconnu et le scout est intégralement rejoué.
 *
 * On n'élargit QUE les phases en lecture seule. Une phase qui mute (`build`, `clean`) doit être
 * rejouée : son acquis est sur le disque, pas dans un texte, et le workspace a pu bouger depuis.
 */
const etat = (patch: Partial<OrchestrationRunState> = {}): OrchestrationRunState =>
  ({
    runId: 'run-1',
    conversationId: 'conv-1061',
    task: 'scout des améliorations de la vue Chat',
    updatedAt: 1_000_000,
    phaseOutputs: [
      { phase: 'scout', text: 'P1 : brancher le bouton Orienter. P2 : états vides.' },
      { phase: 'build', text: 'commit 3 fichiers' }
    ],
    ...patch
  }) as OrchestrationRunState

const base = {
  conversationId: 'conv-1061',
  task: 'Fais tout. Mène les chantiers retenus pour la vue Chat de bout en bout.',
  nowMs: 1_000_500
}

describe('acquis d’analyse réutilisable dans une conversation', () => {
  it('réutilise le scout produit sous un AUTRE libellé de la même conversation', () => {
    const acquis = pickAcquiredAnalysis([etat()], base)
    expect(acquis.map((o) => o.phase)).toEqual(['scout'])
    expect(acquis[0].text).toContain('Orienter')
  })

  it('ne réutilise JAMAIS une phase qui mute le workspace', () => {
    const acquis = pickAcquiredAnalysis([etat()], base)
    expect(acquis.some((o) => o.phase === 'build')).toBe(false)
  })

  it('ne traverse pas les conversations', () => {
    expect(pickAcquiredAnalysis([etat({ conversationId: 'conv-999' })], base)).toEqual([])
  })

  it('ignore un acquis trop ancien', () => {
    expect(pickAcquiredAnalysis([etat()], { ...base, nowMs: 1_000_000 + 48 * 3_600_000 })).toEqual(
      []
    )
  })

  it('ignore un acquis vide, qui ferait sauter la phase sans rien apporter', () => {
    const vide = etat({ phaseOutputs: [{ phase: 'scout', text: '   ' }] })
    expect(pickAcquiredAnalysis([vide], base)).toEqual([])
  })

  it('ne saute pas une phase que l’utilisateur redemande explicitement', () => {
    const acquis = pickAcquiredAnalysis([etat()], { ...base, task: '/scout refais l’analyse' })
    expect(acquis).toEqual([])
  })

  it('ne réutilise pas un run dont un appel est encore actif : c’est un verrou, pas un acquis', () => {
    const verrouille = etat({ usage: { activeCalls: 1 } } as Partial<OrchestrationRunState>)
    expect(pickAcquiredAnalysis([verrouille], base)).toEqual([])
  })

  it('prend le plus récent quand plusieurs acquis coexistent', () => {
    const ancien = etat({
      runId: 'run-0',
      updatedAt: 900_000,
      phaseOutputs: [{ phase: 'scout', text: 'analyse périmée' }]
    })
    const acquis = pickAcquiredAnalysis([ancien, etat()], base)
    expect(acquis[0].text).toContain('Orienter')
  })
})
