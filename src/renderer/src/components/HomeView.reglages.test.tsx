// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeView } from './HomeView'
import { CLE_VISIBILITE_WIDGETS } from './home-widgets-visibility'
import { CLE_NOM_JARVIS } from './jarvis-nom'
import { oublierOuvertureReglages } from './home-reglages-ouverture'
import { CLE_VOIX_JARVIS, lireReglageVoix } from './jarvis-voix-reglage'

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

beforeEach(() => {
  window.localStorage.clear()
  // Equivalent d'un DEMARRAGE de l'application : la memoire d'ouverture du panneau vit dans le
  // module, elle survivrait donc d'un test a l'autre.
  oublierOuvertureReglages()
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    taskManagerSnapshot: vi.fn(async () => ({ tasks: [], alerts: [] })),
    outlookSnapshot: vi.fn(async () => ({ ok: true, mails: [], events: [] })),
    onTaskManagerSnapshot: vi.fn(() => () => {})
  }
})

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
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

const q = <T extends Element>(c: ParentNode, sel: string): T | null => c.querySelector<T>(sel)

/** Le bouton BASCULE le panneau : ouvert -> ferme, ferme -> ouvert. */
async function basculerReglages(c: HTMLDivElement): Promise<void> {
  const bouton = q<HTMLButtonElement>(c, '[data-testid="home-settings"]')!
  await act(async () => bouton.click())
}

/**
 * Ouvre le panneau S'IL est ferme.
 *
 * Volontairement idempotent : l'etat initial du panneau est un choix d'affichage qui peut changer,
 * et un test sur les interrupteurs n'a pas a en dependre.
 */
async function ouvrirReglages(c: HTMLDivElement): Promise<void> {
  if (q(c, '[data-testid="home-settings-panel"]') === null) await basculerReglages(c)
}

/**
 * Ecrire dans un champ comme un humain.
 *
 * Affecter `value` puis emettre `input` ne suffit pas : React memorise la derniere valeur vue et
 * considere qu'elle n'a pas change. Il faut passer par le setter natif du prototype.
 */
