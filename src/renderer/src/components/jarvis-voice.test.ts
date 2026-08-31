import { describe, expect, it } from 'vitest'
import {
  appliquerParole,
  basculerEcoute,
  conversationsEnDirect,
  ecouteInitiale,
  evenementsDirects,
  extraireCommandeEveil,
  type SommaireDirect
} from './jarvis-voice'

const sommaire = (p: Partial<SommaireDirect> & { id: string }): SommaireDirect => ({
  title: p.id,
  updatedAt: 0,
  messageCount: 0,
  ...p
})

describe('écoute continue de Jarvis', () => {
  it('ignore une parole finale tant que le widget n’est pas activé', () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : si `appliquerParole` n'interrogeait pas `active`,
    // le micro du navigateur (qui peut rendre un dernier résultat après l'arrêt) créerait
    // une commande alors que l'utilisateur a coupé l'écoute.
    const apres = appliquerParole(ecouteInitiale, {
      texte: 'ouvre le task manager',
      final: true,
      le: 5
    })
    expect(apres.commandes).toEqual([])
    expect(apres.partiel).toBe('')
  })

  it('retient une parole finale quand l’écoute est active', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const apres = appliquerParole(on, { texte: 'ouvre le task manager', final: true, le: 5 })
    expect(apres.commandes.map((c) => c.texte)).toEqual(['ouvre le task manager'])
    expect(apres.partiel).toBe('')
  })

  it('affiche le partiel sans en faire une commande', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const apres = appliquerParole(on, { texte: 'ouvre le', final: false, le: 4 })
    expect(apres.partiel).toBe('ouvre le')
    expect(apres.commandes).toEqual([])
  })

  it('ne crée aucune commande pour une parole vide', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const apres = appliquerParole(on, { texte: '   ', final: true, le: 4 })
    expect(apres.commandes).toEqual([])
  })

  it('couper l’écoute vide le partiel mais garde l’historique', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const avec = appliquerParole(appliquerParole(on, { texte: 'salut', final: true, le: 2 }), {
      texte: 'et pu',
      final: false,
      le: 3
    })
    const off = basculerEcoute(avec, 4)
    expect(off.active).toBe(false)
    expect(off.partiel).toBe('')
    expect(off.commandes.map((c) => c.texte)).toEqual(['salut'])
    expect(basculerEcoute(off, 5).active).toBe(true)
  })
})

describe('monitoring des conversations en direct', () => {
  it('garde une conversation qui streame même si elle est ancienne', () => {
    const direct = conversationsEnDirect(
      [
        sommaire({ id: 'a', updatedAt: 0, lastAssistantStatus: 'streaming' }),
        sommaire({ id: 'b', updatedAt: 0, lastAssistantStatus: 'completed' })
      ],
      10_000_000
    )
    expect(direct.map((c) => c.id)).toEqual(['a'])
    expect(direct[0].enCours).toBe(true)
  })

  it('garde une conversation terminée récemment, la plus fraîche d’abord', () => {
    const now = 1_000_000
    const direct = conversationsEnDirect(
      [
        sommaire({ id: 'vieux', updatedAt: now - 60 * 60_000, lastAssistantStatus: 'completed' }),
        sommaire({ id: 'frais', updatedAt: now - 1_000, lastAssistantStatus: 'completed' }),
        sommaire({ id: 'moyen', updatedAt: now - 60_000, lastAssistantStatus: 'completed' })
      ],
      now
    )
    expect(direct.map((c) => c.id)).toEqual(['frais', 'moyen'])
    expect(direct[0].enCours).toBe(false)
  })

  it('signale un nouveau message et la fin d’un tour', () => {
    const avant = [
      sommaire({ id: 'a', messageCount: 2, lastAssistantStatus: 'streaming' }),
      sommaire({ id: 'b', messageCount: 1, lastAssistantStatus: 'streaming' })
    ]
    const apres = [
      sommaire({ id: 'a', messageCount: 3, lastAssistantStatus: 'streaming' }),
      sommaire({ id: 'b', messageCount: 1, lastAssistantStatus: 'completed' })
    ]
    const evenements = evenementsDirects(avant, apres, 42)
    expect(evenements.map((e) => [e.conversationId, e.genre])).toEqual([
      ['a', 'message'],
      ['b', 'fin']
    ])
    expect(evenements[0].le).toBe(42)
    expect(evenementsDirects(apres, apres, 43)).toEqual([])
  })
})

describe('mot d’éveil', () => {
  it('n’extrait rien d’une phrase qui ne nomme pas Jarvis', () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : sans exigence du mot d'éveil, une conversation de bureau
    // captée par un micro toujours ouvert partirait en run réel.
    expect(extraireCommandeEveil('ouvre le task manager')).toBeNull()
  })

  it('extrait ce qui suit le mot d’éveil, casse et ponctuation comprises', () => {
    expect(extraireCommandeEveil('Jarvis, ouvre le task manager')).toBe('ouvre le task manager')
    expect(extraireCommandeEveil('jarvis ouvre le task manager')).toBe('ouvre le task manager')
    expect(extraireCommandeEveil('Dis Jarvis : lance la routine')).toBe('lance la routine')
  })

  it('ne retient pas un éveil sans ordre', () => {
    expect(extraireCommandeEveil('jarvis')).toBeNull()
    expect(extraireCommandeEveil('jarvis  ,  ')).toBeNull()
  })
})
