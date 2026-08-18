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

  it('reconnaît la copie durable absente ou incomplète (coordinator:272)', () => {
    expect(
      classifierRefusDeReprise(
        'Reprise du worktree impossible pour run-5f5a75a0208d-1 : copie durable absente ou incomplète.'
      )
    ).toBe('copie-durable-absente')
  })

  // Un cas par littéral DÉFINITIF de `validateRecoveryContext` (worktree-manager.ts:3422-3444),
  // enveloppé comme le coordinateur le jette (`:385` / `:502`).
  it.each([
    'Le contexte durable ne correspond pas à ce dépôt.',
    'Le SHA de départ durable est invalide.',
    'Le SHA source durable est invalide ou indisponible.',
    'La branche ou le SHA durable n’existe plus dans ce dépôt.',
    'Le SHA durable n’appartient plus à la branche capturée.'
  ])('classe le refus définitif « %s »', (detail) => {
    expect(classifierRefusDeReprise(`Reprise du worktree refusée : ${detail}`)).toBe(
      'contexte-de-reprise-invalide'
    )
  })

  it('accepte l’apostrophe ASCII sur les littéraux à apostrophe', () => {
    expect(
      classifierRefusDeReprise(
        "Reprise du worktree refusée : La branche ou le SHA durable n'existe plus dans ce dépôt."
      )
    ).toBe('contexte-de-reprise-invalide')
  })

  /**
   * LE discriminant de cet incrément. La régression qui menace n'est pas « ça ne classe plus »
   * mais « ça classe TROP » : le 6e `detail` (worktree-manager.ts:3418) ré-emballe une erreur
   * arbitraire, potentiellement TRANSITOIRE. Le classer tuerait le checkpoint d'un run reprenable.
   */
  it('ne classe PAS un detail enveloppant une erreur arbitraire (worktree-manager.ts:3418)', () => {
    expect(
      classifierRefusDeReprise(
        "Reprise du worktree refusée : fatal: Unable to create '.git/index.lock': File exists."
      )
    ).toBeUndefined()
    expect(
      classifierRefusDeReprise('Reprise du worktree refusée : agentId invalide: « run/../x ».')
    ).toBeUndefined()
    expect(
      classifierRefusDeReprise(
        'Reprise du worktree refusée : error: could not lock config file .git/config'
      )
    ).toBeUndefined()
  })

  it('ne classe RIEN d’autre : un échec transitoire doit rester rejouable', () => {
    expect(classifierRefusDeReprise('ETIMEDOUT: provider injoignable')).toBeUndefined()
    expect(classifierRefusDeReprise('Reprise du worktree refusée : conflit en cours.')).toBeUndefined()
  })
})
