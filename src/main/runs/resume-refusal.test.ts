import { describe, expect, it } from 'vitest'
import { classifierRefusDeReprise } from './resume-refusal'

/** Messages copiés des boots réels du 13/08 — pas des reconstructions. */
describe('refus définitifs de reprise', () => {
  it('reconnaît une publication déjà engagée (le run a réussi)', () => {
    expect(
      classifierRefusDeReprise(
        'Reprise du worktree refusée pour run-5f5a75a0208d-1 : publication complete déjà engagée.'
      )
    ).toBe('publication-acquise')
  })

  it('reconnaît la copie durable disparue (la reprise ne pourra jamais aboutir)', () => {
    expect(
      classifierRefusDeReprise('Reprise du worktree refusée : La copie durable à reprendre n’existe plus.')
    ).toBe('copie-durable-absente')
    expect(classifierRefusDeReprise("La copie durable à reprendre n'existe plus.")).toBe(
      'copie-durable-absente'
    )
  })

  it('ne classe RIEN d’autre : un échec transitoire doit rester rejouable', () => {
    expect(classifierRefusDeReprise('ETIMEDOUT: provider injoignable')).toBeUndefined()
    expect(classifierRefusDeReprise('Reprise du worktree refusée : conflit en cours.')).toBeUndefined()
  })
})
