import { describe, expect, it } from 'vitest'
import { verdictVeilleurInactivite } from './run-pilot-chat'

/*
 * UNE COMMANDE QUI TOURNE EST UN SIGNE DE VIE — MEME QUAND ELLE N'EMET RIEN.
 *
 * DEFAUT VECU le 2026-09-04 (conv-233) : le veilleur ne regarde que les EVENEMENTS du pilote, or
 * entre `command` (le depart) et `result` (l'arrivee) une commande longue n'en emet AUCUN. Une
 * suite de tests de 233 s, deux editions coupees a 182 s et l'attente du modele ont suffi a
 * franchir le plafond : le tour a ete tue avec « aucun signe de vie depuis 20 minutes » ALORS
 * QU'IL TRAVAILLAIT, et le travail lance a fini sans jamais rendre son resultat.
 *
 * On ne RELACHE pas la garde — elle existe pour les tours REELLEMENT morts (conv-1181, conv-1242 :
 * figes sur « [a execute orchestrate] », sans reponse ni erreur). On la rend EXACTE : tant qu'une
 * commande est en vol, le tour attend, il n'est pas mort. Des qu'elles sont toutes revenues, le
 * compte a rebours repart de zero.
 */
describe('veilleur d’inactivité — une commande en vol n’est pas un tour mort', () => {
  const plafondMs = 20 * 60 * 1000

  it('patiente tant que le plafond n’est pas atteint', () => {
    expect(verdictVeilleurInactivite({ inactifDepuisMs: 60_000, commandesEnVol: 0, plafondMs })).toBe(
      'patienter'
    )
  })

  it('coupe un tour réellement muet au-delà du plafond', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: plafondMs, commandesEnVol: 0, plafondMs })
    ).toBe('couper')
  })

  it('ne coupe JAMAIS pendant qu’une commande est en vol, même bien au-delà du plafond', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: plafondMs * 5, commandesEnVol: 1, plafondMs })
    ).toBe('commande-en-vol')
  })

  it('redevient armé dès que la dernière commande est revenue', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: plafondMs, commandesEnVol: 0, plafondMs })
    ).toBe('couper')
  })
})
