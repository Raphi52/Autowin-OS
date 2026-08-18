// @vitest-environment happy-dom
/**
 * QUE VOIT-ON AU DÉMARRAGE ?
 *
 * Demande utilisateur du 2026-08-18 : « ça doit ouvrir la plus récente ». Elle est arrivée après le
 * constat que l'app rouvrait indéfiniment la conversation du 17/08 « Arrêt inattendu du processus
 * Autowin OS » — un vestige : deux tours interrompus par un processus tué (le défaut
 * `electron-vite --watch`), que `unfinishedTurns()` plaçait en tête et que la reprise, PRIORITAIRE
 * sur la mémoire de la dernière conversation ouverte, rouvrait à chaque boot.
 *
 * Trois garanties tenues ici, dans l'ordre de priorité du boot :
 *   1. un tour inachevé FRAIS est bien repris (la survie de niveau 2 n'est pas cassée) ;
 *   2. un tour PÉRIMÉ ne vole plus le démarrage ;
 *   3. sans rien à reprendre ET sans mémoire, on ouvre LA PLUS RÉCENTE — pas un panneau vide.
 *
 * Fichier SÉPARÉ : `ChatView.load-conversation.test.tsx` est édité en parallèle par une autre
 * session, et un fichier partagé s'est déjà fait écraser aujourd'hui.
 */
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { CLE_DERNIERE_CONVERSATION } from './derniere-conversation'
import { RESUME_STALE_AFTER_MS } from '../../../shared/resume-staleness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const MAINTENANT = Date.now()
const HEURE = 60 * 60 * 1000

/** Conversation minimale : `lastUserMessageAt` porte la RÉCENCE UTILISATEUR, distincte d'`updatedAt`. */
const conv = (
  id: string,
  titre: string,
  lastUserMessageAt: number,
  updatedAt = lastUserMessageAt
): Record<string, unknown> => ({
  id,
  title: titre,
  category: 'codex',
  provider: 'codex',
  updatedAt,
  lastUserMessageAt
})

/**
 * Le jeu commun. `vestige` est la plus récemment TOUCHÉE (comme conv-1267, remontée par des
 * écritures non-utilisateur) mais l'utilisateur n'y a pas parlé depuis deux jours.
 */
const CONVS = [
  conv('vestige', 'Arret inattendu du processus', MAINTENANT - 48 * HEURE, MAINTENANT - HEURE),
  conv('travail', 'Mon travail du jour', MAINTENANT - 2 * HEURE),
  conv('vieille', 'Une vieille discussion', MAINTENANT - 200 * HEURE)
]

describe('ChatView — ce qui s’ouvre au démarrage', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('sans mémoire ni tour à reprendre : ouvre LA PLUS RÉCENTE au sens utilisateur', async () => {
    const conversation = vi.fn(async (id: string) => ({
      ...CONVS.find((c) => c.id === id),
      messages: [{ role: 'user', content: `contenu de ${id}`, ts: 1 }]
    }))
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(CONVS),
      conversation,
      unfinishedTurns: vi.fn().mockResolvedValue([]),
      appState: vi.fn().mockResolvedValue({})
    })
    h = await mountChat(api)

    // « travail » (2 h) gagne : `vestige` a un `updatedAt` plus frais, mais l'utilisateur n'y a pas
    // parlé depuis 48 h. Sans le correctif, ce cas n'ouvrait RIEN du tout.
    expect(conversation).toHaveBeenCalledWith('travail')
    expect(conversation).not.toHaveBeenCalledWith('vestige')
  })

  it('un tour inachevé PÉRIMÉ ne vole plus le démarrage', async () => {
    const conversation = vi.fn(async (id: string) => ({
      ...CONVS.find((c) => c.id === id),
      messages: [{ role: 'user', content: `contenu de ${id}`, ts: 1 }]
    }))
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(CONVS),
      conversation,
      // Le vestige exact du 2026-08-18 : un tour interrompu, 1 événement, plus vieux que la fenêtre.
      unfinishedTurns: vi.fn().mockResolvedValue([
        {
          conversationId: 'vestige',
          turnId: 't-vestige',
          events: 1,
          updatedAt: MAINTENANT - (RESUME_STALE_AFTER_MS + HEURE)
        }
      ]),
      appState: vi.fn().mockResolvedValue({})
    })
    h = await mountChat(api)

    expect(conversation).not.toHaveBeenCalledWith('vestige')
    expect(conversation).toHaveBeenCalledWith('travail')
  })

  it('un tour inachevé FRAIS est TOUJOURS repris — la survie de niveau 2 reste intacte', async () => {
    const conversation = vi.fn(async (id: string) => ({
      ...CONVS.find((c) => c.id === id),
      messages: [{ role: 'user', content: `contenu de ${id}`, ts: 1 }]
    }))
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(CONVS),
      conversation,
      unfinishedTurns: vi.fn().mockResolvedValue([
        {
          conversationId: 'vieille',
          turnId: 't-vieille',
          events: 2,
          updatedAt: MAINTENANT - HEURE
        }
      ]),
      appState: vi.fn().mockResolvedValue({})
    })
    h = await mountChat(api)

    // Entrée discriminante : « vieille » n'est ni la plus récente ni mémorisée — seule la reprise
    // peut l'ouvrir. Si elle ne l'était pas, le correctif aurait cassé la reprise.
    expect(conversation).toHaveBeenCalledWith('vieille')
  })

  it('la MÉMOIRE reste prioritaire sur la plus récente — la demande du matin tient', async () => {
    localStorage.setItem(CLE_DERNIERE_CONVERSATION, 'vieille')
    const conversation = vi.fn(async (id: string) => ({
      ...CONVS.find((c) => c.id === id),
      messages: [{ role: 'user', content: `contenu de ${id}`, ts: 1 }]
    }))
    const api = chatApi({
      conversations: vi.fn().mockResolvedValue(CONVS),
      conversation,
      unfinishedTurns: vi.fn().mockResolvedValue([]),
      appState: vi.fn().mockResolvedValue({})
    })
    h = await mountChat(api)

    // « où j'étais » l'emporte : le fallback ne s'applique QU'EN son absence.
    expect(conversation).toHaveBeenCalledWith('vieille')
    expect(conversation).not.toHaveBeenCalledWith('travail')
  })
})
