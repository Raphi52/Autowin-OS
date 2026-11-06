import { describe, expect, it } from 'vitest'
import { ISSUES_CONNUES, issuePour, refusAvecIssue, type MotifRefus } from './issue-de-refus'

/**
 * UN REFUS SANS SORTIE FAIT BOUCLER — MESURÉ, PAS SUPPOSÉ.
 *
 * Le 2026-08-25 (conv-1404), `edit_file` a été refusé huit fois de suite sur le même message. Le
 * refus disait CE QUI N'ALLAIT PAS, jamais QUOI FAIRE. L'agent a donc retenté la seule chose qu'il
 * savait faire — la même édition — jusqu'à ce que le budget d'appels coupe le tour.
 *
 * Le lecteur de ces messages n'est pas seulement humain : c'est l'agent, et c'est lui qui décide de
 * la suite. Un constat nu le laisse deviner ; un constat + une sortie lui donne un geste. C'est la
 * même bascule que `natureDeLEchec` a produite pour les erreurs de syntaxe.
 *
 * Ces tests imposent la règle à TOUS les motifs, présents et futurs : le garde d'exhaustivité
 * ci-dessous échoue dès qu'un motif est ajouté sans sa sortie.
 */
describe('issuePour — aucun refus ne part sans sa sortie', () => {
  it('couvre EXHAUSTIVEMENT les motifs : en ajouter un sans issue casse ce test', () => {
    const motifs = Object.keys(ISSUES_CONNUES) as MotifRefus[]

    expect(motifs.length).toBeGreaterThan(0)
    for (const motif of motifs) {
      const issue = issuePour(motif)
      expect(issue, `motif « ${motif} » sans issue`).toBeTruthy()
      // Une « sortie » qui se contente de reformuler le problème n'en est pas une : on exige un
      // GESTE. Sans ce garde, la règle se satisferait d'une paraphrase polie.
      expect(issue, `motif « ${motif} » ne propose aucun geste`).toMatch(
        /déclare|relance|committe|réduis|découpe|ouvre|relis|choisis|reprends|demande|publie|corrige/i
      )
      expect(issue.length, `motif « ${motif} » trop bavard`).toBeLessThanOrEqual(320)
    }
  })

  it('compose constat + sortie, dans cet ordre', () => {
    const message = refusAvecIssue('isolation-indisponible', 'edit_file')

    // Le libellé d'origine est CONSERVÉ : des gardes voisins l'assoient, et ce module ajoute une
    // sortie sans renommer ce dont d'autres dépendent.
    expect(message.startsWith('isolation workspace indisponible')).toBe(true)
    expect(message).toContain('edit_file')
    expect(message).toContain(issuePour('isolation-indisponible'))
  })

  it('le détail reste facultatif — un refus sans contexte reste lisible', () => {
    const message = refusAvecIssue('verification-indisponible')

    expect(message).toContain(issuePour('verification-indisponible'))
    expect(message).not.toContain('undefined')
  })

  it('un motif inconnu ne fabrique pas une fausse sortie', () => {
    expect(issuePour('motif-jamais-vu' as MotifRefus)).toBe('')
  })
})
