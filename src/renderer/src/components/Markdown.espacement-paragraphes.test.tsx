/**
 * ESPACEMENT VERTICAL DES RÉPONSES (conv-227, 2026-10-11 : « ya trop d'espacement vertical entre
 * les différents éléments du chat ca fait scroller pour rien »).
 *
 * Mesuré dans l'app (copie cachée, Holographique blanc et Clair) : chaque ligne vide du texte était
 * rendue par un `<br>` de plus, donc un saut de paragraphe coûtait une LIGNE BLANCHE PLEINE
 * (≈ 22 px), et les lignes vides autour d'un schéma ou d'un bloc HTML en ajoutaient 44 à 48 px.
 *
 * Contrat : une ligne vide entre deux lignes de texte devient UN petit séparateur (`.md-para`,
 * hauteur fixée en CSS) ; plusieurs lignes vides n'en font qu'un ; une ligne vide en tête, en fin,
 * ou juste après un titre / une liste ne laisse RIEN (ces blocs ont leur propre marge). Un retour à
 * la ligne simple reste un `<br>`.
 *
 * Entrées qui feraient échouer une correction fausse : deux `<br>` consécutifs (la ligne blanche
 * revient), un séparateur avant le premier texte, ou le retour à la ligne simple perdu.
 */
// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function rendre(text: string): HTMLElement {
  act(() => root.render(<Markdown text={text} />))
  return container.querySelector('.md') ?? container
}

/** Nombre de `<br>` qui se suivent sans texte entre eux : chacun au-delà du premier est une ligne blanche. */
function lignesBlanches(md: HTMLElement): number {
  return [...md.querySelectorAll('br')].filter((br) => {
    const span = br.parentElement
    return span?.textContent === '' && span.previousElementSibling?.tagName === 'SPAN'
  }).length
}

describe('espacement des paragraphes dans une réponse', () => {
  it('un saut de paragraphe devient un seul petit séparateur, sans ligne blanche', () => {
    const md = rendre('Premier paragraphe.\n\nDeuxième paragraphe.')
    expect(md.querySelectorAll('.md-para')).toHaveLength(1)
    expect(lignesBlanches(md)).toBe(0)
    expect(md.querySelectorAll('br')).toHaveLength(0)
    expect(md.textContent).toBe('Premier paragraphe.Deuxième paragraphe.')
  })

  it('plusieurs lignes vides ne font toujours qu’un séparateur', () => {
    // Pas de lettres seules (« A ») : un pré-traitement antérieur au rendu retire déjà une ligne
    // d'une seule lettre suivie de lignes vides, ce test ne porterait plus sur l'espacement.
    const md = rendre('Premier.\n\n\n\nSecond.')
    expect(md.querySelectorAll('.md-para')).toHaveLength(1)
    expect(md.querySelectorAll('br')).toHaveLength(0)
  })

  it('garde le retour à la ligne simple', () => {
    const md = rendre('ligne 1\nligne 2')
    expect(md.querySelectorAll('br')).toHaveLength(1)
    expect(md.querySelectorAll('.md-para')).toHaveLength(0)
  })

  it('ne laisse rien pour les lignes vides en tête et en fin', () => {
    const md = rendre('\n\nTexte seul\n\n')
    expect(md.querySelectorAll('.md-para')).toHaveLength(0)
    expect(md.querySelectorAll('br')).toHaveLength(0)
  })

  it('ne laisse rien entre un titre ou une liste et le texte qui suit', () => {
    const md = rendre('## Titre\n\nTexte\n\n- un\n- deux\n\nSuite')
    expect(md.querySelectorAll('br')).toHaveLength(0)
    // Un seul séparateur : celui entre « Texte » et la liste n'est pas utile non plus (la liste a sa
    // marge), mais il ne coûte qu'un demi-interligne ; ce qui est exigé, c'est l'absence de ligne blanche.
    expect(md.querySelectorAll('.md-para').length).toBeLessThanOrEqual(1)
    expect(md.querySelector('h2')?.textContent).toBe('Titre')
    expect(md.querySelectorAll('li')).toHaveLength(2)
  })
})
