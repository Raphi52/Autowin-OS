// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskDecisionBlock } from './AskDecision'

/**
 * LE DÉFAUT, vécu le 2026-08-26 (capture de l'utilisateur : deux réponses identiques envoyées
 * depuis le même bloc `ask`).
 *
 * Le verrou du 25/08 existait, mais il fuyait par deux endroits, et le spam-clic passait par les
 * deux : (1) `useState` est ASYNCHRONE — deux clics dans le MÊME lot lisaient tous les deux
 * « pas encore répondu » ; (2) le bloc était monté sous une clé d'INDEX, donc tout regroupement du
 * flux le remontait et l'état local repartait à zéro, rouvrant un bloc déjà répondu.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER LA CORRECTION SI ELLE EST FAUSSE :
 *  - deux clics SANS rendu intermédiaire (le verrou d'état seul les laisse passer tous les deux) ;
 *  - un remontage après réponse (le verrou d'état seul disparaît avec le composant).
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
  question: 'J’ajoute la pastille ambre « attend ta réponse » ?',
  options: [
    { libelle: 'Oui — 8e état needs-human', recommande: true },
    { libelle: 'Oui, et inclure aussi les runs bloqués dans cet état' },
    { libelle: 'Non, juste l’analyse pour l’instant' }
  ]
} as never

const choix = (): HTMLButtonElement[] =>
  [...hote.querySelectorAll<HTMLButtonElement>('button.askd-choix')]

describe('le verrou du bloc ask tient le spam-clic ET le remontage', () => {
  it('deux clics dans le MÊME lot n’envoient qu’une réponse', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={decision} onPick={onPick} />))

    // Le geste réel : deux clics coup sur coup, React n'a pas re-rendu entre les deux.
    act(() => {
      choix()[1].click()
      choix()[1].click()
    })

    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('un bloc dont le fil porte déjà la réponse est CLOS dès son montage', () => {
    const onPick = vi.fn()
    // Remontage après réponse : le fil sait, le composant ne sait plus rien.
    act(() =>
      racine.render(<AskDecisionBlock decision={decision} dejaRepondu onPick={onPick} />)
    )

    act(() => choix()[0].click())

    expect(onPick).not.toHaveBeenCalled()
    expect(choix().every((bouton) => bouton.disabled)).toBe(true)
    expect(hote.querySelector('[data-testid="ask-decision"]')?.getAttribute('data-repondu')).toBe(
      'oui'
    )
  })

  it('reste ouvert tant que le fil n’a pas répondu — le verrou ne doit pas arriver trop tôt', () => {
    act(() =>
      racine.render(<AskDecisionBlock decision={decision} dejaRepondu={false} onPick={vi.fn()} />)
    )

    expect(choix()[0].disabled).toBe(false)
  })
})

/**
 * LES CHIFFRES AFFICHES DOIVENT REPONDRE.
 *
 * Le bloc peignait `1`, `2`, `3` a droite de chaque ligne sans aucun gestionnaire derriere :
 * une etiquette qui ment. L'utilisateur tape `2`, rien ne se passe.
 */
describe('les touches 1..N du bloc ask', () => {
  const taper = (key: string, cible: EventTarget = document.body): void => {
    act(() => {
      cible.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
  }

  it('répondent à la question — le chiffre affiché n’est pas décoratif', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={decision} onPick={onPick} />))

    taper('2')

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toContain('runs bloqués')
  })

  it('ne mordent pas dans un champ de saisie — le composer garde ses chiffres', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={decision} onPick={onPick} />))
    const champ = document.createElement('textarea')
    document.body.appendChild(champ)

    taper('2', champ)

    expect(onPick).not.toHaveBeenCalled()
    champ.remove()
  })

  it('se taisent une fois la question répondue', () => {
    const onPick = vi.fn()
    act(() => racine.render(<AskDecisionBlock decision={decision} dejaRepondu onPick={onPick} />))

    taper('1')

    expect(onPick).not.toHaveBeenCalled()
  })
})
