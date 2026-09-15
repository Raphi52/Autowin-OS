// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { prepareChatHtml } from './chat-html-inline'

/**
 * RENDU REEL des onglets et accordeons sans script. Les tests voisins ne lisent que le TEXTE
 * produit par l'assainissement ; celui-ci monte le HTML prepare dans un DOM, clique sur les
 * libelles comme l'utilisateur, et lit le style CALCULE du panneau.
 */
describe('chat-html-inline — onglets et accordeons cliquables', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function monter(source: string): HTMLElement {
    const { html, scopeId } = prepareChatHtml(source)
    const hote = document.createElement('div')
    hote.setAttribute('data-html-scope', scopeId)
    hote.innerHTML = html
    document.body.appendChild(hote)
    return hote
  }

  it('cliquer sur un libelle d onglet change le panneau affiche', () => {
    const hote = monter(
      '<style>.p{display:none} #o1:checked ~ .p1{display:block} #o2:checked ~ .p2{display:block}</style>' +
        '<input type="radio" name="g" id="o1" checked><label for="o1">Un</label>' +
        '<input type="radio" name="g" id="o2"><label for="o2">Deux</label>' +
        '<div class="p p1">panneau un</div><div class="p p2">panneau deux</div>'
    )
    const affiche = (classe: string): string =>
      getComputedStyle(hote.querySelector(`.${classe}`) as HTMLElement).display
    expect(affiche('p1')).toBe('block')
    expect(affiche('p2')).toBe('none')

    const libelle = [...hote.querySelectorAll('label')].find((l) => l.textContent === 'Deux')
    libelle!.click()

    expect(affiche('p1')).toBe('none')
    expect(affiche('p2')).toBe('block')
  })

  it('un accordeon details/summary s ouvre au clic', () => {
    const hote = monter('<details><summary>Voir</summary><p>contenu</p></details>')
    const details = hote.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    ;(hote.querySelector('summary') as HTMLElement).click()
    expect(details.open).toBe(true)
  })
})
