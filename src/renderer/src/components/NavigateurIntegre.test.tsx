// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AnnotationNavigateur,
  EtatNavigateur,
  GesteNavigateur,
  OngletNavigateur,
  ReglagesNavigateur
} from '../../../shared/navigateur'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'
import { NavigateurIntegre, type PropsNavigateurIntegre } from './NavigateurIntegre'
import {
  adresseDeLaSaisie,
  blocPourLeChat,
  decouperAdresse,
  lienAOuvrirDansLePanneau
} from './navigateur-integre-outils'

/**
 * NAVIGATEUR INTÉGRÉ DU CHAT — panneau et intégration dans la vue chat (conv-1286, lot 3/5).
 *
 * Entrées qui doivent faire échouer ce fichier : la page native laissée posée alors que le panneau
 * est caché (autre écran, menu ⋮, aperçu, démontage) — elle flotterait au-dessus du DOM ; un
 * raccourci qui ne fait rien ; la carte d'accord absente ou muette ; des annotations qui n'arrivent
 * pas dans la saisie ; un lien localhost qui part dans le navigateur du système.
 */

// L'encodage réel passe par un <canvas> (miniature) : hors sujet ici, on rend la pièce déjà encodée.
vi.mock('./chat-attachments', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chat-attachments')>()
  return {
    ...original,
    encodeAttachment: vi.fn(async (file: File) => ({
      name: file.name,
      mimeType: file.type,
      size: file.size,
      kind: file.type.startsWith('image/') ? ('image' as const) : ('text' as const),
      content: 'YWJj',
      ...(file.type.startsWith('image/') && { thumbnail: 'data:image/jpeg;base64,bWluaQ==' })
    }))
  }
})

const CAPTURE = 'data:image/png;base64,iVBORw0KGgo='

function onglet(id: string, url = 'http://localhost:5173/'): OngletNavigateur {
  return {
    id,
    conversationId: 'A',
    url,
    titre: 'Page de dev',
    chargement: false,
    peutReculer: false,
    peutAvancer: false
  }
}

function annotation(id: string, commentaire: string): AnnotationNavigateur {
  return {
    id: `annotation-${id}0000000`,
    ongletId: 'onglet-1',
    url: 'http://localhost:5173/',
    selecteur: 'main > button.primaire',
    texteElement: 'Envoyer',
    styles: {
      police: 'Inter',
      taille: '14px',
      couleur: 'rgb(0, 0, 0)',
      fond: 'rgb(255, 255, 255)',
      marges: 'marge 0px · retrait 8px'
    },
    rect: { x: 10, y: 20, largeur: 100, hauteur: 30 },
    commentaire,
    captureDataUrl: CAPTURE
  }
}

function geste(id: string, partiel: Partial<GesteNavigateur> = {}): GesteNavigateur {
  return {
    id,
    ongletId: 'onglet-1',
    verbe: 'clic',
    nature: 'agit',
    description: 'cliquer sur bouton « Envoyer »',
    etat: 'fait',
    debut: Date.now(),
    ...partiel
  }
}

/** `window.api.navigateur` simulé : état poussé à la main, comme le processus principal le ferait. */
function simulerNavigateur(initial: Partial<EtatNavigateur> = {}) {
  const abonnes = new Set<(etat: EtatNavigateur) => void>()
  let etat: EtatNavigateur = {
    conversationId: 'A',
    onglets: [],
    ongletActif: null,
    agentPilote: false,
    mode: null,
    nombreAnnotations: 0,
    gestes: [],
    pilotage: 'libre',
    ...initial
  }
  let annotations: AnnotationNavigateur[] = []
  let reglages: ReglagesNavigateur = { garderCookies: true, ouvrirLiensDuChatIci: false }
  const api = {
    etat: vi.fn(async (conversationId: string) => ({ ...etat, conversationId })),
    afficherFil: vi.fn(async () => undefined),
    ouvrir: vi.fn(async () => 'onglet-neuf'),
    naviguer: vi.fn(async () => undefined),
    reculer: vi.fn(async () => undefined),
    avancer: vi.fn(async () => undefined),
    recharger: vi.fn(async () => undefined),
    arreter: vi.fn(async () => undefined),
    activerOnglet: vi.fn(async () => undefined),
    fermerOnglet: vi.fn(async () => undefined),
    poserCadre: vi.fn(async () => undefined),
    basculerMode: vi.fn(async () => undefined),
    annotations: vi.fn(async () => annotations.map((a) => ({ ...a }))),
    supprimerAnnotation: vi.fn(async () => undefined),
    viderAnnotations: vi.fn(async () => undefined),
    repondreAccord: vi.fn(async () => undefined),
    reglages: {
      lire: vi.fn(async () => ({ ...reglages })),
      ecrire: vi.fn(async (partiel: Partial<ReglagesNavigateur>) => {
        reglages = { ...reglages, ...partiel }
        return { ...reglages }
      })
    },
    effacerDonnees: vi.fn(async () => undefined),
    ouvrirDansNavigateurParDefaut: vi.fn(async () => undefined),
    piloter: vi.fn(async () => undefined),
    surEtat: vi.fn((rappel: (etat: EtatNavigateur) => void) => {
      abonnes.add(rappel)
      return () => {
        abonnes.delete(rappel)
      }
    })
  }
  return {
    api,
    async pousser(partiel: Partial<EtatNavigateur>): Promise<void> {
      etat = { ...etat, ...partiel }
      await act(async () => {
        for (const rappel of [...abonnes]) rappel(etat)
        await vider()
      })
    },
    poserAnnotations(liste: AnnotationNavigateur[]): void {
      annotations = liste
    },
    poserReglages(partiel: Partial<ReglagesNavigateur>): void {
      reglages = { ...reglages, ...partiel }
    }
  }
}

async function vider(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

function touche(key: string, options: { shiftKey?: boolean } = {}): Promise<void> {
  return act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...options
      })
    )
    await vider()
  })
}

