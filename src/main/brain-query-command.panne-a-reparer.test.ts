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

/**
 * Maintenance 2026-09-23. `retrieveBrain` calcule DEJA laquelle des six causes s'est produite
 * (`unavailableReason`, src/main/brain-retrieval.ts:227-327) et son en-tete dit que le but etait
 * d'eviter « quatre sondes manuelles ». Mais la raison s'arretait a la frontiere : la note rendue
 * a l'agent ne la portait pas. Mesure du jour : `brain_query` a rendu `unavailable` sur un serveur
 * SAIN (`npm run brain:doctor` -> « CANAL UTILISABLE »), et il a fallu six lectures de code pour
 * retrouver une information que l'appel detenait deja.
 */
describe('brain_query — la note nomme LAQUELLE des causes', () => {
  it('rend la cause exacte au lieu de six hypotheses', () => {
    const sansJeton = buildBrainOutcome('q', '', 'unavailable', 'no-token')
    expect(sansJeton.unavailableReason).toBe('no-token')
    expect(sansJeton.note).toMatch(/aucun jeton/)
    expect(sansJeton.note).toMatch(/PANNE a reparer/)

    expect(buildBrainOutcome('q', '', 'unavailable', 'network').note).toMatch(/rien n’a repondu/)
    expect(buildBrainOutcome('q', '', 'unavailable', 'query-refused').note).toMatch(/refuse la requete/)
  })

  it('ne crie pas a la panne quand c’est la neutralisation de test', () => {
    const note = buildBrainOutcome('q', '', 'unavailable', 'test-mode').note ?? ''
    expect(note).toMatch(/pas une panne/i)
    expect(note).not.toMatch(/PANNE a reparer/)
  })

  it('reste inchangee quand aucune cause n’est transmise', () => {
    expect(buildBrainOutcome('q', '', 'unavailable').note).toMatch(/PANNE a reparer/)
  })
})
