// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeView } from './HomeView'
import { autowinStorageKey } from '../storage-keys'

/**
 * Ce que la vue Accueil FAIT, par opposition à ce qu'elle affiche.
 *
 * Fichier séparé de `HomeView.test.tsx`, qui couvre le rendu et la pose des tuiles. Les frictions
 * réunies ici ont toutes la même racine, relevée le 2026-08-21 en pilotant l'app et par un scout
 * lancé dans Autowin : la vue informait puis renvoyait l'utilisateur ailleurs — ouvrir un mail,
 * solder une alerte, annuler un geste, se passer de souris, rien de tout cela n'était possible.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.now()
const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

function taskSnapshot(acquitte = false) {
  return {
    tasks: [{ id: 't1', title: 'Rapport du matin', enabled: true, nextRunAt: NOW + 600_000 }],
    alerts: [
      {
        id: 'al-1',
        taskId: 't1',
        kind: 'failed' as const,
        message: 'run rouge sur le rapport',
        createdAt: NOW - 60_000,
        ...(acquitte ? { acknowledgedAt: NOW } : {})
      }
    ]
  }
}

function outlookSnapshot(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    luLe: new Date(NOW).toISOString(),
    boite: 'Boîte de réception',
    mailsNonLus: 1,
    mails: [
      {
        id: 'm1',
        adresse: 'collegue@amitel.fr',
        nom: 'Collègue',
        sujet: 'RE: bon de commande',
        recuLe: new Date(NOW - 600_000).toISOString(),
        nonLu: true,
        conversation: 'c1'
      }
    ],
    evenements: [
      {
        id: 'e1',
        sujet: 'Recette EDI lot 3',
        lieu: 'salle de réunion',
        debut: new Date(NOW + 3600_000).toISOString(),
        fin: new Date(NOW + 7200_000).toISOString(),
        journeeEntiere: false,
        recurrent: false
      }
    ],
    adressesEchangees: ['collegue@amitel.fr'],
    ...over
  }
}

function poserApi(over: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: unknown }).api = {
    taskManagerSnapshot: vi.fn(async () => taskSnapshot()),
    taskManagerAcknowledge: vi.fn(async () => true),
    outlookSnapshot: vi.fn(async () => outlookSnapshot()),
    outlookOuvrir: vi.fn(async () => ({ ok: true })),
    ...over
  }
}

beforeEach(() => {
  ;(window as unknown as { innerWidth: number }).innerWidth = 1440
  ;(window as unknown as { innerHeight: number }).innerHeight = 900
  poserApi()
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  window.localStorage.clear()
})

async function mount(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(createElement(HomeView, { active: true }))
  })
  return container
}

/**
 * Les commandes de disposition vivent desormais DANS le panneau de reglages : un test qui les cherche
 * doit d'abord l'ouvrir, comme un utilisateur.
 */
async function ouvrirReglages(c: HTMLDivElement): Promise<void> {
  const bouton = c.querySelector('[data-testid="home-settings"]') as HTMLButtonElement
  if (c.querySelector('[data-testid="home-settings-panel"]') === null) {
    await act(async () => bouton.click())
  }
}

/** L'inverse : le panneau etant OUVERT d'office, c'est le fermer qui demande un clic. */
async function fermerReglages(c: HTMLDivElement): Promise<void> {
  const bouton = c.querySelector('[data-testid="home-settings"]') as HTMLButtonElement
  if (c.querySelector('[data-testid="home-settings-panel"]') !== null) {
    await act(async () => bouton.click())
  }
}

const tile = (c: HTMLDivElement, id: string): HTMLElement =>
  c.querySelector(`[data-testid="home-widget-${id}"]`) as HTMLElement

const api = (): Record<string, ReturnType<typeof vi.fn>> =>
  (window as unknown as { api: Record<string, ReturnType<typeof vi.fn>> }).api

function boxOf(el: HTMLElement): { x: number; y: number; w: number; h: number } {
  const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(el.style.transform)
  return {
    x: m ? Number(m[1]) : NaN,
    y: m ? Number(m[2]) : NaN,
    w: parseFloat(el.style.width),
    h: parseFloat(el.style.height)
  }
}

