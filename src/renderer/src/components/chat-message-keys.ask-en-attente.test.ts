/**
 * `askEnAttente` — RÉPARATION DE BASELINE testée, pas seulement compilée.
 *
 * `ChatView.tsx` importait cet helper alors qu'il n'existait pas (typecheck rouge sur HEAD, `npm test`
 * arrêté avant tout test). Il décide si un texte tapé à la main RÉPOND à une question `ask` ouverte.
 *
 * Entrées qui doivent faire échouer ce test si l'implémentation est fausse : (a) une action `ask`
 * résolue en fin de fil → true ; (b) la même suivie d'un message UTILISATEUR → false (la question a
 * été tranchée) ; (c) un fil sans `ask` → false ; (d) un `ask` en ÉCHEC (ok=false) → false, il ne
 * produit aucun bloc de décision.
 */
import { describe, expect, it } from 'vitest'
import { askEnAttente } from './chat-message-keys'
import type { Msg } from './chat-view-types'

const askPart = (ok: boolean): Record<string, unknown> => ({
  kind: 'action',
  actionId: 'a1',
  name: 'ask',
  ok,
  data: {
    question: 'On garde A ou B ?',
    options: [{ libelle: 'A' }, { libelle: 'B' }]
  }
})

const assistant = (parts: Record<string, unknown>[]): Msg =>
  ({ role: 'assistant', content: '', parts, done: true }) as unknown as Msg
const user = (): Msg => ({ role: 'user', content: 'B' }) as unknown as Msg

describe('askEnAttente', () => {
  it('question ask ouverte en fin de fil → en attente', () => {
    expect(askEnAttente([assistant([askPart(true)])])).toBe(true)
  })

  it('un message utilisateur postérieur la tranche', () => {
    expect(askEnAttente([assistant([askPart(true)]), user()])).toBe(false)
  })

  it('fil sans ask → rien en attente', () => {
    expect(askEnAttente([assistant([{ kind: 'text', text: 'bonjour' }])])).toBe(false)
    expect(askEnAttente([])).toBe(false)
  })

  it('un ask en ÉCHEC ne produit pas de décision à répondre', () => {
    expect(askEnAttente([assistant([askPart(false)])])).toBe(false)
  })
})
