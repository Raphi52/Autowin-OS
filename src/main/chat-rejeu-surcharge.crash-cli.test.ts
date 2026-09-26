import { describe, expect, it } from 'vitest'
import {
  DELAI_BASE_MS,
  TENTATIVES_SURCHARGE,
  deciderRejeuDeChat
} from './chat-rejeu-surcharge'

/**
 * CONV-623, tour `ee2cae40-7dca-4c58-8ebb-9fb9aeadbcbb` : l'iteration 1 meurt en
 * `error_during_execution` a 18:51:58.702 (1876 ms, 0 token, 0 USD), le rejeu part 10 ms plus tard
 * (event `retry`, at 1789584718704) et remeurt a l'identique a 18:52:00.625 (1909 ms). Le tour
 * ENTIER est jete apres 753 650 tokens et 0,7190 USD deja payes, et la conclusion que le modele
 * avait en main — « la branche mentionnee dans le prompt n'existait pas en realite » — n'a jamais
 * atteint l'utilisateur.
 *
 * Un crash d'execution du CLI qui n'a RIEN coute est deja filtre comme rejouable en amont
 * (`providers/claude.ts`, champ `retryable`). Ce qui manquait ici, c'est le TEMPS : rejoue dans la
 * meme seconde, il retombe sur le meme CLI encore casse. Meme politique que la surcharge serveur.
 */
const CRASH_CLI = "Claude a interrompu l'appel : error_during_execution · 0.0000 USD"

describe('rejeu du chat sur crash d execution du CLI', () => {
  it('attend avant de rejouer, et laisse deux chances au lieu d une', () => {
    expect(deciderRejeuDeChat(CRASH_CLI, 0)).toEqual({
      rejouer: true,
      maxAttempts: TENTATIVES_SURCHARGE,
      delaiMs: DELAI_BASE_MS
    })
    expect(deciderRejeuDeChat(CRASH_CLI, 1)).toEqual({
      rejouer: true,
      maxAttempts: TENTATIVES_SURCHARGE,
      delaiMs: 2 * DELAI_BASE_MS
    })
    expect(deciderRejeuDeChat(CRASH_CLI, 2).rejouer).toBe(false)
  })
})
