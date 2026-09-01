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
// Horloge FIGEE : un rendez-vous a "maintenant + 1 h" tombait le lendemain quand la suite
// tournait apres 23 h, et le test du jour echouait une heure par nuit. On ne lit plus l'heure reelle.
const CLOCK = new Date(2026, 7, 22, 10, 0, 0)
const NOW = CLOCK.getTime()
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

const NOW_MS = NOW

function outlookSnapshot() {
  return {
    ok: true,
    luLe: new Date(NOW_MS).toISOString(),
    boite: 'Boîte de réception',
    mailsNonLus: 3,
    mails: [
      {
        id: 'm1',
        adresse: 'julien.mercier@amitel.fr',
        nom: 'Julien Mercier',
        sujet: 'RE: bon de commande RIG',
        recuLe: new Date(NOW_MS - 600_000).toISOString(),
        nonLu: true,
        conversation: 'c1'
      },
      {
        id: 'm2',
        adresse: 'JULIEN.MERCIER@amitel.fr',
        nom: 'MERCIER Julien',
        sujet: 'Devis signé',
        recuLe: new Date(NOW_MS - 7200_000).toISOString(),
        nonLu: false,
        conversation: 'c2'
      },
      {
        id: 'm3',
        adresse: 'sophie.bernard@amitel.fr',
        nom: 'Sophie Bernard',
        sujet: 'Planning de la recette',
        recuLe: new Date(NOW_MS - 300_000).toISOString(),
        nonLu: false,
        conversation: 'c3'
      }
    ],
    evenements: [
      {
        id: 'e1',
        sujet: 'Recette EDI lot 3',
        lieu: 'salle de réunion',
        debut: new Date(NOW_MS + 3600_000).toISOString(),
        fin: new Date(NOW_MS + 7200_000).toISOString(),
        journeeEntiere: false,
        recurrent: false
      }
    ]
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(CLOCK)
  ;(window as unknown as { api: unknown }).api = {
    taskManagerSnapshot: vi.fn(async () => snapshot()),
    outlookSnapshot: vi.fn(async () => outlookSnapshot())
  }
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  window.localStorage.clear()
  vi.useRealTimers()
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
    for (const id of ['mails', 'agenda', 'routines', 'notifications', 'conversations']) {
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
    expect(children[0].textContent).toContain('Agenda')
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

  it('annonce l absence de passerelle au lieu d une liste vide', async () => {
    // Sans `api.outlookSnapshot`, les deux widgets doivent DIRE qu ils ne peuvent pas lire. Une liste
    // vide se lirait « vous n avez pas de mail », ce qui est faux.
    ;(window as unknown as { api: unknown }).api = {
      taskManagerSnapshot: vi.fn(async () => snapshot())
    }
    const container = await mount()
    expect(tile(container, 'mails').querySelector('.home-error')).not.toBeNull()
    expect(tile(container, 'mails').textContent).toContain('pas disponible')
    expect(tile(container, 'agenda').querySelector('.home-error')).not.toBeNull()
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

  it('ne REARRANGE pas toute la page quand on pose une tuile au bord droit', async () => {
    // Defaut constate le 2026-09-01 : glisser un widget vers le bord droit faisait deborder sa boite,
    // la reconciliation jugeait alors l agencement invalide et REMPLACAIT tout par la disposition
    // d origine. Un geste de l utilisateur ne doit jamais rejouer la mise en place automatique.
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const mails = tile(container, 'mails')
    await gesture(mails, [[520, 520]], [500, 500])
    const avantMails = boxOf(mails)
    await gesture(agenda, [[900, 300], [1600, 300], [2400, 300]], [400, 300])
    expect(boxOf(mails)).toEqual(avantMails)
    expect(boxOf(agenda).x).toBeGreaterThan(avantMails.x)
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
    const tuile = tile(container, 'conversations')
    const avant = Number(tuile.style.zIndex)
    await gesture(tuile, [[420, 220]], [400, 200])
    expect(Number(tuile.style.zIndex)).toBeGreaterThan(avant)
  })
})

describe('widgets Outlook', () => {
  it('regroupe les messages par interlocuteur, un fil par contact', async () => {
    const container = await mount()
    const mails = tile(container, 'mails')
    const fils = mails.querySelectorAll('.home-threads li')
    // Deux messages du meme contact sous deux graphies = UN fil, plus le second contact = 2 lignes.
    expect(fils.length).toBe(2)
    expect(mails.textContent).toContain('Julien Mercier')
    expect(mails.textContent).toContain('Sophie Bernard')
  })

  it('met le fil qui a du non lu en tete et affiche son compte', async () => {
    const container = await mount()
    const premier = tile(container, 'mails').querySelector('.home-threads li')!
    expect(premier.getAttribute('data-unread')).toBe('true')
    expect(premier.querySelector('.home-threads__tally')?.textContent).toBe('1')
  })

  it('porte le compte des non lus sur l etiquette de la tuile', async () => {
    const container = await mount()
    expect(tile(container, 'mails').querySelector('.home-tile__count')?.textContent).toBe('1')
  })

  it('affiche les rendez-vous du jour avec leur lieu, accents intacts', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    expect(agenda.textContent).toContain('Recette EDI lot 3')
    expect(agenda.textContent).toContain('salle de réunion')
  })

  it('met le PROCHAIN rendez-vous en tete du widget agenda', async () => {
    const container = await mount()
    const prochain = container.querySelector('[data-testid="home-agenda-prochain"]')
    expect(prochain).not.toBeNull()
    expect(prochain?.textContent).toContain('Recette EDI lot 3')
    expect(tile(container, 'agenda').textContent).toContain('Prochain')
  })

  it('affiche la cause quand la passerelle echoue', async () => {
    ;(window as unknown as { api: unknown }).api = {
      taskManagerSnapshot: vi.fn(async () => snapshot()),
      outlookSnapshot: vi.fn(async () => ({ ok: false, erreur: 'Outlook a refusé l’accès' }))
    }
    const container = await mount()
    expect(tile(container, 'mails').textContent).toContain('Outlook a refusé l’accès')
    expect(tile(container, 'agenda').textContent).toContain('Outlook a refusé l’accès')
  })

  it('ne lit pas Outlook quand la vue n est pas affichee', async () => {
    await mount(false)
    const api = (window as unknown as { api: { outlookSnapshot: ReturnType<typeof vi.fn> } }).api
    expect(api.outlookSnapshot).not.toHaveBeenCalled()
  })
})

describe('la disposition personnelle survit a un redimensionnement', () => {
  // Friction relevee le 2026-08-21 par un scout lance DANS Autowin, score 92, et c'etait un defaut
  // que j'avais introduit puis defendu : `reconcileLayout` remplacait la disposition ET elle etait
  // persistee aussitot. Passer une fois par une fenetre etroite -- ou deplacer la fenetre entre deux
  // ecrans -- detruisait l'agencement DEFINITIVEMENT.
  //
  // Le signal mesurable est celui que le scout a formule : reduire puis re-agrandir restaure
  // exactement les positions initiales.
  const largeur = (w: number, h: number): void => {
    ;(window as unknown as { innerWidth: number }).innerWidth = w
    ;(window as unknown as { innerHeight: number }).innerHeight = h
  }

  it('rend les positions au PIXEL apres reduction puis re-agrandissement', async () => {
    largeur(1440, 900)
    const container = await mount()
    const boites = (): Record<string, { x: number; y: number; w: number; h: number }> =>
      Object.fromEntries(
        ['mails', 'agenda', 'routines', 'notifications', 'conversations'].map((id) => [
          id,
          boxOf(tile(container, id))
        ])
      )
    const avant = boites()

    largeur(430, 900)
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    const pendant = boites()
    // La vue s'est bien adaptee : sinon le test ne prouverait rien. On observe la LARGEUR et non
    // l'abscisse -- le bloc etant colle a la marge gauche, `x` vaut la meme chose dans les deux
    // arrangements et ne temoignerait de rien.
    expect(pendant.mails.w).not.toBe(avant.mails.w)
    expect(pendant.mails.w).toBeLessThan(avant.mails.w)

    largeur(1440, 900)
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(boites()).toEqual(avant)
  })

  it('n ECRIT jamais la disposition compacte dans l enregistrement', async () => {
    largeur(1440, 900)
    const container = await mount()
    const agenda = tile(container, 'agenda')
    // Une position posee a la main, qui doit survivre a tout.
    await gesture(agenda, [[537, 341]], [500, 300])
    const enregistreApresGeste = window.localStorage.getItem(LAYOUT_KEY)

    largeur(430, 900)
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    // C'EST le coeur du defaut : le redimensionnement ne doit rien graver.
    expect(window.localStorage.getItem(LAYOUT_KEY)).toBe(enregistreApresGeste)
  })

  it('garde le geste de l utilisateur comme autorite, lui', async () => {
    largeur(1440, 900)
    const container = await mount()
    const avant = window.localStorage.getItem(LAYOUT_KEY)
    await gesture(tile(container, 'conversations'), [[700, 600]], [600, 500])
    // Un geste, contrairement a un redimensionnement, exprime une intention : il s enregistre.
    expect(window.localStorage.getItem(LAYOUT_KEY)).not.toBe(avant)
  })
})
