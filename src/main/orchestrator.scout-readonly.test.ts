import { describe, expect, it } from 'vitest'
import { classifyMutationConfidence, isMutationTask } from './orchestrator'

/**
 * UN SCOUT EST EN LECTURE SEULE, MÊME SANS SLASH ET MÊME PRÉFIXÉ.
 *
 * Mesuré le 2026-08-12 sur la campagne dogfood : `classifyMutationConfidence` ne reconnaît le
 * contrat lecture-seule que si le libellé COMMENCE par `/scout` (l. 804). Les prompts réels
 * portent une sentinelle — « [claude-propre-A-observatory] scout des améliorations de la vue
 * Observatory … N'implémente rien à ce tour. » — donc le slash n'est pas en tête, le garde ne
 * s'applique pas, et le mot « améliorations » fait basculer la tâche en MUTATION.
 *
 * Conséquences réelles : le pré-gate réclame une preuve de mutation (`requireProof`) à une phase
 * dont `sandboxForPhase` a justement fixé les droits en `read-only` — on exige d'elle ce qu'on lui
 * interdit. La tâche prend en outre un worktree isolé dont un scout n'a aucun usage.
 *
 * Le fail-closed du classifieur reste intact : seule la présence EXPLICITE d'un contrat scout est
 * reconnue, une demande d'écriture déguisée continue d'être traitée comme une mutation.
 */
describe('classification d’un scout', () => {
  it('reconnaît le contrat scout malgré une sentinelle en tête', () => {
    const reel =
      '[claude-propre-A-observatory] scout des améliorations de la vue Observatory. ' +
      'Inspecte la vue réellement branchée, ses parcours de bout en bout, ses états ' +
      'vides/chargement/erreur. Retourne des chantiers concrets. N’implémente rien à ce tour.'
    expect(classifyMutationConfidence(reel)).toBe('read-only')
    expect(isMutationTask(reel)).toBe(false)
  })

  it('reconnaît « scout » sans slash en tête de demande', () => {
    expect(isMutationTask('scout des améliorations de la vue Chat')).toBe(false)
  })

  it('garde la forme slashée déjà couverte', () => {
    expect(isMutationTask('/scout la vue Tickets')).toBe(false)
  })

  it('ne relâche pas une vraie demande d’écriture qui cite le mot scout', () => {
    // Le mot apparaît, mais l'ordre est une implémentation : la tâche reste une mutation.
    expect(isMutationTask('implémente les chantiers issus du scout de la vue Chat')).toBe(true)
    expect(isMutationTask('corrige le bug du scout')).toBe(true)
  })

  it('ne relâche pas un scout suivi d’un ordre d’écriture', () => {
    expect(isMutationTask('scout des améliorations puis implémente-les')).toBe(true)
  })
})