/**
 * Le nom accessible d'un bouton : sans ce qui est caché aux lecteurs d'écran (la coche ✓ du menu).
 * fix-ok: cause mesurée (conv-1286) — le textContent brut vaut « ✓Garder les cookies » : comparé tel
 * quel, le test du menu ⋮ échoue (« bouton introuvable : Garder les cookies », code 1).
 */
function nomAccessible(b: Element): string {
  const copie = b.cloneNode(true) as Element
  copie.querySelectorAll('[aria-hidden="true"]').forEach((cache) => cache.remove())
  return copie.textContent?.trim() ?? ''
}

function bouton(racine: ParentNode, texte: string): HTMLButtonElement {
  const trouve = [...racine.querySelectorAll('button')].find(
    (b) => nomAccessible(b) === texte || b.getAttribute('aria-label') === texte
  )
  if (!trouve) throw new Error(`bouton introuvable : ${texte}`)
  return trouve as HTMLButtonElement
}

const ZONE = { left: 300, top: 80, width: 500, height: 400 }
const RECT_ZONE = { x: 300, y: 80, largeur: 500, hauteur: 400 }

// ── Fonctions pures ─────────────────────────────────────────────────────────────────────────────

describe('lienAOuvrirDansLePanneau — quels liens du fil vont dans le panneau', () => {
  it('un serveur local (localhost, 127.0.0.1, [::1]) s’ouvre ici, réglage éteint compris', () => {
    expect(lienAOuvrirDansLePanneau('http://localhost:5173', false)).toBe('http://localhost:5173/')
    expect(lienAOuvrirDansLePanneau('http://127.0.0.1:8080/x', false)).toBe(
      'http://127.0.0.1:8080/x'
    )
    expect(lienAOuvrirDansLePanneau('http://[::1]:3000/', false)).toBe('http://[::1]:3000/')
  })

  it('un site public garde son chemin actuel, SAUF si « ouvrir ici les liens du chat » est actif', () => {
    expect(lienAOuvrirDansLePanneau('https://exemple.fr/page', false)).toBeNull()
    expect(lienAOuvrirDansLePanneau('https://exemple.fr/page', true)).toBe(
      'https://exemple.fr/page'
    )
  })

  it('ni ancre, ni fichier, ni javascript: — même réglage actif', () => {
    expect(lienAOuvrirDansLePanneau('#', true)).toBeNull()
    expect(lienAOuvrirDansLePanneau('src/main/index.ts:12', true)).toBeNull()
    expect(lienAOuvrirDansLePanneau('javascript:alert(1)', true)).toBeNull()
  })
})

describe('adresseDeLaSaisie — URL ou recherche', () => {
  it('adresse tapée → adresse chargeable (http pour un serveur local)', () => {
    expect(adresseDeLaSaisie('localhost:5173')).toBe('http://localhost:5173/')
    expect(adresseDeLaSaisie('exemple.fr')).toBe('https://exemple.fr/')
  })
  it('des mots → recherche', () => {
    expect(adresseDeLaSaisie('meilleur navigateur')).toBe(
      'https://www.google.com/search?q=meilleur%20navigateur'
    )
    expect(adresseDeLaSaisie('   ')).toBeNull()
  })
})

describe('decouperAdresse — ce que la capsule montre au repos', () => {
  it('site, puis port, chemin et paramètres ; sans protocole ni barre finale', () => {
    expect(decouperAdresse('http://localhost:5173/tarifs?x=1#a')).toEqual({
      site: 'localhost',
      suite: ':5173/tarifs?x=1#a',
      chiffre: false
    })
    expect(decouperAdresse('https://exemple.fr/')).toEqual({
      site: 'exemple.fr',
      suite: '',
      chiffre: true
    })
  })
  it('le vrai site ressort, pas le leurre placé avant le @', () => {
    expect(decouperAdresse('https://banque.fr@pirate.net/compte')?.site).toBe('pirate.net')
  })
  it('jumeaux : saisie en cours, about:blank et data: n’ont pas de lecture', () => {
    expect(decouperAdresse('doc electron')).toBeNull()
    expect(decouperAdresse('about:blank')).toBeNull()
    expect(decouperAdresse('data:text/html,<p>x</p>')).toBeNull()
  })
})

describe('blocPourLeChat — ce que reçoit la saisie', () => {
  it('annotations : n°, URL, sélecteur, extrait, styles, commentaire, et la capture en image', () => {
    const { texte, images } = blocPourLeChat(
      [annotation('a', 'plus gros'), annotation('b', '')],
      false
    )
    expect(texte).toContain('[Navigateur intégré — 2 annotations]')
    expect(texte).toContain('1. http://localhost:5173/')
    expect(texte).toContain('Sélecteur : main > button.primaire')
    expect(texte).toContain('Extrait : « Envoyer »')
    expect(texte).toContain('Styles : police Inter · taille 14px · couleur rgb(0, 0, 0)')
    expect(texte).toContain('Commentaire : plus gros')
    expect(texte).toContain('2. http://localhost:5173/')
    expect(images.map((f) => f.type)).toEqual(['image/png', 'image/png'])
    // Noms DISTINCTS : `addFiles` dédoublonne par nom.
    expect(new Set(images.map((f) => f.name)).size).toBe(2)
    expect(texte).toContain(`Capture : ${images[0].name} (jointe)`)
    expect(images[0].size).toBe(8)
  })
  it('élément choisi : pas de ligne Commentaire', () => {
    const { texte } = blocPourLeChat([annotation('a', '')], true)
    expect(texte.startsWith('[Navigateur intégré — élément choisi]')).toBe(true)
    expect(texte).not.toContain('Commentaire')
  })
})

// ── Le panneau seul ─────────────────────────────────────────────────────────────────────────────

