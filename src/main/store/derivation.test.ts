import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * DEUX EXIGENCES QUI TIRENT EN SENS INVERSE, et il faut les deux.
 *
 * (a) « conversion » ne doit PAS remonter tout ce qui parle de « conversation » -- le mot le plus
 *     frequent de ce corpus. C'etait la collision du cycle 1.
 * (b) « notification » doit TOUJOURS retrouver « notifier », et « parametrage » « parametre » : ce
 *     sont des reformulations, et les retrouver est un item du besoin.
 *
 * Un seuil de racine unique ne peut pas satisfaire les deux : « conversation »/« conversion »
 * partagent SEPT lettres, « notification »/« notifier » seulement SIX. Allonger le seuil pour
 * separer les premiers separe aussi les seconds -- c'est la regression relevee par l'audit du
 * cycle 2, et elle degradait un item du DoD pour fermer un autre defaut.
 *
 * Ce test tient les DEUX bords en meme temps, pour qu'aucun reglage de seuil ne puisse plus
 * satisfaire l'un en cassant l'autre en silence.
 */

describe('racinisation : separer sans casser les derivations', () => {
  it('« conversion » ne remonte pas ce qui parle seulement de conversations', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    // « conversation » est partout, comme dans le vrai corpus.
    for (let index = 0; index < 30; index++) {
      const bruit = store.create({ title: 'bruit ' + index, provider: 'claude' })
      store.append(bruit.id, { role: 'user', content: 'range mes conversations par dossier' })
    }
    const vraie = store.create({ title: 'Vraie cible', provider: 'claude' })
    store.append(vraie.id, { role: 'user', content: 'la conversion du fichier a echoue' })

    const trouve = store.search('conversion', { limite: 5 }).map((c) => c.title)
    expect(trouve[0]).toBe('Vraie cible')
  })

  it('« notification » retrouve « notifier »', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Notifs', provider: 'claude' })
    store.append(c.id, { role: 'user', content: 'il faut notifier l utilisateur a la fin' })
    expect(store.search('notification').map((x) => x.title)).toContain('Notifs')
  })

  it('« parametrage » retrouve « parametre »', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Reglages', provider: 'claude' })
    store.append(c.id, { role: 'user', content: 'change le parametre de profondeur' })
    expect(store.search('parametrage').map((x) => x.title)).toContain('Reglages')
  })
})
