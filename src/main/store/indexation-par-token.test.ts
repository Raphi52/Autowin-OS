import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Le gel du chat vient d'un travail O(n^2) sur le THREAD PRINCIPAL : `applyTurnEvent` est appele une
 * fois par TOKEN, avec le contenu ACCUMULE du message (`applyTurnEventToMessages` reconstruit
 * `content = flattenChatParts(parts)`), et `indexerMessage` re-tokenise ce contenu entier a chaque
 * fois. 300 deltas = 300 tokenisations de textes de plus en plus longs.
 *
 * Ce test COMPTE les appels reels a `motsDe`. Il est rouge avant correctif (~300), vert apres (<= 2 :
 * seul l'evenement terminal indexe).
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE CORRECTIF EST FAUX : le mot « hippopotame », present
 * uniquement dans le contenu final. Si le correctif « corrige » en supprimant l'indexation au lieu de
 * la deplacer sur l'evenement terminal, le compteur passe mais la recherche de « hippopotame » ne
 * trouve plus la conversation -- et la seconde assertion echoue.
 */
vi.mock('../../shared/mots', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../shared/mots')>()
  return { ...reel, motsDe: vi.fn(reel.motsDe) }
})

const { motsDe } = await import('../../shared/mots')
const { ConversationStore } = await import('./conversations')

const compteur = motsDe as unknown as ReturnType<typeof vi.fn>

function store(): InstanceType<typeof ConversationStore> {
  const s = new ConversationStore(() => 1000)
  s.hydrate(
    [
      {
        schemaVersion: 3,
        id: 'conv-1',
        title: 'stream',
        category: 'claude',
        provider: 'claude',
        messages: [
          { role: 'user', content: 'question', ts: 1, messageId: 'message-conv-1-1' },
          {
            role: 'assistant',
            content: '',
            ts: 2,
            messageId: 'message-conv-1-2',
            turnId: 'turn-a',
            status: 'streaming',
            parts: []
          }
        ],
        createdAt: 1,
        updatedAt: 2
      }
    ] as never,
    { resumableTurnIds: new Set(['turn-a']) }
  )
  // Construit les index (voisinage + index inverse) AVANT le streaming : sans eux `indexerMessage`
  // ne fait rien et le poste mesure n'existe pas.
  s.search('question')
  return s
}

describe('indexation pendant le streaming — cout par TOKEN', () => {
  beforeEach(() => {
    compteur.mockClear()
  })

  it('ne re-tokenise pas le message entier a chaque delta', () => {
    const s = store()
    compteur.mockClear()
    for (let i = 0; i < 300; i++) {
      s.applyTurnEvent('conv-1', 'turn-a', { kind: 'delta', streamId: 's1', text: `mot${i} ` })
    }
    s.applyTurnEvent('conv-1', 'turn-a', { kind: 'delta', streamId: 's1', text: 'hippopotame' })
    s.applyTurnEvent('conv-1', 'turn-a', { kind: 'done' })
    expect(compteur.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('indexe quand meme le contenu final (le correctif deplace le travail, ne le supprime pas)', () => {
    const s = store()
    for (let i = 0; i < 10; i++) {
      s.applyTurnEvent('conv-1', 'turn-a', { kind: 'delta', streamId: 's1', text: `mot${i} ` })
    }
    s.applyTurnEvent('conv-1', 'turn-a', { kind: 'delta', streamId: 's1', text: 'hippopotame' })
    s.applyTurnEvent('conv-1', 'turn-a', { kind: 'done' })
    const resultats = s.search('hippopotame')
    expect(JSON.stringify(resultats)).toContain('conv-1')
  })
})
