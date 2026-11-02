// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ABSENCE_MS,
  AnimationAccueilChat,
  COUCOU_MS,
  ENDORMISSEMENT_MS,
  PAUSE_PHRASE_MS
} from './AnimationAccueilChat'
import { teaserVu, VITESSE_AU_TRAVAIL } from './teaser-accueil-calcul'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// La cadence a ses propres tests (`accueil-cadence.test.ts`) : ce banc n'a pas de vraies animations.
vi.mock('./accueil-cadence', () => ({ prendreLaMain: () => [], avancerLesPistes: () => {} }))

type Props = ComponentProps<typeof AnimationAccueilChat>

const PHRASES = ['Ouvre le graphe', 'Mets le juge sur codex']
const USAGES = [
  { nom: '/draft', usage: 'six versions' },
  { nom: '/scout', usage: 'ce projet' }
]
const texteDe = (u: { nom: string; usage: string }): string => `${u.nom}${u.usage}`
const montes: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

function monter(partiel: Partial<Props> = {}): {
  container: HTMLDivElement
  rendre: (suite: Partial<Props>) => void
} {
  const props: Props = {
    libelle: 'Parle à l’agent',
    detail: 'Il répond et agit',
    phrases: PHRASES,
    usages: USAGES,
    agentsAuTravail: 0,
    saisieRemplie: false,
    actif: true,
    onChoisir: () => {},
    ...partiel
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  montes.push({ root, container })
  const rendre = (suite: Partial<Props>): void => {
    act(() => root.render(createElement(AnimationAccueilChat, { ...props, ...suite })))
  }
  rendre({})
  return { container, rendre }
}

/**
 * Par tranches d'un cran : chaque lettre arme son minuteur après le rendu de la précédente, et React
 * ne rend qu'à la fin d'un `act`. Une seule grande avance n'écrirait qu'une lettre.
 */
const avancer = (ms: number): void => {
  for (let reste = ms; reste > 0; reste -= 100) {
    act(() => {
      vi.advanceTimersByTime(Math.min(reste, 100))
    })
  }
}
const racine = (c: HTMLElement): HTMLElement => c.querySelector('.accueil-anim') as HTMLElement
const phrase = (c: HTMLElement): HTMLButtonElement =>
  c.querySelector('.aa-phrase') as HTMLButtonElement
/** Ce qui est écrit à l'écran, à la différence du nom complet donné par `aria-label`. */
const ecrit = (c: HTMLElement): string => phrase(c).textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers()
  // L'intro a son propre bloc de tests : partout ailleurs, elle a déjà été vue.
  teaserVu.intro = true
})

