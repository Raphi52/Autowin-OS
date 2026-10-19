// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * LE FOND QUI SACCADE (conv-347, 2026-10-19, « l'accueil il fait pas assez lissé »).
 *
 * Mesuré au profil du fil du décor (instance cachée, `--code-dev`) : 13 images/s, mais espacées de
 * 40 à 131 ms d'une image à l'autre — 19 écarts sous 55 ms, 62 entre 75 et 110 ms, 7 au-delà. Dans
 * l'app de l'utilisateur : 34 ms par image en médiane, 74 ms une fois sur dix.
 *
 * CAUSE : le rythme se décide côté page (`decor-cadence.ts`), le dessin dans un Worker
 * (`decor-avenue-hote.ts`). La cadence ne voyait que le prix d'un `postMessage` (≈ 0 ms) ; et une
 * image demandée pendant que le Worker dessinait encore la précédente était PERDUE en silence, la
 * phase avancée quand même : la suivante attendait un intervalle entier. Avec le reflet une image
 * sur deux (coût 30 puis 52 ms), les écarts alternaient 33 / 67 ms — l'œil voit l'à-coup.
 *
 * Ce qui doit faire échouer ce fichier : des images inégalement espacées, ou un fil du décor occupé
 * au-delà de ce que la cadence lui accorde.
 */

const BATTEMENT = 1000 / 60

/**
 * Un Worker simulé, comme decor-avenue.worker.ts : à chaque demande, la passe ÉCRAN (`ecran` ms),
 * à la fin de laquelle l'image s'affiche, puis le REFLET de l'image suivante (`reflet` ms, une image
 * sur deux) dans la tâche d'après ; `rendue` revient après le reflet. Une demande pendant ce temps
 * est perdue (decor-avenue-hote.ts).
 */
interface FilSimule {
  t: number
  occupeJusqua: number
  afficheA: number
  affichee: boolean
  enVol: boolean
  dernierCout: number | null
  couts: { ecran: number; reflet: number }[]
  k: number
  /** Les battements d'écran où une image NEUVE est apparue (la fin d'un dessin). */
  presentations: number[]
  coutTotal: number
}
const fil: FilSimule = {
  t: 0,
  occupeJusqua: -Infinity,
  afficheA: -Infinity,
  affichee: true,
  enVol: false,
  dernierCout: null,
  couts: [{ ecran: 12, reflet: 0 }],
  k: 0,
  presentations: [],
  coutTotal: 0
}

vi.mock('./home-decor-scene', () => ({
  DECOR_DEFAUT: 'avenue',
  tempsDecor: (t: number) => t,
  createDecorScene: vi.fn(() => ({
    canvas: document.createElement('canvas'),
    resize: vi.fn(),
    dispose: vi.fn(),
    // comme decor-avenue-hote.ts : pas de nouvelle demande tant que la précédente est en vol
    render: vi.fn(() => {
      if (fil.enVol) return
      const { ecran, reflet } = fil.couts[fil.k++ % fil.couts.length]
      fil.enVol = true
      fil.affichee = false
      fil.afficheA = fil.t + ecran
      fil.occupeJusqua = fil.t + ecran + reflet
      fil.coutTotal += ecran + reflet
      ;(fil as FilSimule & { coutEnCours: number }).coutEnCours = ecran + reflet
    }),
    pret: () => !fil.enVol,
    coutDerniereImage: () => fil.dernierCout
  }))
}))

const { DecorDeFond } = await import('./DecorDeFond')

let rappels: FrameRequestCallback[] = []
let monte: { root: Root; hote: HTMLElement } | null = null

