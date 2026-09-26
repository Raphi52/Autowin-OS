import { describe, expect, it } from 'vitest'
import { memeRefus } from './stopgate'

/**
 * conv-540, tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 : 20 reparations payees pour le meme refus.
 * Le motif « Promis mais pas fait » recopie les objections du juge, et ces objections contiennent
 * elles-memes des guillemets francais. La paire «…» la plus courte s'arrete donc au premier »
 * INTERIEUR, et tout le texte qui suit reste compare mot pour mot alors qu'il est reformule a
 * chaque passage.
 */
describe('memeRefus — citations imbriquees', () => {
  const refus = (interieur: string): string[] => [
    "Échec déjà déclaré : ce travail s'est lui-même terminé en échec, ce contrôle ne fait que le relayer.",
    `Promis mais pas fait : « Objection du juge : ${interieur} »`
  ]

  it('reconnait deux refus identiques quand la citation contient elle-meme des guillemets', () => {
    expect(
      memeRefus(
        refus('le texte dit « pas corrigé » puis « corrigé », seul le dernier fait foi.'),
        refus('un passage dit « impossible » puis « fait » ; la lecture est coûteuse.')
      )
    ).toBe(true)
  })

  it('distingue toujours deux refus dont le REPROCHE differe', () => {
    expect(
      memeRefus(['Promis mais pas fait : « a »'], ['Statut rouge : « a »'])
    ).toBe(false)
  })
})