afterEach(() => {
  for (const { root, container } of montes.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AnimationAccueilChat — le teaser', () => {
  const boucle = (c: HTMLElement): HTMLVideoElement =>
    c.querySelector('video:not(.at-intro)') as HTMLVideoElement
  const intro = (c: HTMLElement): HTMLVideoElement | null => c.querySelector('video.at-intro')

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  it('joue l’intro une seule fois : la phrase arrive à sa fin', () => {
    teaserVu.intro = false
    const { container } = monter()
    expect(intro(container)).not.toBeNull()
    expect(racine(container).classList.contains('en-intro')).toBe(true)

    act(() => {
      intro(container)?.dispatchEvent(new Event('ended'))
    })
    expect(intro(container)).toBeNull()
    expect(racine(container).classList.contains('en-intro')).toBe(false)

    const second = monter()
    expect(intro(second.container)).toBeNull()
  })

  it('une intro illisible ne bloque pas l’accueil', () => {
    teaserVu.intro = false
    const { container } = monter()
    act(() => {
      intro(container)?.dispatchEvent(new Event('error'))
    })
    expect(racine(container).classList.contains('en-intro')).toBe(false)
  })

  it('la boucle tourne en muet, sans fin, et ne s’arrête qu’après une vraie absence', () => {
    const lecture = vi.mocked(HTMLMediaElement.prototype.play)
    const pause = vi.mocked(HTMLMediaElement.prototype.pause)
    const { container } = monter()
    expect(boucle(container).muted).toBe(true)
    expect(boucle(container).loop).toBe(true)
    expect(lecture).toHaveBeenCalledTimes(1)

    // « faut que ca soit tout le temps waouh » : le film ne s'endort pas avec la mascotte.
    avancer(ENDORMISSEMENT_MS + 10)
    expect(pause).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(ABSENCE_MS)
    })
    expect(pause).toHaveBeenCalledTimes(1)
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(lecture).toHaveBeenCalledTimes(2)
  })

  it('un agent au travail garde le film vivant, même après une longue absence', () => {
    const pause = vi.mocked(HTMLMediaElement.prototype.pause)
    monter({ agentsAuTravail: 1 })
    act(() => {
      vi.advanceTimersByTime(ABSENCE_MS + 10)
    })
    expect(pause).not.toHaveBeenCalled()
  })

  it('hors du Chat, la vidéo est à l’arrêt', () => {
    const lecture = vi.mocked(HTMLMediaElement.prototype.play)
    monter({ actif: false })
    expect(lecture).not.toHaveBeenCalled()
  })

  it('fenêtre cachée : la vidéo s’arrête, et repart à son retour', () => {
    const pause = vi.mocked(HTMLMediaElement.prototype.pause)
    const lecture = vi.mocked(HTMLMediaElement.prototype.play)
    monter()
    const etat = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(pause).toHaveBeenCalledTimes(1)
    etat.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(lecture).toHaveBeenCalledTimes(2)
  })

  it('quand un agent travaille, le temps s’accélère', () => {
    const { container, rendre } = monter()
    expect(boucle(container).playbackRate).toBe(1)
    rendre({ agentsAuTravail: 2 })
    expect(boucle(container).playbackRate).toBe(VITESSE_AU_TRAVAIL)
    rendre({ agentsAuTravail: 0 })
    expect(boucle(container).playbackRate).toBe(1)
  })

  it('sur le film, ni mascotte ni sol : le magicien de la vidéo tient son rôle', async () => {
    const mascottePage = vi.fn()
    ;(window as unknown as { api: unknown }).api = { mascottePage }
    const { container } = monter()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.querySelector('.am-perso')).toBeNull()
    expect(container.querySelector('.as-sceau')).toBeNull()
    expect(mascottePage).not.toHaveBeenCalled()
    expect(phrase(container)).not.toBeNull()
    delete (window as unknown as { api?: unknown }).api
  })

  describe('les phrases invoquées par le cercle', () => {
    let tempsVideo = 0
    const invoquee = (c: HTMLElement): HTMLButtonElement | null => c.querySelector('.at-phrase')
    const allerA = (temps: number): void => {
      tempsVideo = temps
      avancer(200)
    }

    beforeEach(() => {
      tempsVideo = 0
      // happy-dom ne met rien en page : sans hauteur, l'accueil se croirait sans film.
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(559)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(790)
      vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(
        () => tempsVideo
      )
    })

    it('une phrase sort du cercle à chaque temps du film, puis se dissipe', () => {
      const { container } = monter()
      expect(racine(container).classList.contains('avec-decor')).toBe(true)
      expect(invoquee(container)).toBeNull()

      allerA(1.2)
      expect(invoquee(container)?.textContent).toBe(texteDe(USAGES[0]))
      allerA(5.5)
      expect(invoquee(container)?.classList.contains('at-sort')).toBe(true)
      allerA(6)
      expect(invoquee(container)).toBeNull()

      allerA(11.2)
      expect(invoquee(container)?.textContent).toBe(texteDe(USAGES[1]))
    })

    it('chaque lettre vient du cercle, sans couper ni mot ni emoji', () => {
      const { container } = monter({ usages: [{ nom: '/look', usage: 'ça 😀' }] })
      allerA(1.5)
      const lettres = [...container.querySelectorAll<HTMLElement>('.at-lettre')]
      expect(lettres.map((l) => l.textContent)).toEqual([...'/lookça', '😀'])
      expect(container.querySelector('.at-nom')?.textContent).toBe('/look')
      expect(container.querySelector('.at-usage')?.textContent).toBe('ça 😀')
      expect(invoquee(container)?.getAttribute('aria-label')).toBe('/look ça 😀')
      // Mesurées au montage : la zone fait 790 px, et happy-dom pose tout en 0.
      expect(lettres[0].style.getPropertyValue('--de-x')).toBe('395px')
      expect(lettres[0].style.getPropertyValue('--de-y')).toMatch(/^-\d+px$/)
      // De plus en plus tard : elles sortent l'une après l'autre.
      expect(lettres[1].style.getPropertyValue('--retard')).toBe('24ms')
      expect(container.querySelector('.aa-barre')).toBeNull()
    })

    it('un clic donne la phrase entière', () => {
      const onChoisir = vi.fn()
      const { container } = monter({ onChoisir })
      allerA(1.5)
      act(() => invoquee(container)?.click())
      expect(onChoisir).toHaveBeenCalledWith('/draft six versions')
    })

    it('sous le pointeur, elle reste, même quand le film passe à la suivante', () => {
      const { container } = monter()
      allerA(1.5)
      act(() => {
        invoquee(container)?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
      })
      allerA(6)
      expect(invoquee(container)?.textContent).toBe(texteDe(USAGES[0]))
      allerA(11.5)
      expect(invoquee(container)?.textContent).toBe(texteDe(USAGES[0]))
      expect(invoquee(container)?.classList.contains('at-sort')).toBe(false)
    })

    it('rien pendant l’intro, et aucune phrase quand un brouillon est en cours', () => {
      teaserVu.intro = false
      const { container } = monter()
      allerA(1.5)
      expect(invoquee(container)).toBeNull()

      // `phrases` vide : un brouillon est en cours, le film se tait.
      const brouillon = monter({ phrases: [] })
      allerA(1.5)
      expect(invoquee(brouillon.container)).toBeNull()
    })
  })

  it('une vidéo illisible rend la main à la mascotte et au sol magique', async () => {
    ;(window as unknown as { api: unknown }).api = {
      mascottePage: vi.fn().mockResolvedValue({
        html: '<!doctype html><html><head></head><body></body></html>',
        largeur: 128,
        hauteur: 124
      }),
      mascotteFeuilleAccueil: vi.fn().mockResolvedValue('')
    }
    const { container } = monter()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      boucle(container).dispatchEvent(new Event('error'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.querySelector('.at-decor')).toBeNull()
    expect(container.querySelector('.as-sceau')).not.toBeNull()
    expect(container.querySelector('.am-perso')).not.toBeNull()
    delete (window as unknown as { api?: unknown }).api
  })
})

