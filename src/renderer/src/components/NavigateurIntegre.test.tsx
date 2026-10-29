// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AnnotationNavigateur,
  EtatNavigateur,
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

  it('onglets : clic active, × ferme, + en ouvre un', async () => {
    await nav.pousser({})
    await monter()
    await nav.pousser({ onglets: [onglet('onglet-1'), onglet('onglet-2', 'https://exemple.fr/')] })
    const onglets = conteneur!.querySelectorAll('[role="tab"]')
    expect(onglets).toHaveLength(2)
    await act(async () => (onglets[1] as HTMLButtonElement).click())
    expect(nav.api.activerOnglet).toHaveBeenCalledWith('onglet-2')
    await act(async () => bouton(conteneur!, 'Fermer l’onglet Page de dev').click())
    expect(nav.api.fermerOnglet).toHaveBeenCalledWith('onglet-1')
    await act(async () => bouton(conteneur!, 'Nouvel onglet (Ctrl+T)').click())
    expect(nav.api.ouvrir).toHaveBeenCalledWith('A', 'about:blank')
  })

  it('l’agent pilote : bandeau affiché, puis retiré', async () => {
    await monter()
    expect(conteneur!.querySelector('[data-testid="navigateur-pilote"]')).toBeNull()
    await nav.pousser({ agentPilote: true })
    expect(conteneur!.querySelector('[data-testid="navigateur-pilote"]')?.textContent).toBe(
      'L’agent pilote cet onglet'
    )
    await nav.pousser({ agentPilote: false })
    expect(conteneur!.querySelector('[data-testid="navigateur-pilote"]')).toBeNull()
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
    await act(async () => bouton(conteneur!, 'Supprimer l’annotation 2').click())
    expect(nav.api.supprimerAnnotation).toHaveBeenCalledWith(lot[1].id)
    await act(async () => bouton(conteneur!, 'Envoyer au chat').click())
    expect(props.onEnvoyerAuChat).toHaveBeenCalledWith(lot)
    expect(nav.api.viderAnnotations).toHaveBeenCalledWith('A')
    expect(conteneur!.querySelector('[data-testid="navigateur-annotations"]')).toBeNull()
    // Une annotation du mode Annoter n'est PAS un élément choisi.
    expect(props.onElementChoisi).not.toHaveBeenCalled()
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