function pointer(type: string, x: number, y: number, target: EventTarget): void {
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

async function geste(el: Element, de: [number, number], vers: [number, number]): Promise<void> {
  await act(async () => pointer('pointerdown', de[0], de[1], el))
  await act(async () => pointer('pointermove', vers[0], vers[1], window))
  await act(async () => pointer('pointerup', vers[0], vers[1], window))
}

async function touche(el: Element, key: string, modifs: Partial<KeyboardEvent> = {}): Promise<void> {
  await act(async () => {
    const event = new Event('keydown', { bubbles: true, cancelable: true }) as Event &
      Record<string, unknown>
    event.key = key
    Object.assign(event, modifs)
    el.dispatchEvent(event)
  })
}

describe('la vue agit : ouvrir dans Outlook', () => {
  it('ouvre le message le plus recent d un fil', async () => {
    const container = await mount()
    const bouton = tile(container, 'mails').querySelector(
      '[data-testid^="home-ouvrir-mail-"]'
    ) as HTMLButtonElement
    expect(bouton).not.toBeNull()
    await act(async () => bouton.click())
    // On ouvre un ELEMENT, donc son identifiant, pas la cle du fil.
    expect(api().outlookOuvrir).toHaveBeenCalledWith('m1')
  })

  it('ouvre un rendez-vous', async () => {
    const container = await mount()
    const bouton = tile(container, 'agenda').querySelector(
      '[data-testid^="home-ouvrir-rdv-"]'
    ) as HTMLButtonElement
    await act(async () => bouton.click())
    expect(api().outlookOuvrir).toHaveBeenCalledWith('e1')
  })

  it('AFFICHE la cause quand Outlook refuse', async () => {
    // Un clic sans effet ET sans explication est pire que pas de clic du tout.
    poserApi({ outlookOuvrir: vi.fn(async () => ({ ok: false, erreur: 'Cet element n existe plus' })) })
    const container = await mount()
    await act(async () =>
      (container.querySelector('[data-testid^="home-ouvrir-mail-"]') as HTMLButtonElement).click()
    )
    expect(container.querySelector('.home-view__alerte')?.textContent).toContain('n existe plus')
  })

  it('le dit aussi quand la version de l app ne sait pas ouvrir', async () => {
    poserApi({ outlookOuvrir: undefined })
    const container = await mount()
    await act(async () =>
      (container.querySelector('[data-testid^="home-ouvrir-mail-"]') as HTMLButtonElement).click()
    )
    expect(container.querySelector('.home-view__alerte')).not.toBeNull()
  })
})

describe('la vue agit : solder une alerte', () => {
  it('acquitte depuis l accueil', async () => {
    const container = await mount()
    const bouton = container.querySelector(
      '[data-testid="home-acquitter-al-1"]'
    ) as HTMLButtonElement
    expect(bouton).not.toBeNull()
    await act(async () => bouton.click())
    expect(api().taskManagerAcknowledge).toHaveBeenCalledWith('al-1')
    // Relecture immediate : sans elle le compteur ne bougerait qu au bout de 30 s et le clic
    // paraitrait sans effet.
    expect(api().taskManagerSnapshot.mock.calls.length).toBeGreaterThan(1)
  })

  it('ne propose pas d acquitter ce qui l est deja', async () => {
    poserApi({ taskManagerSnapshot: vi.fn(async () => taskSnapshot(true)) })
    const container = await mount()
    expect(container.querySelector('[data-testid="home-acquitter-al-1"]')).toBeNull()
  })
})

describe('annuler un geste', () => {
  it('est desactive tant qu il n y a rien a defaire', async () => {
    const container = await mount()
    await ouvrirReglages(container)
    expect((container.querySelector('[data-testid="home-undo"]') as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('rend la boite precedente AU PIXEL apres un deplacement', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const avant = boxOf(agenda)
    await geste(agenda, [500, 300], [537, 341])
    expect(boxOf(agenda)).not.toEqual(avant)
    await ouvrirReglages(container)
    const undo = container.querySelector('[data-testid="home-undo"]') as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    await act(async () => undo.click())
    expect(boxOf(agenda)).toEqual(avant)
  })

  it('defait une dispersion SANS effacer les ajustements volontaires', async () => {
    // C est tout l objet de la friction : « Retablir » etait le seul recours, et il effacait tout.
    const container = await mount()
    const agenda = tile(container, 'agenda')
    await geste(agenda, [500, 300], [560, 380])
    const poseeALaMain = boxOf(agenda)
    await ouvrirReglages(container)
    const disperser = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Disperser'
    )!
    await act(async () => disperser.click())
    expect(boxOf(agenda)).not.toEqual(poseeALaMain)
    await act(async () =>
      (container.querySelector('[data-testid="home-undo"]') as HTMLButtonElement).click()
    )
    expect(boxOf(agenda)).toEqual(poseeALaMain)
  })

  it('defait aussi un « Retablir la disposition »', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    await geste(agenda, [500, 300], [560, 380])
    const posee = boxOf(agenda)
    await ouvrirReglages(container)
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('Rétablir')
        ) as HTMLButtonElement
      ).click()
    )
    expect(boxOf(agenda)).not.toEqual(posee)
    await act(async () =>
      (container.querySelector('[data-testid="home-undo"]') as HTMLButtonElement).click()
    )
    expect(boxOf(agenda)).toEqual(posee)
  })
})

