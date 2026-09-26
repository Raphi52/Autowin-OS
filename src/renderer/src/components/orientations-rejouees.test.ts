import { describe, expect, it } from 'vitest'
import { rejouerOrientations } from './orientations-rejouees'
import type { Msg } from './chat-view-types'

const assistant = (turnId: string): Msg => ({
  role: 'assistant',
  turnId,
  parts: [{ kind: 'text', text: 'réponse' }],
  status: 'completed',
  done: true
})
const utilisateur = (content: string): Msg => ({ role: 'user', content })

describe('consignes données pendant un tour, rejouées à l’ouverture du fil', () => {
  const messages: Msg[] = [
    utilisateur('fais X'),
    assistant('turn-1'),
    utilisateur('puis Y'),
    assistant('turn-2')
  ]

  it('ancre chaque consigne sur le message du tour qu’elle a infléchi', () => {
    const recus = rejouerOrientations(
      [
        { ts: 10, texte: 'non, garde le bouton', turnId: 'turn-1' },
        { ts: 20, texte: 'plutôt en bleu', turnId: 'turn-2' }
      ],
      messages
    )
    expect(recus.map((recu) => [recu.text, recu.afterMessageIndex, recu.status])).toEqual([
      ['non, garde le bouton', 1, 'sent'],
      ['plutôt en bleu', 3, 'sent']
    ])
  })

  it('écarte une consigne sans rattachement ou dont le tour n’est plus affiché', () => {
    expect(rejouerOrientations([{ ts: 1, texte: 'attends' }], messages)).toEqual([])
    expect(
      rejouerOrientations([{ ts: 2, texte: 'attends', turnId: 'turn-inconnu' }], messages)
    ).toEqual([])
  })

  it('écarte un texte vide plutôt que d’afficher un reçu muet', () => {
    expect(rejouerOrientations([{ ts: 3, texte: '   ', turnId: 'turn-1' }], messages)).toEqual([])
  })
})
