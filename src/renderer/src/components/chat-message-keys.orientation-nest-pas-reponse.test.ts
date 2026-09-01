/**
 * UNE ORIENTATION N'EST PAS UNE REPONSE (conv-50, 2026-09-01).
 *
 * Vecu : l'utilisateur clique une reponse du bloc `ask`, le bloc affiche « Répondu — écrivez la
 * suite dans le composer », et RIEN ne part. Preuve hors-modele : `saisies-utilisateur.jsonl`, qui
 * est ecrit AVANT tout envoi, ne porte aucune ligne du texte de l'option -- le clic n'a jamais
 * atteint le chemin d'envoi.
 *
 * Cause : le verrou durable du bloc est « un message utilisateur existe-t-il APRES ce tour ? ». Or
 * depuis le correctif de conv-38 (meme jour), le texte tape PENDANT un tour est ecrit dans le fil
 * comme un message utilisateur ordinaire. Toute orientation fermait donc les questions du tour, en
 * pretendant qu'elles etaient repondues.
 *
 * Le verrou existe pour empecher un SECOND envoi, jamais le PREMIER.
 */
import { describe, expect, it } from 'vitest'
import { askEnAttente } from './chat-message-keys'
import type { Msg } from './chat-view-types'

const assistantAvecAsk = (): Msg =>
  ({
    role: 'assistant',
    content: 'question posee',
    parts: [
      {
        kind: 'action',
        name: 'ask',
        ok: true,
        data: { question: 'Elle doit faire quoi ?', options: ['A', 'B'] }
      }
    ]
  }) as unknown as Msg

const utilisateur = (content: string): Msg => ({ role: 'user', content }) as Msg

const orientation = (content: string): Msg =>
  ({ role: 'user', content, orientation: true }) as unknown as Msg

describe('askEnAttente — la question reste en attente apres une orientation', () => {
  it('reste vrai quand la seule suite est une orientation', () => {
    expect(askEnAttente([assistantAvecAsk(), orientation('precision en vol')])).toBe(true)
  })

  it('devient faux des qu’un message utilisateur ordinaire repond', () => {
    expect(askEnAttente([assistantAvecAsk(), utilisateur('A')])).toBe(false)
  })
})
