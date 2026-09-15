import { describe, expect, it } from 'vitest'
import { CLOSURE_UPSTREAM_REFUSAL, memeRefus } from './stopgate'

/**
 * UN REFUS FIGÉ DONT LA CITATION CHANGE reste le MÊME refus.
 *
 * Défaut VÉCU, conv-540, tour `4dfe2821-f6da-4cd9-8cb8-7afba10d3df4` (saisie `ts` 1789463252460) :
 * SEIZE passages `[RÉPARATION 1..16]`, tous refusés sur le même couple de motifs — « Échec déjà
 * déclaré … ; Promis mais pas fait : « Objection du juge : … » ». Le compteur de refus figé n'a
 * jamais mordu parce que `memeRefus` comparait mot pour mot : le motif « Promis mais pas fait »
 * RECOPIE les objections du juge, qui sont reformulées à chaque passage. Le refus était figé, sa
 * citation ne l'était pas — et 14 builds + panels ont été payés pour rien.
 */
describe('refus figé dont la citation varie', () => {
  const refus = (citation: string): string[] => [
    CLOSURE_UPSTREAM_REFUSAL,
    `Promis mais pas fait : « ${citation} ».`
  ]

  it('compte comme le MÊME refus quand seule la citation entre guillemets change', () => {
    expect(
      memeRefus(refus('Objection du juge : aucun vrai tour fini en vert'), refus('Objection du juge : la cause principale n’est pas corrigée'))
    ).toBe(true)
  })

  it('dit toujours non quand le motif lui-même change', () => {
    expect(
      memeRefus(['Signal rouge : code de sortie 1 != 0.'], refus('Objection du juge : x'))
    ).toBe(false)
  })

  it('dit toujours non au tout premier refus', () => {
    expect(memeRefus(refus('x'), [])).toBe(false)
  })
})