describe('NavigateurIntegre — le panneau', () => {
  beforeAll(installRafShim)
  let racine: Root | null = null
  let conteneur: HTMLDivElement | null = null
  let nav: ReturnType<typeof simulerNavigateur>
  let props: PropsNavigateurIntegre

  beforeEach(() => {
    window.localStorage.clear()
    nav = simulerNavigateur({ onglets: [onglet('onglet-1')], ongletActif: 'onglet-1' })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { navigateur: nav.api, getZoomFactor: () => 1.25 }
    })
    const original = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      if (this.classList.contains('navigateur-zone')) {
        return { ...ZONE, x: ZONE.left, y: ZONE.top, right: 800, bottom: 480, toJSON: () => ({}) }
      }
      return original.call(this)
    })
    props = {
      conversationId: 'A',
      visible: true,
      onFermer: vi.fn(),
      onEnvoyerAuChat: vi.fn(),
      onElementChoisi: vi.fn()
    }
  })

  afterEach(async () => {
    if (racine) await act(async () => racine?.unmount())
    racine = null
    conteneur?.remove()
    conteneur = null
    vi.restoreAllMocks()
  })

  async function monter(surcharge: Partial<PropsNavigateurIntegre> = {}): Promise<void> {
    props = { ...props, ...surcharge }
    if (!conteneur) {
      conteneur = document.createElement('div')
      document.body.append(conteneur)
      racine = createRoot(conteneur)
    }
    await act(async () => {
      racine?.render(createElement(NavigateurIntegre, props))
      await vider()
    })
  }

  it('visible : la page est posée sur la zone mesurée, avec le zoom de la fenêtre', async () => {
    await monter()
    expect(nav.api.afficherFil).toHaveBeenCalledWith('A')
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(RECT_ZONE, 1.25)
  })

  it('caché (autre écran, aperçu d’image) : la page est retirée — puis reposée au retour', async () => {
    await monter()
    await monter({ visible: false })
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(null, 1.25)
    await monter({ visible: true })
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(RECT_ZONE, 1.25)
  })

  it('menu ⋮ ouvert : la page est retirée (elle passerait au-dessus du menu) ; Échap la rend', async () => {
    await monter()
    await act(async () => bouton(conteneur!, 'Plus d’options').click())
    expect(conteneur!.querySelector('[role="menu"]')).toBeTruthy()
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(null, 1.25)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(conteneur!.querySelector('[role="menu"]')).toBeNull()
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(RECT_ZONE, 1.25)
  })

  it('menu ⋮ : les réglages s’écrivent, les données s’effacent, l’onglet part au navigateur par défaut', async () => {
    await monter()
    await act(async () => bouton(conteneur!, 'Plus d’options').click())
    await act(async () => bouton(conteneur!, 'Ouvrir ici les liens du chat').click())
    expect(nav.api.reglages.ecrire).toHaveBeenCalledWith({ ouvrirLiensDuChatIci: true })
    await act(async () => bouton(conteneur!, 'Garder les cookies').click())
    expect(nav.api.reglages.ecrire).toHaveBeenCalledWith({ garderCookies: false })
    await act(async () => bouton(conteneur!, 'Ouvrir dans le navigateur par défaut').click())
    expect(nav.api.ouvrirDansNavigateurParDefaut).toHaveBeenCalledWith('http://localhost:5173/')
    await act(async () => bouton(conteneur!, 'Plus d’options').click())
    await act(async () => bouton(conteneur!, 'Effacer les données').click())
    expect(nav.api.effacerDonnees).toHaveBeenCalledTimes(1)
  })

  it('démonté (panneau fermé, mosaïque) : la page est retirée et le fil n’est plus affiché', async () => {
    await monter()
    await act(async () => racine?.unmount())
    racine = null
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(null, 1.25)
    expect(nav.api.afficherFil).toHaveBeenLastCalledWith(null)
  })

  it('Ctrl+T ouvre un onglet, Ctrl+Shift+S bascule « Choisir un élément »', async () => {
    await monter()
    await touche('t')
    expect(nav.api.ouvrir).toHaveBeenCalledWith('A', 'about:blank')
    await touche('S', { shiftKey: true })
    expect(nav.api.basculerMode).toHaveBeenLastCalledWith('choisir')
    // Déjà en mode choisir : le même raccourci l'éteint.
    await nav.pousser({ mode: 'choisir' })
    await touche('S', { shiftKey: true })
    expect(nav.api.basculerMode).toHaveBeenLastCalledWith(null)
  })

  it('jumeau : panneau caché, les raccourcis ne font rien', async () => {
    await monter({ visible: false })
    await touche('t')
    await touche('S', { shiftKey: true })
    expect(nav.api.ouvrir).not.toHaveBeenCalled()
    expect(nav.api.basculerMode).not.toHaveBeenCalled()
  })

  it('barre d’adresse : Entrée charge l’URL dans l’onglet actif, des mots lancent une recherche', async () => {
    await monter()
    const champ = conteneur!.querySelector(
      'input[aria-label="Adresse ou recherche"]'
    ) as HTMLInputElement
    expect(champ.value).toBe('http://localhost:5173/')
    const saisir = async (valeur: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          champ,
          valeur
        )
        champ.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        champ.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await vider()
      })
    }
    await saisir('localhost:3000/admin')
    expect(nav.api.naviguer).toHaveBeenLastCalledWith('onglet-1', 'http://localhost:3000/admin')
    await saisir('doc electron')
    expect(nav.api.naviguer).toHaveBeenLastCalledWith(
      'onglet-1',
      'https://www.google.com/search?q=doc%20electron'
    )
  })

  it('onglets : clic active, × ferme, + en ouvre un, et la rangée reste là', async () => {
    await nav.pousser({})
    await monter()
    await nav.pousser({ onglets: [onglet('onglet-1'), onglet('onglet-2', 'https://exemple.fr/')] })
    await act(async () => bouton(conteneur!, 'Fermer l’onglet Page de dev').click())
    expect(nav.api.fermerOnglet).toHaveBeenCalledWith('onglet-1')
    const onglets = conteneur!.querySelectorAll('[role="tab"]')
    expect(onglets).toHaveLength(2)
    await act(async () => (onglets[1] as HTMLButtonElement).click())
    expect(nav.api.activerOnglet).toHaveBeenCalledWith('onglet-2')
    expect(conteneur!.querySelector('[role="tablist"]')).toBeTruthy()
    await act(async () => bouton(conteneur!, 'Nouvel onglet (Ctrl+T)').click())
    expect(nav.api.ouvrir).toHaveBeenCalledWith('A', 'about:blank')
    expect(conteneur!.querySelector('[role="tablist"]')).toBeTruthy()
  })

  // « il a pas d'onglet le navigateur ? » (conv-1306, 2026-10-30) : repliés dans un compteur, on ne
  // les trouvait pas. La rangée est toujours là, juste sous l'adresse, même sans aucun onglet.
  it('onglets toujours visibles juste sous l’adresse, + au bout, sans compteur', async () => {
    await monter()
    const rangee = conteneur!.querySelector('.navigateur-onglets')!
    expect(rangee.previousElementSibling).toBe(conteneur!.querySelector('.navigateur-barre'))
    expect(conteneur!.querySelector('.navigateur-compteur')).toBeNull()
    expect(rangee.querySelector('[role="tablist"] [role="tab"]')).toBeTruthy()
    // Le + ne défile pas avec les onglets : il reste à portée quand ils débordent.
    const plus = bouton(conteneur!, 'Nouvel onglet (Ctrl+T)')
    expect(rangee.lastElementChild).toBe(plus)
    expect(plus.closest('[role="tablist"]')).toBeNull()
    await nav.pousser({ onglets: [], ongletActif: null })
    expect(conteneur!.querySelector('.navigateur-onglets')).toBe(rangee)
    expect(rangee.lastElementChild).toBe(bouton(conteneur!, 'Nouvel onglet (Ctrl+T)'))
  })

  it('rangée pleine : la molette la fait défiler, l’onglet actif est ramené à l’écran', async () => {
    const montrer = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: montrer
    })
    try {
      await monter()
      const liste = conteneur!.querySelector('[role="tablist"]')!
      await act(async () => {
        liste.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }))
      })
      expect(liste.scrollLeft).toBe(120)
      montrer.mockClear()
      await nav.pousser({
        onglets: [onglet('onglet-1'), onglet('onglet-2', 'https://exemple.fr/')],
        ongletActif: 'onglet-2'
      })
      expect(montrer).toHaveBeenCalledTimes(1)
      expect(montrer.mock.contexts[0]).toBe(conteneur!.querySelector('.navigateur-onglet.is-actif'))
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('la zone déplacée sans changer de taille : la page suit (l’observateur de taille ne le voit pas)', async () => {
    await monter()
    const appels = nav.api.poserCadre.mock.calls.length
    ZONE.top = 118
    try {
      await nav.pousser({ demandeAccord: { origine: 'https://exemple.fr', action: 'cliquer' } })
      expect(nav.api.poserCadre.mock.calls.length).toBe(appels + 1)
      expect(nav.api.poserCadre).toHaveBeenLastCalledWith({ ...RECT_ZONE, y: 118 }, 1.25)
    } finally {
      ZONE.top = 80
    }
  })

  it('Plein cadre vit dans le menu ⋮ et se retire par le même chemin', async () => {
    await monter()
    expect(
      [...conteneur!.querySelectorAll('button')].some((b) => nomAccessible(b) === 'Plein cadre')
    ).toBe(false)
    await act(async () => bouton(conteneur!, 'Plus d’options').click())
    await act(async () => bouton(conteneur!, 'Plein cadre').click())
    const panneau = conteneur!.querySelector('[data-testid="navigateur-panneau"]')!
    expect(panneau.classList.contains('is-plein-cadre')).toBe(true)
    // Choisir referme le menu : la page revient.
    expect(conteneur!.querySelector('[role="menu"]')).toBeNull()
    await act(async () => bouton(conteneur!, 'Plus d’options').click())
    await act(async () => bouton(conteneur!, 'Côte à côte').click())
    expect(panneau.classList.contains('is-plein-cadre')).toBe(false)
  })

  // « pas dans la barre d'url la crois dans la barre d'url enleve la » (conv-1317, 2026-10-30).
  it('la croix ferme le panneau, au bout de la rangée et hors de la barre d’adresse', async () => {
    await monter()
    const croix = bouton(conteneur!, 'Fermer le navigateur (Ctrl+Shift+B)')
    expect(conteneur!.querySelector('.navigateur-capsule button[aria-label*="Fermer"]')).toBeNull()
    expect(croix.closest('.navigateur-capsule')).toBeNull()
    expect(conteneur!.querySelector('.navigateur-barre')!.lastElementChild).toBe(croix)
    await act(async () => croix.click())
    expect(props.onFermer).toHaveBeenCalledTimes(1)
  })

  it('capsule : cadenas seulement en https, site lisible, globe sur http', async () => {
    await monter()
    const lecture = (): string =>
      conteneur!.querySelector('.navigateur-adresse-vue')?.textContent ?? ''
    expect(lecture()).toBe('localhost:5173')
    expect(conteneur!.querySelector('.navigateur-site rect')).toBeNull()
    await nav.pousser({ onglets: [onglet('onglet-1', 'https://exemple.fr/doc')] })
    expect(lecture()).toBe('exemple.fr/doc')
    expect(conteneur!.querySelector('.navigateur-site rect')).toBeTruthy()
  })

  it('page en chargement : le tourniquet se voit dans la capsule', async () => {
    await monter()
    await nav.pousser({ onglets: [{ ...onglet('onglet-1'), chargement: true }] })
    expect(conteneur!.querySelector('.navigateur-site .spinner')).toBeTruthy()
  })

  it('l’agent pilote : bandeau affiché, puis retiré, et sa phrase n’est dite qu’une fois', async () => {
    await monter()
    const bandeau = (): Element | null =>
      conteneur!.querySelector('[data-testid="navigateur-pilotage"]')
    expect(bandeau()).toBeNull()
    await nav.pousser({ agentPilote: true })
    expect(bandeau()?.querySelector('.navigateur-pilotage-texte')?.textContent).toBe(
      'L’agent pilote cet onglet'
    )
    // Doublon lu sur la capture du lot 2 (conv-1286) : la tête du cadre répétait le bandeau.
    expect(conteneur!.textContent?.split('L’agent pilote cet onglet')).toHaveLength(2)
    await nav.pousser({ agentPilote: false })
    expect(bandeau()).toBeNull()
  })

  it('cadre de page : allumé avec l’agent, éteint sans lui, bande toujours là (la page ne saute pas)', async () => {
    await monter()
    const cadre = conteneur!.querySelector('.navigateur-cadre')!
    const tete = (): string => conteneur!.querySelector('.navigateur-cadre-tete')?.textContent ?? ''
    expect(cadre.classList.contains('is-agent')).toBe(false)
    expect(tete()).toBe('Page de dev')
    await nav.pousser({ agentPilote: true })
    expect(cadre.classList.contains('is-agent')).toBe(true)
    // La phrase vit dans le bandeau du pas-à-pas : la bande garde le titre de la page.
    expect(tete()).toBe('Page de dev')
    await nav.pousser({ agentPilote: false })
    expect(cadre.classList.contains('is-agent')).toBe(false)
    expect(tete()).toBe('Page de dev')
    // Le cadre reste le même nœud : il ne se remonte pas, donc la zone mesurée non plus.
    expect(conteneur!.querySelector('.navigateur-cadre')).toBe(cadre)
  })

  it('demande d’accord sans pilotage (l’ordre réel du principal) : cadre allumé, bande honnête', async () => {
    await monter()
    await nav.pousser({
      agentPilote: false,
      demandeAccord: { origine: 'https://exemple.fr', action: 'cliquer' }
    })
    expect(conteneur!.querySelector('.navigateur-cadre')!.classList.contains('is-agent')).toBe(true)
    expect(conteneur!.querySelector('.navigateur-cadre-tete')?.textContent).toBe(
      'L’agent attend votre accord'
    )
    expect(conteneur!.querySelector('[data-testid="navigateur-pilotage"]')).toBeNull()
    // L'accord se donne DANS le cadre, au pied de la page.
    const cadre = conteneur!.querySelector('.navigateur-cadre')!
    expect(cadre.lastElementChild?.classList.contains('navigateur-accord')).toBe(true)
  })

  it('carte d’accord : site et action lisibles, chaque réponse part au principal', async () => {
    await monter()
    expect(conteneur!.textContent).not.toContain('L’agent veut agir sur')
    const demandeAccord = {
      origine: 'https://exemple.fr',
      action: 'cliquer sur bouton « Envoyer »'
    }
    await nav.pousser({ demandeAccord })
    expect(conteneur!.textContent).toContain('L’agent veut agir sur https://exemple.fr')
    expect(conteneur!.textContent).toContain('cliquer sur bouton « Envoyer »')
    await act(async () => bouton(conteneur!, 'Autoriser une fois').click())
    expect(nav.api.repondreAccord).toHaveBeenLastCalledWith('https://exemple.fr', 'une-fois')
    await act(async () => bouton(conteneur!, 'Toujours').click())
    expect(nav.api.repondreAccord).toHaveBeenLastCalledWith('https://exemple.fr', 'toujours')
    await act(async () => bouton(conteneur!, 'Refuser').click())
    expect(nav.api.repondreAccord).toHaveBeenLastCalledWith('https://exemple.fr', 'refuser')
  })

  it('annotations : listées (n°, extrait, commentaire), supprimables, envoyées en lot puis vidées', async () => {
    await monter()
    const lot = [annotation('a', 'plus gros'), annotation('b', '')]
    nav.poserAnnotations(lot)
    await nav.pousser({ mode: 'annoter', nombreAnnotations: 2 })
    const liste = conteneur!.querySelector('[data-testid="navigateur-annotations"]')!
    expect(liste.textContent).toContain('Annotations (2)')
    expect(liste.textContent).toContain('plus gros')
    expect(liste.textContent).toContain('(sans commentaire)')
    // Puces : le commentaire se lit au survol.
    expect(liste.querySelector('li')?.getAttribute('title')).toBe('plus gros')
    await act(async () => bouton(conteneur!, 'Supprimer l’annotation 2').click())
    expect(nav.api.supprimerAnnotation).toHaveBeenCalledWith(lot[1].id)
    await act(async () => bouton(conteneur!, 'Envoyer au chat').click())
    expect(props.onEnvoyerAuChat).toHaveBeenCalledWith(lot)
    expect(nav.api.viderAnnotations).toHaveBeenCalledWith('A')
    expect(conteneur!.querySelector('[data-testid="navigateur-annotations"]')).toBeNull()
    // Une annotation du mode Annoter n'est PAS un élément choisi.
    expect(props.onElementChoisi).not.toHaveBeenCalled()
  })

  // « enleve le bouton annoter » (conv-1306, 2026-10-30).
  it('plus de bouton Annoter ni de badge : Choisir reste seul et bascule le mode', async () => {
    await monter()
    nav.poserAnnotations([annotation('a', 'déjà posée')])
    await nav.pousser({ nombreAnnotations: 1 })
    const noms = [...conteneur!.querySelectorAll('button')].map(
      (b) => b.getAttribute('aria-label') ?? ''
    )
    expect(noms).not.toContain('Annoter')
    expect(conteneur!.querySelectorAll('.navigateur-mode')).toHaveLength(1)
    expect(conteneur!.querySelector('[data-testid="navigateur-badge"]')).toBeNull()
    // Celles déjà posées restent lisibles et envoyables.
    expect(conteneur!.querySelector('[data-testid="navigateur-annotations"]')).toBeTruthy()
    await act(async () => bouton(conteneur!, 'Choisir').click())
    expect(nav.api.basculerMode).toHaveBeenLastCalledWith('choisir')
  })

  it('Choisir un élément : l’élément cliqué part tout de suite au chat et quitte la liste', async () => {
    await monter()
    await nav.pousser({ mode: 'choisir' })
    const choisie = annotation('c', '')
    nav.poserAnnotations([choisie])
    await nav.pousser({ mode: 'choisir', nombreAnnotations: 1 })
    expect(props.onElementChoisi).toHaveBeenCalledWith(choisie)
    expect(nav.api.supprimerAnnotation).toHaveBeenCalledWith(choisie.id)
    expect(conteneur!.querySelector('[data-testid="navigateur-annotations"]')).toBeNull()
  })

  // ── Pas-à-pas : frise et bandeau de pilotage (conv-1286, maquette « 1 · Jalons ») ─────────────

  const bandeau = (): Element | null =>
    conteneur!.querySelector('[data-testid="navigateur-pilotage"]')
  const frise = (): Element | null => conteneur!.querySelector('[data-testid="navigateur-frise"]')
  const boutonsDuBandeau = (): string[] =>
    [...bandeau()!.querySelectorAll('button')].map((b) => b.textContent ?? '')
  const texteDuBandeau = (): string =>
    bandeau()!.querySelector('[role="status"]')?.textContent ?? ''

  it('frise : absente sans geste, puis entre la barre d’adresse et la page', async () => {
    await monter()
    expect(frise()).toBeNull()
    await nav.pousser({ gestes: [geste('g1')] })
    const suit = (a: Element, b: Element): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(suit(conteneur!.querySelector('.navigateur-barre')!, frise()!)).toBe(true)
    expect(suit(frise()!, conteneur!.querySelector('.navigateur-zone')!)).toBe(true)
  })

  it('frise : elle suit l’onglet actif', async () => {
    await monter()
    await nav.pousser({
      onglets: [onglet('onglet-1'), onglet('onglet-2')],
      gestes: [geste('g1', { ongletId: 'onglet-2' })]
    })
    expect(frise()).toBeNull()
    await nav.pousser({ ongletActif: 'onglet-2' })
    expect(frise()).toBeTruthy()
  })

  it('bandeau, libre : Pause + Reprendre la main', async () => {
    await monter()
    await nav.pousser({ agentPilote: true })
    expect(texteDuBandeau()).toBe('L’agent pilote cet onglet')
    expect(boutonsDuBandeau()).toEqual(['Pause', 'Reprendre la main'])
  })

  it('bandeau, en pause : « geste N / M » + Reprendre, Pas suivant, Reprendre la main', async () => {
    await monter()
    await nav.pousser({
      pilotage: 'pause',
      gestes: [geste('g1'), geste('g2', { etat: 'prochain' }), geste('g3', { etat: 'prochain' })]
    })
    expect(texteDuBandeau()).toBe('L’agent pilote cet onglet · en pause · geste 2 / 3')
    expect(boutonsDuBandeau()).toEqual(['Reprendre', 'Pas suivant', 'Reprendre la main'])
  })

  it('jumeau : en pause sans geste sur cet onglet, pas de compteur à inventer', async () => {
    await monter()
    await nav.pousser({ pilotage: 'pause' })
    expect(texteDuBandeau()).toBe('L’agent pilote cet onglet · en pause')
  })

  it('bandeau, main reprise : « Tu as la main » + Rendre la main à l’agent, seul', async () => {
    await monter()
    await nav.pousser({ pilotage: 'main' })
    expect(texteDuBandeau()).toBe('Tu as la main')
    expect(boutonsDuBandeau()).toEqual(['Rendre la main à l’agent'])
  })

  it('chaque bouton envoie SON ordre, pour CE fil', async () => {
    await monter()
    const cliquer = async (libelle: string): Promise<void> => {
      await act(async () => bouton(bandeau()!, libelle).click())
    }
    await nav.pousser({ agentPilote: true })
    await cliquer('Pause')
    expect(nav.api.piloter).toHaveBeenLastCalledWith('A', 'pause')
    await cliquer('Reprendre la main')
    expect(nav.api.piloter).toHaveBeenLastCalledWith('A', 'reprendre-la-main')
    await nav.pousser({ pilotage: 'pause' })
    await cliquer('Reprendre')
    expect(nav.api.piloter).toHaveBeenLastCalledWith('A', 'reprendre')
    await cliquer('Pas suivant')
    expect(nav.api.piloter).toHaveBeenLastCalledWith('A', 'pas-suivant')
    await cliquer('Reprendre la main')
    expect(nav.api.piloter).toHaveBeenLastCalledWith('A', 'reprendre-la-main')
    await nav.pousser({ pilotage: 'main' })
    await cliquer('Rendre la main à l’agent')
    expect(nav.api.piloter).toHaveBeenLastCalledWith('A', 'rendre-la-main')
    expect(nav.api.piloter).toHaveBeenCalledTimes(6)
  })

  it('un ordre qui échoue se dit dans le panneau', async () => {
    await monter()
    await nav.pousser({ agentPilote: true })
    nav.api.piloter.mockRejectedValueOnce(new Error('canal coupé'))
    await act(async () => {
      bouton(bandeau()!, 'Pause').click()
      await vider()
    })
    expect(conteneur!.querySelector('[role="alert"]')?.textContent).toBe('canal coupé')
  })

  it('l’agent ne pilote pas, rien en cours, aucun geste : pas de bandeau', async () => {
    await monter()
    expect(bandeau()).toBeNull()
  })

  describe('le bandeau survit au dernier geste', () => {
    // `shouldAdvanceTime` : l'horloge simulée continue de courir, sinon `vider()` ne rendrait jamais.
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'Date'],
        shouldAdvanceTime: true
      })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    const allerA = (instant: number): Promise<void> =>
      act(async () => {
        vi.advanceTimersByTime(instant - Date.now())
      })

    it('visible 20 s après le geste, entre deux gestes, puis retiré', async () => {
      await monter()
      const debut = Date.now()
      await nav.pousser({ gestes: [geste('g1', { debut })] })
      expect(bandeau()).toBeTruthy()
      await allerA(debut + 19_500)
      expect(bandeau()).toBeTruthy()
      await allerA(debut + 20_001)
      expect(bandeau()).toBeNull()
      // La frise, elle, reste : c'est le journal du fil.
      expect(frise()).toBeTruthy()
    })

    it('un nouveau geste relance les 20 s', async () => {
      await monter()
      const debut = Date.now()
      await nav.pousser({ gestes: [geste('g1', { debut })] })
      await allerA(debut + 15_000)
      const second = Date.now()
      await nav.pousser({ gestes: [geste('g1', { debut }), geste('g2', { debut: second })] })
      await allerA(debut + 21_000)
      expect(bandeau()).toBeTruthy()
      await allerA(second + 20_001)
      expect(bandeau()).toBeNull()
    })

    it('jumeau : un geste de plus de 20 s à l’ouverture du panneau ne rallume rien', async () => {
      await nav.pousser({ gestes: [geste('g1', { debut: Date.now() - 60_000 })] })
      await monter()
      expect(bandeau()).toBeNull()
      expect(frise()).toBeTruthy()
    })

    it('jumeau : un geste sur un AUTRE onglet ne garde pas le bandeau', async () => {
      await monter()
      await nav.pousser({ gestes: [geste('g1', { ongletId: 'onglet-2' })] })
      expect(bandeau()).toBeNull()
    })

    it('en pause ou main reprise : il reste, quel que soit l’âge du dernier geste', async () => {
      await monter()
      const vieux = geste('g1', { debut: Date.now() - 60_000 })
      await nav.pousser({ gestes: [vieux], pilotage: 'pause' })
      expect(bandeau()).toBeTruthy()
      await nav.pousser({ pilotage: 'main' })
      expect(bandeau()).toBeTruthy()
      await nav.pousser({ pilotage: 'libre' })
      expect(bandeau()).toBeNull()
    })

    it('tant que l’agent pilote : il reste, quel que soit l’âge du dernier geste', async () => {
      await monter()
      const vieux = geste('g1', { debut: Date.now() - 60_000 })
      await nav.pousser({ gestes: [vieux], agentPilote: true })
      expect(bandeau()).toBeTruthy()
    })

    it('un geste pas fini (question d’accord de 120 s) le garde : on peut reprendre la main', async () => {
      await monter()
      const debut = Date.now()
      await nav.pousser({ gestes: [geste('g1', { debut, etat: 'en-cours' })] })
      await allerA(debut + 60_000)
      expect(bandeau()).toBeTruthy()
      await nav.pousser({ gestes: [geste('g1', { debut, etat: 'fait' })] })
      expect(bandeau()).toBeNull()
    })
  })
})

