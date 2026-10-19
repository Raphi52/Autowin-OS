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
      createElement(HdeskGestionView, { active: true, api, intervalleMs: 60_000, ...props })
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

describe('HdeskGestionView — liste de tous les bureaux', () => {
  it('montre chaque bureau avec son travail, son fil, son aperçu et ses gestes', async () => {
    const h = await monter(faux([ZOX, ORPHELIN]))
    const carte = $(h, 'hdesk-bureau-zox')!
    expect(carte.textContent).toContain('ZOX Rapture')
    expect(carte.textContent).toContain('Fil : conv-951')
    expect(carte.textContent).toContain('ZoxClientAccueil.exe')
    expect(carte.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA')
    expect($(h, 'hdesk-fermer-zox')).not.toBeNull()
    expect($(h, 'hdesk-basculer-zox')).not.toBeNull()
    expect($(h, 'hdesk-bureau-orphelin')?.textContent).toContain('Fil : aucun')
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
})

/**
 * conv-344 — « pk je suis obligé de choisir un path de programme ? ». Le chemin reste obligatoire
 * (un bureau vide est détruit par Windows) : il se CHOISIT (« Parcourir… », scout n°10), l'identifiant
 * se PROPOSE (n°11), et un bureau fermé se RELANCE sans rien retaper (n°6).
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

  it('« Récents » : un bureau fermé se relance avec exactement ses champs', async () => {
    const recent = {
      id: 'roblox',
      executable: 'C:\\Roblox\\RobloxStudioBeta.exe',
      arguments: '-mode test',
      travail: 'Essai du jeu',
      conversationId: 'conv-526',
      lanceLe: '2026-10-19T08:00:00+02:00'
    }
    const api = faux([], {
      hdeskGestionBureaux: vi.fn(async () => ({
        ok: true as const,
        bureaux: [],
        recents: [recent]
      }))
    })
    const h = await monter(api)
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

  it('aucun récent : pas de section', async () => {
    const h = await monter(faux([ZOX]))
    expect($(h, 'hdesk-recents')).toBeNull()
  })
})

/**
 * conv-344 (scout n°2, 5, 9) : agir dans l'appli cachée SANS basculer l'écran réel. La petite image
 * agrandit l'aperçu (aucun geste par mégarde) ; dans l'aperçu agrandi, clic / frappe / molette partent
 * au bureau par hdesk-act, l'un après l'autre ; un point montre le dernier clic.
 */
describe('HdeskGestionView — agir dans l’aperçu (conv-344)', () => {
  const image800 = vi.fn(async (id: string) => ({
    statut: 'ok' as const,
    id,
    dataUrl: 'data:image/png;base64,AA',
    width: 800,
    height: 600
  }))
  const boite = (img: Element): void => {
    ;(img as HTMLElement).getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 400,
        height: 300,
        right: 400,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => ({})
      }) as DOMRect
  }
  const cliquerA = async (el: Element, x: number, y: number): Promise<void> => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))
    })
  }
  const ouvrir = async (api: HdeskGestionApi): Promise<{ h: HTMLElement; img: Element }> => {
    const h = await monter(api)
    await cliquer($(h, 'hdesk-apercu-zox'))
    const img = $(h, 'hdesk-agrandi-image')!
    boite(img)
    return { h, img }
  }

  it('un clic sur la petite image AGRANDIT l’aperçu, sans aucun geste', async () => {
    const agir = vi.fn(async () => ({ ok: true as const }))
    const h = await monter(faux([ZOX], { hdeskTvAct: agir, hdeskTvImage: image800 }))
    await cliquer($(h, 'hdesk-apercu-zox'))
    expect($(h, 'hdesk-agrandi')).not.toBeNull()
    expect(agir).not.toHaveBeenCalled()
    await cliquer($(h, 'hdesk-agrandi-fermer'))
    expect($(h, 'hdesk-agrandi')).toBeNull()
  })

  it('clic aux coordonnées de la CAPTURE, puis frappe + Entrée sans reclic, puis molette', async () => {
    const agir = vi.fn(async () => ({ ok: true as const }))
    const { h, img } = await ouvrir(faux([ZOX], { hdeskTvAct: agir, hdeskTvImage: image800 }))
    await cliquerA(img, 100, 75)
    expect(agir).toHaveBeenLastCalledWith({ id: 'zox', x: 200, y: 150 })
    const champ = $(h, 'hdesk-agrandi-texte') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        champ,
        'bonjour'
      )
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      $(h, 'hdesk-agrandi-saisie')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })
    expect(agir).toHaveBeenLastCalledWith({
      id: 'zox',
      x: 200,
      y: 150,
      texte: 'bonjour',
      entree: true,
      sansClic: true
    })
    // Le moteur de test ne recopie pas clientX/clientY d'un WheelEvent : posés comme Chromium.
    const sansPosition = new WheelEvent('wheel', { bubbles: true, deltaY: 300 })
    await act(async () => {
      img.dispatchEvent(sansPosition)
    })
    expect(agir).toHaveBeenCalledTimes(2) // position illisible : aucun geste en NaN
    const roue = new WheelEvent('wheel', { bubbles: true, deltaY: 300 })
    Object.defineProperty(roue, 'clientX', { value: 200 })
    Object.defineProperty(roue, 'clientY', { value: 150 })
    await act(async () => {
      img.dispatchEvent(roue)
    })
    expect(agir).toHaveBeenLastCalledWith({ id: 'zox', x: 400, y: 300, molette: -3 })
  })

  it('frappe sans clic préalable : rien n’est envoyé, la raison est dite', async () => {
    const agir = vi.fn(async () => ({ ok: true as const }))
    const { h } = await ouvrir(faux([ZOX], { hdeskTvAct: agir, hdeskTvImage: image800 }))
    expect(($(h, 'hdesk-agrandi-texte') as HTMLInputElement).disabled).toBe(true)
    expect(($(h, 'hdesk-agrandi-texte') as HTMLInputElement).placeholder).toMatch(/Clique d’abord/)
    expect(agir).not.toHaveBeenCalled()
  })

  it('deux clics rapides : le second attend la fin du premier', async () => {
    let finir: () => void = () => undefined
    const agir = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (finir = () => r({ ok: true as const }))))
      .mockResolvedValue({ ok: true as const })
    const { img } = await ouvrir(faux([ZOX], { hdeskTvAct: agir, hdeskTvImage: image800 }))
    await cliquerA(img, 10, 10)
    await cliquerA(img, 20, 20)
    expect(agir).toHaveBeenCalledTimes(1)
    await act(async () => finir())
    expect(agir).toHaveBeenCalledTimes(2)
  })

  it('le point du dernier clic est posé à l’endroit cliqué', async () => {
    const agir = vi.fn(async () => ({ ok: true as const }))
    const { h, img } = await ouvrir(faux([ZOX], { hdeskTvAct: agir, hdeskTvImage: image800 }))
    expect($(h, 'hdesk-point')).toBeNull()
    await cliquerA(img, 100, 75)
    const point = $(h, 'hdesk-point') as HTMLElement
    expect(point.style.left).toBe('25%')
    expect(point.style.top).toBe('25%')
  })

  it('le point montre aussi le dernier clic d’un AGENT, lu dans le journal (moins de 5 s)', async () => {
    const recent = new Date().toISOString()
    const ancien = new Date(Date.now() - 60_000).toISOString()
    const bureau = (quand: string): BureauGere => ({
      ...ZOX,
      gestes: [{ quand, ok: true, x: 400, y: 150, clic: true }]
    })
    const { h } = await ouvrir(faux([bureau(recent)], { hdeskTvImage: image800 }))
    const point = $(h, 'hdesk-point') as HTMLElement
    expect([point.style.left, point.style.top]).toEqual(['50%', '25%'])
    await act(async () => racine!.unmount())
    racine = null
    hote?.remove()
    const { h: h2 } = await ouvrir(faux([bureau(ancien)], { hdeskTvImage: image800 }))
    expect($(h2, 'hdesk-point')).toBeNull()
  })

  it('la carte montre les derniers gestes, jamais le texte tapé', async () => {
    const h = await monter(
      faux([
        {
          ...ZOX,
          gestes: [
            { quand: '2026-10-19T10:00:00+02:00', ok: true, x: 10, y: 20, clic: true },
            {
              quand: '2026-10-19T10:00:01+02:00',
              ok: true,
              x: 10,
              y: 20,
              clic: false,
              caracteres: 9,
              entree: true
            },
            {
              quand: '2026-10-19T10:00:02+02:00',
              ok: false,
              x: 5,
              y: 5,
              clic: true,
              erreur: 'Aucune fenetre en (5,5) dans ce bureau.'
            }
          ]
        }
      ])
    )
    const g = $(h, 'hdesk-gestes-zox')!.textContent ?? ''
    expect(g).toContain('clic 10,20')
    expect(g).toContain('9 caractères + Entrée')
    expect(g).toContain('refusé')
  })
})

/** conv-344 (scout n°8) : le fil s'affichait comme un identifiant brut, sans lien. */
describe('HdeskGestionView — le fil par son titre, cliquable (conv-344)', () => {
  const titres = (liste: Array<{ id: string; title: string }>) =>
    vi.fn(async () => liste as unknown as Array<{ id: string; title: string }>)

  it('titre du fil ; un clic ouvre la conversation', async () => {
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
    expect($(h, 'hdesk-bureau-zox')!.textContent).toContain('Fil : manuel')
    expect($(h, 'hdesk-bureau-orphelin')!.textContent).toContain('Fil : aucun')
  })
})
