// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageDuDecor, MessageVersDecor } from './decor-avenue-messages'

/**
 * Le côté page du fond avenue dessiné dans un Worker (decor-avenue-hote.ts, conv-323). Mesure qui le
 * motive : 36 à 45 ms de fil principal par image de l'avenue, à 30 images/s — plus que le fil entier.
 */
const repli = vi.hoisted(() => ({
  scene: null as null | {
    canvas: HTMLCanvasElement
    render: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }
}))
vi.mock('./home-decor-avenue', () => ({
  FONDU_ENTREE_MS: 1200,
  createAvenueScene: () => {
    repli.scene = {
      canvas: document.createElement('canvas'),
      render: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn()
    }
    return repli.scene
  }
}))

class FauxWorker {
  static dernier: FauxWorker | null = null
  recus: MessageVersDecor[] = []
  transferts: Transferable[][] = []
  onmessage: ((e: MessageEvent<MessageDuDecor>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  termine = false
  constructor(public url: URL) {
    FauxWorker.dernier = this
  }
  postMessage(m: MessageVersDecor, t: Transferable[] = []): void {
    this.recus.push(m)
    this.transferts.push(t)
  }
  terminate(): void {
    this.termine = true
  }
  repondre(m: MessageDuDecor): void {
    this.onmessage?.({ data: m } as MessageEvent<MessageDuDecor>)
  }
}

const horsPage = { horsPage: true } as unknown as OffscreenCanvas

beforeEach(() => {
  vi.stubGlobal('Worker', FauxWorker)
  vi.stubGlobal('OffscreenCanvas', class {})
  HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
    return horsPage
  }
  repli.scene = null
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (HTMLCanvasElement.prototype as { transferControlToOffscreen?: unknown })
    .transferControlToOffscreen
})

const monter = async (): Promise<{
  scene: NonNullable<ReturnType<typeof import('./decor-avenue-hote').createAvenueEnArrierePlan>>
  worker: FauxWorker
}> => {
  const { createAvenueEnArrierePlan } = await import('./decor-avenue-hote')
  const scene = createAvenueEnArrierePlan()
  if (!scene || !FauxWorker.dernier) throw new Error('pas de scène')
  return { scene, worker: FauxWorker.dernier }
}

describe('le fond avenue dessiné dans un Worker — côté page', () => {
  it('transfère son canevas, invisible, au Worker qu il démarre', async () => {
    const { scene, worker } = await monter()
    expect(worker.url.href).toMatch(/decor-avenue\.worker\.ts/)
    expect(worker.recus[0]).toMatchObject({ type: 'monter', canvas: horsPage })
    expect(worker.transferts[0]).toEqual([horsPage])
    expect(scene.canvas.style.opacity).toBe('0')
  })

  it('UNE image à la fois : pas de nouvelle demande tant que la précédente n est pas rendue', async () => {
    const { scene, worker } = await monter()
    scene.render(1, { x: 0.2, y: -0.1 })
    scene.render(1.03, { x: 0.3, y: -0.1 })
    const images = (): MessageVersDecor[] => worker.recus.filter((m) => m.type === 'image')
    expect(images()).toEqual([{ type: 'image', temps: 1, regard: { x: 0.2, y: -0.1 } }])
    worker.repondre({ type: 'rendue', ms: 30 })
    scene.render(1.06, { x: 0.4, y: 0 })
    expect(images()).toHaveLength(2)
  })

  it('transmet la taille avec la densité de pixels de l écran (le Worker n a pas window)', async () => {
    const { scene, worker } = await monter()
    scene.resize(800, 400)
    expect(worker.recus.at(-1)).toEqual({
      type: 'taille',
      largeur: 800,
      hauteur: 400,
      ratio: window.devicePixelRatio || 1
    })
  })

  it('fait le fondu à la première image, et recopie les marques du Worker dans la page', async () => {
    const { scene, worker } = await monter()
    const mark = vi.spyOn(performance, 'mark')
    worker.repondre({ type: 'marque', nom: 'decor-avenue:rue-visible' })
    worker.repondre({ type: 'apparue' })
    expect(mark).toHaveBeenCalledWith('decor-avenue:rue-visible')
    expect(scene.canvas.style.opacity).toBe('1')
  })

  it('REPLI : si le Worker ne peut pas monter la rue, elle se dessine dans la page, au même endroit', async () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { scene, worker } = await monter()
    const hote = document.createElement('div')
    hote.appendChild(scene.canvas)
    scene.resize(640, 360)
    worker.repondre({ type: 'montee', ok: false, erreur: 'WebGL indisponible' })
    expect(worker.termine).toBe(true)
    expect(erreur).toHaveBeenCalled()
    expect(repli.scene).not.toBeNull()
    expect(scene.canvas).toBe(repli.scene?.canvas)
    expect(hote.firstChild).toBe(repli.scene?.canvas)
    expect(repli.scene?.resize).toHaveBeenCalledWith(640, 360)
    scene.render(2, { x: 0, y: 0 })
    expect(repli.scene?.render).toHaveBeenCalledWith(2, { x: 0, y: 0 })
  })

  it('libère : demande au Worker de libérer sa scène et retire le canevas', async () => {
    vi.useFakeTimers()
    const { scene, worker } = await monter()
    const hote = document.createElement('div')
    hote.appendChild(scene.canvas)
    scene.dispose()
    expect(worker.recus.at(-1)).toEqual({ type: 'liberer' })
    expect(hote.childNodes).toHaveLength(0)
    vi.advanceTimersByTime(2000)
    expect(worker.termine).toBe(true)
    vi.useRealTimers()
  })

  it('sans Worker (ou sans OffscreenCanvas), la rue se dessine dans la page comme avant', async () => {
    vi.stubGlobal('Worker', undefined)
    const { createAvenueEnArrierePlan } = await import('./decor-avenue-hote')
    const scene = createAvenueEnArrierePlan()
    expect(scene).toBe(repli.scene)
  })
})
