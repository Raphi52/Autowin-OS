import { describe, expect, it } from 'vitest'
import { groupOutcomeSummary } from './action-outcome-summary'

/**
 * L'ÉTIQUETTE QUI MENT, vue par l'utilisateur le 2026-08-26 : l'en-tête affichait
 * « 1 action terminée · remember » AU-DESSUS de l'erreur rouge « type invalide ».
 *
 * La cause n'est pas un bug d'affichage isolé, c'est un TROU DE COUVERTURE :
 * `groupOutcomeSummary` ne connaissait que `verify` et `orchestrate`. Un `remember` refusé ne
 * produisait donc aucun résumé, et l'en-tête retombait sur son défaut — `failed` se calcule sur
 * `action.ok === false`, or un dépôt refusé est une commande qui a parfaitement RÉUSSI à rendre un
 * refus. Techniquement « terminée », faux au seul sens qui compte pour le lecteur.
 *
 * Le mot « terminée » posé au-dessus d'un refus est ce qui rend le faux vert crédible : c'est
 * exactement l'erreur que l'agent a commise sur conv-1086 en annonçant un dépôt qui n'avait pas eu
 * lieu. L'interface la répétait.
 */

describe('un dépôt Brain refusé ne se lit pas comme une action terminée', () => {
  it('rend un résumé REFUSÉ qui porte le motif', () => {
    const resume = groupOutcomeSummary([
      {
        name: 'remember',
        ok: true,
        data: {
          allowed: false,
          stored: false,
          reason:
            "type invalide — recu « cause-racine », attendu l'un de : lesson, decision, preference, domain"
        }
      }
    ])

    expect(resume?.state).toBe('refused')
    expect(resume?.label).toContain('cause-racine')
  })

  it('reste MUET sur un dépôt qui a réussi', () => {
    // L'autre bord : une pastille qui crie sur un succès ne serait plus lue.
    const resume = groupOutcomeSummary([
      { name: 'remember', ok: true, data: { allowed: true, stored: true } }
    ])

    expect(resume?.state).not.toBe('refused')
  })

  it('un refus passe DEVANT un dépôt réussi quand les deux sont dans le tour', () => {
    const resume = groupOutcomeSummary([
      { name: 'remember', ok: true, data: { allowed: true, stored: true } },
      {
        name: 'remember',
        ok: true,
        data: { allowed: false, stored: false, reason: 'type manquant' }
      }
    ])

    expect(resume?.state).toBe('refused')
  })
})
