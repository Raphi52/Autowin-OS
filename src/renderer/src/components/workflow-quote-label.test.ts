import { describe, expect, it } from 'vitest'
import { workflowQuoteLabel } from './workflow-quote-label'

/**
 * Ce que ces tests protègent : que la carte « Plan d’exécution » nomme la façon de travailler qui
 * pilote le run.
 *
 * Le devis annonce des plafonds qui DÉCOULENT du workflow retenu (`worstCaseNodeExecutions` dans
 * l'orchestrateur) : les afficher sans nommer leur cause revient à montrer un prix sans article.
 */
describe('le libellé du workflow dans le devis', () => {
  it('dit « aucun workflow » plutôt que de rester vide', () => {
    // Une ligne absente se lit comme une information manquante, pas comme une absence VOULUE — or
    // « aucun workflow » est une réponse de plein droit du mode dynamique.
    expect(workflowQuoteLabel(undefined)).toBe('aucun workflow')
  })

  it('nomme le workflow ET sa provenance quand il a été choisi à la main', () => {
    expect(workflowQuoteLabel({ name: 'Correctif', source: 'manuel' })).toBe(
      'Correctif — choisi à la main'
    )
  })

  it('signale un workflow que l’utilisateur n’a PAS demandé', () => {
    // C'est le cas le plus important : l'utilisateur n'a rien décidé, le modèle a choisi pour lui.
    expect(workflowQuoteLabel({ name: 'Feature', source: 'modele' })).toBe(
      'Feature — choisi par le modèle'
    )
  })

  it('signale un graphe composé à la volée — le cas le moins décidé de tous', () => {
    expect(workflowQuoteLabel({ name: 'Ad hoc', source: 'compose' })).toBe(
      'Ad hoc — composé à la volée'
    )
  })

  it('les trois provenances produisent trois libellés DISTINCTS', () => {
    // Sans quoi la provenance serait affichée sans rien distinguer : un mot décoratif.
    const libelles = (['manuel', 'modele', 'compose'] as const).map((source) =>
      workflowQuoteLabel({ name: 'X', source })
    )
    expect(new Set(libelles).size).toBe(3)
  })

  it('le nom est rendu tel qu’il est enregistré, sans troncature ni réécriture', () => {
    const nom = 'Panel critique — trois juges aux angles différents'
    expect(workflowQuoteLabel({ name: nom, source: 'manuel' })).toContain(nom)
  })
})
