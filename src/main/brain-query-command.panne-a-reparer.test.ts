import { describe, expect, it } from 'vitest'
import { buildBrainOutcome } from './brain-query-command'

/**
 * Kaizen conv-151, saisie ts=1788375174361 (« kaizen t'aurais du reparer le brain »).
 * Le Brain a rendu status=unavailable SIX fois (18:57:46 -> 19:04:52) sur la meme question :
 * la note ne disait que « ne conclus pas au negatif », donc rien n'appelait la reparation.
 */
describe('brain_query — panne = tache, pas fin de route', () => {
  const note = buildBrainOutcome('q', '', 'unavailable').note ?? ''

  it('nomme la panne comme reparable', () => {
    expect(note).toMatch(/PANNE a reparer/)
    expect(note).toMatch(/Diagnostique le serveur Brain/)
  })

  it('interdit la relance a l’identique', () => {
    expect(note).toMatch(/MEME question a l'identique/)
  })

  it('ne touche pas les autres statuts', () => {
    expect(buildBrainOutcome('q', '', 'empty').note).not.toMatch(/PANNE/)
    expect(buildBrainOutcome('q', 'savoir').note).toBeUndefined()
  })
})
