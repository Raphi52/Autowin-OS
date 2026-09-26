// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskDecisionBlock } from './AskDecision'

/**
 * LE DÉFAUT, rapporté le 2026-09-11 : « les choix sont grisés alors que j'ai pas répondu ».
 *
 * Le plafond de réponses est passé de 4 à 10 la veille (commit 87346be0) sans que le raccourci
 * clavier suive : il tranchait sur le PREMIER chiffre. Taper `10` envoyait donc la ligne 1, le bloc
 * se verrouillait sur une réponse que personne n'avait choisie, et la dixième ligne était
 * injoignable au clavier.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER LA CORRECTION SI ELLE EST FAUSSE :
 *  - `1` puis `0` sur une question à dix lignes → la DIXIÈME, jamais la première ;
 *  - `1` seul sur une question à dix lignes → la première, mais seulement après la fenêtre ;
 *  - `2` sur une question à trois lignes → réponse IMMÉDIATE, aucune latence ajoutée.
 */

let hote: HTMLDivElement
let racine: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
  vi.useRealTimers()
})

const dixLignes = {
  question: 'Quelle piste ?',
  options: Array.from({ length: 10 }, (_, i) => ({ libelle: `piste ${i + 1}` }))
} as never

const troisLignes = {
  question: 'Quelle portée ?',
  options: [{ libelle: 'A' }, { libelle: 'B' }, { libelle: 'C' }]
} as never

/** Le raccourci n'ecoute que le bloc qui a le focus : on le lui donne comme un vrai clic. */
const focaliserLeBloc = (): void => {
  hote.querySelector<HTMLButtonElement>('button.askd-choix')?.focus()
}
const taper = (key: string): void => {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}
const attendreLaFenetre = (): void => {
  act(() => {
    vi.advanceTimersByTime(700)
  })
}

describe('le raccourci clavier suit le plafond de dix réponses', () => {
  it('« 1 » puis « 0 » répond la DIXIÈME ligne, pas la première', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={dixLignes} onPick={onPick} />))

    focaliserLeBloc()
    taper('1')
    // Le geste réel : les deux chiffres se suivent, rien ne doit partir entre les deux.
    expect(onPick).not.toHaveBeenCalled()
    taper('0')
    attendreLaFenetre()

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toBe('piste 10')
  })

  it('« 1 » seul répond bien la première ligne, après la fenêtre d’attente', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={dixLignes} onPick={onPick} />))

    focaliserLeBloc()
    taper('1')
    attendreLaFenetre()

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toBe('piste 1')
  })

  it('n’ajoute AUCUNE latence quand aucun préfixe n’est ambigu', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={troisLignes} onPick={onPick} />))

    focaliserLeBloc()
    taper('2')

    // Sans avancer l'horloge : la réponse doit être déjà partie.
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toBe('B')
  })

  it('un chiffre qui ne mène à aucune ligne ne verrouille rien', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={troisLignes} onPick={onPick} />))

    focaliserLeBloc()
    taper('7')
    attendreLaFenetre()

    expect(onPick).not.toHaveBeenCalled()
    expect(
      hote.querySelector('[data-testid="ask-decision"]')?.getAttribute('data-repondu')
    ).toBeNull()
  })
})
