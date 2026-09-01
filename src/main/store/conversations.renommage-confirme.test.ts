import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/*
 * Defaut vecu conv-71 : `rename` ne rendait RIEN. L'appelant ne voyait aucune confirmation, en
 * deduisait un echec, et rejouait — c'est le meme reflexe qui a fait partir la creation deux fois.
 * Un renommage doit se CONSTATER, pas se supposer.
 */
describe('rename_conversation confirme ce qu il a fait', () => {
  it('rend le titre RELU dans le magasin, pas l argument recu', () => {
    const store = new ConversationStore()
    const conv = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    const rendu = store.rename(conv.id, 'lance une conversation test.')
    expect(rendu).toEqual({ id: conv.id, title: 'lance une conversation test.' })
    expect(store.get(conv.id)?.title).toBe('lance une conversation test.')
  })

  it('rend undefined sur un id inconnu — un vrai « non fait », distinguable d un succes', () => {
    const store = new ConversationStore()
    expect(store.rename('conv-inexistante', 'peu importe')).toBeUndefined()
  })
})
