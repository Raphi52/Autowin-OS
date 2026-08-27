import { describe, expect, it } from 'vitest'
import {
  CAUSES_OBSERVABLES,
  DELAI_ENTRE_DEUX_REPECHAGES_MS,
  ESSAIS_AUTOMATIQUES_MAX,
  travauxARepecher
} from './repechage-automatique'

/**
 * ATTENTE ACTIVE — barreau 3 de l'echelle.
 *
 * Le plafond de trois essais n'est pas un caprice : sans lui, mesure du 2026-08-24, vingt-et-un
 * travaux impubliables etaient repeches indefiniment, chaque passage RESTAURANT leur copie —
 * 682 Mo recrees. Le supprimer a l'aveugle reintroduirait ce defaut.
 *
 * Mais il ferme aussi la porte au cas VECU le 2026-08-27 (conv-1450) : un `base-dirty` sur un arbre
 * partage ou la cause ne disparait pas en trente minutes. Trois essais a l'aveugle, puis un echec
 * definitif, alors que le travail attendait simplement que l'utilisateur committe son fichier.
 *
 * La sortie n'est donc ni « plafond » ni « boucle infinie », c'est l'OBSERVATION : pour les causes
 * dont l'etat se relit a moindre frais (`git status`), on ne tente RIEN tant que la cause est la —
 * donc aucune copie restauree pour rien, aucun essai brule — et on tente DES qu'elle a disparu,
 * sans plafond ni delai. Une cause qu'on ne sait pas observer garde exactement le comportement
 * d'avant : trois essais, puis la main.
 */
describe('repechage — attente active sur les causes observables', () => {
  const candidat = (reason: string, runId = 'run-1'): Parameters<typeof travauxARepecher>[0][number] => ({
    runId,
    publication: 'blocked',
    attentionReason: reason
  })

  it('seule la cause qu on sait REELLEMENT observer y figure', () => {
    // `base-in-progress` en est absente a dessein : aucune sonde publique ne rend son etat, et
    // annoncer une observation qu'on ne fait pas serait pire que le plafond qu'elle remplacerait.
    expect([...CAUSES_OBSERVABLES]).toEqual(['base-dirty'])
    expect(CAUSES_OBSERVABLES.has('base-in-progress')).toBe(false)
  })

  it('cause TOUJOURS la : on ne tente rien, meme apres le delai — aucun essai brule', () => {
    const lot = travauxARepecher(
      [candidat('base-dirty')],
      new Map([['run-1', 0]]),
      DELAI_ENTRE_DEUX_REPECHAGES_MS * 10,
      new Map(),
      () => true
    )
    expect(lot).toEqual([])
  })

  it('cause DISPARUE : on tente immediatement, sans attendre le delai', () => {
    const lot = travauxARepecher(
      [candidat('base-dirty')],
      new Map([['run-1', DELAI_ENTRE_DEUX_REPECHAGES_MS * 10]]),
      DELAI_ENTRE_DEUX_REPECHAGES_MS * 10 + 1,
      new Map(),
      () => false
    )
    expect(lot).toEqual(['run-1'])
  })

  it('cause DISPARUE : le plafond ne s applique plus — c est ce qui rendait l echec definitif', () => {
    const lot = travauxARepecher(
      [candidat('base-dirty')],
      new Map(),
      0,
      new Map([['run-1', ESSAIS_AUTOMATIQUES_MAX + 5]]),
      () => false
    )
    expect(lot).toEqual(['run-1'])
  })

  it('une cause NON observable garde le comportement d avant : plafond souverain', () => {
    const avecObservateur = travauxARepecher(
      [candidat('merge-failed')],
      new Map(),
      0,
      new Map([['run-1', ESSAIS_AUTOMATIQUES_MAX]]),
      () => false
    )
    expect(avecObservateur).toEqual([])
  })

  it('sans observateur fourni, RIEN ne change : le plafond et le delai restent souverains', () => {
    expect(
      travauxARepecher([candidat('base-dirty')], new Map(), 0, new Map([['run-1', ESSAIS_AUTOMATIQUES_MAX]]))
    ).toEqual([])
    expect(travauxARepecher([candidat('base-dirty')], new Map(), 0)).toEqual(['run-1'])
  })

  it('un observateur qui echoue ne bloque pas le filet : on retombe sur plafond + delai', () => {
    const lot = travauxARepecher([candidat('base-dirty')], new Map(), 0, new Map(), () => {
      throw new Error('git indisponible')
    })
    expect(lot).toEqual(['run-1'])
  })
})