describe('AnimationAccueilChat — la phrase qui s’écrit', () => {
  it('écrit la phrase lettre à lettre, puis passe à la suivante', () => {
    const { container } = monter()
    expect(ecrit(container)).toBe('')
    avancer(500)
    const debut = ecrit(container)
    expect(debut.length).toBeGreaterThan(0)
    expect(PHRASES[0].startsWith(debut)).toBe(true)
    expect(debut.length).toBeLessThan(PHRASES[0].length)

    avancer(PHRASES[0].length * 100)
    expect(ecrit(container)).toBe(PHRASES[0])
    avancer(PAUSE_PHRASE_MS + 200)
    expect(phrase(container).getAttribute('aria-label')).toBe(PHRASES[1])
  })

  it('un clic donne la phrase ENTIÈRE, même à moitié écrite', () => {
    const onChoisir = vi.fn()
    const { container } = monter({ onChoisir })
    avancer(300)
    expect(ecrit(container)).not.toBe(PHRASES[0])
    act(() => phrase(container).click())
    expect(onChoisir).toHaveBeenCalledTimes(1)
    expect(onChoisir).toHaveBeenCalledWith(PHRASES[0])
  })

  it('sous le pointeur, la phrase se montre entière et ne s’en va plus', () => {
    const { container } = monter()
    avancer(300)
    act(() => {
      phrase(container).dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    })
    expect(ecrit(container)).toBe(PHRASES[0])
    avancer(PAUSE_PHRASE_MS * 3)
    expect(phrase(container).getAttribute('aria-label')).toBe(PHRASES[0])
    expect(ecrit(container)).toBe(PHRASES[0])
  })

  it('n’affiche aucune phrase quand il n’y en a pas (brouillon en cours)', () => {
    const { container } = monter({ phrases: [] })
    avancer(1000)
    expect(phrase(container)).toBeNull()
  })

  it('ne coupe pas un emoji en deux', () => {
    const { container } = monter({ phrases: ['😀😀😀😀😀😀'] })
    avancer(300)
    expect(ecrit(container)).toMatch(/^(😀)+$/u)
  })
})

