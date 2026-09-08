// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainMarkdown } from './BrainMarkdown'
import { MARKDOWN_RENDU_MAX_CARACTERES } from './brain-markdown-model'

/**
 * GARDE-FOU DU GEL DE LA VUE KNOWLEDGE (2026-09-08). Une fiche de 200 000 caractères
 * (`readNodeFile` plafonne là) prenait 7 s rien qu'à l'analyse Markdown, dans le rendu React :
 * la fenêtre se figeait et il fallait tuer l'application. Ce test échoue si le rendu formaté
 * revient sur les grandes notes.
 */
let hote: HTMLDivElement
let racine: Root

function rendre(source: string): number {
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
  const debut = Date.now()
  act(() => {
    racine.render(createElement(BrainMarkdown, { source }))
  })
  return Date.now() - debut
}

afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

describe('BrainMarkdown sur une note volumineuse', () => {
  it('affiche le texte brut complet au lieu de formater 200 000 caractères', () => {
    const ligne = '| colonne A | colonne B | colonne C |\n'
    const source = ligne.repeat(Math.ceil(200_000 / ligne.length)).slice(0, 200_000)

    const duree = rendre(source)

    expect(source.length).toBeGreaterThan(MARKDOWN_RENDU_MAX_CARACTERES)
    expect(hote.querySelector('[role="status"]')?.textContent).toContain('texte brut')
    expect(hote.querySelector('table')).toBeNull()
    expect(hote.querySelector('.brain-markdown__brut-corps')?.textContent).toHaveLength(
      source.length
    )
    expect(duree).toBeLessThan(1000)
  }, 30_000)

  it('formate normalement une note courte', () => {
    rendre('# Titre\n\n- a\n')
    expect(hote.querySelector('h1')?.textContent).toBe('Titre')
  })
})
