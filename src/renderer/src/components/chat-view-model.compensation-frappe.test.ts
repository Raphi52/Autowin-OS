import { describe, expect, it } from 'vitest'
import { compenserRetrecissementDuFil } from './chat-view-model'

describe('compenserRetrecissementDuFil', () => {
  it('recule le fil de ce que la fenetre a perdu quand la barre de saisie grandit', () => {
    // Fenetre 500 -> 460 px (4 lignes tapees) : sans compensation, le bas sort du champ.
    expect(
      compenserRetrecissementDuFil({
        suivaitLeBas: true,
        hauteurPrecedente: 500,
        metrics: { scrollTop: 1500, clientHeight: 460, scrollHeight: 2000 } as HTMLElement
      })
    ).toBe(1540)
  })

  it('ne depasse jamais le bas reel du fil', () => {
    expect(
      compenserRetrecissementDuFil({
        suivaitLeBas: true,
        hauteurPrecedente: 500,
        metrics: { scrollTop: 1520, clientHeight: 460, scrollHeight: 2000 } as HTMLElement
      })
    ).toBe(1540)
  })

  it('ne touche a rien si le lecteur lisait plus haut', () => {
    expect(
      compenserRetrecissementDuFil({
        suivaitLeBas: false,
        hauteurPrecedente: 500,
        metrics: { scrollTop: 200, clientHeight: 460, scrollHeight: 2000 } as HTMLElement
      })
    ).toBeNull()
  })

  it('ne touche a rien quand la fenetre GRANDIT (barre videe apres envoi)', () => {
    expect(
      compenserRetrecissementDuFil({
        suivaitLeBas: true,
        hauteurPrecedente: 460,
        metrics: { scrollTop: 1540, clientHeight: 500, scrollHeight: 2000 } as HTMLElement
      })
    ).toBeNull()
  })
})
