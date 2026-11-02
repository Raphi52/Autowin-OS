// @vitest-environment happy-dom
/**
 * conv-951 : vue « Bureaux cachés ». Cas limites du cadrage : aucun bureau, liste illisible, bureau
 * sans fiche, fermeture répétée, saisie invalide refusée sans lancement, identifiant occupé.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HdeskGestionView, type HdeskGestionApi } from './HdeskGestionView'
import {
  CREATION_ATTENTE_MS,
  type BureauGere,
  type ResultatCreationBureau,
  type ResultatFermetureGeree
} from '../../../shared/hdesk-gestion'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ZOX: BureauGere = {
  id: 'zox',
  travail: 'ZOX Rapture',
  relie: true,
  conversationId: 'conv-951',
  lanceLe: '2026-10-16T14:06:37+02:00',
  pid: 15432,
  executable: 'C:\\zox\\exe\\ZoxClientAccueil.exe'
}
const ORPHELIN: BureauGere = { id: 'orphelin', travail: 'travail non relié', relie: false }

function faux(bureaux: BureauGere[], surcharges: Partial<HdeskGestionApi> = {}) {
  const api = {
    hdeskGestionBureaux: vi.fn(async () => ({ ok: true as const, bureaux })),
    hdeskGestionFermer: vi.fn(async (): Promise<ResultatFermetureGeree> => ({
      ok: true,
      code: 0,
      message: 'Application fermée, bureau libéré.'
    })),
    hdeskGestionCreer: vi.fn(async (): Promise<ResultatCreationBureau> => ({
      ok: true,
      id: 'x',
      message: 'Bureau « x » prêt.'
    })),
    hdeskTvImage: vi.fn(async (id: string) => ({
      statut: 'ok' as const,
      id,
      dataUrl: 'data:image/png;base64,AA',
      width: 1,
      height: 1
    })),
    ...surcharges
  }
  return api
}

let racine: Root | null = null
let hote: HTMLElement | null = null
afterEach(async () => {
  if (racine) await act(async () => racine!.unmount())
  hote?.remove()
  racine = null
  hote = null
  vi.restoreAllMocks()
})

async function monter(
  api: HdeskGestionApi,
  props: {
    onOpenConversation?: (t: { conversationId: string }) => void
    fils?: readonly string[]
    onFermer?: () => void
    active?: boolean
  } = {}
): Promise<HTMLElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine!.render(
      createElement(HdeskGestionView, {
        active: true,
        api,
        intervalleMs: 60_000,
        intervalleImageMs: 60_000,
        ...props
      })
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return hote
}

const $ = (h: HTMLElement, id: string): HTMLElement | null =>
  h.querySelector(`[data-testid="${id}"]`)

async function cliquer(el: Element | null): Promise<void> {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

async function saisir(h: HTMLElement, cle: string, valeur: string): Promise<void> {
  const input = $(h, `hdesk-champ-${cle}`) as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, valeur)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// conv-1378 : « la tv doit prendre toute la largeur, il doit pouvoir y avoir plusieurs hdesk en même
// temps pour les super convs et la liste elle sert à rien enlève la ». Entrées qui doivent faire échouer
// ce bloc : une liste de retour, un seul bureau à l'image, un écran qui ne prend pas toute la largeur.
describe('HdeskGestionView — un écran par bureau', () => {
  it('plus de liste : chaque bureau a son écran, tous à l’image en même temps', async () => {
    const api = faux([ZOX, ORPHELIN])
    const h = await monter(api)
    expect($(h, 'hdesk-liste')).toBeNull()
    expect(h.querySelector('.hdesk-ligne')).toBeNull()
    expect(h.querySelector('nav')).toBeNull()
    const ecrans = [...h.querySelectorAll('[data-testid="hdesk-antenne"]')]
    expect(ecrans.map((e) => e.getAttribute('data-bureau'))).toEqual(['zox', 'orphelin'])
    expect(h.querySelectorAll('[data-testid="hdesk-antenne-image"]')).toHaveLength(2)
    expect(api.hdeskTvImage).toHaveBeenCalledWith('zox')
    expect(api.hdeskTvImage).toHaveBeenCalledWith('orphelin')
    const zox = ecrans[0] as HTMLElement
    expect(zox.getAttribute('aria-label')).toBe('Bureau « ZOX Rapture »')
    expect(zox.textContent).toContain('ZOX Rapture')
    expect($(zox, 'hdesk-pied')?.textContent).toContain('zox')
    expect($(zox, 'hdesk-pied')?.textContent).toContain('Fil conv-951')
    expect($(ecrans[1] as HTMLElement, 'hdesk-pied')?.textContent).toContain('Sans fil')
    expect($(h, 'hdesk-fermer-zox')).not.toBeNull()
    expect($(h, 'hdesk-fermer-orphelin')).not.toBeNull()
    expect($(h, 'hdesk-basculer-zox')?.textContent).toBe('Afficher sur mon écran')
    expect($(h, 'hdesk-direct')?.textContent).toContain('2 ouverts')
    expect($(h, 'hdesk-direct')?.textContent).toContain('1 sans fil')
    expect(h.textContent).not.toContain('antenne')
  })

  it('un écran de plus au lancement suivant, sans toucher aux autres', async () => {
    let bureaux = [ZOX]
    const api = faux([], {
      hdeskGestionBureaux: vi.fn(async () => ({ ok: true as const, bureaux }))
    })
    vi.useFakeTimers()
    try {
      const h = await monter(api)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(h.querySelectorAll('[data-testid="hdesk-antenne"]')).toHaveLength(1)
      bureaux = [ZOX, ORPHELIN]
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(h.querySelectorAll('[data-testid="hdesk-antenne"]')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('chaque bureau à l’écran se rafraîchit à la cadence des images, la liste à la sienne', async () => {
    vi.useFakeTimers()
    try {
      const capture = vi.fn(async (id: string) => ({
        statut: 'ok' as const,
        id,
        dataUrl: 'data:image/png;base64,AA',
        width: 1,
        height: 1
      }))
      const api = faux([ZOX, ORPHELIN], { hdeskTvImage: capture })
      hote = document.createElement('div')
      document.body.appendChild(hote)
      racine = createRoot(hote)
      await act(async () => {
        racine!.render(
          createElement(HdeskGestionView, {
            active: true,
            api,
            intervalleMs: 4_000,
            intervalleImageMs: 500
          })
        )
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const images = (id: string): number => capture.mock.calls.filter(([i]) => i === id).length
      expect(images('zox')).toBe(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(images('zox')).toBe(5)
      expect(images('orphelin')).toBe(5)
      expect(api.hdeskGestionBureaux).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(api.hdeskGestionBureaux).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aucun bureau : état vide avec un bouton pour en créer un, jamais une page blanche', async () => {
    const h = await monter(faux([]))
    expect($(h, 'hdesk-vide')?.textContent).toContain('Aucun bureau caché ouvert')
    expect($(h, 'hdesk-vide')?.querySelector('button')?.textContent).toBe('Créer un bureau')
  })

  it('liste illisible : l’erreur est dite, pas de liste vide trompeuse', async () => {
    const h = await monter(
      faux([], {
        hdeskGestionBureaux: vi.fn(async () => ({ ok: false as const, message: 'capture morte' }))
      })
    )
    expect($(h, 'hdesk-erreur')?.textContent).toContain('capture morte')
    expect($(h, 'hdesk-vide')).toBeNull()
  })
})

// conv-1378 : « ça devient un icône à côté de celui du navigateur et ça ouvre un right panel comme le
// navigateur ». Entrées qui doivent faire échouer ce bloc : un panneau qui capture alors que le chat
// n'est pas à l'écran, le bureau d'un autre fil montré d'abord, une largeur perdue à la fermeture.
describe('HdeskGestionView — le panneau à droite du fil', () => {
  const AUTRE: BureauGere = {
    id: 'autre',
    travail: 'Autre travail',
    relie: true,
    conversationId: 'conv-1378'
  }
  afterEach(() => window.localStorage.clear())

  it('ne montre que les bureaux des fils demandés, même répartis dans une super conv', async () => {
    const h = await monter(faux([ZOX, AUTRE, ORPHELIN]), { fils: ['conv-1378', 'conv-951'] })
    const ecrans = [...h.querySelectorAll('[data-testid="hdesk-antenne"]')]
    expect(ecrans.map((e) => e.getAttribute('data-bureau'))).toEqual(['zox', 'autre'])
    expect($(h, 'hdesk-direct')?.textContent).toContain('2 ouverts')
    expect($(h, 'hdesk-direct')?.textContent).not.toContain('sans fil')
  })

  it('un bureau hors du fil n’est plus capturé', async () => {
    const api = faux([ZOX, AUTRE])
    await monter(api, { fils: ['conv-1378'] })
    expect(api.hdeskTvImage).toHaveBeenCalledWith('autre')
    expect(api.hdeskTvImage).not.toHaveBeenCalledWith('zox')
  })

  it('fil sans bureau : il le dit, et « Tous les bureaux » garde l’accès aux autres', async () => {
    const h = await monter(faux([ZOX, AUTRE]), { fils: ['conv-1'] })
    expect($(h, 'hdesk-vide')?.textContent).toContain('Aucun bureau caché dans ce fil')
    expect($(h, 'hdesk-antenne')).toBeNull()
    expect($(h, 'hdesk-tous')?.textContent).toBe('Tous les bureaux (2)')
    await cliquer($(h, 'hdesk-tous'))
    expect(h.querySelectorAll('[data-testid="hdesk-antenne"]')).toHaveLength(2)
    expect($(h, 'hdesk-tous')?.textContent).toBe('Ce fil seulement')
    await cliquer($(h, 'hdesk-tous'))
    expect($(h, 'hdesk-antenne')).toBeNull()
  })

  it('jumeau : tout est déjà à l’écran, pas de bouton « Tous les bureaux »', async () => {
    const h = await monter(faux([AUTRE]), { fils: ['conv-1378'] })
    expect($(h, 'hdesk-tous')).toBeNull()
    await monter(faux([ZOX]))
    expect($(hote!, 'hdesk-tous')).toBeNull()
  })

  it('la croix ferme le panneau, comme celle du navigateur', async () => {
    const onFermer = vi.fn()
    const h = await monter(faux([ZOX]), { onFermer })
    await cliquer($(h, 'hdesk-panneau-fermer'))
    expect(onFermer).toHaveBeenCalledOnce()
  })

  it('plein cadre : il prend la place du fil, sa poignée disparaît, puis retour côte à côte', async () => {
    const h = await monter(faux([ZOX]))
    expect($(h, 'hdesk-view')?.tagName).toBe('ASIDE')
    expect(h.querySelector('[role="separator"]')).not.toBeNull()
    await cliquer($(h, 'hdesk-panneau-plein-cadre'))
    expect($(h, 'hdesk-view')?.classList.contains('is-plein-cadre')).toBe(true)
    expect(h.querySelector('[role="separator"]')).toBeNull()
    expect(($(h, 'hdesk-view') as HTMLElement).style.width).toBe('')
    await cliquer($(h, 'hdesk-panneau-plein-cadre'))
    expect($(h, 'hdesk-view')?.classList.contains('is-plein-cadre')).toBe(false)
    expect(($(h, 'hdesk-view') as HTMLElement).style.width).toBe('520px')
  })

  it('la poignée change la largeur, bornée, et la garde pour la prochaine ouverture', async () => {
    const h = await monter(faux([ZOX]))
    const poignee = h.querySelector('[role="separator"]')!
    await act(async () => {
      poignee.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    })
    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }))
    })
    expect(($(h, 'hdesk-view') as HTMLElement).style.width).toBe('620px')
    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5000 }))
    })
    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
    expect(($(h, 'hdesk-view') as HTMLElement).style.width).toBe('320px')
    expect(window.localStorage.getItem('autowin.chat.bureauxLargeur')).toBe('320')
  })

  it('chat pas à l’écran : aucune liste, aucune capture', async () => {
    const api = faux([ZOX])
    await monter(api, { active: false })
    expect(api.hdeskGestionBureaux).not.toHaveBeenCalled()
    expect(api.hdeskTvImage).not.toHaveBeenCalled()
  })
})

describe('HdeskGestionView — Fermer', () => {
  it('n’envoie QUE l’identifiant ; bouton désactivé pendant la fermeture (double clic sans effet)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finir: (r: ResultatFermetureGeree) => void = () => undefined
    const fermer = vi.fn(() => new Promise<ResultatFermetureGeree>((r) => (finir = r)))
    const h = await monter(faux([ZOX], { hdeskGestionFermer: fermer }))
    await cliquer($(h, 'hdesk-fermer-zox'))
    expect(($(h, 'hdesk-fermer-zox') as HTMLButtonElement).disabled).toBe(true)
    expect($(h, 'hdesk-fermer-zox')?.textContent).toBe('Fermeture…')
    await cliquer($(h, 'hdesk-fermer-zox'))
    expect(fermer).toHaveBeenCalledTimes(1)
    expect(fermer).toHaveBeenCalledWith('zox')
    await act(async () =>
      finir({ ok: true, code: 0, message: 'Application fermée, bureau libéré.' })
    )
    expect(($(h, 'hdesk-fermer-zox') as HTMLButtonElement).disabled).toBe(false)
  })

  it('refus (bureau sans fiche) : le message est affiché comme un refus, pas comme un succès', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const h = await monter(
      faux([ORPHELIN], {
        hdeskGestionFermer: vi.fn(async () => ({
          ok: false,
          code: null,
          message: "Ce bureau n'a pas de fiche."
        }))
      })
    )
    await cliquer($(h, 'hdesk-fermer-orphelin'))
    const retour = $(h, 'hdesk-retour-orphelin')!
    expect(retour.textContent).toBe("Fermeture refusée : Ce bureau n'a pas de fiche.")
    expect(retour.getAttribute('role')).toBe('alert')
  })

  it('confirmation refusée : rien n’est envoyé', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const api = faux([ZOX])
    const h = await monter(api)
    await cliquer($(h, 'hdesk-fermer-zox'))
    expect(api.hdeskGestionFermer).not.toHaveBeenCalled()
  })

  it('Fermer sur un écran ferme CE bureau ; une fois parti, le retour reste dit au-dessus', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let bureaux = [ZOX, ORPHELIN]
    let finir: (r: ResultatFermetureGeree) => void = () => undefined
    const fermer = vi.fn(() => new Promise<ResultatFermetureGeree>((r) => (finir = r)))
    const h = await monter(
      faux([], {
        hdeskGestionBureaux: vi.fn(async () => ({ ok: true as const, bureaux })),
        hdeskGestionFermer: fermer
      })
    )
    await cliquer($(h, 'hdesk-fermer-orphelin'))
    expect(fermer).toHaveBeenCalledWith('orphelin')
    bureaux = [ZOX]
    await act(async () => finir({ ok: true, code: 0, message: 'Application fermée.' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect($(h, 'hdesk-fermer-orphelin')).toBeNull()
    expect($(h, 'hdesk-retour-orphelin')?.textContent).toBe('orphelin : Application fermée.')
    expect($(h, 'hdesk-fermer-zox')).not.toBeNull()
  })
})

describe('HdeskGestionView — l’écran', () => {
  it('Regarder / Piloter est un sélecteur à deux boutons ; l’écran est marqué « en main » en Piloter', async () => {
    const h = await monter(
      faux([ZOX], { hdeskTvAct: vi.fn(async (): Promise<{ ok: true }> => ({ ok: true })) })
    )
    const ecran = $(h, 'hdesk-ecran')!
    expect(ecran.querySelector('[data-testid="hdesk-antenne-image"]')).not.toBeNull()
    expect(ecran.className).toBe('hdesk-ecran')
    expect($(h, 'hdesk-regarder')?.getAttribute('aria-pressed')).toBe('true')
    expect($(h, 'hdesk-piloter')?.getAttribute('aria-pressed')).toBe('false')
    await cliquer($(h, 'hdesk-piloter'))
    expect($(h, 'hdesk-ecran')?.className).toBe('hdesk-ecran is-pilote')
    expect($(h, 'hdesk-regarder')?.getAttribute('aria-pressed')).toBe('false')
    expect($(h, 'hdesk-piloter')?.getAttribute('aria-pressed')).toBe('true')
  })
})

/**
 * conv-1025 : « en enlevant le mot multi color et le filtre télévision et en mettant un cadre en
 * fonction du thème au lieu du cadre rose sur le bureau sélectionné ». Un rendu ne se lit pas dans
 * happy-dom : on lit la feuille elle-même.
 */