describe('piloter une tuile au clavier', () => {
  it('deplace avec les fleches, sans toucher a la taille', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const avant = boxOf(agenda)
    await touche(agenda, 'ArrowRight')
    await touche(agenda, 'ArrowDown')
    const apres = boxOf(agenda)
    expect(apres.x).toBe(avant.x + 16)
    expect(apres.y).toBe(avant.y + 16)
    expect(apres.w).toBe(avant.w)
  })

  it('redimensionne avec Maj, sans deplacer l origine', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const avant = boxOf(agenda)
    await touche(agenda, 'ArrowRight', { shiftKey: true })
    const apres = boxOf(agenda)
    expect(apres.w).toBe(avant.w + 16)
    expect(apres.x).toBe(avant.x)
  })

  it('laisse Ctrl aux raccourcis de navigation de l app', async () => {
    // Ctrl+chiffre change de vue dans Autowin : la vue ne doit pas s approprier ce modificateur.
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const avant = boxOf(agenda)
    await touche(agenda, 'ArrowRight', { ctrlKey: true })
    expect(boxOf(agenda)).toEqual(avant)
  })

  it('rend la tuile atteignable au clavier et annonce ce qu on peut y faire', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    expect(agenda.getAttribute('tabindex')).toBe('0')
    expect(agenda.getAttribute('aria-label')).toContain('flèches')
  })

  it('un geste au clavier s annule comme un geste a la souris', async () => {
    const container = await mount()
    const agenda = tile(container, 'agenda')
    const avant = boxOf(agenda)
    await touche(agenda, 'ArrowRight')
    await ouvrirReglages(container)
    await act(async () =>
      (container.querySelector('[data-testid="home-undo"]') as HTMLButtonElement).click()
    )
    expect(boxOf(agenda)).toEqual(avant)
  })
})

describe('le compteur des mails compte les personnes', () => {
  it('ignore le bruit machine, et garde le total dans l infobulle', async () => {
    // Mesure sur la vraie boite : 85 des 106 non lus venaient d un SEUL robot. Un compteur ecrase par
    // un automate n alerte jamais.
    poserApi({
      outlookSnapshot: vi.fn(async () =>
        outlookSnapshot({
          mails: [
            {
              id: 'p1',
              adresse: 'collegue@amitel.fr',
              nom: 'Collegue',
              sujet: 'Question',
              recuLe: new Date(NOW).toISOString(),
              nonLu: true,
              conversation: 'c'
            },
            ...Array.from({ length: 40 }, (_, i) => ({
              id: `r${i}`,
              adresse: 'robot@notifications.example',
              nom: 'Robot',
              sujet: 'Ping',
              recuLe: new Date(NOW - i * 1000).toISOString(),
              nonLu: true,
              conversation: 'r'
            }))
          ]
        })
      )
    })
    const container = await mount()
    const badge = tile(container, 'mails').querySelector('.home-tile__count')!
    expect(badge.textContent).toBe('1')
    expect(badge.getAttribute('title')).toContain('41 au total')
  })

  it('compte tout quand la distinction est impossible', async () => {
    // `null` veut dire « je n ai pas pu savoir » : masquer alors les non lus cacherait de vrais
    // messages.
    poserApi({
      outlookSnapshot: vi.fn(async () => outlookSnapshot({ adressesEchangees: null }))
    })
    const container = await mount()
    expect(tile(container, 'mails').querySelector('.home-tile__count')?.textContent).toBe('1')
  })
})

describe('la notice d usage s efface', () => {
  it('disparait apres quelques ouvertures, et reste rappelable', async () => {
    window.localStorage.setItem(autowinStorageKey('home.notice-vue.v1'), '12')
    const container = await mount()
    expect(container.querySelector('.home-view__masthead p')).toBeNull()
    await ouvrirReglages(container)
    const rappel = container.querySelector('[data-testid="home-rappel-notice"]') as HTMLButtonElement
    expect(rappel).not.toBeNull()
    // Effacer une aide SANS moyen de la revoir echangerait une friction contre une autre.
    await act(async () => rappel.click())
    expect(container.querySelector('.home-view__masthead p')?.textContent).toContain('posez-la')
  })

  it('reste visible les premieres fois', async () => {
    const container = await mount()
    expect(container.querySelector('.home-view__masthead p')?.textContent).toContain('posez-la')
    // L'aide n'encombre pas l'en-tete : son rappel est range DANS les reglages -- panneau ouvert
    // d'office depuis le 2026-09-01, donc il est la, mais dans le panneau et nulle part ailleurs.
    const panneau = container.querySelector('[data-testid="home-settings-panel"]') as HTMLElement
    const rappel = container.querySelector('[data-testid="home-rappel-notice"]')
    expect(panneau.contains(rappel)).toBe(true)
    await fermerReglages(container)
    expect(container.querySelector('[data-testid="home-rappel-notice"]')).toBeNull()
  })
})

describe('la tuile des conversations remplace le hublot', () => {
  it('annonce la liste vide au lieu d une horloge', async () => {
    const container = await mount()
    const tuile = tile(container, 'conversations')
    expect(tuile.querySelector('.home-hublot__heure')).toBeNull()
    expect(tuile.textContent).toContain('Aucune conversation en attente')
  })
})