// ── Intégration dans la vue chat ────────────────────────────────────────────────────────────────

const historiqueAvecLiens = [
  { role: 'user', content: 'lance le serveur', ts: 1, messageId: 'm-1' },
  {
    role: 'assistant',
    content: 'Ouvrez http://localhost:5173 ou https://exemple.fr/doc pour voir.',
    ts: 2,
    messageId: 'm-2',
    turnId: 'tour-1',
    status: 'completed',
    done: true,
    parts: [
      { kind: 'text', text: 'Ouvrez http://localhost:5173 ou https://exemple.fr/doc pour voir.' }
    ]
  }
]

describe('ChatView — navigateur intégré', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let nav: ReturnType<typeof simulerNavigateur>
  // Un lien que personne ne retient partirait dans une vraie navigation de happy-dom : on la bloque
  // APRÈS la vue chat (écouteur de fenêtre, phase de remontée) en notant si elle l'avait retenu.
  let retenus: boolean[] = []
  const bloquer = (event: Event): void => {
    if ((event.target as Element | null)?.closest?.('a[href]')) {
      retenus.push(event.defaultPrevented)
      event.preventDefault()
    }
  }

  beforeEach(async () => {
    window.localStorage.clear()
    retenus = []
    window.addEventListener('click', bloquer)
    nav = simulerNavigateur()
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', historiqueAvecLiens)]),
        navigateur: nav.api
      })
    )
    await h.click('.conv-pick')
    await act(async () => vider())
  })

  afterEach(async () => {
    window.removeEventListener('click', bloquer)
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  const panneau = (): Element | null =>
    h!.container.querySelector('[data-testid="navigateur-panneau"]')

  it('Ctrl+Shift+B ouvre puis ferme le panneau ; fermé, la page native est retirée', async () => {
    expect(panneau()).toBeNull()
    await touche('B', { shiftKey: true })
    expect(panneau()).toBeTruthy()
    expect(nav.api.afficherFil).toHaveBeenCalledWith('A')
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }), 1)
    await touche('B', { shiftKey: true })
    expect(panneau()).toBeNull()
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(null, 1)
  })

  it('le bouton de l’en-tête du fil ouvre et ferme le même panneau', async () => {
    await h!.click('[data-testid="chat-navigateur-toggle"]')
    expect(panneau()).toBeTruthy()
    await h!.click('[data-testid="chat-navigateur-toggle"]')
    expect(panneau()).toBeNull()
  })

  it('l’agent ouvre une page dans le fil actif : le panneau s’ouvre tout seul', async () => {
    await nav.pousser({ onglets: [onglet('onglet-1')], ongletActif: 'onglet-1' })
    expect(panneau()).toBeTruthy()
  })

  it('jumeau : une page ouverte dans un AUTRE fil n’ouvre rien', async () => {
    await nav.pousser({
      conversationId: 'B',
      onglets: [onglet('onglet-9')],
      ongletActif: 'onglet-9'
    })
    expect(panneau()).toBeNull()
  })

  it('« Envoyer au chat » : le bloc structuré arrive dans la saisie et la capture est jointe', async () => {
    await touche('B', { shiftKey: true })
    const lot = [annotation('a', 'plus gros')]
    nav.poserAnnotations(lot)
    await nav.pousser({
      onglets: [onglet('onglet-1')],
      ongletActif: 'onglet-1',
      nombreAnnotations: 1
    })
    await act(async () => bouton(h!.container, 'Envoyer au chat').click())
    await act(async () => vider())
    const saisie = h!.textarea().value
    expect(saisie).toContain('[Navigateur intégré — 1 annotation]')
    expect(saisie).toContain('Sélecteur : main > button.primaire')
    expect(saisie).toContain('Commentaire : plus gros')
    const nom = blocPourLeChat(lot, false).images[0].name
    expect(h!.container.querySelector('.attachment-list.pending')?.textContent).toContain(nom)
    expect(nav.api.viderAnnotations).toHaveBeenCalledWith('A')
    expect(chatApiAppelee('pilotChat')).toBe(false)
  })

  it('« Choisir un élément » : l’élément cliqué arrive dans la saisie, sans envoyer', async () => {
    await touche('B', { shiftKey: true })
    await nav.pousser({ onglets: [onglet('onglet-1')], ongletActif: 'onglet-1', mode: 'choisir' })
    nav.poserAnnotations([annotation('c', '')])
    await nav.pousser({ mode: 'choisir', nombreAnnotations: 1 })
    await act(async () => vider())
    expect(h!.textarea().value).toContain('[Navigateur intégré — élément choisi]')
    expect(chatApiAppelee('pilotChat')).toBe(false)
  })

  it('lien localhost du fil : ouvert dans le panneau, pas dans le navigateur du système', async () => {
    const lien = h!.container.querySelector('a[href="http://localhost:5173"]') as HTMLAnchorElement
    expect(lien).toBeTruthy()
    await act(async () => {
      lien.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      await vider()
    })
    expect(retenus).toEqual([true])
    expect(nav.api.ouvrir).toHaveBeenCalledWith('A', 'http://localhost:5173/')
    expect(panneau()).toBeTruthy()
  })

  it('jumeau : lien public, réglage éteint → comportement actuel (rien d’ouvert ici)', async () => {
    await act(async () => vider())
    const lien = h!.container.querySelector('a[href="https://exemple.fr/doc"]') as HTMLAnchorElement
    expect(lien).toBeTruthy()
    await act(async () => {
      lien.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      await vider()
    })
    expect(retenus).toEqual([false])
    expect(nav.api.ouvrir).not.toHaveBeenCalled()
    expect(panneau()).toBeNull()
  })

  function chatApiAppelee(nom: string): boolean {
    const fn = (window.api as unknown as Record<string, { mock?: { calls: unknown[] } }>)[nom]
    return (fn?.mock?.calls.length ?? 0) > 0
  }
})