describe('HdeskGestionView — la feuille de style (conv-1025)', () => {
  // Chemin depuis la racine du dépôt : sous happy-dom, import.meta.url n'est pas un `file:`.
  const css = readFileSync('src/renderer/src/components/HdeskGestionView.css', 'utf8')
  // Les commentaires citent ce qui a été retiré : on ne lit que les règles.
  const regles = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('plus de mot multicolore ni de filtre télé (balayage, reflet, liseré irisé)', () => {
    expect(regles).not.toMatch(/background-clip\s*:\s*text/)
    expect(regles).not.toMatch(/repeating-linear-gradient/)
    expect(regles).not.toMatch(/conic-gradient/)
    expect(regles).not.toMatch(/@keyframes/)
    // Aucune couleur en dur (conv-1002) ; le `#000` des masques n'est qu'une opacité.
    expect(regles.replace(/-webkit-mask:[^;]*;/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('le bureau choisi prend le cadre du choix du thème, jamais la couleur d’erreur', () => {
    expect(regles).toMatch(/--hdesk-choisi-cadre:\s*var\(\s*--nv-choisi-cadre\s*,/)
    const enMain = regles.match(/\.hdesk-ecran\.is-pilote::before\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(enMain).toMatch(/background:\s*var\(--hdesk-choisi-cadre\)/)
    expect(regles).not.toMatch(/is-pilote[^{]*\{[^}]*--err/)
  })

  it('l’image prend toute la largeur de son écran, sans marges qui fausseraient un clic', () => {
    const image = regles.match(/\.hdesk-ecran img\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(image).toMatch(/width:\s*100%/)
    expect(image).not.toMatch(/max-width|object-fit/)
    expect(regles.match(/\.hdesk-ecran\s*\{([^}]*)\}/)?.[1]).not.toMatch(/max-height/)
  })
})

describe('HdeskGestionView — Regarder / Piloter', () => {
  const gestes = () => vi.fn(async (): Promise<{ ok: true }> => ({ ok: true }))

  /** Clic au point (clientX, clientY) d'une image affichée en 200 × 100 pour une capture 1000 × 500. */
  async function cliquerImage(h: HTMLElement, clientX: number, clientY: number): Promise<void> {
    const img = $(h, 'hdesk-antenne-image') as HTMLImageElement
    img.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120 }) as DOMRect
    await act(async () => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }))
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  function avecCapture(surcharges: Partial<HdeskGestionApi> = {}) {
    return faux([ZOX, ORPHELIN], {
      hdeskTvImage: vi.fn(async (id: string) => ({
        statut: 'ok' as const,
        id,
        dataUrl: 'data:image/png;base64,AA',
        width: 1000,
        height: 500
      })),
      ...surcharges
    })
  }

  it('Regarder par défaut : un clic dans l’image n’envoie RIEN et aucun champ de frappe n’existe', async () => {
    const act$ = gestes()
    const h = await monter(avecCapture({ hdeskTvAct: act$ }))
    expect($(h, 'hdesk-bandeau')?.textContent).toContain('lecture seule')
    await cliquerImage(h, 110, 70)
    expect(act$).not.toHaveBeenCalled()
    expect($(h, 'hdesk-saisie')).toBeNull()
  })

  it('Piloter : bandeau « Tu pilotes », le clic part aux coordonnées de la capture, la frappe rejoue ce point', async () => {
    const act$ = gestes()
    const h = await monter(avecCapture({ hdeskTvAct: act$ }))
    await cliquer($(h, 'hdesk-piloter'))
    expect($(h, 'hdesk-bandeau')?.textContent).toContain('Tu pilotes ce bureau')
    await cliquerImage(h, 110, 70)
    // (110 - 10) × 1000 / 200 = 500 ; (70 - 20) × 500 / 100 = 250
    expect(act$).toHaveBeenCalledWith({ id: 'zox', x: 500, y: 250 })
    const champ = $(h, 'hdesk-texte') as HTMLInputElement
    expect(champ.disabled).toBe(false)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(champ, 'bonjour')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await cliquer($(h, 'hdesk-taper'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(act$).toHaveBeenLastCalledWith({
      id: 'zox',
      x: 500,
      y: 250,
      texte: 'bonjour',
      entree: false,
      sansClic: true
    })
  })

  it('Piloter est désactivé quand le pont des gestes manque', async () => {
    const h = await monter(avecCapture())
    expect(($(h, 'hdesk-piloter') as HTMLButtonElement).disabled).toBe(true)
  })

  it('le bouton Regarder rend la main', async () => {
    const h = await monter(avecCapture({ hdeskTvAct: gestes() }))
    await cliquer($(h, 'hdesk-piloter'))
    await cliquer($(h, 'hdesk-regarder'))
    expect($(h, 'hdesk-saisie')).toBeNull()
    expect(h.querySelector('.hdesk-ecran.is-pilote')).toBeNull()
  })

  it('un seul bureau en main : piloter le second rend le premier', async () => {
    const h = await monter(avecCapture({ hdeskTvAct: gestes() }))
    const boutons = (): HTMLElement[] => [
      ...h.querySelectorAll<HTMLElement>('[data-testid="hdesk-piloter"]')
    ]
    await cliquer(boutons()[0])
    await cliquer(boutons()[1])
    expect(boutons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(h.querySelectorAll('.hdesk-ecran.is-pilote')).toHaveLength(1)
    expect(h.querySelectorAll('[data-testid="hdesk-saisie"]')).toHaveLength(1)
  })

  it('en pilotant un bureau, un clic sur l’écran d’un autre n’envoie rien', async () => {
    const act$ = gestes()
    const h = await monter(avecCapture({ hdeskTvAct: act$ }))
    await cliquer($(h, 'hdesk-piloter'))
    const images = h.querySelectorAll<HTMLImageElement>('[data-testid="hdesk-antenne-image"]')
    images[1].getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120 }) as DOMRect
    await act(async () => {
      images[1].dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110, clientY: 70 }))
    })
    expect(act$).not.toHaveBeenCalled()
  })

  it('le bureau en main quitte l’écran : le pilotage s’arrête', async () => {
    const h = await monter(avecCapture({ hdeskTvAct: gestes() }), { fils: ['conv-951'] })
    await cliquer($(h, 'hdesk-piloter'))
    expect($(h, 'hdesk-saisie')).not.toBeNull()
    await act(async () => {
      racine!.render(
        createElement(HdeskGestionView, {
          active: true,
          api: avecCapture({ hdeskTvAct: gestes() }),
          intervalleMs: 60_000,
          intervalleImageMs: 60_000,
          fils: ['conv-1']
        })
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect($(h, 'hdesk-saisie')).toBeNull()
  })

  it('sans geste pendant le délai, la vue repasse seule en Regarder ; un geste repousse l’échéance', async () => {
    vi.useFakeTimers()
    try {
      const act$ = gestes()
      hote = document.createElement('div')
      document.body.appendChild(hote)
      racine = createRoot(hote)
      await act(async () => {
        racine!.render(
          createElement(HdeskGestionView, {
            active: true,
            api: avecCapture({ hdeskTvAct: act$ }),
            intervalleMs: 600_000,
            intervalleImageMs: 600_000,
            delaiPilotageMs: 10_000
          })
        )
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await cliquer($(hote, 'hdesk-piloter'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000)
      })
      expect($(hote, 'hdesk-compte-a-rebours')?.textContent).toBe('0:04')
      await cliquerImage(hote, 110, 70) // geste : l'échéance repart à 10 s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000)
      })
      expect($(hote, 'hdesk-bandeau')?.textContent).toContain('Tu pilotes ce bureau')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect($(hote, 'hdesk-bandeau')?.textContent).toContain('lecture seule')
      expect($(hote, 'hdesk-saisie')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HdeskGestionView — Créer', () => {
  async function remplir(h: HTMLElement, valeurs: Record<string, string>): Promise<void> {
    for (const [cle, v] of Object.entries(valeurs)) await saisir(h, cle, v)
  }

  it.each([
    ['identifiant invalide', { id: 'mon bureau', executable: 'C:\\a.exe', travail: 'essai' }],
    ['exécutable vide', { id: 'a', executable: '', travail: 'essai' }],
    ['libellé vide', { id: 'a', executable: 'C:\\a.exe', travail: '' }]
  ])('%s : refusé dans l’écran, aucun lancement', async (_cas, valeurs) => {
    const api = faux([])
    const h = await monter(api)
    await cliquer($(h, 'hdesk-nouveau'))
    await remplir(h, valeurs)
    await cliquer($(h, 'hdesk-creer'))
    expect(api.hdeskGestionCreer).not.toHaveBeenCalled()
    expect($(h, 'hdesk-retour-creation')?.textContent).toMatch(/^Création refusée : /)
  })

  it('demande valide : envoyée telle quelle, le formulaire se referme au succès', async () => {
    const api = faux([])
    const h = await monter(api)
    await cliquer($(h, 'hdesk-nouveau'))
    await remplir(h, { id: 'zox-essai', executable: 'C:\\zox\\Zox.exe', travail: 'Essai' })
    await cliquer($(h, 'hdesk-creer'))
    expect(api.hdeskGestionCreer).toHaveBeenCalledWith({
      id: 'zox-essai',
      executable: 'C:\\zox\\Zox.exe',
      arguments: '',
      travail: 'Essai',
      conversationId: ''
    })
    expect($(h, 'hdesk-formulaire')).toBeNull()
    expect($(h, 'hdesk-retour-creation')?.textContent).toBe('Bureau « x » prêt.')
  })

  it('identifiant occupé : propose l’identifiant libre, sans relancer tout seul', async () => {
    const api = faux([], {
      hdeskGestionCreer: vi.fn(async () => ({
        ok: false as const,
        code: 5,
        message: 'Identifiant deja utilise',
        idLibre: 'zox-manuel-55'
      }))
    })
    const h = await monter(api)
    await cliquer($(h, 'hdesk-nouveau'))
    await remplir(h, { id: 'zox', executable: 'C:\\zox\\Zox.exe', travail: 'Essai' })
    await cliquer($(h, 'hdesk-creer'))
    await cliquer($(h, 'hdesk-id-libre'))
    expect(($(h, 'hdesk-champ-id') as HTMLInputElement).value).toBe('zox-manuel-55')
    expect(api.hdeskGestionCreer).toHaveBeenCalledTimes(1)
  })

  // conv-344 : le bouton disait « jusqu’à 40 s » alors que l’application attend jusqu’à 90 s.
  it('pendant la création, le bouton annonce l’attente réelle', async () => {
    let finir: (r: ResultatCreationBureau) => void = () => undefined
    const api = faux([], {
      hdeskGestionCreer: vi.fn(() => new Promise<ResultatCreationBureau>((r) => (finir = r)))
    })
    const h = await monter(api)
    await cliquer($(h, 'hdesk-nouveau'))
    await remplir(h, { id: 'zox', executable: 'C:\\zox\\Zox.exe', travail: 'Essai' })
    await cliquer($(h, 'hdesk-creer'))
    expect($(h, 'hdesk-creer')?.textContent).toBe(
      `Création… (jusqu’à ${CREATION_ATTENTE_MS / 1000} s)`
    )
    expect(CREATION_ATTENTE_MS).toBe(90_000)
    await act(async () => finir({ ok: true, id: 'zox', message: 'Bureau « zox » prêt.' }))
  })
})

/**
 * Repris de conv-344 dans l'Antenne (conv-1023) — « pk je suis obligé de choisir un path de
 * programme ? ». Le chemin reste obligatoire (un bureau vide est détruit par Windows) : il se
 * CHOISIT (« Parcourir… »), l'identifiant se PROPOSE, et un bureau fermé se RELANCE sans rien retaper.
 */
describe('HdeskGestionView — choisir sans taper (conv-344)', () => {
  const champ = (h: HTMLElement, cle: string): HTMLInputElement =>
    $(h, `hdesk-champ-${cle}`) as HTMLInputElement

  it('« Parcourir… » remplit le chemin et propose un identifiant libre', async () => {
    const api = faux([ZOX], {
      hdeskGestionChoisirExe: vi.fn(async () => ({
        ok: true as const,
        chemin: 'C:\\zox\\exe\\ZOX.exe'
      }))
    })
    const h = await monter(api)
    await cliquer($(h, 'hdesk-nouveau'))
    await cliquer($(h, 'hdesk-parcourir'))
    expect(champ(h, 'executable').value).toBe('C:\\zox\\exe\\ZOX.exe')
    // « zox » est déjà un bureau vivant : la proposition le contourne.
    expect(champ(h, 'id').value).toBe('zox-2')
  })

  it('« Parcourir… » annulé : le champ reste tel quel, sans message', async () => {
    const api = faux([], { hdeskGestionChoisirExe: vi.fn(async () => ({ ok: false as const })) })
    const h = await monter(api)
    await cliquer($(h, 'hdesk-nouveau'))
    await saisir(h, 'executable', 'C:\\deja\\la.exe')
    await cliquer($(h, 'hdesk-parcourir'))
    expect(champ(h, 'executable').value).toBe('C:\\deja\\la.exe')
    expect($(h, 'hdesk-retour-creation')).toBeNull()
  })

  it('un fichier refusé (pas un .exe) : le refus est dit, le champ reste tel quel', async () => {
    const api = faux([], {
      hdeskGestionChoisirExe: vi.fn(async () => ({
        ok: false as const,
        message: 'Choisis un fichier .exe.'
      }))
    })
    const h = await monter(api)
    await cliquer($(h, 'hdesk-nouveau'))
    await cliquer($(h, 'hdesk-parcourir'))
    expect(champ(h, 'executable').value).toBe('')
    expect($(h, 'hdesk-retour-creation')?.textContent).toBe(
      'Création refusée : Choisis un fichier .exe.'
    )
  })

  it('le chemin tapé propose l’identifiant ; un identifiant tapé à la main n’est jamais écrasé', async () => {
    const h = await monter(faux([]))
    await cliquer($(h, 'hdesk-nouveau'))
    await saisir(h, 'executable', 'C:\\Program Files\\Mon Appli\\Mon Appli.exe')
    expect(champ(h, 'id').value).toBe('mon-appli')
    await saisir(h, 'id', 'le-mien')
    await saisir(h, 'executable', 'C:\\Windows\\notepad.exe')
    expect(champ(h, 'id').value).toBe('le-mien')
    // Identifiant vidé à la main : la proposition reprend.
    await saisir(h, 'id', '')
    await saisir(h, 'executable', 'C:\\Windows\\notepad.exe ')
    expect(champ(h, 'id').value).toBe('notepad')
  })

  it('sans pont « Parcourir » (ancienne version) : pas de bouton', async () => {
    const h = await monter(faux([]))
    await cliquer($(h, 'hdesk-nouveau'))
    expect($(h, 'hdesk-parcourir')).toBeNull()
  })

  // conv-1378 : « Retire aussi Récents du panneau ». Le moteur rend encore cette liste : ce test tient
  // le panneau à l'écart de ce qu'il reçoit, avec ou sans bureau ouvert.
  describe('« Récents » retiré du panneau', () => {
    const RECENT = {
      id: 'roblox',
      executable: 'C:\\Roblox\\RobloxStudioBeta.exe',
      arguments: '-mode test',
      travail: 'Essai du jeu',
      conversationId: 'conv-526',
      lanceLe: '2026-10-19T08:00:00+02:00'
    }

    const sansTrace = (h: HTMLElement): void => {
      expect(h.querySelector('[data-testid^="hdesk-recent"]')).toBeNull()
      expect(h.querySelector('[data-testid^="hdesk-relancer"]')).toBeNull()
      expect(h.querySelector('details')).toBeNull()
      expect(h.textContent).not.toContain('Récents')
      expect(h.textContent).not.toContain('Essai du jeu')
    }

    it('aucun bureau ouvert : l’état vide, sans bureau fermé', async () => {
      const h = await monter(
        faux([], {
          hdeskGestionBureaux: vi.fn(async () => ({
            ok: true as const,
            bureaux: [],
            recents: [RECENT]
          }))
        })
      )
      expect($(h, 'hdesk-vide')).not.toBeNull()
      sansTrace(h)
    })

    it('un bureau ouvert : son écran seul', async () => {
      const h = await monter(
        faux([ZOX], {
          hdeskGestionBureaux: vi.fn(async () => ({
            ok: true as const,
            bureaux: [ZOX],
            recents: [RECENT]
          }))
        })
      )
      expect($(h, 'hdesk-antenne')).not.toBeNull()
      sansTrace(h)
    })
  })
})

/** Repris de conv-344 (scout n°8) : le fil s'affichait comme un identifiant brut, sans lien. */
describe('HdeskGestionView — le fil par son titre, cliquable (conv-344)', () => {
  const titres = (liste: Array<{ id: string; title: string }>) =>
    vi.fn(async () => liste as unknown as Array<{ id: string; title: string }>)

  it('titre du fil à l’antenne ; un clic ouvre la conversation', async () => {
    const ouvrir = vi.fn()
    const h = await monter(
      faux([ZOX], { conversations: titres([{ id: 'conv-951', title: 'Refonte du bureau' }]) }),
      { onOpenConversation: ouvrir }
    )
    const lien = $(h, 'hdesk-fil-zox')!
    expect(lien.textContent).toBe('Refonte du bureau')
    expect(lien.getAttribute('title')).toBe('conv-951')
    await cliquer(lien)
    expect(ouvrir).toHaveBeenCalledWith({ conversationId: 'conv-951' })
  })

  it('fil inconnu de la liste, ou liste en échec : l’identifiant, toujours cliquable', async () => {
    const ouvrir = vi.fn()
    const h = await monter(
      faux([ZOX], { conversations: vi.fn(async () => Promise.reject(new Error('x'))) }),
      { onOpenConversation: ouvrir }
    )
    expect($(h, 'hdesk-fil-zox')!.textContent).toBe('conv-951')
    await cliquer($(h, 'hdesk-fil-zox'))
    expect(ouvrir).toHaveBeenCalledWith({ conversationId: 'conv-951' })
  })

  it('fil « manuel » ou absent : texte simple, sans lien', async () => {
    const h = await monter(faux([{ ...ZOX, conversationId: 'manuel' }, ORPHELIN]), {
      onOpenConversation: vi.fn()
    })
    expect($(h, 'hdesk-fil-zox')).toBeNull()
    const pieds = h.querySelectorAll('[data-testid="hdesk-pied"]')
    expect(pieds[0].textContent).toContain('Fil manuel')
    expect(pieds[1].textContent).toContain('Sans fil')
    expect($(h, 'hdesk-fil-orphelin')).toBeNull()
  })

  it('sans moyen d’ouvrir une conversation : l’identifiant en texte, sans lien', async () => {
    const h = await monter(faux([ZOX]))
    expect($(h, 'hdesk-fil-zox')).toBeNull()
    expect($(h, 'hdesk-pied')!.textContent).toContain('Fil conv-951')
  })
})
