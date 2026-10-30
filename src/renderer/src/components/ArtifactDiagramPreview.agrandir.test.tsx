// @vitest-environment happy-dom
/*
 * AGRANDIR UN SCHEMA (conv-1322, 2026-10-30 : « un schema que j'arrive pas a lire et je peux pas
 * l'agrandir »). Le schema de conv-1321, tres haut, sortait a 420 px de haut dans le fil : texte de
 * 5 px, et rien pour le voir en grand. Mermaid ne dessine rien ici (pas de moteur de rendu) : le
 * vrai dessin, la vraie molette et le vrai glisser sont prouves par la sonde CDP de ce fil.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SVG = (id: string): string =>
  `<svg id="${id}" width="100%" viewBox="0 0 1000 2000" style="max-width: 1000px">` +
  `<style>#${id} .node{fill:red}</style>` +
  `<marker id="${id}_pointe"></marker><path marker-end="url(#${id}_pointe)"></path></svg>`

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: SVG(id) }))
  }
}))

import { ArtifactDiagramPreview } from './ArtifactDiagramPreview'

let container: HTMLDivElement
let root: Root
/** Rappelle la scène comme un changement de taille de la fenêtre. */
let redimensionner: () => void

/** happy-dom n'en fournit qu'un muet : ici, c'est le test qui joue la réponse du navigateur. */
class ObservateurDeTaille {
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(rappel: () => void) {
    redimensionner = rappel
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', ObservateurDeTaille)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const dessiner = async (): Promise<void> => {
  act(() =>
    root.render(createElement(ArtifactDiagramPreview, { source: 'flowchart TB\n A --> B' }))
  )
  for (let i = 0; i < 50 && !container.querySelector('svg'); i += 1)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  expect(container.querySelector('svg')).not.toBeNull()
}

const visionneuse = (): HTMLElement | null =>
  document.body.querySelector('[data-testid="visionneuse-diagramme"]')
const scene = (): HTMLElement =>
  document.body.querySelector('[data-testid="visionneuse-scene"]') as HTMLElement
const toile = (): HTMLElement =>
  document.body.querySelector('[data-testid="visionneuse-toile"]') as HTMLElement
const pourcent = (): number =>
  Number(
    document.body.querySelector('[data-testid="visionneuse-zoom"]')?.textContent?.replace(/\D/g, '')
  )
const cliquer = (cible: string): void => {
  act(() => {
    ;(document.body.querySelector(`[data-testid="${cible}"]`) as HTMLElement).click()
  })
}
/** Un cadre de 1000 x 1000 : happy-dom ne met rien en page, sa largeur serait 0. */
const cadreMesure = (): void => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1000)
}
const ouvrir = async (): Promise<void> => {
  await dessiner()
  cadreMesure()
  cliquer('diagramme-agrandir')
  expect(visionneuse()).not.toBeNull()
  // La première réponse de l'observateur : c'est elle qui ajuste le schéma à la fenêtre.
  act(() => redimensionner())
}