describe('AnimationAccueilChat — la mascotte', () => {
  it('fait coucou en arrivant, puis se calme', () => {
    const { container } = monter()
    expect(racine(container).classList.contains('est-coucou')).toBe(true)
    avancer(COUCOU_MS + 10)
    expect(racine(container).classList.contains('est-eveil')).toBe(true)
  })

  it('lit dès que la saisie contient du texte', () => {
    const { container, rendre } = monter()
    rendre({ saisieRemplie: true })
    expect(racine(container).classList.contains('est-lecture')).toBe(true)
  })

  it('s’endort sans activité : la phrase se fige, entière', () => {
    const { container } = monter()
    avancer(ENDORMISSEMENT_MS + 10)
    expect(racine(container).classList.contains('est-sommeil')).toBe(true)

    const figee = phrase(container).getAttribute('aria-label')
    expect(ecrit(container)).toBe(figee)
    expect(container.querySelector('.aa-barre')).toBeNull()
    avancer(ENDORMISSEMENT_MS)
    expect(phrase(container).getAttribute('aria-label')).toBe(figee)
  })

  it('un geste retarde le sommeil', () => {
    const { container } = monter()
    avancer(ENDORMISSEMENT_MS - 1000)
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    avancer(ENDORMISSEMENT_MS - 1000)
    expect(racine(container).classList.contains('est-sommeil')).toBe(false)
    avancer(1100)
    expect(racine(container).classList.contains('est-sommeil')).toBe(true)
  })

  it('se réveille au moindre geste, et refait coucou', () => {
    const { container } = monter()
    avancer(ENDORMISSEMENT_MS + 10)
    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(racine(container).classList.contains('est-coucou')).toBe(true)
    avancer(ENDORMISSEMENT_MS + 10)
    expect(racine(container).classList.contains('est-sommeil')).toBe(true)
  })

  it('ne laisse aucun écouteur après son démontage', () => {
    const retraits = vi.spyOn(window, 'removeEventListener')
    const { container } = monter()
    const monte = montes.pop()
    act(() => monte?.root.unmount())
    container.remove()
    const noms = retraits.mock.calls.map(([nom]) => nom)
    expect(noms).toEqual(expect.arrayContaining(['pointermove', 'pointerdown', 'keydown']))
    retraits.mockRestore()
  })
})

