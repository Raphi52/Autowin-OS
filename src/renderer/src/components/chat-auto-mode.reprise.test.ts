import { describe, expect, it } from 'vitest'
import { premierPassageLaisseSortirLeTour } from './chat-auto-mode'

/*
 * DEFAUT VECU le 2026-09-05 (conv-303) : l'agent redemarre l'app lui-meme au milieu d'une chaine en
 * mode auto. Au retour, le repere « premier passage dans ce fil » — qui vit en memoire — est vide,
 * la boucle croit ARRIVER dans la conversation, fige le dernier tour et saute le maillon suivant.
 * L'interrupteur reste allume : la chaine meurt en SILENCE et l'utilisateur doit renvoyer la suite
 * a la main. Un redemarrage voulu n'est pas une ouverture de fil.
 */
describe('premier passage dans un fil — reprise apres redemarrage', () => {
  it('laisse sortir le tour quand l’agent a redemarre l’app lui-meme', () => {
    expect(
      premierPassageLaisseSortirLeTour({ allumageManuel: false, repriseApresRedemarrage: true })
    ).toBe(true)
  })

  it('laisse sortir le tour sur un allumage manuel — comportement d’origine conserve', () => {
    expect(
      premierPassageLaisseSortirLeTour({ allumageManuel: true, repriseApresRedemarrage: false })
    ).toBe(true)
  })

  it('CAS LIMITE — fige le tour quand on ROUVRE simplement un fil', () => {
    expect(
      premierPassageLaisseSortirLeTour({ allumageManuel: false, repriseApresRedemarrage: false })
    ).toBe(false)
  })

  it('CAS LIMITE — les deux signaux ensemble n’envoient qu’une fois, sans se contredire', () => {
    expect(
      premierPassageLaisseSortirLeTour({ allumageManuel: true, repriseApresRedemarrage: true })
    ).toBe(true)
  })
})
