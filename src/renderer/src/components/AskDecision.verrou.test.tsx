// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskDecisionBlock } from './AskDecision'

/**
 * LE DÉFAUT, vécu le 2026-08-25 dans la conversation `conv-1400`.
 *
 * Rien ne marquait un bloc `ask` comme répondu. L'utilisateur a cliqué QUATRE fois sur la même
 * option — « Rejouer la vérif ciblée sur oracle-suite-complete uniquement » — et quatre envois sont
 * partis. Le bloc restait aussi cliquable qu'avant, donc rien ne lui disait que sa réponse avait
 * atterri : le défaut fabriquait lui-même sa propre répétition.
 *
 * Une question ne se répond qu'une fois.
 */

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
  question: 'Comment on clôture avant la task suivante ?',
  options: [
    { libelle: 'Rejouer la vérif ciblée', recommande: true },
    { libelle: 'Commiter en l’état' }
  ]
} as never

const rendre = (onPick: (prompt: string) => void): void => {
  act(() => racine.render(<AskDecisionBlock decision={decision} onPick={onPick} />))
}

/** Les boutons de choix, dans l'ordre d'affichage. */
const choix = (): HTMLButtonElement[] =>
  [...hote.querySelectorAll<HTMLButtonElement>('button.askd-choix')]

describe('un bloc ask déjà répondu', () => {
  it('n’envoie QU’UNE fois, même après quatre clics', () => {
    const onPick = vi.fn()
    rendre(onPick)

    // Le geste exact de l'utilisateur : il reclique parce que rien ne lui dit que c'est parti.
    for (let i = 0; i < 4; i += 1) act(() => choix()[0].click())

    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('désactive TOUTES les options, pas seulement celle choisie', () => {
    const onPick = vi.fn()
    rendre(onPick)

    act(() => choix()[0].click())
    // Sans ça, on pourrait répondre DEUX choses différentes à la même question.
    act(() => choix()[1].click())

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toContain('Rejouer la vérif ciblée')
    expect(choix()[1].disabled).toBe(true)
  })

  it('marque VISIBLEMENT l’option retenue — sinon le verrou est muet', () => {
    rendre(vi.fn())

    act(() => choix()[0].click())

    expect(choix()[0].getAttribute('data-choisi')).toBe('oui')
  })

  it('reste cliquable AVANT toute réponse — le verrou ne doit pas arriver trop tôt', () => {
    // L'entrée qui doit faire échouer un verrou posé dès le rendu.
    rendre(vi.fn())

    expect(choix()[0].disabled).toBe(false)
  })
})