beforeEach(() => {
  rappels = []
  Object.assign(fil, {
    t: 0,
    occupeJusqua: -Infinity,
    afficheA: -Infinity,
    affichee: true,
    enVol: false,
    dernierCout: null,
    k: 0,
    presentations: [],
    coutTotal: 0
  })
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    rappels.push(f)
    return rappels.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
afterEach(() => {
  if (monte) {
    act(() => monte!.root.unmount())
    monte.hote.remove()
    monte = null
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Monte le fond, puis fait battre un écran 60 Hz pendant `secondes`. */
async function jouer(couts: FilSimule['couts'], secondes: number): Promise<number[]> {
  fil.couts = couts
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const root = createRoot(hote)
  monte = { root, hote }
  await act(async () => root.render(createElement(DecorDeFond, { actif: true })))
  await act(async () => {
    await Promise.resolve()
  })
  // l'horloge du test part après le dernier geste enregistré au montage : pas de repos
  const origine = performance.now() + 1
  for (let i = 0; i * BATTEMENT < secondes * 1000; i++) {
    const t = origine + i * BATTEMENT
    fil.t = t
    // la passe écran est finie : l'image apparaît à ce battement
    if (!fil.affichee && t >= fil.afficheA) {
      fil.affichee = true
      fil.presentations.push(t)
    }
    // le reflet aussi : le Worker est libre, son coût revient à la page
    if (fil.enVol && t >= fil.occupeJusqua) {
      fil.enVol = false
      fil.dernierCout = (fil as FilSimule & { coutEnCours: number }).coutEnCours
    }
    const aJouer = rappels
    rappels = []
    for (const f of aJouer) f(t)
  }
  // la première seconde : la cadence apprend le coût du fil
  return fil.presentations.filter((t) => t > origine + 1000)
}

const ecarts = (t: number[]): number[] => t.slice(1).map((x, i) => x - t[i])

/** La part des écarts égaux (à 1 ms près) à l'écart le plus fréquent. */
function regularite(e: number[]): { mode: number; part: number } {
  const compte = new Map<number, number>()
  for (const x of e) compte.set(Math.round(x), (compte.get(Math.round(x)) ?? 0) + 1)
  const [mode] = [...compte].sort((a, b) => b[1] - a[1])[0]
  return { mode, part: e.filter((x) => Math.abs(x - mode) <= 1).length / e.length }
}

describe('le fond dessiné dans un Worker garde des images régulièrement espacées', () => {
  it('reflet une image sur deux (30, puis 30 + 22 ms) : un seul écart, pas 33 / 67 ms en alternance', async () => {
    const vues = await jouer(
      [
        { ecran: 30, reflet: 0 },
        { ecran: 30, reflet: 22 }
      ],
      6
    )
    const { mode, part } = regularite(ecarts(vues))
    expect(part, `écarts : ${ecarts(vues).map(Math.round).join(' ')}`).toBeGreaterThanOrEqual(0.95)
    // et pas au prix d'une cadence effondrée : 15 images/s au moins
    expect(mode).toBeLessThanOrEqual(4 * BATTEMENT + 1)
  })

  it('le fil du décor garde de la marge : il ne dessine pas plus de 80 % du temps', async () => {
    await jouer(
      [
        { ecran: 30, reflet: 0 },
        { ecran: 30, reflet: 22 }
      ],
      6
    )
    expect(fil.coutTotal / 6000).toBeLessThanOrEqual(0.8)
  })

  it('un Worker rapide (12 ms) reste à 30 images/s, une image tous les deux battements', async () => {
    const vues = await jouer([{ ecran: 12, reflet: 0 }], 4)
    const { mode, part } = regularite(ecarts(vues))
    expect(mode).toBe(Math.round(2 * BATTEMENT))
    expect(part).toBeGreaterThanOrEqual(0.95)
  })

  it('un pic isolé (compilation, ramasse-miettes) ne fait pas chuter la cadence pour la suite', async () => {
    // une image à 480 ms toutes les 60 (le max relevé dans l'app de l'utilisateur : 487 ms)
    const couts = Array.from({ length: 60 }, (_, i) => ({ ecran: i === 10 ? 480 : 14, reflet: 0 }))
    const vues = await jouer(couts, 8)
    const e = ecarts(vues)
    const { mode, part } = regularite(e)
    expect(mode).toBe(Math.round(2 * BATTEMENT))
    expect(part).toBeGreaterThanOrEqual(0.9)
  })
})