describe('ChatView — navigateur intégré, réglage « ouvrir ici les liens du chat » actif', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  it('un lien public s’ouvre aussi dans le panneau', async () => {
    const nav = simulerNavigateur()
    nav.poserReglages({ ouvrirLiensDuChatIci: true })
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', historiqueAvecLiens)]),
        navigateur: nav.api
      })
    )
    await h.click('.conv-pick')
    await act(async () => vider())
    const lien = h.container.querySelector('a[href="https://exemple.fr/doc"]') as HTMLAnchorElement
    const clic = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    await act(async () => {
      lien.dispatchEvent(clic)
      await vider()
    })
    expect(clic.defaultPrevented).toBe(true)
    expect(nav.api.ouvrir).toHaveBeenCalledWith('A', 'https://exemple.fr/doc')
  })
})

/*
 * Vu à la capture réelle (instance de test sans conversation, 2026-10-29) : le bouton globe
 * restait cliquable et ne montrait rien — les onglets appartiennent à un fil.
 */
describe('ChatView — navigateur intégré, aucun fil ouvert', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  it('bouton désactivé et Ctrl+Shift+B inerte tant qu’aucun fil n’est ouvert (jumeau actif : les tests ci-dessus, fil A ouvert)', async () => {
    const nav = simulerNavigateur()
    // Liste vide : sinon la vue rouvre d'elle-même le dernier fil (ChatView.derniere-conversation).
    h = await mountChat(
      chatApi({ conversations: vi.fn().mockResolvedValue([]), navigateur: nav.api })
    )
    await act(async () => vider())
    const bouton = (): HTMLButtonElement =>
      h!.container.querySelector('[data-testid="chat-navigateur-toggle"]') as HTMLButtonElement
    expect(bouton().disabled).toBe(true)
    await touche('B', { shiftKey: true })
    expect(h.container.querySelector('[data-testid="navigateur-panneau"]')).toBeNull()
    expect(bouton().getAttribute('aria-pressed')).toBe('false')
  })
})

describe('ChatView — navigateur intégré, vue chat pas à l’écran', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  it('panneau ouvert sur un autre onglet de l’app : la page n’est jamais posée, Ctrl+Shift+B inerte', async () => {
    const nav = simulerNavigateur()
    h = await mountChat(chatApi({ navigateur: nav.api }), { isActive: false })
    await h.click('.conv-pick')
    await touche('B', { shiftKey: true })
    expect(h.container.querySelector('[data-testid="navigateur-panneau"]')).toBeNull()
    await h.click('[data-testid="chat-navigateur-toggle"]')
    expect(h.container.querySelector('[data-testid="navigateur-panneau"]')).toBeTruthy()
    expect(nav.api.poserCadre).not.toHaveBeenCalledWith(expect.objectContaining({ x: 0 }), 1)
    expect(nav.api.poserCadre).toHaveBeenLastCalledWith(null, 1)
  })
})
