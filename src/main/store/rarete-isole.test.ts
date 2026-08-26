import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * `rarete()` SERT-ELLE A QUELQUE CHOSE, une fois la normalisation par longueur en place ?
 *
 * Reproche du juge sur-ingenierie : `rarete()` et la division par `sqrt(longueur)` corrigent le MEME
 * symptome mesure (« les conversations fourre-tout remontent en tete »), et AUCUN test n'isole
 * l'effet de la premiere. Deux corrections empilees pour une seule observation, dont une seule est
 * prouvee.
 *
 * Ce test tranche : deux messages de MEME longueur, l'un portant un mot present partout dans le
 * corpus, l'autre un mot rare. A longueur egale, la normalisation ne les distingue pas -- seule la
 * rarete peut. Si ce test passe avec `rarete()` remplacee par une constante, la couche est morte.
 *
 * REECRIT le 2026-08-26, parce qu'il avait cesse de garder. Le re-classement par le mot porteur
 * (introduit le meme jour) decidait a sa place : le porteur etait « zephyr », le plus tardif de la
 * demande, et il remontait la bonne conversation sans que la rarete intervienne. Verifie par sabotage :
 * le test passait AUSSI avec `rarete()` rendant 1 pour tout -- soit exactement la condition sous
 * laquelle sa propre docstring le declare mort. Le montage NEUTRALISE donc desormais le re-classement :
 * le mot le plus long de la demande (« signalement ») est present dans LES DEUX candidats, donc le
 * re-classement les met tous deux devant et ne les separe pas. Seul le score peut alors trancher, et
 * dans le score, a longueur egale, seule la rarete distingue.
 */

describe('la rarete distingue a longueur EGALE', () => {
  it('classe en tete le message qui porte le mot RARE, pas le mot omnipresent', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)

    // « statut » est partout : le trouver n'apprend rien. « signalement » aussi, mais il est present
    // dans les DEUX candidats -- c'est ce qui neutralise le re-classement.
    for (let index = 0; index < 40; index++) {
      const bruit = store.create({ title: 'bruit ' + index, provider: 'claude' })
      store.append(bruit.id, { role: 'user', content: 'le statut du signalement avance bien ici' })
    }

    // Deux candidats de MEME longueur exacte. Chacun porte « signalement » (donc le porteur), et se
    // distingue par UN seul mot : l'omnipresent contre le rare.
    const commun = store.create({ title: 'Mot commun', provider: 'claude' })
    store.append(commun.id, { role: 'user', content: 'signalement : statut, rien de plus a dire' })
    const rare = store.create({ title: 'Mot rare', provider: 'claude' })
    store.append(rare.id, { role: 'user', content: 'signalement : zephyr, rien de plus a dire' })

    const commande = store.messagesOf(commun.id)[0].content as string
    const rarissime = store.messagesOf(rare.id)[0].content as string
    expect(commande.length).toBe(rarissime.length)

    // Le mot le plus long de la demande est « signalement » : il est dans les deux candidats, donc le
    // re-classement ne peut pas les departager. Seule la rarete de « statut » contre « zephyr » reste.
    const classement = store.search('signalement statut zephyr', { limite: 3 }).map((c) => c.title)
    expect(classement[0]).toBe('Mot rare')
  })
})