describe('agrandir un schema', () => {
  it('montre un bouton Agrandir sur le schema dessine, pas pendant le chargement', async () => {
    act(() =>
      root.render(createElement(ArtifactDiagramPreview, { source: 'flowchart TB\n A --> B' }))
    )
    expect(container.querySelector('[data-testid="diagramme-agrandir"]')).toBeNull()
    await dessiner()
    expect(container.querySelector('[data-testid="diagramme-agrandir"]')).not.toBeNull()
    expect(visionneuse()).toBeNull()
  })

  it('ouvre la visionneuse hors du fil, schema ajuste a la fenetre', async () => {
    await ouvrir()
    expect(container.contains(visionneuse())).toBe(false)
    expect(toile().style.width).toBe('1000px')
    expect(toile().style.height).toBe('2000px')
    // Le schema (2000 de haut) tient dans le cadre de 1000 : marges retirees, soit 48 %.
    expect(pourcent()).toBe(48)
  })

  it('suit la taille de la fenetre, jusqu au premier geste', async () => {
    await ouvrir()
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    act(() => redimensionner())
    expect(pourcent()).toBe(23)
    // Ce que l'utilisateur a cadré ne bouge plus quand la fenêtre change.
    cliquer('visionneuse-zoom-plus')
    const cadre = pourcent()
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1000)
    act(() => redimensionner())
    expect(pourcent()).toBe(cadre)
  })

  it('un clic sur le schema l ouvre aussi', async () => {
    await dessiner()
    act(() => {
      container.querySelector('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(visionneuse()).not.toBeNull()
  })

  it('selectionner du texte dans le schema n ouvre rien', async () => {
    await dessiner()
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)
    act(() => {
      container.querySelector('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(visionneuse()).toBeNull()
  })

  it('la copie agrandie a son propre identifiant, et le dessin y reste seul', async () => {
    await ouvrir()
    const duFil = container.querySelector('svg') as SVGElement
    const copie = toile().querySelector('svg') as SVGElement
    expect(copie.id).not.toBe(duFil.id)
    expect(document.querySelectorAll(`[id="${copie.id}"]`).length).toBe(1)
    expect(toile().children).toHaveLength(1)
  })

  it('les boutons zooment, Ajuster revient a la vue de depart', async () => {
    await ouvrir()
    cliquer('visionneuse-zoom-plus')
    expect(pourcent()).toBeGreaterThan(48)
    cliquer('visionneuse-ajuster')
    expect(pourcent()).toBe(48)
    cliquer('visionneuse-zoom-moins')
    expect(pourcent()).toBeLessThan(48)
  })

  it('la molette zoome et ne fait pas zoomer toute l app (Ctrl + molette)', async () => {
    await ouvrir()
    const zoomDeLApp = vi.fn()
    window.addEventListener('wheel', zoomDeLApp)
    const molette = new WheelEvent('wheel', {
      deltaY: -200,
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    act(() => {
      scene().dispatchEvent(molette)
    })
    window.removeEventListener('wheel', zoomDeLApp)
    expect(pourcent()).toBeGreaterThan(48)
    expect(molette.defaultPrevented).toBe(true)
    expect(zoomDeLApp).not.toHaveBeenCalled()
  })

  it('glisser deplace le schema sans changer le zoom, et s arrete au relachement', async () => {
    await ouvrir()
    const pointeur = (type: string, x: number, y: number): void => {
      act(() => {
        scene().dispatchEvent(
          new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
        )
      })
    }
    const position = (): number[] =>
      /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(toile().style.transform)!.slice(1).map(Number)
    const [x, y] = position()
    pointeur('pointerdown', 100, 100)
    pointeur('pointermove', 130, 80)
    expect(position()).toEqual([x + 30, y - 20])
    pointeur('pointerup', 130, 80)
    pointeur('pointermove', 400, 400)
    expect(position()).toEqual([x + 30, y - 20])
    expect(pourcent()).toBe(48)
  })

  it('double clic dans la vue : zoom x2. Celui qui a ouvert la vue : rien', async () => {
    await ouvrir()
    const souris = (type: string, detail: number): void => {
      act(() => {
        scene().dispatchEvent(new MouseEvent(type, { detail, bubbles: true }))
      })
    }
    // Le second clic du double clic qui a ouvert la vue, parti du schema du fil.
    souris('mousedown', 2)
    souris('dblclick', 2)
    expect(pourcent()).toBe(48)
    // Un double clic entier dans la vue.
    souris('mousedown', 1)
    souris('mousedown', 2)
    souris('dblclick', 2)
    // 47,6 % ajusté (affiché 48), doublé : 95,2 %.
    expect(pourcent()).toBe(95)
  })

  it('Echap ferme la visionneuse et ne va pas plus loin (rien d autre ne se ferme derriere)', async () => {
    await ouvrir()
    const derriere = vi.fn()
    document.addEventListener('keydown', derriere)
    act(() => {
      visionneuse()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    document.removeEventListener('keydown', derriere)
    expect(visionneuse()).toBeNull()
    expect(derriere).not.toHaveBeenCalled()
  })

  it('le bouton fermer ferme, puis le schema se rouvre', async () => {
    await ouvrir()
    cliquer('visionneuse-fermer')
    expect(visionneuse()).toBeNull()
    cliquer('diagramme-agrandir')
    expect(visionneuse()).not.toBeNull()
  })

  it('un clic dans la visionneuse ne remonte pas jusqu au fil', async () => {
    const clicDuFil = vi.fn()
    act(() =>
      root.render(
        createElement(
          'div',
          { onClick: clicDuFil },
          createElement(ArtifactDiagramPreview, { source: 'flowchart TB\n A --> B' })
        )
      )
    )
    for (let i = 0; i < 50 && !container.querySelector('svg'); i += 1)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
    cadreMesure()
    cliquer('diagramme-agrandir')
    clicDuFil.mockClear()
    cliquer('visionneuse-zoom-plus')
    expect(clicDuFil).not.toHaveBeenCalled()
  })
})
