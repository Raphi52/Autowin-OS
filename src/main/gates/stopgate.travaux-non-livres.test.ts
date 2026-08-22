import { describe, expect, it } from 'vitest'
import { evaluateClosure } from './stopgate'

/**
 * UNE SOUS-TACHE QUI A ECHOUE EMPECHE LA CLOTURE — sinon elle n'empeche rien du tout.
 *
 * Mesure du 2026-08-22, sur le harnais greedy existant : un run dont la sous-tache `A` ECHOUE et dont
 * `C` est SAUTEE en cascade se cloturait `valid: true`, `gateBlocked: false`, `gateReasons: []`.
 * `failedTasks` et `skippedTasks` etaient calcules, accumules avec soin, retournes dans le
 * resultat... et lus par AUCUN consommateur de production. Du travail nomme, jamais livre, et une
 * cloture qui annonce la reussite.
 *
 * Le gate est le seul endroit qui decide de bloquer : c'est donc ici que l'information doit entrer,
 * et non dans une troisieme machinerie de reprise. La boucle de reparation existante se declenche
 * deja sur `gate.blocked`, avec son plafond dur et son arret sur refus identique.
 */
describe('un travail nomme mais non livre bloque la cloture', () => {
  it('une sous-tache en echec bloque, et elle est NOMMEE', () => {
    const g = evaluateClosure({
      status: 'green',
      dod: [{ checked: true, hasContent: true }],
      travauxNonLivres: ['A']
    })
    expect(g.blocked).toBe(true)
    // Nommer, pas compter : la regle deja etablie dans ce fichier pour la DoD.
    expect(g.reasons.join(' ')).toContain('A')
  })

  it('plusieurs travaux non livres sont tous nommes', () => {
    const g = evaluateClosure({
      status: 'green',
      dod: [{ checked: true, hasContent: true }],
      travauxNonLivres: ['A', 'C']
    })
    expect(g.blocked).toBe(true)
    expect(g.reasons.join(' ')).toContain('A')
    expect(g.reasons.join(' ')).toContain('C')
  })

  it('aucun travail en attente : le gate ne bloque pas', () => {
    const g = evaluateClosure({
      status: 'green',
      dod: [{ checked: true, hasContent: true }],
      travauxNonLivres: []
    })
    expect(g.blocked).toBe(false)
  })

  it('champ absent : comportement inchange pour tous les appelants existants', () => {
    const g = evaluateClosure({ status: 'green', dod: [{ checked: true, hasContent: true }] })
    expect(g.blocked).toBe(false)
    expect(g.reasons).toEqual([])
  })

  it('une cloture degradee assumee par l humain reste souveraine', () => {
    // L'autorite de cloture externe a deja ete exercee : le gate ne la contredit pas.
    const g = evaluateClosure({
      status: 'degraded-closed',
      dod: [],
      travauxNonLivres: ['A']
    })
    expect(g.blocked).toBe(false)
  })
})
