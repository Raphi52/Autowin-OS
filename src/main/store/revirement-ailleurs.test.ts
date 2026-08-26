import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * LES DEUX TROUS QUE L'AUDIT A LAISSES OUVERTS.
 *
 * Le cycle 1 avait ferme le cas ou le revirement suit le mot dans LE MEME message. Le cycle 2 a
 * montre que ca ne suffisait pas :
 *
 *  (a) un revirement exprime dans un message ULTERIEUR de la meme conversation n'etait jamais vu --
 *      la fenetre ne regarde qu'un message a la fois, et le message porteur du revirement ne contient
 *      souvent AUCUN mot de la demande, donc il n'est meme pas candidat ;
 *  (b) la liste des connecteurs est FERMEE : « on est passe au violet », « l'ambre ne signale plus
 *      rien » n'y figurent pas, et l'extrait ne portait alors aucune marque distincte.
 *
 * Dans les deux cas le rappel fait lire un choix ABANDONNE comme le choix actuel. C'est le mode
 * d'echec que ce chantier existe pour eviter -- le laisser ouvert en le nommant ne le ferme pas.
 *
 * Ce que ce test EXIGE : soit le revirement est rendu visible, soit le lecteur est AVERTI que
 * l'extrait ne porte pas forcement la conclusion. Un « ... » nu ne suffit pas : il ne distingue pas
 * « coupe sans consequence » de « coupe au point d'inverser le sens ».
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI L'AVERTISSEMENT EST POSE PARTOUT : une conversation d'UN
 * seul message, entierement montre, sans rien apres, ne doit porter AUCUN avertissement -- sinon
 * l'avertissement devient du bruit et cesse d'etre lu. Le dernier cas garde ce bord.
 */

describe('un revirement hors du message porteur', () => {
  it('un revirement dans un message ULTERIEUR est signale', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Fil', provider: 'claude' })
    store.append(c.id, { role: 'user', content: "on utilisait l'ambre pour signaler l'attente" })
    store.append(c.id, { role: 'assistant', content: 'compris, ambre pour attente' })
    // Ce message ne contient AUCUN mot de la demande : il ne serait jamais candidat.
    store.append(c.id, { role: 'user', content: 'finalement le violet a pris la place, on abandonne' })

    const extraits = store.search('ambre')[0].extraits.map((e) => e.extrait).join(' ')
    const porteLeRevirement = /violet|abandonne/i.test(extraits)
    const avertit = /suite|contred|revir|conversation continue/i.test(extraits)
    expect(porteLeRevirement || avertit).toBe(true)
  })

  it('un revirement SANS connecteur de la liste est signale', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Sans connecteur', provider: 'claude' })
    const remplissage = 'et il y avait des details a regler ce jour-la, '.repeat(4)
    store.append(c.id, {
      role: 'user',
      content:
        // Aucun mot de la liste des connecteurs ici : ni mais, ni finalement, ni depuis.
        "on utilisait l'ambre pour l'attente, " + remplissage + 'le violet a pris sa place'
    })

    const extrait = store.search('ambre')[0].extraits[0].extrait
    const porteLeRevirement = /violet/i.test(extrait)
    const avertit = /suite|contred|revir|conversation continue|extrait/i.test(extrait)
    expect(porteLeRevirement || avertit).toBe(true)
  })

  it('n avertit PAS quand tout est montre et que rien ne suit', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Complet', provider: 'claude' })
    store.append(c.id, { role: 'user', content: "l'ambre signale un travail en cours" })

    const extrait = store.search('ambre')[0].extraits[0].extrait
    expect(extrait).toBe("l'ambre signale un travail en cours")
  })
})
