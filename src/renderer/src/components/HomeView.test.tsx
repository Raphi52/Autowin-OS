// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeView } from './HomeView'
import { autowinStorageKey } from '../storage-keys'
import { defaultHomeLayout, parseHomeLayout } from './home-layout'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const LAYOUT_KEY = autowinStorageKey('home.layout.v1')
const NOW = Date.now()
const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

function snapshot() {
  return {
    tasks: [
      { id: 't-matin', title: 'Rapport du matin', enabled: true, nextRunAt: NOW + 12 * 60_000 },
      { id: 't-off', title: 'Nettoyage', enabled: false, nextRunAt: NOW + 3 * 3600_000 },
      { id: 't-event', title: 'Watchdog rouge', enabled: true, nextRunAt: null, watchdog: {} }
    ],
    alerts: [
      {
        id: 'al-1',
        taskId: 't-matin',
        kind: 'failed' as const,
        message: 'run rouge sur le rapport',
        createdAt: NOW - 60_000
      }
    ]
  }
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = { taskManagerSnapshot: vi.fn(async () => snapshot()) }
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  window.localStorage.clear()
})

async function mount(active = true): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(createElement(HomeView, { active }))
  })
  return container
}

function tile(container: HTMLDivElement, id: string): HTMLElement {
  return container.querySelector(`[data-testid="home-widget-${id}"]`) as HTMLElement
}

/** Un geste complet : prise, déplacements, lâcher. `on` est l'élément qu'on saisit. */
async function gesture(
  on: Element,
  steps: Array<[number, number]>,
  start: [number, number]
): Promise<void> {
  const fire = (type: string, x: number, y: number, target: EventTarget): void => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
      clientX: number
      clientY: number
      pointerId: number
    }
    event.clientX = x
    event.clientY = y
    event.pointerId = 1
    target.dispatchEvent(event)
  }
  await act(async () => fire('pointerdown', start[0], start[1], on))
  for (const [x, y] of steps) {
    await act(async () => fire('pointermove', x, y, window))
  }
  const [lastX, lastY] = steps[steps.length - 1] ?? start
  await act(async () => fire('pointerup', lastX, lastY, window))
}

function boxOf(el: HTMLElement): { x: number; y: number; w: number; h: number } {
  const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(el.style.transform)
  return {
    x: match ? Number(match[1]) : NaN,
    y: match ? Number(match[2]) : NaN,
    w: parseFloat(el.style.width),
    h: parseFloat(el.style.height)
  }
}

describe('page d accueil', () => {
  it('affiche les cinq widgets', async () => {
    const container = await mount()
    for (const id of ['mails', 'agenda', 'routines', 'notifications', 'hublot']) {
      expect(tile(container, id)).not.toBeNull()
    }
  })

  it('porte le titre AU-DESSUS du panneau, jamais dedans', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const children = Array.from(agenda.children)
    // L'étiquette est un frère du panneau, et vient avant lui : c'est la structure exigée.
    expect(children[0].className).toContain('home-tile__label')
    expect(children[1].className).toContain('home-tile__panel')
    expect(children[1].querySelector('.home-tile__label')).toBeNull()
    expect(children[0].textContent).toContain('Agenda du jour')
  })

  it('liste les departs des routines horaires, sans la tache reveillee par evenement', async () => {
    const container = await mount()
    const routines = tile(container, 'routines')
    expect(routines.textContent).toContain('Rapport du matin')
    expect(routines.textContent).toContain('dans 12 min')
    expect(routines.textContent).toContain('désactivée')
    expect(routines.textContent).not.toContain('Watchdog rouge')
  })

  it('affiche la remontee de l agent et son compteur', async () => {
    const container = await mount()
    const notifications = tile(container, 'notifications')
    expect(notifications.textContent).toContain('run rouge sur le rapport')
    expect(notifications.querySelector('.home-tile__count')?.textContent).toBe('1')
  })

  it('n invente aucun mail en attendant la passerelle Outlook', async () => {
    const container = await mount()
    expect(tile(container, 'mails').textContent).toContain('passerelle Outlook')
    expect(tile(container, 'agenda').textContent).toContain('passerelle Outlook')
  })

  it('annonce la panne au lieu d afficher une liste vide trompeuse', async () => {
    ;(window as unknown as { api: unknown }).api = {
      taskManagerSnapshot: vi.fn(async () => {
        throw new Error('IPC coupé')
      })
    }
    const container = await mount()
    expect(tile(container, 'routines').textContent).toContain('IPC coupé')
  })

  it('ne lit pas le Task Manager quand la vue n est pas affichee', async () => {
    await mount(false)
    const api = (window as unknown as { api: { taskManagerSnapshot: ReturnType<typeof vi.fn> } }).api
    expect(api.taskManagerSnapshot).not.toHaveBeenCalled()
  })
})

