import { describe, expect, it } from 'vitest'
import { compareWorkflowRuns, type WorkflowRunOutcome } from './workflow-comparison'

const run = (over: Partial<WorkflowRunOutcome> & { profileId: string }): WorkflowRunOutcome => ({
  profileName: over.profileId,
  green: true,
  costUsd: 1,
  ...over
})

/**
 * Le classement naïf confond deux choses : « moins cher » et « meilleur travail au meilleur prix ».
 * Ces tests verrouillent les deux refus qui font toute la valeur du module.
 */
describe('comparer plusieurs workflows sur un même objectif', () => {
  it('recommande le moins cher PARMI ceux qui aboutissent', () => {
    const comparison = compareWorkflowRuns([
      run({ profileId: 'rigoureux', costUsd: 3 }),
      run({ profileId: 'rapide', costUsd: 1 })
    ])
    expect(comparison.recommendedProfileId).toBe('rapide')
    expect(comparison.rationale).toContain('1.00 $')
  })

  it('un run ROUGE moins cher ne gagne pas — il n’a rien produit', () => {
    const comparison = compareWorkflowRuns([
      run({ profileId: 'bacle', costUsd: 0.1, green: false }),
      run({ profileId: 'serieux', costUsd: 2 })
    ])
    expect(comparison.recommendedProfileId).toBe('serieux')
    expect(comparison.rows.find((r) => r.profileId === 'bacle')?.caveat).toContain('non vert')
  })

  it('aucun workflow vert → AUCUNE recommandation, et on le dit', () => {
    const comparison = compareWorkflowRuns([
      run({ profileId: 'a', green: false }),
      run({ profileId: 'b', green: false })
    ])
    expect(comparison.recommendedProfileId).toBeUndefined()
    expect(comparison.rationale).toContain('rien à recommander')
  })

  it('un coût INCONNU n’est pas un coût nul', () => {
    // Sinon le workflow le moins mesurable gagnerait systématiquement.
    const comparison = compareWorkflowRuns([
      run({ profileId: 'opaque', costUsd: null }),
      run({ profileId: 'mesure', costUsd: 2 })
    ])
    expect(comparison.recommendedProfileId).toBe('mesure')
    expect(comparison.rows.find((r) => r.profileId === 'opaque')?.caveat).toContain('inconnu')
  })

  it('un coût AMPUTÉ d’appels non tarifés n’est pas comparable', () => {
    const comparison = compareWorkflowRuns([
      run({ profileId: 'partiel', costUsd: 0.2, unpricedCalls: 3 }),
      run({ profileId: 'complet', costUsd: 1.5 })
    ])
    expect(comparison.recommendedProfileId).toBe('complet')
    expect(comparison.rows.find((r) => r.profileId === 'partiel')?.caveat).toContain(
      '3 appel(s) non tarifé(s)'
    )
  })

  it('des verts sans coût comparable : on refuse de classer plutôt que d’inventer', () => {
    const comparison = compareWorkflowRuns([
      run({ profileId: 'a', costUsd: null }),
      run({ profileId: 'b', costUsd: null })
    ])
    expect(comparison.recommendedProfileId).toBeUndefined()
    expect(comparison.rationale).toContain('mesure incomplète')
  })

  it('annonce les verts écartés faute de coût — le classement ne cache pas son périmètre', () => {
    const comparison = compareWorkflowRuns([
      run({ profileId: 'chiffre', costUsd: 1 }),
      run({ profileId: 'opaque', costUsd: null })
    ])
    expect(comparison.rationale).toContain('1 workflow(s) vert(s) écarté(s)')
  })

  it('aucun run du tout → pas de recommandation', () => {
    expect(compareWorkflowRuns([]).recommendedProfileId).toBeUndefined()
  })
})
