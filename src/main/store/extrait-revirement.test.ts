import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * UN EXTRAIT NE DOIT PAS FAIRE PASSER UN CHOIX ABANDONNE POUR LE CHOIX ACTUEL.
 *
 * Defaut releve par l'audit, et c'est le plus grave : `fenetre()` decoupe 120 caracteres autour du
 * PREMIER mot trouve, sans egard pour la suite de la phrase. Si le message dit « on utilisait
 * l'ambre [...] mais on a ABANDONNE cette convention », le revirement tombe au-dela de la marge et
 * disparait -- l'extrait se lit comme une affirmation encore valide.
 *
 * C'est exactement le mode d'echec que ce chantier visait a supprimer : un rappel qui induit le
 * mauvais geste. Il etait reintroduit par le mecanisme cense le prevenir, et le `...` de troncature
 * ne distinguait pas « coupe sans consequence » de « coupe au point d'inverser le sens ».
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE CORRECTIF EST TROP LARGE : un message SANS revirement
 * ne doit pas voir son extrait gonfler inutilement. Le dernier cas garde ce bord.
 */

const CONTEXTE = 'et il y avait beaucoup de details techniques a regler ce jour-la, '.repeat(3)

function storeAvecRevirement(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  const c = store.create({ title: 'Revirement', provider: 'claude' })
  store.append(c.id, {
    role: 'user',
    content:
      "on utilisait l'ambre pour signaler un travail en cours, " +
      CONTEXTE +
      "mais on a finalement ABANDONNE cette convention pour le violet"
  })
  return store
}

describe('un extrait porte le revirement, ou le signale', () => {
  it('rend visible le fait que la suite du message contredit l extrait', () => {
    const trouve = storeAvecRevirement().search('ambre')
    const extrait = trouve[0].extraits[0].extrait

    // Soit le connecteur de contraste est present, soit le lecteur est averti que l'extrait
    // peut ne pas porter la conclusion. Un « ... » nu ne suffit pas : il ne distingue pas.
    const porteLeRevirement = /abandonne|finalement|mais/i.test(extrait)
    const avertit = /suite|contred|revir/i.test(extrait)
    expect(porteLeRevirement || avertit).toBe(true)
  })

  it('ne gonfle pas un extrait qui n a aucun revirement', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Simple', provider: 'claude' })
    store.append(c.id, { role: 'user', content: "l'ambre signale un travail en cours" })

    const extrait = store.search('ambre')[0].extraits[0].extrait
    expect(extrait).toBe("l'ambre signale un travail en cours")
  })
})
