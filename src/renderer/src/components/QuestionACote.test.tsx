// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueQuestionACote } from '../../../shared/question-a-cote'
import { oublierQuestionsACote, useRaccourciQuestionACote } from './question-a-cote-outils'
import { BoutonQuestionACote, QuestionACote } from './QuestionACote'

/**
 * LE PANNEAU DE LA QUESTION À CÔTÉ (conv-1362, lot 1/3). Le pont est simulé : le moteur a ses tests.
 *
 * Entrées qui doivent faire échouer ce fichier : Échap qui ne ferme pas, une fermeture qui laisse la
 * question tourner (ou qui annule alors que rien ne tourne), un motif sans message, plus de 5 questions
 * précédentes, les questions d'un fil montrées dans un autre, une question annulée gardée en mémoire,
 * un raccourci qui se déclenche sans Ctrl.
 */

const poser = vi.fn<(id: string, q: string) => Promise<IssueQuestionACote>>()
const annuler = vi.fn<(id: string) => Promise<void>>()

let racine: Root
let hote: HTMLElement
const fermer = vi.fn()

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  oublierQuestionsACote()
  poser.mockReset()
  annuler.mockReset()
  annuler.mockResolvedValue(undefined)
  fermer.mockReset()
  ;(window as unknown as { api: unknown }).api = { questionACote: { poser, annuler } }
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
})

afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

const monter = (conversationId = 'conv-1'): void => {
  act(() => {
    racine.render(
      createElement(QuestionACote, { key: conversationId, conversationId, onFermer: fermer })
    )
  })
}

const champ = (): HTMLInputElement =>
  hote.querySelector('[data-testid="question-a-cote-champ"]') as HTMLInputElement

