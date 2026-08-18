import { describe, expect, it } from 'vitest'
import {
  searchConversations,
  trierParRecenceUtilisateur,
  type ConversationSearchSource
} from './conversation-search'

const conversations: ConversationSearchSource[] = [
  {
    id: 'recent-message',
    title: 'Revue technique',
    provider: 'claude',
    updatedAt: 30,
    messages: [
      { role: 'user', content: 'Cherche la stratégie de déploiement Windows', ts: 10 },
      { role: 'assistant', content: 'Le déploiement atomique est retenu.', ts: 20 }
    ]
  },
  {
    id: 'title',
    title: 'Déploiement production',
    provider: 'codex',
    updatedAt: 20,
    messages: []
  },
  {
    id: 'other',
    title: 'Interface Agents',
    provider: 'native',
    updatedAt: 40,
    messages: [{ role: 'user', content: 'Améliorer la lisibilité', ts: 40 }]
  }
]

describe('conversation search', () => {
  it('returns the normal list when the query is empty', () => {
    expect(searchConversations(conversations, '').map((hit) => hit.conversation.id)).toEqual([
      'recent-message',
      'title',
      'other'
    ])
  })

  it('searches titles and messages without accents or case sensitivity', () => {
    const hits = searchConversations(conversations, 'DEPLOIEMENT')
    expect(hits.map((hit) => [hit.conversation.id, hit.matchedIn])).toEqual([
      ['title', 'title'],
      ['recent-message', 'message']
    ])
    expect(hits[1].snippet).toContain('déploiement atomique')
  })

  it('requires every query word in one title or one message', () => {
    expect(
      searchConversations(conversations, 'strategie windows').map((hit) => hit.conversation.id)
    ).toEqual(['recent-message'])
    expect(searchConversations(conversations, 'windows atomique')).toEqual([])
  })

  it('bounds results', () => {
    expect(searchConversations(conversations, '', 2)).toHaveLength(2)
  })

  it('ignores malformed persisted fields instead of breaking the search', () => {
    const malformed = {
      ...conversations[0],
      title: undefined,
      messages: [{ role: 'user', content: undefined, ts: 1 }]
    } as unknown as ConversationSearchSource

    expect(() => searchConversations([malformed], 'déploiement')).not.toThrow()
    expect(searchConversations([malformed], 'déploiement')).toEqual([])
  })

  it('invalide le cache de normalisation quand la conversation change (updatedAt)', () => {
    const conv: ConversationSearchSource = {
      id: 'evolutive',
      title: 'Sujet initial',
      provider: 'claude',
      updatedAt: 1,
      messages: [{ role: 'user', content: 'contenu alpha', ts: 1 }]
    }
    expect(searchConversations([conv], 'alpha').map((h) => h.conversation.id)).toEqual([
      'evolutive'
    ])
    expect(searchConversations([conv], 'beta')).toEqual([])
    // même id, contenu changé + updatedAt incrémenté → le cache doit se rafraîchir
    const updated: ConversationSearchSource = {
      ...conv,
      updatedAt: 2,
      messages: [{ role: 'user', content: 'contenu beta', ts: 2 }]
    }
    expect(searchConversations([updated], 'beta').map((h) => h.conversation.id)).toEqual([
      'evolutive'
    ])
    expect(searchConversations([updated], 'alpha')).toEqual([])
  })
})

describe('la liste SANS recherche ne doit pas mentir sur ce qu’elle contient', () => {
  /*
    Constaté par l'utilisateur le 2026-08-15 : « je vois que la catégorie Divers avec 40 éléments,
    on dirait un mock-up, le compteur bouge jamais ».

    Il avait raison, et le « 40 » n'était pas un compte : c'était le PLAFOND lui-même, appliqué quand
    la recherche est vide. Son installation compte 1 011 conversations ; la barre latérale n'en
    montrait que les 40 premières, et l'en-tête affichait donc éternellement 40. Trente sondes créées
    et vérifiées présentes (`conv-1195`→`conv-1224`) restaient invisibles : elles tombaient hors des 40.

    C'est la même faute que celles corrigées le même jour — un affichage qui montre une PARTIE en se
    présentant comme le TOUT. Un plafond est légitime pour tenir le rendu ; le présenter comme un
    inventaire complet ne l'est pas.
  */
  const beaucoup = Array.from({ length: 300 }, (_, i) => ({
    id: `conv-${i}`,
    title: `Conversation ${i}`,
    provider: 'claude',
    updatedAt: i,
    messages: []
  }))

  it('rend BIEN PLUS que les 40 premières quand aucune recherche n’est saisie', () => {
    const hits = searchConversations(beaucoup, '')
    expect(hits.length).toBeGreaterThan(40)
    expect(hits.length).toBe(300)
  })

  it('rend les récentes ET les anciennes : une conversation au-delà du 40ᵉ rang reste atteignable', () => {
    // Le cas vécu : les sondes existaient, mais hors fenêtre. Une liste qui les cache les nie.
    const hits = searchConversations(beaucoup, '')
    expect(hits.some((hit) => hit.conversation.id === 'conv-250')).toBe(true)
  })

  it('garde un plafond de sécurité : une base énorme ne rend pas la liste sans fin', () => {
    // Le plafond n'est pas supprimé, il est porté à une valeur qui couvre l'usage réel observé
    // (1 011 conversations) sans promettre l'infini.
    const enorme = Array.from({ length: 5_000 }, (_, i) => ({
      id: `c-${i}`,
      title: `t${i}`,
      provider: 'claude',
      updatedAt: i,
      messages: []
    }))
    const hits = searchConversations(enorme, '')
    expect(hits.length).toBeLessThan(5_000)
    expect(hits.length).toBeGreaterThanOrEqual(1_500)
  })
})

