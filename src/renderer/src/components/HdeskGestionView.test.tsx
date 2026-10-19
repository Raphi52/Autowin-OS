// @vitest-environment happy-dom
/**
 * conv-951 : vue « Bureaux cachés ». Cas limites du cadrage : aucun bureau, liste illisible, bureau
 * sans fiche, fermeture répétée, saisie invalide refusée sans lancement, identifiant occupé.
 */
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
  props: { onOpenConversation?: (t: { conversationId: string }) => void } = {}
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
        intervallePiloteMs: 60_000,
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

describe('HdeskGestionView — antenne et moniteurs', () => {
  it('le premier bureau passe à l’antenne avec sa fiche, son aperçu et ses gestes ; tous ont un moniteur', async () => {
    const h = await monter(faux([ZOX, ORPHELIN]))
    const antenne = $(h, 'hdesk-antenne')!
    expect(antenne.getAttribute('data-bureau')).toBe('zox')
    expect(antenne.textContent).toContain('ZOX Rapture')
    expect(antenne.textContent).toContain('Fil : conv-951')
    expect(antenne.textContent).toContain('ZoxClientAccueil.exe')
    expect($(h, 'hdesk-antenne-image')?.getAttribute('src')).toBe('data:image/png;base64,AA')
    expect($(h, 'hdesk-fermer-zox')).not.toBeNull()
    expect($(h, 'hdesk-basculer-zox')).not.toBeNull()
    expect($(h, 'hdesk-moniteur-zox')?.getAttribute('aria-pressed')).toBe('true')
    expect($(h, 'hdesk-moniteur-orphelin')?.getAttribute('aria-pressed')).toBe('false')
    expect($(h, 'hdesk-direct')?.textContent).toContain('1 sans fil')
  })

  it('un clic sur un moniteur le passe à l’antenne', async () => {
    const h = await monter(faux([ZOX, ORPHELIN]))
    await cliquer($(h, 'hdesk-moniteur-orphelin'))
    expect($(h, 'hdesk-antenne')?.getAttribute('data-bureau')).toBe('orphelin')
    expect($(h, 'hdesk-antenne')?.textContent).toContain('Fil : aucun')
    expect($(h, 'hdesk-fermer-orphelin')).not.toBeNull()
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

  it('la croix d’un moniteur ferme CE bureau, après confirmation, sans le passer à l’antenne', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finir: (r: ResultatFermetureGeree) => void = () => undefined
    const fermer = vi.fn(() => new Promise<ResultatFermetureGeree>((r) => (finir = r)))
    const h = await monter(faux([ZOX, ORPHELIN], { hdeskGestionFermer: fermer }))
    const croix = $(h, 'hdesk-fermer-moniteur-orphelin') as HTMLButtonElement
    expect(croix.getAttribute('aria-label')).toBe('Fermer le bureau « travail non relié »')
    await cliquer(croix)
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(fermer).toHaveBeenCalledWith('orphelin')
    expect($(h, 'hdesk-antenne')?.getAttribute('data-bureau')).toBe('zox')
    // Pendant la fermeture : croix désactivée, un second clic ne relance rien.
    expect(croix.disabled).toBe(true)
    await cliquer(croix)
    expect(fermer).toHaveBeenCalledTimes(1)
    await act(async () => finir({ ok: true, code: 0, message: 'Application fermée.' }))
    expect($(h, 'hdesk-retour-orphelin')?.textContent).toBe('orphelin : Application fermée.')
  })

  it('chaque moniteur a sa croix ; confirmation refusée = rien n’est fermé', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const api = faux([ZOX, ORPHELIN])
    const h = await monter(api)
    expect($(h, 'hdesk-fermer-moniteur-zox')).not.toBeNull()
    expect($(h, 'hdesk-fermer-moniteur-orphelin')).not.toBeNull()
    await cliquer($(h, 'hdesk-fermer-moniteur-zox'))
    expect(api.hdeskGestionFermer).not.toHaveBeenCalled()
  })
})