function taper(valeur: string): void {
  const poseur = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    poseur?.call(champ(), valeur)
    champ().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function demander(question: string, issue?: IssueQuestionACote): Promise<void> {
  poser.mockResolvedValueOnce(
    issue ?? { ok: true, reponse: `Réponse à ${question}`, outilRefuse: false }
  )
  taper(question)
  await act(async () => {
    hote
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

const echap = (): void => {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

const precedentes = (): string[] =>
  [...hote.querySelectorAll('.question-a-cote-precedentes button')].map((b) => b.textContent ?? '')

describe('le panneau', () => {
  it('met le curseur dans le champ à l’ouverture', () => {
    monter()
    expect(document.activeElement).toBe(champ())
  })

  it('pose la question sur le bon fil, montre l’attente, puis la réponse, et vide le champ', async () => {
    monter()
    let rendre: (issue: IssueQuestionACote) => void = () => undefined
    poser.mockReturnValueOnce(new Promise((resoudre) => (rendre = resoudre)))
    taper('  Quel fichier ?  ')
    await act(async () => {
      hote
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(poser).toHaveBeenCalledWith('conv-1', 'Quel fichier ?')
    expect(hote.textContent).toContain('Réponse en cours…')
    expect(champ().value).toBe('')

    await act(async () => rendre({ ok: true, reponse: 'Celui-là.', outilRefuse: false }))
    expect(hote.textContent).toContain('Quel fichier ?')
    expect(hote.textContent).toContain('Celui-là.')
    expect(hote.textContent).not.toContain('Réponse en cours…')
  })

  it('n’envoie pas une question vide', async () => {
    monter()
    await demander('   ')
    expect(poser).not.toHaveBeenCalled()
  })

  it('n’envoie pas une seconde question tant que la première n’a pas répondu', async () => {
    monter()
    poser.mockReturnValue(new Promise(() => undefined))
    taper('une')
    await act(async () => {
      hote
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    taper('deux')
    await act(async () => {
      hote
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(poser).toHaveBeenCalledTimes(1)
  })

  it('Échap ferme, et sans question en cours n’annule rien', () => {
    monter()
    echap()
    expect(fermer).toHaveBeenCalledTimes(1)
    act(() => racine.render(null))
    expect(annuler).not.toHaveBeenCalled()
  })

  it('fermer pendant une question l’annule, sur ce fil seulement', async () => {
    monter()
    poser.mockReturnValue(new Promise(() => undefined))
    taper('une')
    await act(async () => {
      hote
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    act(() => racine.render(null))
    expect(annuler).toHaveBeenCalledTimes(1)
    expect(annuler).toHaveBeenCalledWith('conv-1')
  })

  it('une question annulée n’est ni montrée ni gardée', async () => {
    monter()
    await demander('annulée', { ok: false, motif: 'annulee' })
    await demander('suivante')
    expect(precedentes()).toEqual([])
    expect(hote.textContent).toContain('Réponse à suivante')
  })

  it.each([
    ['sans-session', 'pas encore de session'],
    ['autre-modele', 'autre modèle IA'],
    ['compte-absent', 'a été retiré'],
    ['session-introuvable', 'introuvable'],
    ['outil-requis', 'demande un outil'],
    ['delai', 'deux minutes']
  ] as const)('dit clairement le motif %s', async (motif, attendu) => {
    monter()
    await demander('q', { ok: false, motif })
    expect(hote.querySelector('[role="alert"]')?.textContent).toContain(attendu)
  })

  it('un échec du CLI dit sa cause, et un pont qui lève aussi', async () => {
    monter()
    await demander('q', { ok: false, motif: 'echec', detail: 'code 1' })
    expect(hote.querySelector('[role="alert"]')?.textContent).toContain('code 1')
    poser.mockRejectedValueOnce(new Error('pont coupé'))
    taper('r')
    await act(async () => {
      hote
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(hote.querySelector('[role="alert"]')?.textContent).toContain('pont coupé')
  })

  it('signale un outil demandé puis refusé', async () => {
    monter()
    await demander('q', { ok: true, reponse: 'Sans outil.', outilRefuse: true })
    expect(hote.textContent).toContain('rien n’a été lancé')
  })

  it('n’affiche jamais plus que les 5 questions précédentes, de la plus récente à la plus ancienne', async () => {
    monter()
    for (const question of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']) await demander(question)
    expect(precedentes()).toEqual(['q6', 'q5', 'q4', 'q3', 'q2'])
    expect(hote.textContent).toContain('Réponse à q7')
  })

  it('revoit une réponse précédente au clic, et la dernière reste dans la liste', async () => {
    monter()
    await demander('q1')
    await demander('q2')
    await act(async () => {
      hote.querySelector<HTMLButtonElement>('.question-a-cote-precedentes button')?.click()
    })
    expect(hote.textContent).toContain('Réponse à q1')
    expect(precedentes()).toEqual(['q2'])
  })

  it('garde les questions de chaque fil à part, panneau refermé ou non', async () => {
    monter('conv-1')
    await demander('sur le fil 1')
    await demander('encore le fil 1')
    monter('conv-2')
    expect(hote.textContent).not.toContain('sur le fil 1')
    await demander('sur le fil 2')
    monter('conv-1')
    expect(precedentes()).toEqual(['sur le fil 1'])
    expect(hote.textContent).toContain('encore le fil 1')
    expect(hote.textContent).not.toContain('sur le fil 2')
  })
})

describe('l’ouverture', () => {
  function Banc({ actif = true }: { actif?: boolean }): React.JSX.Element {
    const [ouvert, setOuvert] = useState(false)
    useRaccourciQuestionACote(actif, () => setOuvert((o) => !o))
    return createElement(BoutonQuestionACote, {
      ouvert,
      onBasculer: () => setOuvert((o) => !o)
    })
  }
  const bouton = (): HTMLButtonElement =>
    hote.querySelector('[data-testid="composer-question-a-cote"]') as HTMLButtonElement
  const touche = (init: KeyboardEventInit): void => {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
    })
  }

  it('Ctrl+; bascule, et le bouton dit son état', () => {
    act(() => racine.render(createElement(Banc)))
    expect(bouton().getAttribute('aria-pressed')).toBe('false')
    touche({ key: ';', ctrlKey: true })
    expect(bouton().getAttribute('aria-pressed')).toBe('true')
    touche({ key: ';', ctrlKey: true })
    expect(bouton().getAttribute('aria-pressed')).toBe('false')
  })

  it('ne réagit ni à ; seul, ni à Ctrl+Alt+;, ni à une autre touche, ni hors du chat', () => {
    act(() => racine.render(createElement(Banc)))
    touche({ key: ';' })
    touche({ key: ';', ctrlKey: true, altKey: true })
    touche({ key: ',', ctrlKey: true })
    expect(bouton().getAttribute('aria-pressed')).toBe('false')
    act(() => racine.render(createElement(Banc, { actif: false })))
    touche({ key: ';', ctrlKey: true })
    expect(bouton().getAttribute('aria-pressed')).toBe('false')
  })

  it('le bouton bascule', () => {
    act(() => racine.render(createElement(Banc)))
    act(() => bouton().click())
    expect(bouton().getAttribute('aria-pressed')).toBe('true')
    expect(bouton().classList.contains('actif')).toBe(true)
  })
})