describe('poser une tuile', () => {
  it('deplace exactement du geste, et la tuile ne derive pas apres le lacher', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const before = boxOf(agenda)
    await gesture(agenda, [[540, 260], [560, 280], [583, 297]], [500, 250])
    const posee = boxOf(agenda)
    expect(posee.x - before.x).toBe(83)
    expect(posee.y - before.y).toBe(47)
    // Le lâcher est déjà consommé ; rien ne doit plus bouger ensuite.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 60))
    })
    expect(boxOf(agenda)).toEqual(posee)
  })

  it('applique la position SANS attendre une image d animation', async () => {
    // Défaut mesuré sur prototype : quand la transformée n'était écrite que par la boucle de rendu,
    // « réduire les animations » ou une fenêtre en arrière-plan rendait les tuiles immobiles.
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const before = boxOf(agenda)
    const fire = (type: string, x: number, y: number, target: EventTarget): void => {
      const event = new Event(type, { bubbles: true }) as Event & {
        clientX: number
        clientY: number
        pointerId: number
      }
      event.clientX = x
      event.clientY = y
      event.pointerId = 1
      target.dispatchEvent(event)
    }
    await act(async () => fire('pointerdown', 500, 250, agenda))
    await act(async () => fire('pointermove', 530, 250, window))
    // Aucun `requestAnimationFrame` n'a été laissé tourner entre les deux : la position est déjà là.
    expect(boxOf(agenda).x - before.x).toBe(30)
    await act(async () => fire('pointerup', 530, 250, window))
  })

  it('redimensionne au pixel par le coin, sans elasticite', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const before = boxOf(agenda)
    const grip = container.querySelector('[data-testid="home-grip-agenda-se"]')!
    await gesture(grip, [[500, 400], [560, 460]], [400, 300])
    const grandi = boxOf(agenda)
    expect(grandi.w - before.w).toBe(160)
    expect(grandi.h - before.h).toBe(160)
    expect(grandi.x).toBe(before.x)
    expect(grandi.y).toBe(before.y)
  })

  it('deplace l origine quand on tire le bord ouest', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const before = boxOf(agenda)
    const grip = container.querySelector('[data-testid="home-grip-agenda-w"]')!
    await gesture(grip, [[350, 300]], [400, 300])
    const elargi = boxOf(agenda)
    expect(elargi.x).toBe(before.x - 50)
    expect(elargi.w).toBe(before.w + 50)
    // Le bord est n'a pas bougé.
    expect(elargi.x + elargi.w).toBe(before.x + before.w)
  })

  it('enregistre la disposition posee et la relit au montage suivant', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    await gesture(agenda, [[437, 187]], [400, 200])
    const posee = boxOf(agenda)
    const relu = parseHomeLayout(JSON.parse(window.localStorage.getItem(LAYOUT_KEY)!))
    expect(relu.find((entry) => entry.id === 'agenda')).toMatchObject({
      x: posee.x,
      y: posee.y
    })
  })

  it('retablit la disposition par defaut sur demande', async () => {
    const container = await mount()
    await gesture(tile(container, 'agenda'), [[600, 500]], [400, 200])
    const reset = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Rétablir')
    )!
    await act(async () => reset.click())
    // La disposition d'origine depend de la SURFACE : on la compare a celle de la meme fenetre, pas
    // a une reference 1440x900 que le composant n'a jamais vue.
    expect(JSON.parse(window.localStorage.getItem(LAYOUT_KEY)!)).toEqual(
      defaultHomeLayout({ width: window.innerWidth, height: window.innerHeight })
    )
  })

  it('remonte la tuile saisie au-dessus des autres', async () => {
    const container = await mount()
    const hublot = tile(container, 'hublot')
    const avant = Number(hublot.style.zIndex)
    await gesture(hublot, [[420, 220]], [400, 200])
    expect(Number(hublot.style.zIndex)).toBeGreaterThan(avant)
  })
})
