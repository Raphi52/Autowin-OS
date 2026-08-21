import { describe, expect, it } from 'vitest'
import { reparationsAutorisees } from './stopgate'

/**
 * COMBIEN de reparations un run a-t-il droit — et pourquoi une tache d'ANALYSE n'en avait aucune.
 *
 * La formule vivait en ligne dans l'orchestrateur : `!enforceSpend && isMutationTask(task) ? … : 0`.
 * Deux consequences mesurees le 2026-08-20 :
 *  - toute tache NON-mutation (analyse, cadrage, lecture seule) obtenait ZERO reparation, alors que
 *    le gate peut parfaitement la refuser pour « analyse absente du livrable » ou « DoD non cochee »,
 *    deux motifs qu'un nouveau passage repare. Le contrat racine ADAPTE deja ses exigences a un run
 *    en lecture seule (il ne lui demande pas de preuve de mutation) : lui refuser la reparation etait
 *    donc une double peine, sans motif.
 *  - sous budget BLOQUANT, le compte tombait a zero SANS que rien ne le dise. La politique est
 *    defendable (« pas de nouvelle depense sans un tour humain »), son silence ne l'est pas.
 *
 * Extraite ici pour etre testable sans recopier la construction : un test qui reproduirait la formule
 * verifierait son propre miroir — la faute la plus couteuse de cette session.
 */
describe('réparations autorisées', () => {
  it('accorde des réparations à une tâche de mutation, depuis le graphe', () => {
    expect(
      reparationsAutorisees({ mutation: true, budgetBloquant: false, retoursDuGraphe: 2 })
    ).toEqual({ reparations: 2, motif: undefined })
  })

  it('en accorde AUSSI à une tâche non-mutation — le défaut corrigé', () => {
    // Un run d'analyse refusé pour « analyse absente » ou « DoD non cochée » est réparable.
    expect(
      reparationsAutorisees({ mutation: false, budgetBloquant: false, retoursDuGraphe: 2 })
    ).toEqual({ reparations: 2, motif: undefined })
  })

  it('sans graphe, retombe sur le plafond du devis', () => {
    expect(
      reparationsAutorisees({ mutation: true, budgetBloquant: false, retoursDuDevis: 1 })
    ).toEqual({ reparations: 1, motif: undefined })
  })

  it('sous budget BLOQUANT, n’accorde rien mais le DIT', () => {
    const r = reparationsAutorisees({ mutation: true, budgetBloquant: true, retoursDuGraphe: 2 })
    expect(r.reparations).toBe(0)
    expect(r.motif).toContain('budget')
    // Le motif doit être lisible par un humain dans la trace, pas un code.
    expect(r.motif!.length).toBeGreaterThan(20)
  })

  it('ne rend jamais un nombre négatif ni fractionnaire', () => {
    expect(
      reparationsAutorisees({ mutation: true, budgetBloquant: false, retoursDuGraphe: -5 })
        .reparations
    ).toBe(0)
    expect(
      reparationsAutorisees({ mutation: true, budgetBloquant: false, retoursDuGraphe: 2.7 })
        .reparations
    ).toBe(2)
  })

  it('aucune source de plafond : zéro, et on le dit', () => {
    const r = reparationsAutorisees({ mutation: true, budgetBloquant: false })
    expect(r.reparations).toBe(0)
    expect(r.motif).toBeDefined()
  })
})
