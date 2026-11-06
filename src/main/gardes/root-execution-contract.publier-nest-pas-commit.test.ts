import { describe, expect, it } from 'vitest'
import { rootExecutionRequirements } from './root-execution-contract'

/**
 * conv-597, 2026-09-16, turnId 4e502786-4887-4101-85b3-ea2dee304091.
 *
 * « Finis le Jeu ... online ready a etre publie sur le market » faisait naitre l'obligation
 * « Commit demande publie avec une identite Git verifiable ». Le RUN.md du run la porte en
 * `- [ ]` — jamais tenue, jamais demandee — et le run a quand meme ferme `status: green`.
 * Une obligation fabriquee par un mot isole discredite toute la DoD.
 */
describe('DoD racine — « publier » vise une boutique, pas Git', () => {
  it("n'exige aucun commit pour une publication sur un market", () => {
    const tache =
      "Finis le Jeu pour qu'il soit fun balance joli et online ready a être publié sur le market"
    expect(rootExecutionRequirements(tache).commit).toBe(false)
  })

  it("n'exige aucun commit pour une mise en ligne sur une boutique nommee", () => {
    for (const tache of [
      'Prepare le jeu et publie-le sur Steam',
      "Publie l'app sur le Play Store quand elle est prête",
      'Rends le jeu publiable sur itch.io'
    ]) {
      expect({ tache, commit: rootExecutionRequirements(tache).commit }).toEqual({
        tache,
        commit: false
      })
    }
  })

  it('exige toujours un commit quand la phrase nomme ce qui va dans Git', () => {
    for (const tache of [
      'Corrige le bug puis publie les changements',
      'Corrige le bug et publie la branche',
      'Corrige le bug puis push',
      'Corrige le bug et fais un commit',
      'Corrige le bug puis commit les modifications'
    ]) {
      expect({ tache, commit: rootExecutionRequirements(tache).commit }).toEqual({
        tache,
        commit: true
      })
    }
  })
})
