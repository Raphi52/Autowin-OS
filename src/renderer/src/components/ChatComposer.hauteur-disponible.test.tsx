// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from './ChatComposer'

/**
 * LA RANGÉE D'OUTILS RESTE VISIBLE DANS UNE FENÊTRE BASSE (conv-1103, 2026-10-22).
 *
 * Défaut vu à 900 × 670 px avec deux suggestions cochées : la zone des messages était déjà
 * réduite à son minimum, la zone de saisie ne pouvait pas rétrécir, et le champ grandissait
 * jusqu'à 180 px sans regarder la place restante. Le bas de la saisie (∞, trombone, micro)
 * sortait du cadre de la colonne. Mesuré par capture : limiter le champ suffit à les ramener.
 *
 * Happy-dom ne calcule aucune mise en page : les dimensions sont donc posées à la main, et la
 * hauteur de la saisie suit celle du champ comme dans l'application (218 px + le champ).
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const proprietes = (): ChatComposerProps => ({
  busy: false,
  hasActiveConversation: true,
  resumeAvailable: false,
  attachmentCount: 0,
  mentionSources: { runs: [], files: [] } as never,
  skillCommands: [],
  ghostRecommendation: null,
  placeholderPendantTour: false,
  onDraftInput: () => {},
  onDraftPresence: () => {},
  onBtw: () => false,
  onSend: () => {},
  onQueue: () => {},
  onResume: () => {},
  onPaste: () => {}
})

const rect = (top: number, bottom: number): DOMRect =>
  ({ top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top }) as DOMRect

let root: Root | null = null
let colonne: HTMLDivElement | null = null
let surRedimension: (() => void) | null = null

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  colonne?.remove()
  root = null
  colonne = null
  surRedimension = null
  vi.unstubAllGlobals()
})

/**
 * Monte la saisie dans une colonne de `hauteurColonne` px. Le contenu du champ mesure
 * `hauteurTexte` px ; le reste de la saisie (suggestions, outils, marges) en mesure 218.
 */
async function monter(hauteurColonne: number, hauteurTexte: number): Promise<HTMLTextAreaElement> {
  // Seul le rappel compte : on le garde pour simuler un redimensionnement de la colonne.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor(rappel: () => void) {
        surRedimension = rappel
      }
    }
  )
  colonne = document.createElement('div')
  document.body.appendChild(colonne)
  root = createRoot(colonne)
  await act(async () => {
    root!.render(<ChatComposer {...proprietes()} />)
  })
  const champ = colonne.querySelector('textarea') as HTMLTextAreaElement
  const saisie = colonne.querySelector('.composer') as HTMLElement
  champ.style.minHeight = '55px'
  Object.defineProperty(champ, 'scrollHeight', { configurable: true, get: () => hauteurTexte })
  saisie.getBoundingClientRect = () => rect(0, 218 + (Number.parseFloat(champ.style.height) || 0))
  definirHauteurColonne(hauteurColonne)
  return champ
}

function definirHauteurColonne(hauteur: number): void {
  colonne!.getBoundingClientRect = () => rect(0, hauteur)
  Object.defineProperty(colonne!, 'clientHeight', { configurable: true, get: () => hauteur })
}

async function taper(champ: HTMLTextAreaElement, valeur: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      champ,
      valeur
    )
    champ.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ChatComposer — le champ tient dans la place laissée par la colonne', () => {
  it('assez de place : le champ prend toute la hauteur de son texte (plafond 180 px)', async () => {
    const champ = await monter(400, 112)
    await taper(champ, '1. une suite\n2. une autre suite')
    expect(champ.style.height).toBe('112px')
  })

  it('la saisie dépasserait de 30 px : le champ rend ces 30 px et défile', async () => {
    const champ = await monter(300, 112)
    await taper(champ, '1. une suite\n2. une autre suite')
    expect(champ.style.height).toBe('82px')
  })

  it('jamais sous sa hauteur minimale de deux lignes, même si la place manque encore', async () => {
    const champ = await monter(250, 112)
    await taper(champ, '1. une suite\n2. une autre suite')
    expect(champ.style.height).toBe('55px')
  })

  it('la fenêtre rapetisse sans frappe : le champ se réajuste au redimensionnement', async () => {
    const champ = await monter(400, 112)
    await taper(champ, '1. une suite\n2. une autre suite')
    expect(champ.style.height).toBe('112px')
    definirHauteurColonne(300)
    await act(async () => {
      surRedimension?.()
    })
    expect(champ.style.height).toBe('82px')
  })
})
