// @vitest-environment happy-dom
/**
 * CE QUE PROUVE CE FICHIER : le widget MONTRE le niveau du micro et DIT si l'on parle dans le vide,
 * et ses paramètres audio règlent le moteur DÉJÀ en cours. Le callback `onniveau` est OPTIONNEL :
 * un moteur qui ne le fournit pas laisse la jauge à zéro sans rien casser.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JarvisWidget } from './JarvisWidget'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

class MoteurFactice {
  static instances: MoteurFactice[] = []
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onniveau: ((m: { niveau: number; parle: boolean }) => void) | null = null
  seuilParole = 0.012
  peripherique: string | undefined = undefined
  demarrages = 0
  constructor() {
    MoteurFactice.instances.push(this)
  }
  start(): void {
    this.demarrages += 1
  }
  arrets = 0
  stop(): void {
    this.arrets += 1
  }
}

const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

function rendre(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(JarvisWidget)))
  monte.push({ root, container })
  return container
}
const par = (c: HTMLElement, id: string): HTMLElement => {
  const el = c.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`absent : ${id}`)
  return el
}
const clic = (c: HTMLElement, id: string): void => {
  act(() => par(c, id).dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  MoteurFactice.instances = []
  ;(window as never as Record<string, unknown>).SpeechRecognition = MoteurFactice
  ;(window as never as Record<string, unknown>).api = { conversations: vi.fn(async () => []) }
  ;(navigator as never as Record<string, unknown>).mediaDevices = {
    enumerateDevices: vi.fn(async () => [
      { kind: 'audioinput', deviceId: 'mic-a', label: 'Casque USB' },
      { kind: 'audioinput', deviceId: 'mic-b', label: '' }
    ])
  }
})

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('jauge et paramètres audio du widget Jarvis', () => {
  it('annonce « micro coupé » et une jauge à zéro tant que rien n’écoute', () => {
    const c = rendre()
    expect(par(c, 'jarvis-verdict').textContent).toContain('Micro coupé')
    expect(par(c, 'jarvis-jauge').getAttribute('aria-valuenow')).toBe('0')
  })

  it('monte avec le niveau reçu et confirme que le micro entend', () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = MoteurFactice.instances.at(-1)!
    act(() => moteur.onniveau?.({ niveau: 0.06, parle: true }))
    expect(Number(par(c, 'jarvis-jauge').getAttribute('aria-valuenow'))).toBeGreaterThan(30)
    expect(par(c, 'jarvis-verdict').textContent).toContain('je vous entends')
  })

  it('DIT qu’on parle dans le vide quand le micro ne rend rien', () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = MoteurFactice.instances.at(-1)!
    act(() => moteur.onniveau?.({ niveau: 0.0002, parle: false }))
    expect(par(c, 'jarvis-verdict').textContent).toContain('Aucun son détecté')
    expect(par(c, 'jarvis-jauge').getAttribute('data-verdict')).toBe('silence')
  })

  it('règle la sensibilité du moteur DÉJÀ en cours', () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    clic(c, 'jarvis-reglages-bascule')
    const curseur = par(c, 'jarvis-seuil') as HTMLInputElement
    // React garde un « value tracker » sur l'input : écrire `.value` le met à jour aussi, et React
    // conclurait qu'il n'y a pas eu de changement. On passe donc par le setter natif.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(curseur, '0.04')
      curseur.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(MoteurFactice.instances.at(-1)!.seuilParole).toBeCloseTo(0.04)
  })

  it('liste les micros disponibles, avec un libellé de repli', async () => {
    const c = rendre()
    clic(c, 'jarvis-reglages-bascule')
    await act(async () => {})
    const options = Array.from(par(c, 'jarvis-micro').querySelectorAll('option')).map(
      (o) => o.textContent
    )
    expect(options).toEqual(['Micro système par défaut', 'Casque USB', 'Micro 2'])
  })

  it('change de micro en rouvrant le flux sur le périphérique choisi', async () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    clic(c, 'jarvis-reglages-bascule')
    await act(async () => {})
    const select = par(c, 'jarvis-micro') as HTMLSelectElement
    act(() => {
      select.value = 'mic-a'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const moteur = MoteurFactice.instances.at(-1)!
    expect(moteur.peripherique).toBe('mic-a')
    expect(moteur.demarrages).toBeGreaterThan(1)
  })
})