function saisir(champ: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set
  setter?.call(champ, valeur)
  champ.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('le bouton Reglages de l accueil', () => {
  it('est FERME au demarrage de l application', async () => {
    // CHOIX DU 2026-09-01, demande de l'utilisateur : « laisse-le ferme au demarrage ». Un panneau
    // ouvert d'office masque l'accueil de quelqu'un qui vient juste regarder ses tuiles.
    const container = await mount()
    expect(q(container, '[data-testid="home-settings-panel"]')).toBeNull()
  })

  it('reste OUVERT quand on change de page et qu on revient', async () => {
    // Deuxieme moitie de la meme demande : « laisse-le ouvert si l'utilisateur l'a ouvert et a change
    // de page ». Changer d'onglet DEMONTE la vue ; l'ouverture ne doit pas mourir avec elle.
    const premier = await mount()
    await basculerReglages(premier)
    expect(q(premier, '[data-testid="home-settings-panel"]')).not.toBeNull()

    const retour = await mount()
    expect(q(retour, '[data-testid="home-settings-panel"]')).not.toBeNull()
  })

  it('reste FERME au retour si on l avait referme', async () => {
    const premier = await mount()
    await basculerReglages(premier)
    await basculerReglages(premier)

    const retour = await mount()
    expect(q(retour, '[data-testid="home-settings-panel"]')).toBeNull()
  })

  it('ouvre et referme le panneau au clic', async () => {
    const container = await mount()
    await ouvrirReglages(container)
    expect(q(container, '[data-testid="home-settings-panel"]')).not.toBeNull()
    await basculerReglages(container)
    expect(q(container, '[data-testid="home-settings-panel"]')).toBeNull()
    await basculerReglages(container)
    expect(q(container, '[data-testid="home-settings-panel"]')).not.toBeNull()
  })

  it('range les commandes de disposition dedans, plus dans la barre', async () => {
    const container = await mount()
    await ouvrirReglages(container)
    const panneau = q<HTMLElement>(container, '[data-testid="home-settings-panel"]')!
    const undo = q<HTMLElement>(container, '[data-testid="home-undo"]')!
    // La commande existe UNE seule fois, et elle est DANS le panneau : c'est ce qui prouve qu'elle
    // n'est plus dans la barre.
    expect(container.querySelectorAll('[data-testid="home-undo"]')).toHaveLength(1)
    expect(panneau.contains(undo)).toBe(true)
    expect(panneau.textContent).toContain('Disperser')
    expect(panneau.textContent).toContain('Rétablir la disposition')
    // Referme : la commande part avec le panneau, elle n'a pas de double dans la barre.
    await basculerReglages(container)
    expect(q(container, '[data-testid="home-undo"]')).toBeNull()
  })
})

describe('un interrupteur par widget', () => {
  it('eteint une tuile et la rallume a la meme place', async () => {
    const container = await mount()
    const avant = q<HTMLElement>(container, '[data-testid="home-widget-agenda"]')!.style.transform
    await ouvrirReglages(container)
    const interrupteur = q<HTMLInputElement>(
      container,
      '[data-testid="home-widget-switch-agenda"]'
    )!
    expect(interrupteur.getAttribute('role')).toBe('switch')
    await act(async () => interrupteur.click())
    expect(q(container, '[data-testid="home-widget-agenda"]')).toBeNull()
    // Les autres tuiles ne bougent pas : eteindre n'est pas rearranger.
    expect(q(container, '[data-testid="home-widget-mails"]')).not.toBeNull()
    await act(async () => interrupteur.click())
    expect(q<HTMLElement>(container, '[data-testid="home-widget-agenda"]')!.style.transform).toBe(
      avant
    )
  })

  it('retient le reglage d une ouverture a l autre', async () => {
    const premier = await mount()
    await ouvrirReglages(premier)
    await act(async () =>
      q<HTMLInputElement>(premier, '[data-testid="home-widget-switch-routines"]')!.click()
    )
    expect(window.localStorage.getItem(CLE_VISIBILITE_WIDGETS)).toContain('"routines":false')

    const second = await mount()
    expect(q(second, '[data-testid="home-widget-routines"]')).toBeNull()
    expect(q(second, '[data-testid="home-widget-agenda"]')).not.toBeNull()
  })
})

describe('le nom de l assistant', () => {
  it('se choisit dans les reglages et devient le titre de la tuile', async () => {
    const container = await mount()
    expect(
      q<HTMLElement>(container, '[data-testid="home-widget-jarvis"] h2')!.textContent
    ).toBe('Jarvis')
    await ouvrirReglages(container)
    const champ = q<HTMLInputElement>(container, '[data-testid="home-jarvis-nom"]')!
    await act(async () => saisir(champ, 'Alfred'))
    expect(
      q<HTMLElement>(container, '[data-testid="home-widget-jarvis"] h2')!.textContent
    ).toBe('Alfred')
    expect(window.localStorage.getItem(CLE_NOM_JARVIS)).toBe('Alfred')
  })

  it('laisse le champ VIDE le temps de retaper un autre nom', async () => {
    // LE DEFAUT REPARE : le champ etait recale a chaque frappe sur le nom RETENU. Effacer rendait
    // donc une saisie vide, aussitot remplacee par « Jarvis » -- impossible de vider pour retaper.
    const container = await mount()
    await ouvrirReglages(container)
    const champ = q<HTMLInputElement>(container, '[data-testid="home-jarvis-nom"]')!
    await act(async () => saisir(champ, ''))
    expect(champ.value).toBe('')
    // La tuile, elle, ne reste jamais sans titre.
    expect(q<HTMLElement>(container, '[data-testid="home-widget-jarvis"] h2')!.textContent).toBe(
      'Jarvis'
    )
    await act(async () => saisir(champ, 'Alfred'))
    expect(champ.value).toBe('Alfred')
    expect(q<HTMLElement>(container, '[data-testid="home-widget-jarvis"] h2')!.textContent).toBe(
      'Alfred'
    )
  })

  it('reaffiche le nom retenu quand on quitte le champ laisse vide', async () => {
    const container = await mount()
    await ouvrirReglages(container)
    const champ = q<HTMLInputElement>(container, '[data-testid="home-jarvis-nom"]')!
    await act(async () => saisir(champ, ''))
    await act(async () => champ.dispatchEvent(new Event('focusout', { bubbles: true })))
    expect(champ.value).toBe('Jarvis')
  })

  it('reprend le nom enregistre a l ouverture suivante', async () => {
    window.localStorage.setItem(CLE_NOM_JARVIS, 'Friday')
    const container = await mount()
    expect(
      q<HTMLElement>(container, '[data-testid="home-widget-jarvis"] h2')!.textContent
    ).toBe('Friday')
  })
})

describe('relire Outlook se commande depuis la tuile Outlook', () => {
  it('vit DANS l etiquette des interlocuteurs, plus dans la barre du haut', async () => {
    const container = await mount()
    const bouton = q<HTMLButtonElement>(container, '[data-testid="home-refresh-outlook"]')!
    expect(bouton).not.toBeNull()
    // La preuve qui compte : son ancetre est la tuile des mails, pas l'en-tete de la page.
    expect(bouton.closest('[data-testid="home-widget-mails"]')).not.toBeNull()
    expect(bouton.closest('.home-view__header')).toBeNull()
  })

  it('ne prend pas la tuile en main quand on le clique', async () => {
    // La tuile se saisit N'IMPORTE OU : sans arret de la propagation, cliquer le bouton amorcerait
    // un deplacement.
    const container = await mount()
    const bouton = q<HTMLButtonElement>(container, '[data-testid="home-refresh-outlook"]')!
    await act(async () => bouton.click())
    expect(q<HTMLElement>(container, '[data-testid="home-widget-mails"]')!.dataset.held).toBeUndefined()
  })
})

describe('plusieurs voix parametrables pour l assistant', () => {
  const voix = (name: string, lang: string): SpeechSynthesisVoice =>
    ({ name, lang, voiceURI: name, default: false }) as SpeechSynthesisVoice

  beforeEach(() => {
    ;(window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      getVoices: () => [voix('Hortense', 'fr-FR'), voix('Zira', 'en-US')],
      speak: vi.fn(),
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    ;(window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      class {
        voice: SpeechSynthesisVoice | null = null
        lang = ''
        rate = 1
        pitch = 1
        constructor(public text: string) {}
      }
  })

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis
    delete (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance
  })

  it('propose les voix du poste, en plus du choix automatique', async () => {
    const container = await mount()
    await ouvrirReglages(container)
    const liste = q<HTMLSelectElement>(container, '[data-testid="home-jarvis-voix"]')!
    const libelles = [...liste.options].map((o) => o.textContent)
    expect(libelles[0]).toContain('automatique')
    expect(libelles).toContain('Hortense — fr-FR')
    expect(libelles).toContain('Zira — en-US')
  })

  it('retient la voix choisie, son debit et sa hauteur', async () => {
    const container = await mount()
    await ouvrirReglages(container)
    const liste = q<HTMLSelectElement>(container, '[data-testid="home-jarvis-voix"]')!
    await act(async () => {
      liste.value = 'Zira'
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const debit = q<HTMLInputElement>(container, '[data-testid="home-jarvis-debit"]')!
    await act(async () => saisir(debit, '1.5'))
    expect(lireReglageVoix(window.localStorage)).toMatchObject({ voixURI: 'Zira', debit: 1.5 })
  })

  it('reprend le reglage enregistre a l ouverture suivante', async () => {
    window.localStorage.setItem(
      CLE_VOIX_JARVIS,
      JSON.stringify({ voixURI: 'Zira', debit: 1.2, hauteur: 1.1 })
    )
    const container = await mount()
    await ouvrirReglages(container)
    expect(q<HTMLSelectElement>(container, '[data-testid="home-jarvis-voix"]')!.value).toBe('Zira')
    expect(q<HTMLInputElement>(container, '[data-testid="home-jarvis-debit"]')!.value).toBe('1.2')
  })

  it('prononce un essai avec la voix choisie', async () => {
    // Le seul endroit ou un reglage de voix se juge, c'est a l'oreille : l'essai doit partir.
    const container = await mount()
    await ouvrirReglages(container)
    const liste = q<HTMLSelectElement>(container, '[data-testid="home-jarvis-voix"]')!
    await act(async () => {
      liste.value = 'Zira'
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const essai = q<HTMLButtonElement>(container, '[data-testid="home-jarvis-voix-test"]')!
    await act(async () => essai.click())
    const synth = (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } })
      .speechSynthesis
    expect(synth.speak).toHaveBeenCalledTimes(1)
    const dit = synth.speak.mock.calls[0][0] as SpeechSynthesisUtterance
    expect(dit.voice?.name).toBe('Zira')
  })
})
