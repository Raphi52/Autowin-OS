// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AskDecisionBlock } from './AskDecision'
import { askReponseDuFil } from './chat-message-keys'
import { optionsRepondues } from './ask-choices'

/**
 * LE DÉFAUT, vécu le 2026-10-11 (conv-240 : « et après avoir répondu ça doit me highlight celui qui
 * a été choisi par un cadre »). Le bloc ne savait QUELLE réponse avait été choisie que par son état
 * LOCAL (`repondu`, posé au clic). Le fil, lui, ne transmettait qu'un booléen (`askDejaRepondu`) :
 * après un changement de conversation ou un redémarrage, le bloc remonté affichait « Répondu » sans
 * aucune réponse en évidence (capture de l'utilisateur, conv-239 : trois lignes grisées).
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER LA CORRECTION SI ELLE EST FAUSSE :
 *  - un bloc monté à froid avec la réponse du fil : la ligne choisie doit porter `data-choisi` ;
 *  - une réponse multiple (puces) : chaque ligne envoyée est cochée et retenue, les autres non ;
 *  - un texte libre tapé dans la saisie : aucune ligne n'est retenue.
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

const simple = {
  question: 'Je fais la pastille modèle en tête ?',
  options: [
    { libelle: 'Oui : liste déroulante en tête', recommande: true },
    { libelle: 'Oui, et rends le modèle propre à chaque conversation' },
    { libelle: 'Non, garde comme c’est' }
  ]
}
const multiple = {
  question: 'Quelles vues je passe au nouveau cadre ?',
  choixMultiple: true,
  options: [
    { libelle: 'Le fil de conversation' },
    { libelle: 'Le panneau de droite' },
    { libelle: 'La barre de saisie' }
  ]
}

const retenues = (): string[] =>
  [...hote.querySelectorAll('.askd-item')]
    .filter((item) => item.querySelector('[data-choisi="oui"]'))
    .map((item) => item.querySelector('.askd-libelle')?.textContent ?? '')

describe('après réponse, le bloc met en évidence la réponse choisie — même remonté à froid', () => {
  it('choix simple : la ligne dont le texte est la réponse du fil est retenue', () => {
    act(() =>
      racine.render(
        <AskDecisionBlock
          decision={simple as never}
          dejaRepondu
          reponseDuFil="Oui, et rends le modèle propre à chaque conversation"
          onPick={() => {}}
        />
      )
    )
    expect(hote.querySelector('.askd')?.classList.contains('est-repondu')).toBe(true)
    expect(retenues()).toEqual(['Oui, et rends le modèle propre à chaque conversation'])
  })

  it('choix multiple : chaque ligne envoyée en puce est cochée et retenue, les autres non', () => {
    act(() =>
      racine.render(
        <AskDecisionBlock
          decision={multiple as never}
          dejaRepondu
          reponseDuFil={'- Le fil de conversation\n- La barre de saisie'}
          onPick={() => {}}
        />
      )
    )
    expect(retenues()).toEqual(['Le fil de conversation', 'La barre de saisie'])
    const cases = [...hote.querySelectorAll<HTMLInputElement>('.askd-coche input')]
    expect(cases.map((c) => c.checked)).toEqual([true, false, true])
  })

  it('un texte libre tapé dans la saisie ne retient aucune ligne', () => {
    act(() =>
      racine.render(
        <AskDecisionBlock
          decision={simple as never}
          dejaRepondu
          reponseDuFil="le 1 mais change le cadre"
          onPick={() => {}}
        />
      )
    )
    expect(retenues()).toEqual([])
  })
})

describe('le fil transmet le TEXTE de la réponse, pas seulement « répondu »', () => {
  const askPart = { kind: 'action', name: 'ask', ok: true, data: multiple }
  it('askReponseDuFil rend le message qui répond, et rien pour une remarque hors sujet', () => {
    const fil = [
      { role: 'assistant', content: '', done: true, parts: [askPart] },
      { role: 'user', content: 'une remarque' },
      { role: 'user', content: '- Le panneau de droite\n- La barre de saisie' }
    ]
    expect(askReponseDuFil(fil as never, 0)).toBe('- Le panneau de droite\n- La barre de saisie')
    expect(askReponseDuFil(fil.slice(0, 2) as never, 0)).toBeUndefined()
  })
  it('optionsRepondues : réponse exacte, puces toutes valides, sinon rien', () => {
    expect([...optionsRepondues(simple.options, 'Non, garde comme c’est')]).toEqual([2])
    expect([...optionsRepondues(multiple.options, '- Le fil de conversation\n- La barre de saisie')]).toEqual([0, 2])
    expect([...optionsRepondues(multiple.options, '- Le fil de conversation\n- autre chose')]).toEqual([])
    expect([...optionsRepondues(simple.options, undefined)]).toEqual([])
  })
})
