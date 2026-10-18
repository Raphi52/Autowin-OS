// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { promptDuClic, promptsDesBoutons } from './bouton-prompt-html'
import { askReponseDuFil } from './chat-message-keys'
import type { Msg } from './chat-view-types'

/*
 * Bouton « prompter » d'un bloc html-render (conv-302, 2026-10-17 : « faut un bouton pour prompter
 * au lieu du bloc ask »). Ce qui part au clic est le libellé VISIBLE du lien — et le fil doit relire
 * EXACTEMENT ce même libellé dans la source pour savoir, après un redémarrage, qu'il est déjà parti.
 */

function bloc(html: string): HTMLElement {
  const hote = document.createElement('div')
  hote.setAttribute('data-testid', 'chat-inline-html')
  hote.innerHTML = html
  document.body.appendChild(hote)
  return hote
}

describe('promptDuClic', () => {
  it('rend le libellé visible d’un lien #autowin-prompt du bloc, blancs réduits', () => {
    const hote = bloc('<a href="#autowin-prompt">Affiner la <b>3</b>\n · Éditorial</a>')
    expect(promptDuClic(hote.querySelector('b'))).toBe('Affiner la 3 · Éditorial')
    expect(promptDuClic(hote.querySelector('a')?.firstChild ?? null)).toBe(
      'Affiner la 3 · Éditorial'
    )
    hote.remove()
  })

  it('ignore un lien ordinaire, un lien hors bloc html-render et un libellé vide ou trop long', () => {
    const hote = bloc(
      '<a href="#ailleurs">x</a><a id="vide" href="#autowin-prompt"> </a>' +
        `<a id="long" href="#autowin-prompt">${'a'.repeat(301)}</a>`
    )
    expect(promptDuClic(hote.querySelector('a[href="#ailleurs"]'))).toBeNull()
    expect(promptDuClic(hote.querySelector('#vide'))).toBeNull()
    expect(promptDuClic(hote.querySelector('#long'))).toBeNull()
    const dehors = document.createElement('a')
    dehors.setAttribute('href', '#autowin-prompt')
    dehors.textContent = 'Affiner'
    document.body.appendChild(dehors)
    expect(promptDuClic(dehors)).toBeNull()
    dehors.remove()
    hote.remove()
  })
})

describe('promptsDesBoutons : la source relue comme le DOM la montre', () => {
  it('rend le même libellé que le clic (balises retirées, entités décodées)', () => {
    const source =
      'texte\n```html-render\n<a class="b" href="#autowin-prompt">Garder la <b>2</b> &amp; Gel&nbsp;!</a>' +
      '<a href="https://x.fr">lien</a>\n```'
    const hote = bloc(source.split('\n')[2])
    expect(promptsDesBoutons(source)).toEqual([promptDuClic(hote.querySelector('a'))])
    expect(promptsDesBoutons(source)).toEqual(['Garder la 2 & Gel !'])
    expect(promptsDesBoutons('aucun bouton')).toEqual([])
    hote.remove()
  })
})

describe('askReponseDuFil : un bouton déjà envoyé ferme le tour, durablement', () => {
  const tour = {
    role: 'assistant',
    done: true,
    parts: [
      {
        kind: 'text',
        text: '```html-render\n<a href="#autowin-prompt">Affiner la 3 · Éditorial</a>\n```'
      }
    ]
  } as unknown as Msg
  const utilisateur = (content: string): Msg => ({ role: 'user', content }) as unknown as Msg

  it('reconnaît le libellé envoyé par le bouton', () => {
    expect(askReponseDuFil([tour, utilisateur('Affiner la 3 · Éditorial')], 0)).toBe(
      'Affiner la 3 · Éditorial'
    )
  })

  it('reste ouvert après un message qui n’est pas un de ses boutons', () => {
    expect(askReponseDuFil([tour, utilisateur('hmm, et le thème clair ?')], 0)).toBeUndefined()
  })
})
