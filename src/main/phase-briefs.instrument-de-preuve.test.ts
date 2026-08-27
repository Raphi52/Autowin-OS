import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS } from './phase-briefs'

/**
 * L'INSTRUMENT DE PREUVE MANQUANT SE REPARE — IL NE SE SIGNALE PAS.
 *
 * Vecu le 2026-08-26 (conv-1420), et l'utilisateur l'a resume ainsi : « j'aimerais que ca marche
 * la-bas du premier coup ». Deux runs, 1,95 $, pour un travail qui etait BON des le premier : le
 * code existait, le test etait rouge puis vert, la mutation prouvait sa falsifiabilite. Le juge a
 * refuse pour une raison que le producteur ne pouvait pas lever :
 *
 *   « le juge exige une capture du popover OUVERT montrant la jauge, que le harnais ui-capture ne
 *    sait pas produire »
 *
 * Le producteur a alors fait exactement ce que le brief lui disait : fix minimal, obstacle nomme,
 * correctif RECOMMANDE a quelqu'un d'autre — « etendre scripts/ui-capture.mjs d'un --click ».
 * Ecrire cette option a pris vingt minutes. Il ne l'a pas fait parce que RIEN ne l'y autorisait :
 * la section ANTI-BLOCAGE dit « cherche ailleurs », « change de moyen », « un outil qui echoue une
 * fois n'est pas un mur » — jamais « l'outil qui ne SAIT PAS FAIRE se complete ». Et `fix minimal
 * (pas de refactor opportuniste) » pousse dans l'autre sens.
 *
 * LA LIMITE DE CE TEST, ecrite pour ne pas etre oubliee : verifier qu'une phrase est PRESENTE dans
 * un prompt ne prouve pas qu'un modele la SUIVRA. C'est une garde comportementale, pas un oracle.
 * Elle verrouille seulement que la consigne existe et ne disparaitra pas par inadvertance — la
 * preuve de son effet vit dans les runs suivants, pas ici.
 */
describe('brief BUILD — quand le harnais ne sait pas produire la preuve exigee', () => {
  it('autorise explicitement a ETENDRE l’instrument de preuve', () => {
    expect(PHASE_BRIEFS.build).toMatch(/instrument de preuve/i)
    expect(PHASE_BRIEFS.build).toMatch(/[EÉ]TENDS-LE/)
  })

  it('nomme le cas mesure, pour que la consigne ne se lise pas comme un principe vague', () => {
    expect(PHASE_BRIEFS.build).toMatch(/conv-1420/)
  })

  it('BORNE la permission a l’instrument de preuve, sans rouvrir le refactor opportuniste', () => {
    // Sans cette borne, la consigne se lirait comme une licence generale de sortir du perimetre —
    // exactement ce que « fix minimal » existe pour empecher. Les deux doivent coexister.
    expect(PHASE_BRIEFS.build).toMatch(/fix minimal/i)
  })
})
