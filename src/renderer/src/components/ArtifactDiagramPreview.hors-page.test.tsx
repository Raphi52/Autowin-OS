// @vitest-environment happy-dom
/*
 * LE DESSIN D'UN DIAGRAMME NE TOUCHE PAS A LA MISE EN PAGE (conv-275, 2026-10-11).
 *
 * Sans conteneur, mermaid posait son brouillon EN FLUX dans <body> : la page affichait sa propre
 * barre de defilement le temps du dessin, toute l'app retrecissait de 10 px et le fil sautait,
 * a chaque diagramme d'une conversation qu'on ouvrait.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appels: {
  zone: HTMLElement | undefined
  dansLaPage: boolean
  style: Record<string, string>
}[] = []
/** Dessins en attente, terminés dans l'ordre (mermaid sérialise ses dessins). */
const enAttente: (() => void)[] = []
const terminer = (): void => enAttente.shift()?.()

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn((_id: string, _source: string, zone?: HTMLElement) => {
      appels.push({
        zone,
        dansLaPage: !!zone && document.body.contains(zone),
        style: zone
          ? {
              position: zone.style.position,
              visibility: zone.style.visibility,
              width: zone.style.width,
              display: zone.style.display
            }
          : {}
      })
      return new Promise<{ svg: string }>((resolve) => {
        enAttente.push(() => resolve({ svg: '<svg data-testid="svg-rendu"></svg>' }))
      })
    })
  }
}))

import { ArtifactDiagramPreview } from './ArtifactDiagramPreview'
import { LARGEUR_DESSIN_PAR_DEFAUT } from './zone-dessin-diagramme'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  appels.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  // Un dessin laissé en suspens garderait sa zone dans la page et fausserait le test suivant.
  await act(async () => {
    while (enAttente.length > 0) terminer()
    await new Promise((r) => setTimeout(r, 0))
  })
})

const attendre = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !condition(); i += 1)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  expect(condition()).toBe(true)
}

describe('ArtifactDiagramPreview — dessin hors de la page', () => {
  it('dessine dans une zone FIXE et invisible, jamais dans le flux de <body>', async () => {
    act(() =>
      root.render(createElement(ArtifactDiagramPreview, { source: 'flowchart LR\n A --> B' }))
    )
    await attendre(() => appels.length > 0)

    const appel = appels[0]
    // Un conteneur est TOUJOURS fourni : sans lui, mermaid ajoute son brouillon en flux dans <body>.
    expect(appel.zone).toBeInstanceOf(HTMLElement)
    expect(appel.dansLaPage).toBe(true)
    // `fixed` : la zone ne compte jamais dans la hauteur du document, donc pas de barre de page.
    expect(appel.style.position).toBe('fixed')
    // Rendue mais invisible : mermaid a besoin de la mise en page pour mesurer son texte.
    expect(appel.style.visibility).toBe('hidden')
    expect(appel.style.display).toBe('')
    // Ici la place n'a pas de largeur mesurable (pas de mise en page) : largeur par defaut.
    expect(appel.style.width).toBe(`${LARGEUR_DESSIN_PAR_DEFAUT}px`)
  })

  it('retire la zone une fois le dessin fini, et affiche le diagramme', async () => {
    act(() =>
      root.render(createElement(ArtifactDiagramPreview, { source: 'flowchart LR\n A --> B' }))
    )
    await attendre(() => appels.length > 0)
    const zone = appels[0].zone as HTMLElement
    expect(document.body.contains(zone)).toBe(true)

    await act(async () => {
      terminer()
    })
    await attendre(() => container.querySelector('[data-testid="svg-rendu"]') !== null)
    expect(document.body.contains(zone)).toBe(false)
    expect(document.querySelectorAll('[data-zone-dessin-diagramme]').length).toBe(0)
  })

  it('retire aussi la zone d’un dessin abandonné (fil quitté pendant le rendu)', async () => {
    act(() =>
      root.render(createElement(ArtifactDiagramPreview, { source: 'flowchart LR\n A --> B' }))
    )
    await attendre(() => appels.length > 0)
    const zone = appels[0].zone as HTMLElement
    expect(zone).toBeInstanceOf(HTMLElement)

    act(() => root.render(createElement('div')))
    await act(async () => {
      terminer()
    })
    await attendre(() => !document.body.contains(zone))
    expect(document.querySelectorAll('[data-zone-dessin-diagramme]').length).toBe(0)
  })
})