describe('AnimationAccueilChat — la vraie mascotte', () => {
  const page = {
    html: '<!doctype html><html><head><title>m</title></head><body></body></html>',
    largeur: 128,
    hauteur: 124
  }
  const brancher = (): { mascottePage: ReturnType<typeof vi.fn> } => {
    const mascottePage = vi.fn().mockResolvedValue(page)
    ;(window as unknown as { api: unknown }).api = {
      mascottePage,
      mascotteFeuilleAccueil: vi.fn().mockResolvedValue('')
    }
    return { mascottePage }
  }
  const attendrePage = async (): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  /** La mascotte ne revient que si le film ne se lit pas. */
  const monterSansFilm = (): ReturnType<typeof monter> => {
    const monte = monter()
    act(() => {
      monte.container.querySelector('video')?.dispatchEvent(new Event('error'))
    })
    return monte
  }

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('montre la page même de la mascotte, en grand, sans script et sans clic', async () => {
    brancher()
    const { container } = monterSansFilm()
    await attendrePage()
    const cadre = container.querySelector('iframe.am-cadre') as HTMLIFrameElement
    expect(cadre.getAttribute('srcdoc')).toContain('<title>m</title>')
    // Le jeton qui compte : sans `allow-scripts`, la page ne peut rien exécuter.
    expect(cadre.getAttribute('sandbox')).toBe('allow-same-origin')
    const perso = container.querySelector('.am-perso') as HTMLElement
    expect(perso.style.width).toBe('256px')
    expect(perso.style.height).toBe('248px')
  })

  it('relit la page au retour sur le Chat : le style a pu changer en Settings', async () => {
    const { mascottePage } = brancher()
    const { rendre } = monterSansFilm()
    await attendrePage()
    expect(mascottePage).toHaveBeenCalledTimes(1)
    rendre({ actif: false })
    await attendrePage()
    expect(mascottePage).toHaveBeenCalledTimes(1)
    rendre({ actif: true })
    await attendrePage()
    expect(mascottePage).toHaveBeenCalledTimes(2)
  })

  it('sans pont vers le moteur, pas de mascotte ni de sol, et la phrase reste', () => {
    const { container } = monterSansFilm()
    expect(container.querySelector('.am-perso')).toBeNull()
    expect(container.querySelector('.as-sceau')).toBeNull()
    expect(phrase(container)).not.toBeNull()
  })

  it('pose le vrai cercle de runes sous ses pieds', async () => {
    brancher()
    const { container } = monterSansFilm()
    await attendrePage()
    const sol = container.querySelector('.as-sceau') as SVGElement
    expect(sol.querySelectorAll('.ge .gp path')).toHaveLength(24)
    expect(sol.querySelector('.gi')).not.toBeNull()
    // Avant la mascotte dans la page : il passe derrière elle, jamais devant.
    const position = sol.compareDocumentPosition(container.querySelector('.am-perso') as Element)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('une onde accompagne son coucou, puis le sol ne bouge plus', async () => {
    brancher()
    const { container } = monterSansFilm()
    await attendrePage()
    expect(container.querySelectorAll('.as-onde')).toHaveLength(3)
    avancer(COUCOU_MS + 100)
    expect(container.querySelectorAll('.as-onde')).toHaveLength(0)
  })

  it('une onde repart quand un agent démarre, pas quand il finit', async () => {
    brancher()
    const { container, rendre } = monterSansFilm()
    await attendrePage()
    avancer(COUCOU_MS + 100)

    rendre({ agentsAuTravail: 1 })
    expect(container.querySelectorAll('.as-onde')).toHaveLength(3)
    avancer(COUCOU_MS + 100)
    expect(container.querySelectorAll('.as-onde')).toHaveLength(0)

    rendre({ agentsAuTravail: 0 })
    expect(container.querySelectorAll('.as-onde')).toHaveLength(0)
  })

  it('la couronne ne tourne qu’au travail, et seulement sur le Chat', async () => {
    brancher()
    const { container, rendre } = monterSansFilm()
    await attendrePage()
    expect(racine(container).classList.contains('avec-agents')).toBe(false)
    rendre({ agentsAuTravail: 2 })
    expect(racine(container).classList.contains('avec-agents')).toBe(true)
    rendre({ agentsAuTravail: 2, actif: false })
    expect(racine(container).classList.contains('avec-agents')).toBe(false)
  })

  it('hors du Chat, la phrase ne s’écrit plus', () => {
    const { container } = monter({ actif: false })
    expect(ecrit(container)).toBe(PHRASES[0])
    avancer(PAUSE_PHRASE_MS * 3)
    expect(phrase(container).getAttribute('aria-label')).toBe(PHRASES[0])
  })
})