describe('tri « plus recentes » de la barre laterale', () => {
  /**
   * Defaut vecu le 2026-08-18 : la liste triait sur `updatedAt` SEUL, que bouge n'importe quelle
   * touche non-utilisateur — ranger la conversation dans un dossier, attacher un RUN.md, un delta de
   * streaming, un fork. Ranger une conversation la faisait donc remonter en tete comme si on venait
   * d'y ecrire. « Plus recentes » doit vouloir dire « la ou J'AI parle en dernier ».
   */
  const rangee: ConversationSearchSource = {
    id: 'rangee-a-l-instant',
    title: 'Vieille discussion rangee dans un dossier',
    provider: 'claude',
    // Touchee a l'instant par le rangement...
    updatedAt: 10_000,
    // ...mais l'utilisateur n'y a rien ecrit depuis longtemps.
    messages: [{ role: 'user', content: 'vieux message', ts: 100 }]
  }
  const parlee: ConversationSearchSource = {
    id: 'parlee-recemment',
    title: 'Discussion en cours',
    provider: 'claude',
    updatedAt: 900,
    messages: [{ role: 'user', content: 'message recent', ts: 800 }]
  }

  const hits = (sources: ConversationSearchSource[]) =>
    sources.map((conversation) => ({ conversation, matchedIn: 'all' as const }))

  it('classe par DERNIER MESSAGE UTILISATEUR, pas par derniere touche', () => {
    const ordonnes = trierParRecenceUtilisateur(hits([rangee, parlee]), 'desc')
    expect(ordonnes.map((h) => h.conversation.id)).toEqual(['parlee-recemment', 'rangee-a-l-instant'])
  })

  it('inverse l ordre en « plus anciennes »', () => {
    const ordonnes = trierParRecenceUtilisateur(hits([rangee, parlee]), 'asc')
    expect(ordonnes.map((h) => h.conversation.id)).toEqual(['rangee-a-l-instant', 'parlee-recemment'])
  })

  it('retombe sur updatedAt quand l utilisateur n a jamais ecrit', () => {
    const jamaisParlee: ConversationSearchSource = {
      id: 'jamais-parlee',
      title: 'Creee par un agent',
      provider: 'claude',
      updatedAt: 5_000,
      messages: [{ role: 'assistant', content: 'bonjour', ts: 4_000 }]
    }
    const ordonnes = trierParRecenceUtilisateur(hits([parlee, jamaisParlee]), 'desc')
    // 5 000 (repli updatedAt) passe devant 800 (dernier message utilisateur).
    expect(ordonnes[0].conversation.id).toBe('jamais-parlee')
  })

  it('utilise lastUserMessageAt du resume quand les messages ne sont pas charges', () => {
    // La liste IPC est une PROJECTION LEGERE : `messages` est souvent absent, seul
    // `lastUserMessageAt` est fourni. Ignorer ce champ ramenait le defaut par une autre porte.
    const resume = {
      id: 'resume-sans-messages',
      title: 'Sans historique charge',
      provider: 'claude',
      updatedAt: 10_000,
      lastUserMessageAt: 50
    } as ConversationSearchSource
    const ordonnes = trierParRecenceUtilisateur(hits([resume, parlee]), 'desc')
    expect(ordonnes[0].conversation.id).toBe('parlee-recemment')
  })

  it('ne modifie pas le tableau recu', () => {
    const source = hits([rangee, parlee])
    trierParRecenceUtilisateur(source, 'desc')
    expect(source.map((h) => h.conversation.id)).toEqual(['rangee-a-l-instant', 'parlee-recemment'])
  })
})
