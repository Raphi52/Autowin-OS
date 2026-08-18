import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLOSURE_UPSTREAM_REFUSAL,
  doitArreterLaReparation,
  evaluateClosure
} from './gates/stopgate'

/**
 * UN REFUS QUE BUILD NE PEUT PAS LEVER NE SE REJOUE PAS.
 *
 * Mesuré dans `conv-1242` le 2026-08-15, en rejouant le journal d'évènements du tour : trois
 * passages `build` (73 s, 60 s, puis un troisième), chacun suivi du MÊME refus mot pour mot —
 * « Statut "red" : la clôture a été refusée en amont ». Plus de deux minutes de calcul brûlées pour
 * rien. Le run était rouge EN AMONT ; aucune réparation du livrable ne pouvait lever ce verrou.
 *
 * La garde a été retirée le 2026-08-18 au motif — juste — qu'un motif identique ne prouve pas que
 * la tentative suivante échouera : une dépendance ou une preuve peut devenir disponible entre deux
 * passages. La règle rétablie ici tient les deux intentions à la fois : elle ne coupe que sur
 * l'INTERSECTION « refus identique » ∩ « aucune raison réparable par build ».
 *
 * Ces tests exercent la DÉCISION, pas la présence d'une chaîne dans le source : l'ancienne version
 * de ce fichier ne pouvait plus échouer que si quelqu'un réécrivait un identifiant précis, sans rien
 * vérifier du comportement.
 */
describe('boucle de réparation : arrêt sur un refus hors de portée de build', () => {
  it('ARRÊTE sur un refus amont répété à l’identique', () => {
    const amont = [CLOSURE_UPSTREAM_REFUSAL]
    expect(doitArreterLaReparation(amont, amont)).toBe(true)
  })

  it('REJOUE tant que le refus n’a pas encore été vu une fois', () => {
    // Première tentative : aucun motif précédent. Couper ici retirerait toute réparation.
    expect(doitArreterLaReparation([CLOSURE_UPSTREAM_REFUSAL], [])).toBe(false)
  })

  it('REJOUE un refus RÉPARABLE, même identique deux fois de suite', () => {
    // L'intention de la suppression du 2026-08-18 : une DoD non cochée peut devenir cochable.
    const dod = ['DoD non tenue : « le test passe ».']
    expect(doitArreterLaReparation(dod, dod)).toBe(false)

    const signal = ['Signal rouge : code de sortie 1 != 0.']
    expect(doitArreterLaReparation(signal, signal)).toBe(false)
  })

  it('REJOUE un refus MIXTE : la part réparable garde son sens', () => {
    // Amont + DoD : build ne peut rien sur le premier motif, mais tout sur le second.
    const mixte = [CLOSURE_UPSTREAM_REFUSAL, 'DoD non tenue : « la capture est lue ».']
    expect(doitArreterLaReparation(mixte, mixte)).toBe(false)
  })

  it('REJOUE quand le refus ÉVOLUE — un motif nouveau prouve qu’on a avancé', () => {
    expect(
      doitArreterLaReparation([CLOSURE_UPSTREAM_REFUSAL], ['Signal rouge : code de sortie 1 != 0.'])
    ).toBe(false)
    // Même ensemble de motifs, mais un de plus : ce n'est pas le même refus.
    expect(
      doitArreterLaReparation(
        [CLOSURE_UPSTREAM_REFUSAL, 'DoD non tenue : « x ».'],
        [CLOSURE_UPSTREAM_REFUSAL]
      )
    ).toBe(false)
  })

  it('ne coupe JAMAIS sur un refus vide (gate non bloqué)', () => {
    expect(doitArreterLaReparation([], [])).toBe(false)
  })

  /**
   * Le motif comparé doit être CELUI que le gate produit réellement : une constante qui aurait
   * dérivé du texte émis rendrait la règle inerte sans qu'aucun test ne bronche.
   */
  it('la constante est exactement le motif émis par le gate pour un run rouge', () => {
    const refus = evaluateClosure({ status: 'red', dod: [] })
    expect(refus.blocked).toBe(true)
    expect(refus.reasons).toContain(CLOSURE_UPSTREAM_REFUSAL)
    expect(doitArreterLaReparation(refus.reasons, refus.reasons)).toBe(true)
  })

  /**
   * Câblage : la décision doit être CONSULTÉE dans la boucle, sinon les tests ci-dessus valideraient
   * une règle que personne n'applique. Une seule assertion de structure, assumée comme telle.
   */
  it('la boucle de réparation consulte cette décision', () => {
    const source = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')
    expect(source).toContain('doitArreterLaReparation(gate.reasons, motifsPrecedents)')
    expect(source).toContain('motifsPrecedents = [...gate.reasons]')
  })
})
