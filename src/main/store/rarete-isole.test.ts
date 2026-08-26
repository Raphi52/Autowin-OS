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
 */

describe('la rarete distingue a longueur EGALE', () => {
  it('classe en tete le message qui porte le mot RARE, pas le mot omnipresent', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)

    // « statut » est partout : le trouver n'apprend rien.
    for (let index = 0; index < 40; index++) {
      const bruit = store.create({ title: 'bruit ' + index, provider: 'claude' })
      store.append(bruit.id, { role: 'user', content: 'le statut du travail avance bien ici' })
    }

    // Deux candidats de MEME longueur exacte, chacun portant UN mot de la demande.
    const commun = store.create({ title: 'Mot commun', provider: 'claude' })
    store.append(commun.id, { role: 'user', content: 'voici le statut, rien de plus a signaler' })
    const rare = store.create({ title: 'Mot rare', provider: 'claude' })
    store.append(rare.id, { role: 'user', content: 'voici le zephyr, rien de plus a signaler' })

    const commande = store.messagesOf(commun.id)[0].content as string
    const rarissime = store.messagesOf(rare.id)[0].content as string
    expect(commande.length).toBe(rarissime.length)

    // La demande porte les DEUX mots : seule la rarete peut les departager.
    const classement = store.search('statut zephyr', { limite: 3 }).map((c) => c.title)
    expect(classement[0]).toBe('Mot rare')
  })
})
