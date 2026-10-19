// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageDuDecor, MessageVersDecor } from './decor-avenue-messages'

/**
 * L'IMAGE PUIS SON REFLET, EN DEUX TÂCHES (conv-347, « l'accueil il fait pas assez lissé »).
 *
 * Une image dessinée dans le Worker s'affiche à la fin de la tâche qui la dessine. Le reflet de l'eau
 * (une image sur deux) était dessiné DANS cette tâche : une image sur deux s'affichait ~20 ms plus
 * tard, et les écarts entre images alternaient 33 / 67 ms. Ce qui doit faire échouer ce fichier : un
 * reflet dessiné dans la tâche de l'image, ou un `rendue` envoyé avant la fin du reflet (la page
 * redemanderait une image pendant que le Worker est encore occupé).
 */

const ordre: string[] = []
const scene = {
  canvas: {} as HTMLCanvasElement,
  render: vi.fn(() => ordre.push('ecran')),
  apresImage: vi.fn(() => ordre.push('reflet')),
  resize: vi.fn(),
  dispose: vi.fn()
}
const options: { refletApresImage?: boolean }[] = []
vi.mock('./home-decor-avenue', () => ({
  brancherMarquesAvenue: vi.fn(),
  createAvenueScene: vi.fn((o: { refletApresImage?: boolean }) => {
    options.push(o)
    return scene
  })
}))

const recus: MessageDuDecor[] = []
let entree: (e: { data: MessageVersDecor }) => void

beforeAll(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('postMessage', (m: MessageDuDecor) => {
    recus.push(m)
    if (m.type === 'rendue') ordre.push('rendue')
  })
  vi.stubGlobal('close', vi.fn())
  await import('./decor-avenue.worker')
  entree = (e) => (self.onmessage as unknown as (e: { data: MessageVersDecor }) => void)(e)
  entree({ data: { type: 'monter', canvas: {} as OffscreenCanvas, ratio: 1 } })
})
afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  ordre.length = 0
  recus.length = 0
})

describe('le Worker du fond dessine l image, puis son reflet dans la tâche suivante', () => {
  it('la scène est montée avec le reflet après l image', () => {
    expect(options.at(-1)?.refletApresImage).toBe(true)
  })

  it('la tâche de l image ne dessine QUE l image : ni reflet, ni « rendue »', () => {
    entree({ data: { type: 'image', temps: 1, regard: { x: 0, y: 0 } } })
    expect(ordre).toEqual(['ecran'])
    expect(recus.filter((m) => m.type === 'rendue')).toHaveLength(0)
    vi.runAllTimers()
    expect(ordre).toEqual(['ecran', 'reflet', 'rendue'])
  })

  it('« rendue » porte le coût des deux passes', () => {
    entree({ data: { type: 'image', temps: 2, regard: { x: 0, y: 0 } } })
    vi.runAllTimers()
    const rendue = recus.find((m) => m.type === 'rendue')
    expect(rendue && rendue.type === 'rendue' && rendue.ms >= 0).toBe(true)
  })

  it('libérée avant son reflet : rien n est dessiné ni signalé ensuite', () => {
    entree({ data: { type: 'image', temps: 3, regard: { x: 0, y: 0 } } })
    entree({ data: { type: 'liberer' } })
    vi.runAllTimers()
    expect(ordre).toEqual(['ecran'])
    expect(recus.filter((m) => m.type === 'rendue')).toHaveLength(0)
  })
})
