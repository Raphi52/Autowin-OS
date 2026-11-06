import { describe, expect, it } from 'vitest'
import {
  FENETRE_DOUBLON_MS,
  LONGUEUR_TITRE,
  TITRE_PAR_DEFAUT,
  conversationRecenteEquivalente,
  titreDeConversationDemandee
} from './conversation-demandee'

describe('titre d une conversation demandee', () => {
  it('reprend LES MOTS de l utilisateur quand aucun titre n est fourni', () => {
    expect(titreDeConversationDemandee(undefined, 'lance une conversation test.')).toBe(
      'lance une conversation test.'
    )
  })

  it('garde le titre explicite quand il y en a un', () => {
    expect(titreDeConversationDemandee('Audit facturation', 'lance une conversation test.')).toBe(
      'Audit facturation'
    )
  })

  it('ignore un titre vide ou blanc', () => {
    expect(titreDeConversationDemandee('   ', 'refais les pastilles')).toBe('refais les pastilles')
  })

  it('coupe un message long au lieu de coller un paragraphe', () => {
    const titre = titreDeConversationDemandee(undefined, 'a'.repeat(200))
    expect(titre.length).toBeLessThanOrEqual(LONGUEUR_TITRE + 1)
    expect(titre.endsWith('…')).toBe(true)
  })

  it('coupe EXACTEMENT comme la barre laterale (ChatView.tsx:2711) : 42 puis …', () => {
    const message = 'a'.repeat(200)
    // La regle de l'interface, recopiee telle quelle : c'est elle qui fait foi a l'ecran.
    const commeLInterface = message.length > 42 ? `${message.slice(0, 42)}…` : message
    expect(titreDeConversationDemandee(undefined, message)).toBe(commeLInterface)
    expect(LONGUEUR_TITRE).toBe(42)
  })

  it('ne coupe pas un message qui tient pile dans la largeur', () => {
    const pile = 'b'.repeat(42)
    expect(titreDeConversationDemandee(undefined, pile)).toBe(pile)
  })

  it('retombe sur un nom neutre quand il n y a aucun mot', () => {
    expect(titreDeConversationDemandee(undefined, '   ')).toBe(TITRE_PAR_DEFAUT)
  })
})

describe('double envoi de create_conversation', () => {
  const base = [
    { id: 'conv-72', title: 'lance une conversation test.', provider: 'claude', createdAt: 1_000 }
  ]

  it('retrouve la conversation creee par le MEME geste quelques secondes plus tot', () => {
    const trouvee = conversationRecenteEquivalente(base, {
      title: 'Lance une conversation test',
      provider: 'claude',
      maintenant: 3_000
    })
    expect(trouvee?.id).toBe('conv-72')
  })

  it('laisse passer une homonyme creee bien plus tard', () => {
    expect(
      conversationRecenteEquivalente(base, {
        title: 'lance une conversation test.',
        provider: 'claude',
        maintenant: 1_000 + FENETRE_DOUBLON_MS + 1
      })
    ).toBeUndefined()
  })

  it('ne confond pas deux fournisseurs differents', () => {
    expect(
      conversationRecenteEquivalente(base, {
        title: 'lance une conversation test.',
        provider: 'codex',
        maintenant: 2_000
      })
    ).toBeUndefined()
  })

  it('ne confond pas deux titres differents', () => {
    expect(
      conversationRecenteEquivalente(base, {
        title: 'autre sujet',
        provider: 'claude',
        maintenant: 2_000
      })
    ).toBeUndefined()
  })
})
