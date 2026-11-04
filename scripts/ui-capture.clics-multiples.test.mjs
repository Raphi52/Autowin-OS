import { describe, expect, it } from 'vitest'
import { chaineDeClics } from './ui-capture.mjs'

/**
 * Pourquoi ce test existe (conv-1530, 2026-11-04) : `--click A --click B` ne jouait que A, B était
 * ignoré SANS erreur. La capture d'un menu ouvert sur un onglet (choix de modèle → onglet Gemini)
 * sortait donc verte en montrant le mauvais onglet. Plusieurs `--click` se lisent désormais comme
 * la chaîne `A >> B`, jouée dans l'ordre.
 */
describe('ui-capture — plusieurs --click', () => {
  it('deux --click : les deux étapes, dans l’ordre', () => {
    expect(
      chaineDeClics([
        'node',
        'ui-capture.mjs',
        '--click',
        '#menu > summary',
        '--click',
        '[data-testid="onglet"]'
      ])
    ).toBe('#menu > summary >> [data-testid="onglet"]')
  })

  it('un seul --click, déjà en chaîne : inchangé', () => {
    expect(chaineDeClics(['--click', 'a >> b'])).toBe('a >> b')
  })

  it('aucun --click, ou --click sans valeur : aucun déclencheur', () => {
    expect(chaineDeClics(['--view', 'chat'])).toBeUndefined()
    expect(chaineDeClics(['--click'])).toBeUndefined()
    expect(chaineDeClics(['--click', '--view', 'chat'])).toBeUndefined()
  })
})
