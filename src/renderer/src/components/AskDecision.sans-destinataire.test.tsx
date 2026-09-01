// @vitest-environment happy-dom
/**
 * UN BLOC SANS DESTINATAIRE NE PEUT PAS SE DECLARER « RÉPONDU » (conv-50, 2026-09-01).
 *
 * Meme symptome que le defaut vecu — « j'ai répondu a la question et ca a rien fait » — mais par un
 * AUTRE chemin : `ChatMosaic.tsx` rend `ChatMessageRow` sans `onAnswerAsk`, donc le bloc recevait
 * `onPick === undefined`. Le clic armait quand meme le verrou et le pied passait a « Répondu »,
 * alors qu'aucun message ne pouvait partir. Le verrou protege du SECOND envoi, jamais du premier.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskDecisionBlock } from './AskDecision'

let hote: HTMLDivElement
let racine: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

const decision = {
  question: 'Une image collée pendant qu’un tour tourne : elle doit faire quoi ?',
  options: [
    { libelle: 'L’agent la voit tout de suite', recommande: true },
    { libelle: 'Elle attend le prochain message' }
  ]
} as never

const choix = (): HTMLButtonElement[] =>
  [...hote.querySelectorAll<HTMLButtonElement>('button.askd-choix')]

describe('bloc ask sans destinataire branché', () => {
  it('ne se verrouille PAS au clic — rien n’a pu partir', () => {
    act(() => racine.render(<AskDecisionBlock decision={decision} />))

    act(() => choix()[0].click())

    // Toujours cliquable : le bloc n'a pas le droit de se fermer sur un envoi qui n'existe pas.
    expect(choix()).toHaveLength(2)
    expect(choix()[0].disabled).toBe(false)
    expect(hote.querySelector('[data-testid="ask-decision-close"]')).toBeNull()
  })

  it('reste opérant dès qu’un destinataire est branché', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={decision} onPick={onPick} />))
    act(() => choix()[1].click())
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('Elle attend le prochain message')
  })
})
