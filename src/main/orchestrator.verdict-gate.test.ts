import { describe, expect, it } from 'vitest'
import { evaluateClosure } from './gates/stopgate'
import { lireVerdictJuge } from './orchestrator'

/**
 * TROIS DÉFAUTS D'UN MÊME SYMPTÔME, observés sur un run réel de l'utilisateur (`conv-1136`,
 * `scout-claude-propre-b-worktrees-audite-u`) dont la vignette affichait :
 *
 *   status: failed · gateBlocked: true
 *   « Statut "red" : un signal de vérification est en échec.;
 *     DoD non tenue : 1 case(s) à contenu réel non cochée(s). »
 *
 * alors que le scout avait produit un livrable complet (3 chantiers scorés 96/93/90 avec preuves
 * `fichier:ligne`). Le travail était là ; sa clôture a été refusée, et le message n'expliquait rien.
 *
 * 1. DEUX LECTEURS DE VERDICT en désaccord dans le même fichier. `verdictDePhase` (durci le
 *    2026-08-05 après 4 cas dégénérés mesurés) accepte « VALIDE » PARTOUT dans le texte ; le chemin
 *    greedy testait `/^\s*valide/i`, donc exigeait que le mot OUVRE la réponse. Un juge qui écrit
 *    « Verdict : VALIDE » voyait son approbation JETÉE. Faux négatif, sur du travail validé.
 * 2. UN SEUL FAIT COMPTÉ DEUX FOIS. Le site d'appel fabriquait `dod: [{checked: ok}]` à partir du
 *    MÊME booléen que `status`, donc le gate rendait deux raisons pour un seul fait — en laissant
 *    croire à deux problèmes indépendants.
 * 3. UN MESSAGE QUI MENT. « un signal de vérification est en échec » : aucun signal n'a tourné. Le
 *    statut `red` vient d'un avis de juge, pas d'un test rouge. Le gate affirmait une cause qu'il
 *    n'avait pas vérifiée.
 */
describe('lecture du verdict du juge — un seul lecteur, aligné sur le contrat', () => {
  it('LE FAUX NÉGATIF : « Verdict : VALIDE » est une approbation, pas un refus', () => {
    // Le brief impose « VALIDE » ou « DEFAUT: <raison> » ; il n'impose PAS que le mot ouvre la phrase.
    expect(lireVerdictJuge('Verdict : VALIDE')).toBe(true)
    expect(lireVerdictJuge('Le livrable est VALIDE')).toBe(true)
    expect(lireVerdictJuge('**VALIDE** — les preuves tiennent')).toBe(true)
  })

  it('la forme canonique reste acceptée', () => {
    expect(lireVerdictJuge('VALIDE')).toBe(true)
    expect(lireVerdictJuge('  valide  ')).toBe(true)
  })

  it('un rejet contractuel reste un rejet, où qu il se trouve', () => {
    expect(lireVerdictJuge('DEFAUT: preuve absente')).toBe(false)
    expect(lireVerdictJuge('Le livrable présente un DEFAUT: preuve absente')).toBe(false)
    expect(lireVerdictJuge('INVALIDE : rien ne prouve le résultat')).toBe(false)
  })

  it('FAIL-CLOSED : un juge muet, vide ou hors contrat ne vaut PAS une approbation', () => {
    for (const degenere of [
      '',
      '   ',
      'Error: provider timeout',
      'Je résume le travail effectué.'
    ]) {
      expect(lireVerdictJuge(degenere)).toBe(false)
    }
  })

  it('un rejet PRIME sur une mention d approbation dans le même texte', () => {
    // « DEFAUT: ... bien que certains points soient valides » doit rester un refus.
    expect(lireVerdictJuge('DEFAUT: incomplet, bien que la partie A soit valide')).toBe(false)
  })
})

describe('gate de clôture — une raison par fait, et aucune cause inventée', () => {
  it('ne DOUBLE PAS le même fait quand aucune DoD réelle n existe', () => {
    // Le site d'appel ne doit plus fabriquer une fausse case de DoD miroir du statut.
    const evaluation = evaluateClosure({ status: 'red', dod: [] })
    expect(evaluation.blocked).toBe(true)
    expect(evaluation.reasons).toHaveLength(1)
  })

  it('n AFFIRME PAS qu un signal de vérification a échoué quand aucun n a tourné', () => {
    const sansSignal = evaluateClosure({ status: 'red', dod: [] })
    expect(sansSignal.reasons.join(' ')).not.toMatch(/signal de v[eé]rification/i)
    // La raison doit rester vraie et actionnable : ce travail s'est terminé en échec, point. (Le
    // mot « red » a disparu des messages — ils sont écrits pour l'utilisateur, cf.
    // `gates/stopgate.messages.test.ts` — mais le FAIT qu'ils énoncent, lui, est inchangé.)
    expect(sansSignal.reasons.join(' ')).toMatch(/échec/i)
  })

  it('NOMME le signal quand il a réellement tourné et rendu un code non nul', () => {
    const avecSignal = evaluateClosure({ status: 'red', dod: [], signalExitCode: 2 })
    expect(avecSignal.reasons.join(' ')).toMatch(/code 2/)
  })

  it('NOMME les cases de DoD non tenues, au lieu de les compter', () => {
    const evaluation = evaluateClosure({
      status: 'green',
      dod: [
        { checked: true, hasContent: true, label: 'les tests passent' },
        { checked: false, hasContent: true, label: 'la capture est lue' },
        { checked: false, hasContent: true, label: 'aucune régression' }
      ]
    })
    expect(evaluation.blocked).toBe(true)
    const raison = evaluation.reasons.join(' ')
    expect(raison).toContain('la capture est lue')
    expect(raison).toContain('aucune régression')
    expect(raison).not.toContain('les tests passent')
  })

  it('une DoD sans libellé reste comptée, sans inventer de nom', () => {
    const evaluation = evaluateClosure({
      status: 'green',
      dod: [{ checked: false, hasContent: true }]
    })
    expect(evaluation.blocked).toBe(true)
    expect(evaluation.reasons.join(' ')).toMatch(/1 point/i)
  })

  it('une clôture dégradée assumée ne bloque jamais, quel que soit le reste', () => {
    expect(
      evaluateClosure({
        status: 'degraded-closed',
        dod: [{ checked: false, hasContent: true, label: 'x' }],
        signalExitCode: 1
      }).blocked
    ).toBe(false)
  })
})