describe('HdeskGestionView — la TV', () => {
  it('bandeau et écran sont dans un seul cadre TV, marqué « en main » en Piloter', async () => {
    const h = await monter(
      faux([ZOX], { hdeskTvAct: vi.fn(async (): Promise<{ ok: true }> => ({ ok: true })) })
    )
    const tv = $(h, 'hdesk-tv')!
    expect(tv.querySelector('[data-testid="hdesk-bandeau"]')).not.toBeNull()
    expect(tv.querySelector('[data-testid="hdesk-antenne-image"]')).not.toBeNull()
    expect(tv.className).toBe('hdesk-tv')
    await cliquer($(h, 'hdesk-piloter'))
    expect($(h, 'hdesk-tv')?.className).toBe('hdesk-tv is-pilote')
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

  it('le bouton Regarder rend la main ; changer d’antenne aussi', async () => {
    const h = await monter(avecCapture({ hdeskTvAct: gestes() }))
    await cliquer($(h, 'hdesk-piloter'))
    await cliquer($(h, 'hdesk-regarder'))
    expect($(h, 'hdesk-piloter')).not.toBeNull()
    await cliquer($(h, 'hdesk-piloter'))
    await cliquer($(h, 'hdesk-moniteur-orphelin'))
    expect($(h, 'hdesk-piloter')).not.toBeNull()
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
            intervallePiloteMs: 600_000,
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

  const RECENT = {
    id: 'roblox',
    executable: 'C:\\Roblox\\RobloxStudioBeta.exe',
    arguments: '-mode test',
    travail: 'Essai du jeu',
    conversationId: 'conv-526',
    lanceLe: '2026-10-19T08:00:00+02:00'
  }

  it('« Récents » sans aucun bureau ouvert : un bureau fermé se relance avec exactement ses champs', async () => {
    const api = faux([], {
      hdeskGestionBureaux: vi.fn(async () => ({
        ok: true as const,
        bureaux: [],
        recents: [RECENT]
      }))
    })
    const h = await monter(api)
    expect($(h, 'hdesk-vide')).not.toBeNull()
    const ligne = $(h, 'hdesk-recent-roblox')!
    expect(ligne.textContent).toContain('Essai du jeu')
    expect(ligne.textContent).toContain('RobloxStudioBeta.exe')
    await cliquer($(h, 'hdesk-relancer-roblox'))
    expect(api.hdeskGestionCreer).toHaveBeenCalledWith({
      id: 'roblox',
      executable: 'C:\\Roblox\\RobloxStudioBeta.exe',
      arguments: '-mode test',
      travail: 'Essai du jeu',
      conversationId: 'conv-526'
    })
    expect($(h, 'hdesk-retour-creation')?.textContent).toBe('Bureau « x » prêt.')
  })

  it('« Récents » à côté de l’antenne : la liste reste visible sous les moniteurs', async () => {
    const api = faux([ZOX], {
      hdeskGestionBureaux: vi.fn(async () => ({
        ok: true as const,
        bureaux: [ZOX],
        recents: [RECENT]
      }))
    })
    const h = await monter(api)
    expect($(h, 'hdesk-antenne')).not.toBeNull()
    expect($(h, 'hdesk-relancer-roblox')).not.toBeNull()
  })

  it('aucun récent : pas de section', async () => {
    const h = await monter(faux([ZOX]))
    expect($(h, 'hdesk-recents')).toBeNull()
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
    expect($(h, 'hdesk-antenne')!.textContent).toContain('Fil : manuel')
    // L'orphelin passe à l'antenne : sa fiche dit « aucun », sans lien.
    await cliquer($(h, 'hdesk-moniteur-orphelin'))
    expect($(h, 'hdesk-antenne')!.getAttribute('data-bureau')).toBe('orphelin')
    expect($(h, 'hdesk-antenne')!.textContent).toContain('Fil : aucun')
    expect($(h, 'hdesk-fil-orphelin')).toBeNull()
  })

  it('sans moyen d’ouvrir une conversation : l’identifiant en texte, sans lien', async () => {
    const h = await monter(faux([ZOX]))
    expect($(h, 'hdesk-fil-zox')).toBeNull()
    expect($(h, 'hdesk-antenne')!.textContent).toContain('Fil : conv-951')
  })
})
