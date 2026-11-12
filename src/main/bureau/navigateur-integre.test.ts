/**
 * Le moteur du navigateur intégré, sans Electron (lot 1/5) : une fausse fabrique rend des
 * pages en mémoire, et les scripts de page sont relus par `decoderAppelPage` pour répondre comme la
 * vraie page. La vraie fabrique est vérifiée en fin de fichier sur un Electron simulé.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Réponse d'un gestionnaire d'ouverture ; `createWindow` reçoit les options d'Electron. */
type ReponseOuverture = {
  action: string
  createWindow?: (options: { webContents: unknown }) => unknown
}

const electronSimule = vi.hoisted(() => {
  const vues: Array<{
    options: unknown
    visible: boolean | undefined
    rayon: number | undefined
    cadre: { x: number; y: number; width: number; height: number }
    gestes: string[]
    webContents: {
      id: number
      session: unknown
      ecoutes: Map<string, (...args: unknown[]) => void>
      ouvertureFenetre?: (d: { url: string; disposition: string }) => ReponseOuverture
    }
  }> = []
  const sessionsParId = new Map<string, unknown>()
  /** Fabrique une page seule, comme celle qu'Electron prépare pour une fenêtre liée. */
  const pages: { creer?: () => unknown } = {}
  return { vues, sessionsParId, pages }
})

vi.mock('electron', () => {
  const webRequest = {
    termine: null as null | ((d: unknown) => void),
    erreur: null as null | ((d: unknown) => void),
    onCompleted(_f: unknown, l: (d: unknown) => void): void {
      this.termine = l
    },
    onErrorOccurred(_f: unknown, l: (d: unknown) => void): void {
      this.erreur = l
    }
  }
  const sessionPartagee = {
    webRequest,
    setPermissionRequestHandler: vi.fn(),
    getUserAgent: () => 'Mozilla/5.0 Chrome/140.0.0.0 Electron/44.5.1 Safari/537.36',
    setUserAgent: vi.fn(),
    on: vi.fn()
  }
  electronSimule.sessionsParId.set('unique', sessionPartagee)
  let prochainId = 100
  function creerContenu(): WebContentsView['webContents'] {
    const ecoutes = new Map<string, (...args: unknown[]) => void>()
    const contenu = {
      id: prochainId++,
      session: sessionPartagee,
      getUserAgent: () => 'Mozilla/5.0 Chrome/140.0.0.0 Electron/44.5.1 Safari/537.36',
      setUserAgent: vi.fn(),
      ecoutes,
      ouvertureFenetre: undefined as
        undefined | ((d: { url: string; disposition: string }) => ReponseOuverture),
      on(nom: string, f: (...args: unknown[]) => void): void {
        ecoutes.set(nom, f)
      },
      once(nom: string, f: (...args: unknown[]) => void): void {
        ecoutes.set(nom, f)
      },
      setWindowOpenHandler(f: (d: { url: string; disposition: string }) => ReponseOuverture): void {
        contenu.ouvertureFenetre = f
      }
    }
    return contenu
  }
  electronSimule.pages.creer = creerContenu
  class WebContentsView {
    options: unknown
    visible: boolean | undefined
    rayon: number | undefined
    cadre = { x: 0, y: 0, width: 0, height: 0 }
    gestes: string[] = []
    webContents: {
      id: number
      session: unknown
      ecoutes: Map<string, (...args: unknown[]) => void>
      ouvertureFenetre?: (d: { url: string; disposition: string }) => ReponseOuverture
      on: (nom: string, f: (...args: unknown[]) => void) => void
      once: (nom: string, f: (...args: unknown[]) => void) => void
      setWindowOpenHandler: (
        f: (d: { url: string; disposition: string }) => ReponseOuverture
      ) => void
    }
    constructor(options: { webContents?: WebContentsView['webContents'] }) {
      this.options = options
      this.webContents = options.webContents ?? creerContenu()
      electronSimule.vues.push(this)
    }
    setVisible(v: boolean): void {
      this.visible = v
      this.gestes.push(`visible ${v}`)
    }
    getVisible(): boolean {
      return this.visible === true
    }
    setBounds(cadre: { x: number; y: number; width: number; height: number }): void {
      this.cadre = cadre
      this.gestes.push(`cadre y=${cadre.y} ${cadre.width}x${cadre.height}`)
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return this.cadre
    }
    setBorderRadius(rayon: number): void {
      this.rayon = rayon
    }
  }
  return {
    app: { getPath: () => tmpdir() },
    session: { fromPartition: () => sessionPartagee },
    shell: { openExternal: vi.fn() },
    WebContentsView
  }
})

import {
  analyserTouche,
  creerFabriqueElectron,
  DELAI_ACCORD_MS,
  DELAI_PAUSE_MS,
  DELAI_SURBRILLANCE_MS,
  FICHIER_SITES_NAVIGATEUR,
  GestionnaireNavigateur,
  MAX_CARACTERES_LECTURE,
  MAX_ONGLETS_PAR_FIL,
  origineSoumiseAAccord,
  PARTITION_EPHEMERE,
  PARTITION_PERSISTANTE,
  PREFIXE_LECTURE,
  TAILLE_ANNEAU,
  TAILLE_JOURNAL_GESTES,
  type CadreFenetre,
  type EcouteursVue,
  type EvenementSaisie,
  type FabriqueVueNavigateur,
  type VueNavigateur
} from './navigateur-integre'
import {
  decoderAppelPage,
  PING_NAVIGATEUR,
  type FocusPage,
  type MethodePage
} from './navigateur-page-script'
import { normaliserUrlNavigateur } from '../../shared/navigateur'
import { envDelaiOutilsMcp } from '../providers/claude'

type Reponse = (args: unknown[]) => unknown

/**
 * Posée par un test : le chargement des pages ne finit pas tout seul. Remise à zéro avant chaque
 * test : un test rouge ne laisse pas ses pages bloquées aux suivants.
 */
let chargementRetenu: Promise<{ ok: boolean }> | null = null

class FausseVue implements VueNavigateur {
  adresse = ''
  visible = false
  cadre: CadreFenetre | null = null
  ferme = false
  evenements: EvenementSaisie[] = []
  textes: string[] = []
  navigations: string[] = []
  enChargement = false
  appels: Array<{ methode: MethodePage; args: unknown[] }> = []
  reponses: Partial<Record<MethodePage, Reponse>> = {}
  /** Ce que la page rend à `focus` (champ actif). */
  focus: FocusPage = {
    aucun: false,
    secret: false,
    cadreIntegre: false,
    description: 'textbox « Recherche »'
  }

  constructor(
    readonly partition: string,
    readonly ecouteurs: EcouteursVue
  ) {}

  charger(url: string): Promise<{ ok: boolean; erreur?: string }> {
    this.adresse = url
    return chargementRetenu ?? Promise.resolve({ ok: true })
  }
  url(): string {
    // Comme `contenu.getURL()` sur une page fermée (objection du juge, run-adc12547df2d-1). Fausse page
    // qui répondait encore une fois fermée : le recul de la question d'accord passait inaperçu.
    if (this.ferme) throw new TypeError('Object has been destroyed')
    return this.adresse
  }
  titre(): string {
    return ''
  }
  chargement(): boolean {
    return this.enChargement
  }
  peutReculer(): boolean {
    return false
  }
  peutAvancer(): boolean {
    return false
  }
  reculer(): void {
    this.navigations.push('reculer')
  }
  avancer(): void {
    this.navigations.push('avancer')
  }
  recharger(): void {
    this.navigations.push('recharger')
  }
  arreter(): void {
    this.navigations.push('arreter')
  }
  poserCadre(cadre: CadreFenetre): void {
    this.cadre = cadre
  }
  rendreVisible(visible: boolean): void {
    this.visible = visible
  }
  taille(): { largeur: number; hauteur: number } {
    return { largeur: 800, hauteur: 600 }
  }
  executer(source: string): Promise<unknown> {
    if (this.ferme) return Promise.reject(new TypeError('Object has been destroyed'))
    const appel = decoderAppelPage(source)
    if (!appel) return Promise.reject(new Error('source illisible'))
    this.appels.push(appel)
    const reponse = this.reponses[appel.methode]
    if (reponse) return Promise.resolve(reponse(appel.args))
    if (appel.methode === 'focus') return Promise.resolve({ ...this.focus })
    if (appel.methode === 'prendre') return Promise.resolve([])
    return Promise.resolve(true)
  }
  capturer(): Promise<string | null> {
    // `capturePage` sur une page sans image : Chromium échoue ainsi (navigateur_capture).
    if (this.sansImage) return Promise.reject(new Error('UnknownVizError'))
    return Promise.resolve('data:image/png;base64,AAAA')
  }
  /**
   * Règle de Chromium reproduite à la demande (lot 5/5) : tant que la page
   * n'a produit aucune image, Blink jette clics, molette et touches ; seuls les déplacements passent
   * (`WidgetInputHandlerManager::DispatchEvent`). Une vue cachée n'en produit jamais d'elle-même.
   */
  sansImage = false
  perdus: EvenementSaisie[] = []
  peintures = 0
  peindre(): Promise<void> {
    this.peintures += 1
    this.sansImage = false
    return Promise.resolve()
  }
  envoyer(evenement: EvenementSaisie): void {
    if (this.sansImage && evenement.type !== 'mouseMove') {
      this.perdus.push(evenement)
      return
    }
    this.evenements.push(evenement)
  }
  insererTexte(texte: string): Promise<void> {
    this.textes.push(texte)
    return Promise.resolve()
  }
  fermer(): void {
    this.ferme = true
  }
  methodes(): MethodePage[] {
    return this.appels.map((a) => a.methode)
  }
}

function fausseFabrique(): FabriqueVueNavigateur & { vues: FausseVue[] } {
  const vues: FausseVue[] = []
  return {
    vues,
    creerVue: ({ partition, ecouteurs }) => {
      const vue = new FausseVue(partition, ecouteurs)
      vues.push(vue)
      return vue
    },
    effacerDonnees: vi.fn(() => Promise.resolve()),
    ouvrirExterne: vi.fn(() => Promise.resolve())
  }
}

/** Une cible trouvée au centre (60, 35), éventuellement secrète. */
function cibleTrouvee(extra: Record<string, unknown> = {}): Reponse {
  return () => ({
    trouve: true,
    x: 60,
    y: 35,
    rect: { x: 10, y: 20, largeur: 100, hauteur: 30 },
    secret: false,
    cadreIntegre: false,
    description: 'button « Envoyer »',
    ...extra
  })
}

async function laisserFiler(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/**
 * Le résultat, ou « sans réponse » : un geste resté bloqué doit rougir, pas faire expirer le test.
 * 20 ms : largement de quoi passer la surbrillance, qui prend un tour d'horloge même à 0 ms.
 */
async function issueSansAttendre<T>(action: Promise<T>): Promise<T | 'sans réponse'> {
  await new Promise((fin) => setTimeout(fin, 20))
  return Promise.race([action, Promise.resolve('sans réponse' as const)])
}

let racine: string
let fabrique: ReturnType<typeof fausseFabrique>
let nav: GestionnaireNavigateur

beforeEach(() => {
  chargementRetenu = null
  racine = mkdtempSync(join(tmpdir(), 'autowin-navigateur-'))
  fabrique = fausseFabrique()
  nav = new GestionnaireNavigateur({ fabrique, racine, delaiSurbrillanceMs: 0 })
})

afterEach(() => {
  nav.detruire()
  vi.useRealTimers()
})

describe('onglets par fil', () => {
  it('chaque fil a ses onglets ; le dernier ouvert est actif', () => {
    const a1 = nav.ouvrir('conv-a', 'exemple.fr')
    const a2 = nav.ouvrir('conv-a', 'https://deux.fr')
    const b1 = nav.ouvrir('conv-b', 'localhost:5173')
    const etatA = nav.etat('conv-a')
    expect(etatA.onglets.map((o) => o.id)).toEqual([a1, a2])
    expect(etatA.ongletActif).toBe(a2)
    expect(etatA.onglets[0].url).toBe('https://exemple.fr/')
    expect(nav.etat('conv-b').onglets.map((o) => [o.id, o.url])).toEqual([
      [b1, 'http://localhost:5173/']
    ])
    expect(nav.etat('conv-inconnu')).toMatchObject({
      onglets: [],
      ongletActif: null,
      agentPilote: false
    })
  })

  it('fermer l’onglet actif active son voisin ; un fil oublié ferme tous ses onglets', () => {
    const a1 = nav.ouvrir('conv-a', 'https://un.fr')
    const a2 = nav.ouvrir('conv-a', 'https://deux.fr')
    nav.activerOnglet(a1)
    nav.fermerOnglet(a1)
    expect(nav.etat('conv-a').ongletActif).toBe(a2)
    expect(fabrique.vues[0].ferme).toBe(true)
    nav.oublierFil('conv-a')
    expect(fabrique.vues[1].ferme).toBe(true)
    expect(nav.etat('conv-a').onglets).toEqual([])
  })

  it('refuse une adresse dangereuse et borne le nombre d’onglets par fil', () => {
    expect(() => nav.ouvrir('conv-a', 'javascript:alert(1)')).toThrow(/refusée/)
    for (let i = 0; i < MAX_ONGLETS_PAR_FIL; i++) nav.ouvrir('conv-a', `https://site${i}.fr`)
    expect(() => nav.ouvrir('conv-a', 'https://un-de-trop.fr')).toThrow(/au plus/)
    expect(nav.ouvrir('conv-b', 'https://autre-fil.fr')).toMatch(/^onglet-/)
  })

  it('une fenêtre surgissante devient un onglet du MÊME fil ; javascript: et le surplus sont ignorés', () => {
    nav.ouvrir('conv-a', 'https://un.fr')
    nav.ouvrir('conv-b', 'https://autre.fr')
    fabrique.vues[0].ecouteurs.surNouvelleFenetre('https://pop.fr/x', 'foreground-tab')
    const etat = nav.etat('conv-a')
    expect(etat.onglets.map((o) => o.url)).toEqual(
      ['https://un.fr', 'https://pop.fr/x'].map((u) => new URL(u).href)
    )
    expect(etat.ongletActif).toBe(etat.onglets[1].id)
    expect(nav.etat('conv-b').onglets).toHaveLength(1)

    fabrique.vues[0].ecouteurs.surNouvelleFenetre('https://fond.fr', 'background-tab')
    expect(nav.etat('conv-a').ongletActif).toBe(etat.onglets[1].id)

    fabrique.vues[0].ecouteurs.surNouvelleFenetre('javascript:alert(1)', 'foreground-tab')
    expect(nav.etat('conv-a').onglets).toHaveLength(3)
    expect(nav.lignesConsole('conv-a')).toEqual([])
    nav.activerOnglet(etat.onglets[0].id)
    expect(nav.lignesConsole('conv-a').at(-1)?.message).toMatch(/surgissante ignorée/)

    for (let i = 3; i < MAX_ONGLETS_PAR_FIL; i++) nav.ouvrir('conv-a', `https://s${i}.fr`)
    fabrique.vues[0].ecouteurs.surNouvelleFenetre('https://encore.fr', 'foreground-tab')
    expect(nav.etat('conv-a').onglets).toHaveLength(MAX_ONGLETS_PAR_FIL)
  })

  /*
   * La fenêtre de connexion (Google…) garde son lien avec la page : le fil n'en charge pas l'adresse,
   * il adopte la page qu'Electron a créée, et la rend quand elle se ferme d'elle-même.
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : charger l'adresse dans une page neuve, ouvrir l'onglet
   * en arrière-plan, garder l'onglet après la fermeture de sa page, ou dépasser la limite d'onglets.
   */
  it('une fenêtre liée devient l’onglet actif sur la page fournie, et part quand elle se ferme', () => {
    const source = nav.ouvrir('conv-a', 'https://pinterest.fr')
    nav.ouvrir('conv-b', 'https://autre.fr')
    const lie = fabrique.vues[0].ecouteurs.surFenetreLiee('https://accounts.google.com/x')
    if (!lie) throw new Error('fenêtre liée refusée')
    // Rien n'existe avant qu'Electron ait créé la page.
    expect(nav.etat('conv-a').onglets).toHaveLength(1)

    const pageLiee = new FausseVue(PARTITION_PERSISTANTE, lie.ecouteurs)
    pageLiee.adresse = 'https://accounts.google.com/x'
    lie.adopter(pageLiee)
    const etat = nav.etat('conv-a')
    expect(etat.onglets.map((o) => o.url)).toEqual([
      new URL('https://pinterest.fr').href,
      'https://accounts.google.com/x'
    ])
    expect(etat.ongletActif).toBe(etat.onglets[1].id)
    expect(pageLiee.navigations).toEqual([])
    expect(nav.etat('conv-b').onglets).toHaveLength(1)

    // La connexion finie, la page appelle `window.close()` : l'onglet part, l'ouvreur revient devant.
    lie.ecouteurs.surFermeture()
    expect(nav.etat('conv-a').onglets.map((o) => o.id)).toEqual([source])
    expect(nav.etat('conv-a').ongletActif).toBe(source)
    expect(pageLiee.ferme).toBe(false)

    // Une adresse refusée, ou plus de place dans le fil : la fenêtre est refusée, et on le dit.
    expect(fabrique.vues[0].ecouteurs.surFenetreLiee('javascript:alert(1)')).toBeNull()
    for (let i = 1; i < MAX_ONGLETS_PAR_FIL; i++) nav.ouvrir('conv-a', `https://s${i}.fr`)
    expect(fabrique.vues[0].ecouteurs.surFenetreLiee('https://accounts.google.com/y')).toBeNull()
    nav.activerOnglet(source)
    expect(nav.lignesConsole('conv-a').map((l) => l.message)).toEqual([
      'Fenêtre surgissante ignorée : « javascript:alert(1) ».',
      `Fenêtre surgissante ignorée : ${MAX_ONGLETS_PAR_FIL} onglets au plus par fil.`
    ])
  })

  it('une fenêtre liée dont le fil a disparu est refermée aussitôt', () => {
    nav.ouvrir('conv-a', 'https://pinterest.fr')
    const lie = fabrique.vues[0].ecouteurs.surFenetreLiee('https://accounts.google.com/x')
    if (!lie) throw new Error('fenêtre liée refusée')
    nav.oublierFil('conv-a')
    const pageLiee = new FausseVue(PARTITION_PERSISTANTE, lie.ecouteurs)
    lie.adopter(pageLiee)
    expect(pageLiee.ferme).toBe(true)
    expect(nav.etat('conv-a').onglets).toEqual([])
  })
})

describe('visibilité : seul l’onglet actif du fil affiché, dans le cadre posé', () => {
  it('rien n’est visible sans fil affiché ni cadre ; le cadre suit le zoom ; null cache tout', () => {
    const a1 = nav.ouvrir('conv-a', 'https://un.fr')
    const a2 = nav.ouvrir('conv-a', 'https://deux.fr')
    nav.ouvrir('conv-b', 'https://b.fr')
    const [vA1, vA2, vB] = fabrique.vues
    expect(fabrique.vues.every((v) => !v.visible)).toBe(true)

    nav.afficherFil('conv-a')
    expect(fabrique.vues.every((v) => !v.visible)).toBe(true)
    nav.poserCadre({ x: 100, y: 50, largeur: 400, hauteur: 300 }, 1.25)
    expect([vA1.visible, vA2.visible, vB.visible]).toEqual([false, true, false])
    expect(vA2.cadre).toEqual({ x: 125, y: 63, width: 500, height: 375 })

    nav.activerOnglet(a1)
    expect([vA1.visible, vA2.visible, vB.visible]).toEqual([true, false, false])

    nav.afficherFil('conv-b')
    expect([vA1.visible, vA2.visible, vB.visible]).toEqual([false, false, true])

    nav.poserCadre(null, 1)
    expect(fabrique.vues.every((v) => !v.visible)).toBe(true)
    expect(a2).toBeTruthy()
  })
})

describe('garde (a) : jamais de saisie de l’agent dans un mot de passe', () => {
  beforeEach(() => {
    nav.ouvrir('conv-a', 'http://localhost:3000')
  })

  it('cible secrète : refus AVANT tout accord, rien n’est tapé', async () => {
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee({ secret: true })
    const r = await nav.agir('conv-a', { type: 'saisir', texte: 'hunter2', cible: { ref: 3 } })
    expect(r).toMatchObject({ ok: false, refus: 'mot-de-passe' })
    expect(r.message).toMatch(/se connecte lui-même/)
    expect(vue.textes).toEqual([])
    expect(vue.methodes()).not.toContain('surligner')
  })

  it('jumeau accepté : un champ ordinaire reçoit le texte, après la surbrillance', async () => {
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    const r = await nav.agir('conv-a', { type: 'saisir', texte: 'bonjour', cible: { ref: 3 } })
    expect(r).toMatchObject({ ok: true })
    expect(vue.textes).toEqual(['bonjour'])
    const ordre = vue.methodes()
    expect(ordre.indexOf('surligner')).toBeGreaterThan(ordre.indexOf('localiser'))
    expect(ordre.at(-1)).toBe('retirerSurbrillance')
  })

  it('le focus passé sur un mot de passe PENDANT la surbrillance : refus, rien n’est tapé', async () => {
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    vue.reponses.surligner = (): boolean => {
      vue.focus = { ...vue.focus, secret: true }
      return true
    }
    const r = await nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: { ref: 3 } })
    expect(r.refus).toBe('mot-de-passe')
    expect(vue.textes).toEqual([])
    expect(nav.etat('conv-a').agentPilote).toBe(false)
  })

  it('une touche dans un champ secret est refusée ; un clic sur ce champ reste permis', async () => {
    const vue = fabrique.vues[0]
    vue.focus = { ...vue.focus, secret: true }
    expect((await nav.agir('conv-a', { type: 'touche', touche: 'Enter' })).refus).toBe(
      'mot-de-passe'
    )
    vue.reponses.localiser = cibleTrouvee({ secret: true })
    expect(await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).toMatchObject({
      ok: true
    })
    expect(vue.evenements.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
  })

  it('saisie dans un cadre intégré ou sans champ actif : refusée', async () => {
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee({ cadreIntegre: true })
    expect(
      (await nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: { ref: 1 } })).refus
    ).toBe('cadre-integre')
    vue.focus = { aucun: true, secret: false, cadreIntegre: false, description: 'page' }
    expect((await nav.agir('conv-a', { type: 'saisir', texte: 'x' })).refus).toBe(
      'cible-introuvable'
    )
    expect(vue.textes).toEqual([])
  })
})

describe('surbrillance 800 ms et bandeau « l’agent pilote »', () => {
  it('la cible est surlignée et le bandeau levé AVANT le clic, baissé après', async () => {
    vi.useFakeTimers()
    nav = new GestionnaireNavigateur({ fabrique, racine })
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    const etats: boolean[] = []
    nav.surEtat((e) => etats.push(e.agentPilote))
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 2 } })
    await vi.advanceTimersByTimeAsync(799)
    expect(nav.etat('conv-a').agentPilote).toBe(true)
    expect(vue.methodes()).toContain('surligner')
    expect(vue.evenements).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(await action).toMatchObject({ ok: true })
    expect(vue.evenements.find((e) => e.type === 'mouseDown')).toMatchObject({ x: 60, y: 35 })
    expect(nav.etat('conv-a').agentPilote).toBe(false)
    expect(etats).toContain(true)
    expect(etats.at(-1)).toBe(false)
  })

  // Objection du juge (réparation 1) : sans cible, la frappe partait sans surbrillance —
  // l'utilisateur ne voyait pas où le texte allait arriver.
  it.each([
    { type: 'saisir', texte: 'bonjour' } as const,
    { type: 'touche', touche: 'Enter' } as const
  ])(
    'une frappe SANS cible ($type) surligne le champ actif 800 ms avant de partir',
    async (action) => {
      vi.useFakeTimers()
      nav = new GestionnaireNavigateur({ fabrique, racine })
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.focus = { ...vue.focus, rect: { x: 5, y: 6, largeur: 70, hauteur: 20 } }
      const resultat = nav.agir('conv-a', action)
      await vi.advanceTimersByTimeAsync(799)
      expect(vue.appels.find((a) => a.methode === 'surligner')?.args[0]).toEqual({
        x: 5,
        y: 6,
        largeur: 70,
        hauteur: 20
      })
      expect(nav.etat('conv-a').agentPilote).toBe(true)
      expect(vue.textes).toEqual([])
      expect(vue.evenements).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(await resultat).toMatchObject({ ok: true })
      expect(vue.textes.length + vue.evenements.length).toBeGreaterThan(0)
      expect(vue.methodes().at(-1)).toBe('retirerSurbrillance')
    }
  )
})

/*
 * Objection du juge (réparation 1) — mesuré dans l'instance cachée (run8) : sur une page
 * qui n'avait encore produit aucune image (site changé, vue cachée), le clic de l'agent était jeté
 * par Chromium et l'outil répondait quand même « Clic sur … ». Cas réel : l'onglet d'un fil que
 * l'utilisateur ne regarde pas, ou panneau fermé. Entrée qui fait échouer ce test si la correction
 * est fausse : `sansImage = true` (aucune image depuis la navigation) — image forcée APRÈS l'envoi,
 * ou pas pour la molette ou les touches, et `perdus` n'est plus vide.
 */
describe('une page sans image reçoit quand même l’action de l’agent', () => {
  it.each([
    { type: 'clic', cible: { ref: 1 } } as const,
    { type: 'touche', touche: 'Enter', cible: { ref: 1 } } as const,
    { type: 'defiler', dy: 300 } as const
  ])('$type : une image est forcée avant l’envoi, rien n’est jeté', async (action) => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee({ description: 'textbox « Nom »' })
    vue.sansImage = true
    const resultat = await nav.agir('conv-a', action)
    expect(resultat).toMatchObject({ ok: true })
    expect(vue.perdus).toEqual([])
    expect(vue.evenements.some((e) => e.type !== 'mouseMove')).toBe(true)
  })

  it('jumeau : une action refusée (cible introuvable) ne force aucune image et n’envoie rien', async () => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = () => ({ trouve: false })
    vue.sansImage = true
    const resultat = await nav.agir('conv-a', { type: 'clic', cible: { ref: 9 } })
    expect(resultat).toMatchObject({ ok: false, refus: 'cible-introuvable' })
    expect(vue.peintures).toBe(0)
    expect(vue.evenements).toEqual([])
    expect(vue.perdus).toEqual([])
  })

  /*
   * Mesuré dans l'app (2026-10-29) : `navigateur_capture` sur `localhost:5173` rouvert,
   * panneau fermé, échouait deux fois de suite en « UnknownVizError » alors que `navigateur_lire`
   * lisait la page. Entrée qui fait échouer ce test : une capture tentée sans image forcée avant.
   */
  it('capture : une image est forcée avant la copie, la page cachée se capture', async () => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    const vue = fabrique.vues[0]
    vue.sansImage = true
    await expect(nav.capturer('conv-a')).resolves.toBe('data:image/png;base64,AAAA')
    expect(vue.peintures).toBe(1)
  })
})

describe('garde (b) : accord par site', () => {
  it('poste local et file: sont libres ; le reste est soumis par origine', () => {
    expect(origineSoumiseAAccord('http://localhost:5173/x')).toBeNull()
    expect(origineSoumiseAAccord('http://127.0.0.1/')).toBeNull()
    expect(origineSoumiseAAccord('http://[::1]:3000/')).toBeNull()
    expect(origineSoumiseAAccord('file:///C:/page.html')).toBeNull()
    expect(origineSoumiseAAccord('https://exemple.fr/a?b')).toBe('https://exemple.fr')
    expect(origineSoumiseAAccord('http://localhost.evil.fr/')).toBe('http://localhost.evil.fr')
    expect(origineSoumiseAAccord('about:blank')).toBe('about:')
  })

  it('la 1re écriture attend ; « une fois » la libère et vaut pour la suite de la session', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr/page')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    expect(nav.etat('conv-a').demandeAccord).toEqual({
      origine: 'https://exemple.fr',
      action: 'cliquer sur button « Envoyer »'
    })
    expect(nav.etat('conv-a').agentPilote).toBe(false)
    expect(vue.evenements).toEqual([])

    nav.repondreAccord('https://exemple.fr', 'une-fois')
    expect(await action).toMatchObject({ ok: true })
    expect(nav.etat('conv-a').demandeAccord).toBeUndefined()

    expect(await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).toMatchObject({
      ok: true
    })
    expect(readFileSafe(join(racine, FICHIER_SITES_NAVIGATEUR))).toBeNull()
  })

  it('« toujours » est écrit sur disque et vaut pour un gestionnaire neuf', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    fabrique.vues[0].reponses.localiser = cibleTrouvee()
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    nav.repondreAccord('https://exemple.fr', 'toujours')
    expect((await action).ok).toBe(true)
    expect(JSON.parse(readFileSafe(join(racine, FICHIER_SITES_NAVIGATEUR)) ?? '{}')).toEqual({
      toujours: ['https://exemple.fr']
    })

    const autreFabrique = fausseFabrique()
    const neuf = new GestionnaireNavigateur({
      fabrique: autreFabrique,
      racine,
      delaiSurbrillanceMs: 0
    })
    neuf.ouvrir('conv-z', 'https://exemple.fr/autre')
    autreFabrique.vues[0].reponses.localiser = cibleTrouvee()
    expect(await neuf.agir('conv-z', { type: 'clic', cible: { ref: 1 } })).toMatchObject({
      ok: true
    })
    expect(neuf.etat('conv-z').demandeAccord).toBeUndefined()
    neuf.detruire()
  })

  it('« refuser » : action refusée, rien n’est envoyé, et la suivante redemande', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    nav.repondreAccord('https://exemple.fr', 'refuser')
    expect(await action).toMatchObject({ ok: false, refus: 'accord-refuse' })
    expect(vue.evenements).toEqual([])
    void nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    expect(nav.etat('conv-a').demandeAccord?.origine).toBe('https://exemple.fr')
  })

  it('120 s sans réponse = refus, et la demande disparaît de l’état', async () => {
    vi.useFakeTimers()
    nav = new GestionnaireNavigateur({ fabrique, racine, delaiSurbrillanceMs: 0 })
    nav.ouvrir('conv-a', 'https://exemple.fr')
    fabrique.vues[0].reponses.localiser = cibleTrouvee()
    const action = nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: { ref: 1 } })
    await vi.advanceTimersByTimeAsync(DELAI_ACCORD_MS - 1)
    expect(nav.etat('conv-a').demandeAccord).toBeDefined()
    await vi.advanceTimersByTimeAsync(1)
    const r = await action
    expect(r).toMatchObject({ ok: false, refus: 'accord-refuse' })
    expect(r.message).toMatch(/120 s/)
    expect(nav.etat('conv-a').demandeAccord).toBeUndefined()
    expect(fabrique.vues[0].textes).toEqual([])
  })

  // Objection du juge (réparation 1) : l'origine n'était lue qu'AVANT l'attente ; une
  // redirection pendant les 120 s envoyait le clic sur un site jamais autorisé.
  it('la page change de site PENDANT l’attente : l’accord de l’ancien site ne vaut pas, rien n’est envoyé', async () => {
    nav.ouvrir('conv-a', 'https://site-a.fr/connexion')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    expect(nav.etat('conv-a').demandeAccord?.origine).toBe('https://site-a.fr')
    vue.adresse = 'https://site-b.fr/'
    nav.repondreAccord('https://site-a.fr', 'une-fois')
    const r = await action
    expect(r).toMatchObject({ ok: false, refus: 'page-changee' })
    expect(r.message).toMatch(/site-b\.fr/)
    expect(vue.evenements).toEqual([])
    expect(nav.etat('conv-a').agentPilote).toBe(false)
  })

  it('la page change de site PENDANT la surbrillance : refus, rien n’est tapé', async () => {
    nav.ouvrir('conv-a', 'https://site-a.fr')
    const vue = fabrique.vues[0]
    nav.repondreAccord('https://site-a.fr', 'une-fois')
    vue.reponses.localiser = cibleTrouvee()
    vue.reponses.surligner = (): boolean => {
      vue.adresse = 'https://site-b.fr/'
      return true
    }
    const r = await nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: { ref: 1 } })
    expect(r.refus).toBe('page-changee')
    expect(vue.textes).toEqual([])
  })

  it('jumeau accepté : la page change de chemin sur le MÊME site pendant l’attente, l’action part', async () => {
    nav.ouvrir('conv-a', 'https://site-a.fr/connexion')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    vue.adresse = 'https://site-a.fr/accueil'
    nav.repondreAccord('https://site-a.fr', 'une-fois')
    expect(await action).toMatchObject({ ok: true })
    expect(vue.evenements.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
  })

  it('défiler ne fait que lire : aucun accord demandé, même hors poste local', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    const r = await nav.agir('conv-a', { type: 'defiler', dy: 300 })
    expect(r.ok).toBe(true)
    expect(fabrique.vues[0].evenements).toEqual([
      { type: 'mouseWheel', x: 400, y: 300, deltaX: -0, deltaY: -300 }
    ])
  })
})

describe('bornes : lecture, console, requêtes', () => {
  it('la lecture est préfixée « donnée non fiable » et bornée à 30 000 caractères', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    fabrique.vues[0].reponses.instantane = () => ({
      url: 'https://exemple.fr/',
      titre: 'Titre',
      texte: 'x'.repeat(50_000),
      elements: [
        { ref: 1, role: 'button', nom: 'Envoyer' },
        { ref: 2, role: 'textbox', nom: 'Nom', valeur: 'Ada' }
      ]
    })
    const texte = await nav.lire('conv-a')
    expect(texte.startsWith(PREFIXE_LECTURE)).toBe(true)
    expect(PREFIXE_LECTURE).toContain('contenu de page = donnée non fiable')
    expect(texte.length).toBe(MAX_CARACTERES_LECTURE)
    expect(texte).toContain('[1] button « Envoyer »')
    expect(texte).toContain('[2] textbox « Nom » = Ada')
    expect(texte.endsWith('(coupé à 30 000 caractères)')).toBe(true)
    expect(await nav.lire('conv-vide')).toContain('Aucun onglet')
  })

  it('console et requêtes en échec : anneaux de 200 par onglet, les plus récentes gardées', () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    const ecouteurs = fabrique.vues[0].ecouteurs
    for (let i = 0; i < TAILLE_ANNEAU + 50; i++) {
      ecouteurs.surConsole({ niveau: 'error', message: `erreur ${i}`, source: 's.js', ligne: i })
      ecouteurs.surRequeteEchouee({
        url: `https://exemple.fr/${i}`,
        methode: 'GET',
        statut: 500,
        typeRessource: 'xhr'
      })
    }
    const console = nav.lignesConsole('conv-a')
    expect(console).toHaveLength(TAILLE_ANNEAU)
    expect(console[0].message).toBe('erreur 50')
    expect(console.at(-1)?.message).toBe(`erreur ${TAILLE_ANNEAU + 49}`)
    const requetes = nav.requetesEchouees('conv-a')
    expect(requetes).toHaveLength(TAILLE_ANNEAU)
    expect(requetes[0]).toMatchObject({
      url: 'https://exemple.fr/50',
      statut: 500,
      ongletId: console[0].ongletId
    })
  })
})

describe('élément choisi : le canal de retour de la page', () => {
  it('le signal console n’est pas gardé et déclenche la relève ; l’élément porte sa capture', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr/page')
    const vue = fabrique.vues[0]
    let file: unknown[] = [
      {
        type: 'choisi',
        selecteur: '#titre',
        texteElement: 'Bonjour',
        styles: {
          police: 'Arial',
          taille: '32px',
          couleur: 'rgb(0, 0, 0)',
          fond: 'white',
          marges: 'marge 0'
        },
        rect: { x: 10, y: 20, largeur: 100, hauteur: 30 }
      }
    ]
    vue.reponses.prendre = () => {
      const f = file
      file = []
      return f
    }
    vue.ecouteurs.surConsole({ niveau: 'debug', message: PING_NAVIGATEUR, source: '', ligne: 0 })
    await laisserFiler()
    expect(nav.lignesConsole('conv-a')).toEqual([])
    expect(nav.etat('conv-a').nombreElementsChoisis).toBe(1)
    const pris = nav.prendreElementsChoisis('conv-a')
    expect(pris).toMatchObject([
      {
        url: 'https://exemple.fr/page',
        selecteur: '#titre',
        captureDataUrl: 'data:image/png;base64,AAAA'
      }
    ])
    // Prendre vide la file : l'élément n'est livré qu'une fois.
    expect(nav.etat('conv-a').nombreElementsChoisis).toBe(0)
    expect(nav.prendreElementsChoisis('conv-a')).toEqual([])
    expect(nav.prendreElementsChoisis('conv-inconnue')).toEqual([])
  })

  it('le mode suit l’onglet visible ; un élément choisi éteint le mode', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    nav.afficherFil('conv-a')
    nav.poserCadre({ x: 0, y: 0, largeur: 800, hauteur: 600 }, 1)
    const vue = fabrique.vues[0]
    await nav.basculerMode('choisir')
    expect(nav.etat('conv-a').mode).toBe('choisir')
    expect(vue.appels.find((a) => a.methode === 'activerMode')?.args).toEqual(['choisir'])
    vue.reponses.prendre = () => [
      {
        type: 'choisi',
        selecteur: 'button',
        texteElement: 'Payer',
        styles: {},
        rect: { x: 0, y: 0, largeur: 0, hauteur: 0 }
      }
    ]
    vue.ecouteurs.surConsole({ niveau: 'debug', message: PING_NAVIGATEUR, source: '', ligne: 0 })
    await laisserFiler()
    const [choisi] = nav.prendreElementsChoisis('conv-a')
    expect(choisi).toMatchObject({ selecteur: 'button' })
    expect(choisi.captureDataUrl).toBeUndefined()
    expect(nav.etat('conv-a').mode).toBeNull()

    await nav.basculerMode('choisir')
    nav.afficherFil('conv-b')
    expect(nav.etat('conv-a').mode).toBeNull()
  })

  it('sans onglet visible, le mode reste éteint', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    await nav.basculerMode('choisir')
    expect(nav.etat('conv-a').mode).toBeNull()
  })

  /*
   * Mesuré le 2026-10-29 (lot 5/5) dans l'instance cachée : après « Envoyer
   * au chat », le mode reste allumé ; le clic de l'agent part, la page l'AVALE (écoutes
   * click/pointerdown du mode) et l'outil répond « Clic sur … » sans que rien ne change. L'entrée
   * qui ferait échouer ce test si la correction était fausse : un mode encore allumé au moment
   * du mouseDown de l'agent.
   */
  function modeAuPremierEvenement(vue: FausseVue): Array<unknown> {
    const vus: unknown[] = []
    const envoyer = vue.envoyer.bind(vue)
    vue.envoyer = (evenement) => {
      if (vus.length === 0)
        vus.push(vue.appels.filter((a) => a.methode === 'activerMode').at(-1)?.args[0])
      envoyer(evenement)
    }
    return vus
  }

  it('un clic de l’agent sur l’onglet en mode Choisir éteint d’abord le mode : la page ne l’avale pas', async () => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    nav.afficherFil('conv-a')
    nav.poserCadre({ x: 0, y: 0, largeur: 800, hauteur: 600 }, 1)
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    await nav.basculerMode('choisir')
    expect(nav.etat('conv-a').mode).toBe('choisir')
    const modeVu = modeAuPremierEvenement(vue)
    const resultat = await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    expect(resultat).toMatchObject({ ok: true })
    expect(resultat.message).toContain('Choisir')
    expect(modeVu).toEqual([null])
    expect(nav.etat('conv-a').mode).toBeNull()
  })

  it('jumeau : défiler ne fait que lire, le mode Choisir de l’utilisateur reste allumé', async () => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    nav.afficherFil('conv-a')
    nav.poserCadre({ x: 0, y: 0, largeur: 800, hauteur: 600 }, 1)
    const vue = fabrique.vues[0]
    await nav.basculerMode('choisir')
    const resultat = await nav.agir('conv-a', { type: 'defiler', dy: 300 })
    expect(resultat).toMatchObject({ ok: true })
    expect(vue.appels.filter((a) => a.methode === 'activerMode').map((a) => a.args[0])).toEqual([
      'choisir'
    ])
    expect(nav.etat('conv-a').mode).toBe('choisir')
  })

  it('jumeau : une action refusée (cible introuvable) laisse le mode allumé', async () => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    nav.afficherFil('conv-a')
    nav.poserCadre({ x: 0, y: 0, largeur: 800, hauteur: 600 }, 1)
    const vue = fabrique.vues[0]
    vue.reponses.localiser = () => ({ trouve: false })
    await nav.basculerMode('choisir')
    const resultat = await nav.agir('conv-a', { type: 'clic', cible: { ref: 9 } })
    expect(resultat).toMatchObject({ ok: false, refus: 'cible-introuvable' })
    expect(nav.etat('conv-a').mode).toBe('choisir')
  })
})

describe('réglages, données, navigateur du système', () => {
  it('« garder les cookies » choisit la partition des onglets ouverts ensuite', () => {
    expect(nav.lireReglages()).toEqual({ garderCookies: true, ouvrirLiensDuChatIci: true })
    nav.ouvrir('conv-a', 'https://un.fr')
    expect(nav.ecrireReglages({ garderCookies: false })).toEqual({
      garderCookies: false,
      ouvrirLiensDuChatIci: true
    })
    nav.ouvrir('conv-a', 'https://deux.fr')
    expect(fabrique.vues.map((v) => v.partition)).toEqual([
      PARTITION_PERSISTANTE,
      PARTITION_EPHEMERE
    ])
    const neuf = new GestionnaireNavigateur({ fabrique: fausseFabrique(), racine })
    expect(neuf.lireReglages().garderCookies).toBe(false)
  })

  it('un fichier de sites abîmé vaut « aucun site » : l’accord est redemandé', async () => {
    writeFileSync(join(racine, FICHIER_SITES_NAVIGATEUR), '{abîmé')
    nav.ouvrir('conv-a', 'https://exemple.fr')
    fabrique.vues[0].reponses.localiser = cibleTrouvee()
    void nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    expect(nav.etat('conv-a').demandeAccord).toBeDefined()
  })

  it('seuls http et https partent vers le navigateur du système', async () => {
    await expect(nav.ouvrirDansNavigateurParDefaut('file:///C:/x.exe')).rejects.toThrow(/http/)
    await expect(nav.ouvrirDansNavigateurParDefaut('javascript:alert(1)')).rejects.toThrow(/http/)
    await nav.ouvrirDansNavigateurParDefaut('exemple.fr')
    expect(fabrique.ouvrirExterne).toHaveBeenCalledWith('https://exemple.fr/')
    await nav.effacerDonnees()
    expect(fabrique.effacerDonnees).toHaveBeenCalledOnce()
  })
})

/*
 * PAS-À-PAS (maquette « 1 · Jalons · Aperçu du geste suivant », 2026-10-30). Ce qui fait
 * échouer ces tests si le moteur est faux : un geste qui part pendant la pause (`evenements` non
 * vide), « Pas suivant » qui libère plus d'un geste, la main reprise qui touche encore la page
 * (`localiser` rejoué, qui fait défiler et donne le focus), ou une attente sans fin.
 *
 * fix-ok: run-adc12547df2d-1 — sur 6 éditions, une seule corrige : ce test attendait
 * `retirerSurbrillance` en dernier appel (rouge : « expected 'localiser' to be
 * 'retirerSurbrillance' »), alors que le moteur retire le tracé PUIS relocalise la cible, comme
 * demandé. Les 5 autres sont des ajouts : ce bloc, 3 imports, le test de la main reprise pendant
 * la surbrillance avec son jumeau accepté.
 */
describe('pas-à-pas : journal des gestes et pilotage par fil', () => {
  /** Les états successifs des gestes du fil, tels que poussés à l'interface. */
  function suivreGestes(conversationId: string): Array<Array<string>> {
    const vus: Array<Array<string>> = []
    nav.surEtat((e) => {
      if (e.conversationId === conversationId) vus.push(e.gestes.map((g) => g.etat))
    })
    return vus
  }

  it('chaque geste de l’agent est noté (verbe, nature, description), puis fait ou refusé', async () => {
    const r = await nav.agentOuvrir('conv-a', 'http://localhost:5173')
    expect(r.ok).toBe(true)
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    await nav.lire('conv-a')
    await nav.capturer('conv-a')
    await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await nav.agir('conv-a', { type: 'defiler', dy: 200 })
    vue.reponses.localiser = () => ({ trouve: false })
    await nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: { ref: 9 } })
    vue.reponses.localiser = cibleTrouvee()
    await nav.agir('conv-a', { type: 'touche', touche: 'Enter' })

    const { gestes, pilotage } = nav.etat('conv-a')
    expect(pilotage).toBe('libre')
    // `lire` passe par `instantane` : UN seul geste, pas deux.
    expect(gestes.map((g) => [g.verbe, g.nature, g.etat])).toEqual([
      ['ouvrir', 'agit', 'fait'],
      ['lire', 'lit', 'fait'],
      ['capture', 'lit', 'fait'],
      ['clic', 'agit', 'fait'],
      ['defiler', 'lit', 'fait'],
      ['saisir', 'agit', 'refuse'],
      ['touche', 'agit', 'fait']
    ])
    expect(gestes[0].description).toBe('ouvrir http://localhost:5173/')
    expect(gestes[3].description).toBe('cliquer sur button « Envoyer »')
    const onglet = nav.etat('conv-a').ongletActif
    expect(gestes.every((g) => g.ongletId === onglet)).toBe(true)
    expect(new Set(gestes.map((g) => g.id)).size).toBe(gestes.length)
    expect(gestes.every((g) => g.debut > 0 && g.description.length <= 120)).toBe(true)
    expect(nav.etat('conv-b').gestes).toEqual([])
  })

  it('le journal garde les 20 derniers gestes du fil', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    for (let i = 0; i < TAILLE_JOURNAL_GESTES + 5; i++) await nav.lire('conv-a')
    await nav.agir('conv-a', { type: 'defiler', dy: 1 })
    const gestes = nav.etat('conv-a').gestes
    expect(TAILLE_JOURNAL_GESTES).toBe(20)
    expect(gestes).toHaveLength(20)
    expect(gestes.at(-1)?.verbe).toBe('defiler')
  })

  it('pause : le geste est « prochain », sa cible tracée en pointillés, rien n’est envoyé', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    nav.piloter('conv-a', 'pause')
    expect(nav.etat('conv-a').pilotage).toBe('pause')
    void nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    const etat = nav.etat('conv-a')
    expect(etat.gestes.map((g) => [g.verbe, g.etat, g.description])).toEqual([
      ['clic', 'prochain', 'cliquer sur button « Envoyer »']
    ])
    expect(vue.appels.find((a) => a.methode === 'surligner')?.args).toEqual([
      { x: 10, y: 20, largeur: 100, hauteur: 30 },
      'cliquer sur button « Envoyer »',
      { prochain: true }
    ])
    expect(vue.evenements).toEqual([])
    expect(etat.agentPilote).toBe(false)
  })

  // Mesuré dans la vraie app (`cadre=null` dans run-final.txt) : le rechargement efface le
  // calque de la page. Le geste attendait toujours, la frise disait « prochain », et la page ne
  // montrait plus ce qui allait partir au prochain ordre.
  describe('page rechargée pendant l’attente', () => {
    const NOUVELLE_PLACE = { x: 10, y: 400, largeur: 100, hauteur: 30 }
    const CIBLE = { selecteur: '#envoyer' }
    const sequenceChargement = (vue: FausseVue): void => {
      vue.enChargement = true
      vue.ecouteurs.surChangement()
      vue.enChargement = false
      vue.ecouteurs.surChangement()
    }
    const traces = (vue: FausseVue): unknown[][] =>
      vue.appels.filter((a) => a.methode === 'surligner').map((a) => a.args)
    const enPause = async (): Promise<{ vue: FausseVue; action: ReturnType<typeof nav.agir> }> => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', { type: 'clic', cible: CIBLE })
      await laisserFiler()
      vue.appels = []
      return { vue, action }
    }

    it('la cible retrouvée repasse en pointillés, à sa nouvelle place, sans recevoir le focus', async () => {
      const { vue, action } = await enPause()
      vue.reponses.localiser = cibleTrouvee({ rect: NOUVELLE_PLACE })
      sequenceChargement(vue)
      await laisserFiler()
      expect(traces(vue)).toEqual([
        [NOUVELLE_PLACE, 'cliquer sur button « Envoyer »', { prochain: true }]
      ])
      expect(vue.appels.find((a) => a.methode === 'localiser')?.args).toEqual([
        CIBLE,
        { focaliser: false, selectionner: false }
      ])
      expect(vue.evenements).toEqual([])
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])
      nav.piloter('conv-a', 'reprendre')
      expect(await action).toMatchObject({ ok: true })
      expect(vue.methodes()).toContain('retirerSurbrillance')
    })

    it('une frappe sans cible retrouve le champ actif de la page rechargée', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.focus = { ...vue.focus, rect: { x: 1, y: 2, largeur: 30, hauteur: 10 } }
      nav.piloter('conv-a', 'pause')
      void nav.agir('conv-a', { type: 'saisir', texte: 'bonjour' })
      await laisserFiler()
      vue.appels = []
      vue.focus = { ...vue.focus, rect: NOUVELLE_PLACE }
      sequenceChargement(vue)
      await laisserFiler()
      expect(traces(vue).map((args) => args[0])).toEqual([NOUVELLE_PLACE])
    })

    it('jumeau : une cible disparue n’est pas tracée, et le geste libéré est refusé sans rien envoyer', async () => {
      const { vue, action } = await enPause()
      vue.reponses.localiser = () => ({ trouve: false })
      sequenceChargement(vue)
      await laisserFiler()
      expect(traces(vue)).toEqual([])
      nav.piloter('conv-a', 'reprendre')
      expect(await action).toMatchObject({ ok: false, refus: 'cible-introuvable' })
      expect(vue.evenements).toEqual([])
    })

    // fix-ok: objection du juge (réparation) — mesuré `cadre=null` pour une cible par numéro
    // dans la vraie app (run-definitif.txt:73) : un rechargement efface les numéros de la lecture, qui
    // ne reviennent jamais (une lecture neuve renumérote depuis 1). Le geste attendait quand même un
    // ordre, ou 9 min, alors qu'il ne pouvait plus partir — et `navigateur_agir` recommande le numéro.
    it('un geste visé par numéro dont la page a perdu le numéro est refusé tout de suite', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 3 } })
      await laisserFiler()
      vue.appels = []
      vue.reponses.localiser = () => ({ trouve: false })
      sequenceChargement(vue)
      // Entrée qui rougit si la correction est fausse : un geste qui garde son attente rend
      // « sans réponse » ici, comme avant la correction.
      expect(await issueSansAttendre(action)).toMatchObject({
        ok: false,
        refus: 'cible-introuvable'
      })
      expect(traces(vue)).toEqual([])
      expect(vue.evenements).toEqual([])
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse'])
    })

    it('jumeau : le numéro encore présent après le chargement, le geste attend et part à l’ordre', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 3 } })
      await laisserFiler()
      vue.appels = []
      // Fin d'un chargement de ressources sans changement de page : les numéros sont toujours là.
      vue.reponses.localiser = cibleTrouvee({ rect: NOUVELLE_PLACE })
      sequenceChargement(vue)
      expect(await issueSansAttendre(action)).toBe('sans réponse')
      expect(traces(vue).map((args) => args[0])).toEqual([NOUVELLE_PLACE])
      nav.piloter('conv-a', 'pas-suivant')
      expect(await action).toMatchObject({ ok: true })
      expect(vue.evenements.filter((e) => e.type === 'mouseDown')).toHaveLength(1)
    })

    it('le geste suivant prend les pointillés quand le geste visé par numéro tombe', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      nav.piloter('conv-a', 'pause')
      const premier = nav.agir('conv-a', { type: 'clic', cible: { ref: 3 } })
      await laisserFiler()
      const second = nav.agir('conv-a', { type: 'clic', cible: CIBLE })
      await laisserFiler()
      vue.appels = []
      vue.reponses.localiser = ([cible]) =>
        'ref' in (cible as object) ? { trouve: false } : cibleTrouvee({ rect: NOUVELLE_PLACE })([])
      sequenceChargement(vue)
      expect(await issueSansAttendre(premier)).toMatchObject({ refus: 'cible-introuvable' })
      await laisserFiler()
      expect(traces(vue).at(-1)).toEqual([
        NOUVELLE_PLACE,
        'cliquer sur button « Envoyer »',
        { prochain: true }
      ])
      expect(await issueSansAttendre(second)).toBe('sans réponse')
      expect(vue.evenements).toEqual([])
    })

    it('jumeau : le chargement a effacé le cadre et la cible n’était pas encore là, le relais la trace', async () => {
      const { vue } = await enPause()
      // Page qui se construit APRÈS son chargement : à sa fin, le sélecteur ne trouve encore rien.
      vue.reponses.localiser = () => ({ trouve: false })
      sequenceChargement(vue)
      await laisserFiler()
      expect(traces(vue)).toEqual([])
      vue.reponses.localiser = ([cible]) =>
        (cible as { selecteur: string }).selecteur === '#absent'
          ? { trouve: false }
          : cibleTrouvee({ rect: NOUVELLE_PLACE })([])
      expect(
        await nav.agir('conv-a', { type: 'clic', cible: { selecteur: '#absent' } })
      ).toMatchObject({ refus: 'cible-introuvable' })
      await laisserFiler()
      expect(traces(vue)).toEqual([
        [NOUVELLE_PLACE, 'cliquer sur button « Envoyer »', { prochain: true }]
      ])
    })

    it('jumeau : le champ devenu secret n’est pas tracé', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      nav.piloter('conv-a', 'pause')
      void nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: CIBLE })
      await laisserFiler()
      vue.appels = []
      vue.reponses.localiser = cibleTrouvee({ secret: true })
      sequenceChargement(vue)
      await laisserFiler()
      expect(traces(vue)).toEqual([])
    })

    it('jumeau : le champ de la page rechargée ne reçoit ni focus ni sélection avant l’ordre', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      nav.piloter('conv-a', 'pause')
      void nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: CIBLE, remplacer: true })
      await laisserFiler()
      vue.appels = []
      sequenceChargement(vue)
      await laisserFiler()
      expect(vue.appels.find((a) => a.methode === 'localiser')?.args[1]).toEqual({
        focaliser: false,
        selectionner: false
      })
      expect(traces(vue)).toHaveLength(1)
    })

    it('jumeau : le chargement d’un autre onglet du fil ne retrace pas la cible', async () => {
      const a1 = nav.ouvrir('conv-a', 'http://localhost:5173')
      const a2 = nav.ouvrir('conv-a', 'https://deux.fr')
      nav.activerOnglet(a1)
      const [vue, autre] = fabrique.vues
      vue.reponses.localiser = cibleTrouvee()
      nav.piloter('conv-a', 'pause')
      void nav.agir('conv-a', { type: 'clic', cible: CIBLE })
      await laisserFiler()
      expect(nav.etat('conv-a').gestes.at(-1)?.ongletId).toBe(a1)
      expect(nav.etat('conv-a').onglets.map((o) => o.id)).toEqual([a1, a2])
      vue.appels = []
      sequenceChargement(autre)
      await laisserFiler()
      expect(vue.methodes()).toEqual([])
    })

    it('jumeau : un titre qui change sans chargement ne relit pas la cible, la page ne défile pas', async () => {
      const { vue } = await enPause()
      vue.ecouteurs.surChangement()
      vue.ecouteurs.surChangement()
      await laisserFiler()
      expect(vue.methodes()).not.toContain('localiser')
      expect(traces(vue)).toEqual([])
    })

    it('jumeau : tant que la page charge, rien n’est relu', async () => {
      const { vue } = await enPause()
      vue.enChargement = true
      vue.ecouteurs.surChangement()
      await laisserFiler()
      expect(vue.methodes()).not.toContain('localiser')
    })

    it('jumeau : un geste qui attend sans cible (lecture) ne trace rien', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      nav.piloter('conv-a', 'pause')
      // `lire` rejette à la fermeture du fil, en fin de test : c'est son contrat, pas l'objet du test.
      nav.lire('conv-a').catch(() => undefined)
      await laisserFiler()
      vue.appels = []
      sequenceChargement(vue)
      await laisserFiler()
      expect(vue.methodes()).toEqual([])
    })

    it('jumeau : un geste déjà libéré ne retrace rien', async () => {
      const { vue, action } = await enPause()
      nav.piloter('conv-a', 'pas-suivant')
      expect(await action).toMatchObject({ ok: true })
      vue.appels = []
      sequenceChargement(vue)
      await laisserFiler()
      expect(vue.methodes().filter((m) => m === 'localiser' || m === 'surligner')).toEqual([])
    })

    it('ordre donné pendant la relecture : le geste libéré attend sa fin, les deux ne se croisent pas', async () => {
      const { vue, action } = await enPause()
      let rendre: (v: unknown) => void = () => undefined
      vue.reponses.localiser = () => new Promise((r) => (rendre = r))
      sequenceChargement(vue)
      await laisserFiler()
      nav.piloter('conv-a', 'pas-suivant')
      await laisserFiler()
      expect(vue.methodes().filter((m) => m === 'localiser')).toHaveLength(1)
      vue.reponses.localiser = cibleTrouvee()
      rendre(cibleTrouvee()([]))
      expect(await action).toMatchObject({ ok: true })
    })

    it('ordre donné pendant la relecture : aucun cadre ne reste après le geste', async () => {
      const { vue, action } = await enPause()
      let rendre: (v: unknown) => void = () => undefined
      vue.reponses.localiser = () => new Promise((r) => (rendre = r))
      sequenceChargement(vue)
      await laisserFiler()
      nav.piloter('conv-a', 'reprendre-la-main')
      rendre(cibleTrouvee()([]))
      expect(await action).toMatchObject({ ok: false, refus: 'main-reprise' })
      expect(traces(vue)).toEqual([])
      expect(vue.methodes().at(-1)).toBe('retirerSurbrillance')
    })
  })

  // Conv-1324 : chaque geste traçait par-dessus le précédent. La page montrait le DERNIER arrivé alors
  // que « Pas suivant » joue le PREMIER, et ce premier retirait le cadre en finissant : le second
  // attendait sans plus rien montrer.
  describe('deux gestes en attente : la page montre celui que « Pas suivant » va jouer', () => {
    const PLACE_UN = { x: 10, y: 20, largeur: 100, hauteur: 30 }
    const PLACE_DEUX = { x: 10, y: 300, largeur: 100, hauteur: 30 }
    const UN = { type: 'clic', cible: { selecteur: '#un' } } as const
    const DEUX = { type: 'clic', cible: { selecteur: '#deux' } } as const
    const traces = (vue: FausseVue): unknown[][] =>
      vue.appels.filter((a) => a.methode === 'surligner').map((a) => a.args)
    const deuxEnAttente = async (): Promise<{
      vue: FausseVue
      premier: ReturnType<typeof nav.agir>
      second: ReturnType<typeof nav.agir>
    }> => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = ([cible]) =>
        (cible as { selecteur: string }).selecteur === '#deux'
          ? cibleTrouvee({ rect: PLACE_DEUX, description: 'button « Deux »' })([])
          : cibleTrouvee({ rect: PLACE_UN, description: 'button « Un »' })([])
      nav.piloter('conv-a', 'pause')
      const premier = nav.agir('conv-a', UN)
      await laisserFiler()
      const second = nav.agir('conv-a', DEUX)
      await laisserFiler()
      return { vue, premier, second }
    }

    it('le premier arrivé garde les pointillés, le second ne les lui prend pas', async () => {
      const { vue } = await deuxEnAttente()
      expect(traces(vue)).toEqual([[PLACE_UN, 'cliquer sur button « Un »', { prochain: true }]])
    })

    it('le premier joué, le second prend les pointillés et les garde', async () => {
      const { vue, premier, second } = await deuxEnAttente()
      nav.piloter('conv-a', 'pas-suivant')
      expect(await premier).toMatchObject({ ok: true })
      await laisserFiler()
      const enPointilles = traces(vue).filter((args) => args[2])
      expect(enPointilles.at(-1)).toEqual([
        PLACE_DEUX,
        'cliquer sur button « Deux »',
        { prochain: true }
      ])
      expect(
        vue
          .methodes()
          .filter((m) => m !== 'prendre')
          .at(-1)
      ).toBe('surligner')
      expect(vue.evenements.filter((e) => e.type === 'mouseDown')).toHaveLength(1)
      nav.piloter('conv-a', 'reprendre')
      expect(await second).toMatchObject({ ok: true })
    })

    it('à trois, le relais va au suivant dans l’ordre, pas au dernier arrivé', async () => {
      const { vue, premier } = await deuxEnAttente()
      void nav.agir('conv-a', { type: 'clic', cible: { selecteur: '#trois' } })
      await laisserFiler()
      nav.piloter('conv-a', 'pas-suivant')
      expect(await premier).toMatchObject({ ok: true })
      await laisserFiler()
      expect(traces(vue).at(-1)?.[0]).toEqual(PLACE_DEUX)
      expect(
        vue
          .methodes()
          .filter((m) => m !== 'prendre')
          .at(-1)
      ).toBe('surligner')
    })

    it('jumeau : la main reprise fait tomber les deux gestes, rien n’est retracé', async () => {
      const { vue, premier, second } = await deuxEnAttente()
      vue.appels = []
      nav.piloter('conv-a', 'reprendre-la-main')
      expect(await premier).toMatchObject({ refus: 'main-reprise' })
      expect(await second).toMatchObject({ refus: 'main-reprise' })
      await laisserFiler()
      expect(vue.methodes()).not.toContain('surligner')
    })

    // fix-ok: objection du juge (réparation) — chaque geste qui finit relisait la cible du
    // premier en attente même déjà tracée (`terminerGeste`), et `localiser` la recentre
    // (`scrollIntoView`, navigateur-page-script.ts) : l'utilisateur qui avait défilé ailleurs y était
    // ramené à chaque geste refusé à côté.
    it('un geste refusé à côté ne relit pas une cible déjà tracée : la page ne défile pas', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = ([cible]) =>
        (cible as { selecteur: string }).selecteur === '#absent'
          ? { trouve: false }
          : cibleTrouvee({ rect: PLACE_UN, description: 'button « Un »' })([])
      nav.piloter('conv-a', 'pause')
      const attendu = nav.agir('conv-a', UN)
      await laisserFiler()
      expect(traces(vue)).toHaveLength(1)
      vue.appels = []
      expect(
        await nav.agir('conv-a', { type: 'clic', cible: { selecteur: '#absent' } })
      ).toMatchObject({ refus: 'cible-introuvable' })
      await laisserFiler()
      // Entrée qui rougit si la correction est fausse : sans garde, `localiser` repart sur `#un`.
      expect(vue.appels.filter((a) => a.methode === 'localiser').map((a) => a.args[0])).toEqual([
        { selecteur: '#absent' }
      ])
      expect(vue.methodes()).not.toContain('surligner')
      expect(await issueSansAttendre(attendu)).toBe('sans réponse')
    })

    it('jumeau : un geste joué pendant l’attente a effacé son cadre, le relais le repose', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = ([cible]) =>
        (cible as { selecteur: string }).selecteur === '#deux'
          ? cibleTrouvee({ rect: PLACE_DEUX, description: 'button « Deux »' })([])
          : cibleTrouvee({ rect: PLACE_UN, description: 'button « Un »' })([])
      // La surbrillance du geste joué reste ouverte : le second arrive et se trace PENDANT ce temps.
      let lacher: (v: unknown) => void = () => undefined
      vue.reponses.surligner = (args) => (args[2] ? undefined : new Promise((r) => (lacher = r)))
      nav.piloter('conv-a', 'pause')
      const premier = nav.agir('conv-a', UN)
      await laisserFiler()
      nav.piloter('conv-a', 'pas-suivant')
      await laisserFiler()
      const second = nav.agir('conv-a', DEUX)
      await laisserFiler()
      expect(traces(vue).at(-1)).toEqual([
        PLACE_DEUX,
        'cliquer sur button « Deux »',
        { prochain: true }
      ])
      // Le premier finit : son `retirerSurbrillance` efface le seul cadre de la page, celui du second.
      lacher(undefined)
      expect(await premier).toMatchObject({ ok: true })
      await laisserFiler()
      // Une garde « déjà tracé » sans plus laisserait la page sans pointillés ici.
      const fin = vue.methodes().filter((m) => m !== 'prendre')
      expect(fin.lastIndexOf('surligner')).toBeGreaterThan(fin.lastIndexOf('retirerSurbrillance'))
      expect(traces(vue).at(-1)).toEqual([
        PLACE_DEUX,
        'cliquer sur button « Deux »',
        { prochain: true }
      ])
      expect(await issueSansAttendre(second)).toBe('sans réponse')
    })

    it('jumeau : tracé lent, effacé avant sa réponse par le geste joué, le relais le repose', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = ([cible]) =>
        (cible as { selecteur: string }).selecteur === '#deux'
          ? cibleTrouvee({ rect: PLACE_DEUX, description: 'button « Deux »' })([])
          : cibleTrouvee({ rect: PLACE_UN, description: 'button « Un »' })([])
      // Deux réponses retenues : la surbrillance du geste joué, et le PREMIER tracé du second.
      let lacherJoue: (v: unknown) => void = () => undefined
      let lacherTrace: (v: unknown) => void = () => undefined
      let traceRetenu = false
      vue.reponses.surligner = (args) => {
        if (!args[2]) return new Promise((r) => (lacherJoue = r))
        if (traceRetenu || String(args[1]).includes('Un')) return undefined
        traceRetenu = true
        return new Promise((r) => (lacherTrace = r))
      }
      nav.piloter('conv-a', 'pause')
      const premier = nav.agir('conv-a', UN)
      await laisserFiler()
      nav.piloter('conv-a', 'pas-suivant')
      await laisserFiler()
      const second = nav.agir('conv-a', DEUX)
      await laisserFiler()
      // Le premier finit pendant que le tracé du second attend sa réponse : la page exécute dans
      // l'ordre des appels, son `retirerSurbrillance` efface donc ce tracé.
      lacherJoue(undefined)
      expect(await premier).toMatchObject({ ok: true })
      lacherTrace(undefined)
      expect(await issueSansAttendre(second)).toBe('sans réponse')
      // Entrée qui rougit si le tour du tracé est lu à sa RÉPONSE : il croirait le cadre encore là.
      const fin = vue.methodes().filter((m) => m !== 'prendre')
      expect(fin.lastIndexOf('surligner')).toBeGreaterThan(fin.lastIndexOf('retirerSurbrillance'))
      expect(traces(vue).at(-1)?.[0]).toEqual(PLACE_DEUX)
    })
  })

  it('pause : la garde mot de passe passe AVANT l’attente, l’accord du site APRÈS', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    const vue = fabrique.vues[0]
    nav.piloter('conv-a', 'pause')
    vue.reponses.localiser = cibleTrouvee({ secret: true })
    const secret = await nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: { ref: 1 } })
    expect(secret.refus).toBe('mot-de-passe')

    vue.reponses.localiser = cibleTrouvee()
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    expect(nav.etat('conv-a').demandeAccord).toBeUndefined()
    nav.piloter('conv-a', 'pas-suivant')
    await laisserFiler()
    expect(nav.etat('conv-a').demandeAccord?.origine).toBe('https://exemple.fr')
    nav.repondreAccord('https://exemple.fr', 'une-fois')
    expect(await action).toMatchObject({ ok: true })
  })

  it('« Pas suivant » joue UN seul geste, à la cible relocalisée, et la pause reste', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    const vus = suivreGestes('conv-a')
    nav.piloter('conv-a', 'pause')
    const premier = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    const second = nav.agir('conv-a', { type: 'clic', cible: { ref: 2 } })
    await laisserFiler()
    // La page a bougé pendant l'attente : le clic part là où la cible EST maintenant.
    vue.reponses.localiser = cibleTrouvee({ x: 300, y: 40 })
    nav.piloter('conv-a', 'pas-suivant')
    expect(await premier).toMatchObject({ ok: true })
    await laisserFiler()
    expect(vue.evenements.filter((e) => e.type === 'mouseDown')).toEqual([
      { type: 'mouseDown', x: 300, y: 40, button: 'left', clickCount: 1 }
    ])
    const etat = nav.etat('conv-a')
    expect(etat.pilotage).toBe('pause')
    expect(etat.gestes.map((g) => g.etat)).toEqual(['fait', 'prochain'])
    expect(vus.some((etats) => etats[0] === 'en-cours')).toBe(true)

    nav.piloter('conv-a', 'pas-suivant')
    expect(await second).toMatchObject({ ok: true })
    expect(vue.evenements.filter((e) => e.type === 'mouseDown')).toHaveLength(2)
  })

  /*
   * Mesuré en vraie app (run11) : page centrée, agent silencieux depuis 20 s. Le geste fait
   * réapparaître le bandeau, le cadre perd 44 px, la cible remonte de 22 px APRÈS son repérage ; le clic
   * partait aux anciennes coordonnées, tombait sur le champ voisin et l'outil répondait « Clic sur button ».
   * La remise en page d'une vue cachée n'arrive qu'avec l'image forcée : le test la livre là.
   * ENTRÉE QUI FAIT ÉCHOUER CE TEST si la correction est fausse : relire la cible AVANT `peindre`
   * (elle se relirait encore à l'ancienne place, y = 448).
   */
  it('la page se remet en page avant l’envoi : le clic part là où la cible EST', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee({ x: 252, y: 448 })
    const peindre = vue.peindre.bind(vue)
    vue.peindre = () => {
      vue.reponses.localiser = cibleTrouvee({ x: 252, y: 426 })
      return peindre()
    }
    expect(
      await nav.agir('conv-a', { type: 'clic', cible: { selecteur: '#bouton' } })
    ).toMatchObject({
      ok: true
    })
    expect(vue.evenements.filter((e) => e.type === 'mouseDown')).toEqual([
      { type: 'mouseDown', x: 252, y: 426, button: 'left', clickCount: 1 }
    ])
  })

  it('jumeau : page immobile, le clic part au repérage et rien n’est refusé', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee({ x: 252, y: 448 })
    expect(
      await nav.agir('conv-a', { type: 'clic', cible: { selecteur: '#bouton' } })
    ).toMatchObject({
      ok: true
    })
    expect(vue.evenements.filter((e) => e.type === 'mouseDown')).toEqual([
      { type: 'mouseDown', x: 252, y: 448, button: 'left', clickCount: 1 }
    ])
  })

  it('la cible disparaît juste avant l’envoi : refus « cible-introuvable », aucun clic', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    const peindre = vue.peindre.bind(vue)
    vue.peindre = () => {
      vue.reponses.localiser = () => ({ trouve: false })
      return peindre()
    }
    expect(
      await nav.agir('conv-a', { type: 'clic', cible: { selecteur: '#bouton' } })
    ).toMatchObject({
      ok: false,
      refus: 'cible-introuvable'
    })
    expect(vue.evenements.filter((e) => e.type === 'mouseDown')).toEqual([])
  })

  it('« Pas suivant » sans geste en attente ne fait rien : le geste suivant attend quand même', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    nav.piloter('conv-a', 'pause')
    nav.piloter('conv-a', 'pas-suivant')
    const lecture = nav.lire('conv-a')
    await laisserFiler()
    expect(fabrique.vues[0].methodes()).not.toContain('instantane')
    expect(nav.etat('conv-a').gestes.map((g) => [g.verbe, g.etat])).toEqual([['lire', 'prochain']])
    nav.piloter('conv-a', 'pas-suivant')
    expect(await lecture).toContain(PREFIXE_LECTURE)
  })

  it('cible disparue pendant la pause : refus « cible-introuvable », rien n’est envoyé', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    nav.piloter('conv-a', 'pause')
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    vue.reponses.localiser = () => ({ trouve: false })
    nav.piloter('conv-a', 'pas-suivant')
    expect(await action).toMatchObject({ ok: false, refus: 'cible-introuvable' })
    expect(vue.evenements).toEqual([])
    // Le tracé en pointillés est retiré, puis la cible relocalisée : plus rien n'est surligné.
    const ordre = vue.methodes()
    expect(ordre.filter((m) => m === 'surligner')).toHaveLength(1)
    expect(ordre.lastIndexOf('retirerSurbrillance')).toBeGreaterThan(ordre.indexOf('surligner'))
    expect(ordre.at(-1)).toBe('localiser')
    expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse'])
  })

  // fix-ok: run-adc12547df2d-1 (objection du juge) — l'état POUSSÉ gardait « cliquer sur la page »
  // alors que `etat()` et le tracé disaient la cible (rouge mesuré ici). Lire `nav.etat()` ne voyait
  // donc rien : on lit ce que reçoit le panneau.
  it('la description précisée par la cible est POUSSÉE au panneau, pas seulement lisible par etat()', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    fabrique.vues[0].reponses.localiser = cibleTrouvee()
    const pousses: string[][] = []
    nav.surEtat((e) => pousses.push(e.gestes.map((g) => g.description)))
    nav.piloter('conv-a', 'pause')
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    expect(pousses.at(-1)).toEqual(['cliquer sur button « Envoyer »'])
    nav.piloter('conv-a', 'reprendre')
    await action
  })

  it('jumeau : sans cible à préciser, rien de plus n’est poussé pendant l’attente', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    await laisserFiler()
    nav.piloter('conv-a', 'pause')
    const pousses: string[][] = []
    nav.surEtat((e) => pousses.push(e.gestes.map((g) => g.description)))
    const action = nav.agir('conv-a', { type: 'defiler', dy: 200 })
    await laisserFiler()
    expect(pousses).toHaveLength(1)
    nav.piloter('conv-a', 'reprendre')
    await action
  })

  // Même cause que la description : le panneau filtre la frise sur l'onglet actif. Un geste poussé
  // avec un onglet vide reste invisible tant que le chargement dure.
  it('fil sans onglet : pendant le chargement, le geste poussé porte déjà l’onglet ouvert', async () => {
    let finChargement: (r: { ok: boolean }) => void = () => undefined
    chargementRetenu = new Promise((fin) => (finChargement = fin))
    const pousses: string[][] = []
    nav.surEtat((e) => pousses.push(e.gestes.map((g) => g.ongletId)))
    const ouverture = nav.agentOuvrir('conv-a', 'http://localhost:5173')
    await laisserFiler()
    expect(pousses.at(-1)).toEqual([nav.etat('conv-a').ongletActif])
    finChargement({ ok: true })
    await ouverture
  })

  // Objection du juge (run-adc12547df2d-1) : l'onglet de plus demandé par l'agent passait par
  // `ouvrir`, le chemin des boutons de l'interface : ni noté, ni retenu, ni refusé.
  describe('onglet de plus demandé par l’agent', () => {
    const NOUVEL = { nouvelOnglet: true }

    it('libre : noté sur l’onglet ouvert, devenu actif, sans attendre la fin du chargement', async () => {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      chargementRetenu = new Promise(() => undefined)
      const r = await nav.agentOuvrir('conv-a', 'http://localhost:4000', NOUVEL)
      expect(r).toMatchObject({ ok: true })
      expect(r.message).toContain('navigateur_lire')
      const etat = nav.etat('conv-a')
      expect(etat.onglets).toHaveLength(2)
      expect(etat.ongletActif).toBe(r.ongletId)
      expect(etat.gestes.map((g) => [g.verbe, g.nature, g.etat, g.ongletId])).toEqual([
        ['ouvrir', 'agit', 'fait', r.ongletId]
      ])
      expect(etat.gestes[0].description).toBe('ouvrir http://localhost:4000/')
    })

    it('pause : il attend ; aucun onglet tant que « Pas suivant » ne le libère, et la pause reste', async () => {
      const premier = nav.ouvrir('conv-a', 'http://localhost:5173')
      nav.piloter('conv-a', 'pause')
      const ouverture = nav.agentOuvrir('conv-a', 'http://localhost:4000', NOUVEL)
      await laisserFiler()
      expect(nav.etat('conv-a').onglets).toHaveLength(1)
      expect(nav.etat('conv-a').ongletActif).toBe(premier)
      expect(nav.etat('conv-a').gestes.map((g) => [g.verbe, g.etat])).toEqual([
        ['ouvrir', 'prochain']
      ])
      nav.piloter('conv-a', 'pas-suivant')
      expect(await ouverture).toMatchObject({ ok: true })
      expect(nav.etat('conv-a').onglets).toHaveLength(2)
      expect(nav.etat('conv-a').pilotage).toBe('pause')
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['fait'])
    })

    it('« Reprendre la main » : refus, aucun onglet, onglet actif inchangé ; « Rendre la main » le permet', async () => {
      const premier = nav.ouvrir('conv-a', 'http://localhost:5173')
      nav.piloter('conv-a', 'pause')
      const enAttente = nav.agentOuvrir('conv-a', 'http://localhost:4000', NOUVEL)
      await laisserFiler()
      nav.piloter('conv-a', 'reprendre-la-main')
      const r = await enAttente
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/repris la main/)
      expect(await nav.agentOuvrir('conv-a', 'http://localhost:4001', NOUVEL)).toMatchObject({
        ok: false
      })
      expect(fabrique.vues).toHaveLength(1)
      expect(nav.etat('conv-a').ongletActif).toBe(premier)
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse', 'refuse'])

      nav.piloter('conv-a', 'rendre-la-main')
      expect(await nav.agentOuvrir('conv-a', 'http://localhost:4002', NOUVEL)).toMatchObject({
        ok: true
      })
      expect(nav.etat('conv-a').onglets).toHaveLength(2)
    })

    it('pause expirée : refus en phrase, aucun onglet', async () => {
      vi.useFakeTimers()
      nav = new GestionnaireNavigateur({ fabrique, racine, delaiSurbrillanceMs: 0 })
      nav.ouvrir('conv-a', 'http://localhost:5173')
      nav.piloter('conv-a', 'pause')
      const ouverture = nav.agentOuvrir('conv-a', 'http://localhost:4000', NOUVEL)
      await vi.advanceTimersByTimeAsync(DELAI_PAUSE_MS)
      const r = await ouverture
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/pause/)
      expect(fabrique.vues).toHaveLength(1)
    })

    it('adresse refusée ou plafond d’onglets : une phrase et un geste refusé, jamais une exception', async () => {
      const adresse = await nav.agentOuvrir('conv-a', 'javascript:alert(1)', NOUVEL)
      expect(adresse.ok).toBe(false)
      expect(adresse.message).toContain('Adresse refusée')
      for (let i = 0; i < MAX_ONGLETS_PAR_FIL; i++) nav.ouvrir('conv-a', 'http://localhost:5173')
      const plafond = await nav.agentOuvrir('conv-a', 'http://localhost:4000', NOUVEL)
      expect(plafond.ok).toBe(false)
      expect(plafond.message).toContain(`${MAX_ONGLETS_PAR_FIL} onglets`)
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse', 'refuse'])
    })
  })

  // Objection du juge (run-adc12547df2d-1) : le moteur n'avait aucun signal d'arrêt. Après un Stop,
  // le geste restait « prochain », et « Reprendre » — le geste naturel — faisait partir le clic d'un
  // agent arrêté, sans personne pour lire le résultat.
  describe('Stop du tour', () => {
    const CLIC = { type: 'clic', cible: { ref: 1 } } as const

    function preparer(url = 'http://localhost:5173'): FausseVue {
      nav.ouvrir('conv-a', url)
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      return vue
    }

    it('pendant la pause : refusé tout de suite, sans ordre, et « Reprendre » ne joue plus rien', async () => {
      const vue = preparer()
      const arret = new AbortController()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', CLIC, arret.signal)
      await laisserFiler()
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])
      arret.abort('user')
      const r = await action
      expect(r).toMatchObject({ ok: false, refus: 'page-indisponible' })
      expect(r.message).toMatch(/arrêté/)
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse'])
      // Le Stop coupe l'agent, pas le réglage : le fil reste en pause pour le tour suivant.
      expect(nav.etat('conv-a').pilotage).toBe('pause')
      // Le tracé en pointillés est retiré : plus rien n'annonce un geste qui ne viendra pas.
      expect(vue.methodes().at(-1)).toBe('retirerSurbrillance')
      nav.piloter('conv-a', 'reprendre')
      await laisserFiler()
      expect(vue.evenements).toEqual([])
    })

    it('jumeau : un signal jamais levé laisse « Pas suivant » jouer le geste', async () => {
      const vue = preparer()
      const arret = new AbortController()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', CLIC, arret.signal)
      await laisserFiler()
      nav.piloter('conv-a', 'pas-suivant')
      expect(await action).toMatchObject({ ok: true })
      expect(vue.evenements.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
      // Un Stop arrivé APRÈS la fin du geste ne réécrit pas ce qui s'est passé.
      arret.abort('user')
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['fait'])
    })

    it('tous les gestes en attente tombent : lire, capturer, ouvrir', async () => {
      const vue = preparer()
      const arret = new AbortController()
      nav.piloter('conv-a', 'pause')
      const lecture = nav.lire('conv-a', arret.signal)
      const capture = nav.capturer('conv-a', arret.signal)
      const ouverture = nav.agentOuvrir('conv-a', 'http://localhost:4000', {
        nouvelOnglet: true,
        arret: arret.signal
      })
      await laisserFiler()
      arret.abort('user')
      await expect(lecture).rejects.toThrow(/arrêté/)
      await expect(capture).rejects.toThrow(/arrêté/)
      expect(await ouverture).toMatchObject({ ok: false, message: expect.stringMatching(/arrêté/) })
      expect(vue.methodes()).not.toContain('instantane')
      expect(fabrique.vues).toHaveLength(1)
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse', 'refuse', 'refuse'])
    })

    it('déjà levé à l’arrivée du geste : la page n’est ni lue ni touchée', async () => {
      const vue = preparer()
      const arret = new AbortController()
      arret.abort('user')
      expect(await nav.agir('conv-a', CLIC, arret.signal)).toMatchObject({ ok: false })
      await expect(nav.lire('conv-a', arret.signal)).rejects.toThrow(/arrêté/)
      await expect(nav.capturer('conv-a', arret.signal)).rejects.toThrow(/arrêté/)
      expect(
        await nav.agentOuvrir('conv-a', 'http://localhost:4000', { arret: arret.signal })
      ).toMatchObject({ ok: false })
      expect(vue.methodes()).toEqual([])
      expect(vue.adresse).toBe('http://localhost:5173/')
    })

    it('pendant l’accord du site : ni bandeau ni surbrillance, rien n’est envoyé', async () => {
      const vue = preparer('https://exemple.fr')
      const arret = new AbortController()
      const action = nav.agir('conv-a', CLIC, arret.signal)
      await laisserFiler()
      expect(nav.etat('conv-a').demandeAccord?.origine).toBe('https://exemple.fr')
      arret.abort('user')
      nav.repondreAccord('https://exemple.fr', 'une-fois')
      expect(await action).toMatchObject({ ok: false, message: expect.stringMatching(/arrêté/) })
      expect(vue.methodes()).not.toContain('surligner')
      expect(vue.evenements).toEqual([])
      expect(nav.etat('conv-a').agentPilote).toBe(false)
    })

    it('pendant la surbrillance : le geste pas encore parti ne part pas', async () => {
      const vue = preparer()
      const arret = new AbortController()
      vue.reponses.surligner = (): boolean => {
        arret.abort('user')
        return true
      }
      expect(await nav.agir('conv-a', CLIC, arret.signal)).toMatchObject({ ok: false })
      expect(vue.evenements).toEqual([])
      expect(nav.etat('conv-a').agentPilote).toBe(false)
    })

    it('juste après la libération : le geste libéré mais pas parti ne part pas', async () => {
      const vue = preparer()
      const arret = new AbortController()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', CLIC, arret.signal)
      await laisserFiler()
      vue.reponses.retirerSurbrillance = (): boolean => {
        arret.abort('user')
        return true
      }
      nav.piloter('conv-a', 'pas-suivant')
      expect(await action).toMatchObject({ ok: false, message: expect.stringMatching(/arrêté/) })
      expect(vue.evenements).toEqual([])
    })
  })

  // Objection du juge (run-adc12547df2d-1, réparation 4) : le mode était coupé AVANT la relecture du
  // Stop et de la main reprise. Refus rendu, 0 événement, mais le mode éteint : à l'instant où
  // l'utilisateur voit le geste arriver et veut l'arrêter, il perdait son propre mode.
  describe('geste refusé pendant la surbrillance : le mode de l’utilisateur reste allumé', () => {
    const CLIC = { type: 'clic', cible: { ref: 1 } } as const

    async function preparer(): Promise<FausseVue> {
      nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
      nav.afficherFil('conv-a')
      nav.poserCadre({ x: 0, y: 0, largeur: 800, hauteur: 600 }, 1)
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      await nav.basculerMode('choisir')
      return vue
    }

    function attendreModeIntact(vue: FausseVue): void {
      expect(nav.etat('conv-a').mode).toBe('choisir')
      expect(vue.appels.filter((a) => a.methode === 'activerMode').map((a) => a.args[0])).toEqual([
        'choisir'
      ])
      expect(vue.evenements).toEqual([])
    }

    it('« Reprendre la main » : refus, et Choisir reste allumé', async () => {
      const vue = await preparer()
      vue.reponses.surligner = (): boolean => {
        nav.piloter('conv-a', 'reprendre-la-main')
        return true
      }
      expect(await nav.agir('conv-a', CLIC)).toMatchObject({ ok: false, refus: 'main-reprise' })
      attendreModeIntact(vue)
    })

    it('Stop : refus, et Choisir reste allumé', async () => {
      const vue = await preparer()
      const arret = new AbortController()
      vue.reponses.surligner = (): boolean => {
        arret.abort('user')
        return true
      }
      expect(await nav.agir('conv-a', CLIC, arret.signal)).toMatchObject({
        ok: false,
        message: expect.stringMatching(/arrêté/)
      })
      attendreModeIntact(vue)
    })

    // Même cause, autre refus : la relecture du site venait elle aussi après la coupure.
    it('la page change de site : refus, et Choisir reste allumé', async () => {
      const vue = await preparer()
      vue.reponses.surligner = (): boolean => {
        vue.adresse = 'https://site-b.fr/'
        return true
      }
      expect(await nav.agir('conv-a', CLIC)).toMatchObject({ ok: false, refus: 'page-changee' })
      attendreModeIntact(vue)
    })

    // La coupure prend un aller-retour avec la page : un Stop arrivé PENDANT ne peut plus la défaire.
    // L'agent doit alors savoir qu'il a éteint le mode, sinon personne ne le lui dit.
    it('Stop pendant l’extinction même : refus, et le message dit que le mode est éteint', async () => {
      const vue = await preparer()
      const arret = new AbortController()
      vue.reponses.activerMode = (args): boolean => {
        if (args[0] === null) arret.abort('user')
        return true
      }
      const r = await nav.agir('conv-a', CLIC, arret.signal)
      expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/arrêté/) })
      expect(r.message).toContain('Choisir')
      expect(nav.etat('conv-a').mode).toBeNull()
      expect(vue.evenements).toEqual([])
    })

    it('jumeau : refusé sans mode allumé, le message ne parle d’aucun mode', async () => {
      nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      vue.reponses.surligner = (): boolean => {
        nav.piloter('conv-a', 'reprendre-la-main')
        return true
      }
      const r = await nav.agir('conv-a', CLIC)
      expect(r).toMatchObject({ ok: false, refus: 'main-reprise' })
      expect(r.message).not.toMatch(/Mode /)
    })
  })

  // fix-ok: run-adc12547df2d-1 (mesuré) — un geste est noté `prochain` dès son arrivée, mais n'entre
  // dans `enPause` qu'une fois sa cible lue : « Pas suivant » cliqué entre les deux ne libérait rien,
  // et le geste attendait quand même (vrai outil pendu, commands.navigateur.test.ts, 3 fois sur 3).
  describe('ordre donné pendant la lecture de la cible', () => {
    const CLIC = { type: 'clic', cible: { ref: 1 } } as const
    const ENVOI = ['mouseMove', 'mouseDown', 'mouseUp']

    function preparer(): FausseVue {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      return vue
    }

    it('« Pas suivant » vaut pour ce geste, qui ne s’arrête pas à l’attente', async () => {
      const vue = preparer()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', CLIC)
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])

      nav.piloter('conv-a', 'pas-suivant')

      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['en-cours'])
      expect(await issueSansAttendre(action)).toMatchObject({ ok: true })
      expect(vue.evenements.map((e) => e.type)).toEqual(ENVOI)
      expect(nav.etat('conv-a').pilotage).toBe('pause')
    })

    it('la saisie libérée ainsi entre quand même dans le champ avant de taper', async () => {
      const vue = preparer()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', { type: 'saisir', texte: 'Bonjour', cible: { ref: 1 } })
      nav.piloter('conv-a', 'pas-suivant')
      expect(await issueSansAttendre(action)).toMatchObject({ ok: true })
      expect(vue.appels.filter((a) => a.methode === 'localiser').at(-1)?.args[1]).toEqual({
        focaliser: true,
        selectionner: false
      })
      expect(vue.textes).toEqual(['Bonjour'])
    })

    it('jumeau : un ordre libère UN geste, le suivant attend le sien', async () => {
      const vue = preparer()
      nav.piloter('conv-a', 'pause')
      const premier = nav.agir('conv-a', CLIC)
      const second = nav.agir('conv-a', CLIC)

      nav.piloter('conv-a', 'pas-suivant')

      expect(await issueSansAttendre(premier)).toMatchObject({ ok: true })
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['fait', 'prochain'])
      expect(vue.evenements).toHaveLength(3)
      nav.piloter('conv-a', 'pas-suivant')
      expect(await issueSansAttendre(second)).toMatchObject({ ok: true })
      expect(vue.evenements).toHaveLength(6)
    })

    it('jumeau : « Pause » cliquée pendant la lecture retient bien le geste', async () => {
      const vue = preparer()
      const action = nav.agir('conv-a', CLIC)

      nav.piloter('conv-a', 'pause')
      await laisserFiler()

      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])
      expect(vue.evenements).toEqual([])
      nav.piloter('conv-a', 'pas-suivant')
      expect(await issueSansAttendre(action)).toMatchObject({ ok: true })
    })

    it('jumeau : sans geste en route, « Pas suivant » ne fait rien, le prochain attendra', async () => {
      const vue = preparer()
      nav.piloter('conv-a', 'pause')
      nav.piloter('conv-a', 'pas-suivant')
      const action = nav.agir('conv-a', CLIC)
      await laisserFiler()
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])
      expect(vue.evenements).toEqual([])
      nav.piloter('conv-a', 'pas-suivant')
      expect(await issueSansAttendre(action)).toMatchObject({ ok: true })
    })
  })

  // fix-ok: run-adc12547df2d-1 (objection du juge) — `agir` attendait la promesse de la question
  // d'accord sans rien d'autre : « Reprendre la main » et le Stop laissaient le geste `en-cours` et la
  // question à l'écran jusqu'à la réponse ou 120 s, le champ déjà pris (focus et texte sélectionné).
  describe('question d’accord du site : la main reprise et le Stop n’attendent pas la réponse', () => {
    const SITE = 'https://exemple.fr'
    const CLIC = { type: 'clic', cible: { ref: 1 } } as const
    const SAISIE = {
      type: 'saisir',
      texte: 'Bonjour',
      remplacer: true,
      cible: { ref: 1 }
    } as const
    const SANS_TOUCHER = { focaliser: false, selectionner: false }
    const EN_ENTRANT = { focaliser: true, selectionner: true }
    const ARRETS: Array<[string, (arret: AbortController) => void, string, RegExp]> = [
      [
        'Reprendre la main',
        () => nav.piloter('conv-a', 'reprendre-la-main'),
        'main-reprise',
        /repris la main/
      ],
      ['Stop', (arret) => arret.abort('user'), 'page-indisponible', /arrêté/]
    ]
    const regards = (vue: FausseVue): unknown[] =>
      vue.appels.filter((a) => a.methode === 'localiser').map((a) => a.args[1])

    function preparer(conversationId = 'conv-a'): FausseVue {
      nav.ouvrir(conversationId, `${SITE}/page`)
      const vue = fabrique.vues.at(-1) as FausseVue
      vue.reponses.localiser = cibleTrouvee()
      return vue
    }

    it.each(ARRETS)(
      '%s : refus sans réponse, et la question tombe',
      async (_n, arreter, code, m) => {
        const vue = preparer()
        const arret = new AbortController()
        const action = nav.agir('conv-a', CLIC, arret.signal)
        await laisserFiler()
        expect(nav.etat('conv-a').demandeAccord?.origine).toBe(SITE)

        arreter(arret)

        expect(nav.etat('conv-a').demandeAccord).toBeUndefined()
        expect(await issueSansAttendre(action)).toMatchObject({
          ok: false,
          refus: code,
          message: expect.stringMatching(m)
        })
        expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse'])
        expect(vue.evenements).toEqual([])
        expect(vue.methodes()).not.toContain('surligner')
      }
    )

    it.each(ARRETS)(
      '%s après « Pas suivant » : le champ n’a jamais été pris',
      async (_n, arreter, code) => {
        const vue = preparer()
        const arret = new AbortController()
        nav.piloter('conv-a', 'pause')
        const action = nav.agir('conv-a', SAISIE, arret.signal)
        await laisserFiler()
        nav.piloter('conv-a', 'pas-suivant')
        await laisserFiler()
        expect(nav.etat('conv-a').demandeAccord?.origine).toBe(SITE)

        arreter(arret)

        // Lu avant tout `await` : c'est ce qui prouve « tout de suite », le cas exact de l'objection.
        expect(nav.etat('conv-a').demandeAccord).toBeUndefined()
        expect(await issueSansAttendre(action)).toMatchObject({ ok: false, refus: code })
        expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse'])
        expect(regards(vue)).toEqual([SANS_TOUCHER, SANS_TOUCHER])
        expect(vue.textes).toEqual([])
      }
    )

    it('fil libre : la saisie ne prend le champ qu’une fois l’accord donné', async () => {
      const vue = preparer()
      const action = nav.agir('conv-a', SAISIE)
      await laisserFiler()
      expect(regards(vue)).toEqual([SANS_TOUCHER])

      nav.repondreAccord(SITE, 'une-fois')

      expect(await action).toMatchObject({ ok: true })
      expect(regards(vue)).toEqual([SANS_TOUCHER, EN_ENTRANT])
      expect(vue.textes).toEqual(['Bonjour'])
    })

    it('jumeau : sur un site déjà accepté, aucune question, le champ est pris du premier coup', async () => {
      const vue = preparer()
      nav.repondreAccord(SITE, 'une-fois')
      expect(await nav.agir('conv-a', SAISIE)).toMatchObject({ ok: true })
      expect(regards(vue)).toEqual([EN_ENTRANT])
      expect(vue.textes).toEqual(['Bonjour'])
    })

    it('la page change de site pendant la question : le nouveau site n’a pas le champ pris', async () => {
      const vue = preparer()
      const action = nav.agir('conv-a', SAISIE)
      await laisserFiler()
      vue.adresse = 'https://site-b.fr/'

      nav.repondreAccord(SITE, 'une-fois')

      expect(await action).toMatchObject({ ok: false, refus: 'page-changee' })
      expect(regards(vue)).toEqual([SANS_TOUCHER])
      expect(vue.textes).toEqual([])
    })

    it.each(ARRETS)(
      '%s pendant la relecture : aucune question n’est posée',
      async (_n, arreter, code) => {
        const vue = preparer()
        const arret = new AbortController()
        nav.piloter('conv-a', 'pause')
        const action = nav.agir('conv-a', CLIC, arret.signal)
        await laisserFiler()
        const cible = cibleTrouvee()
        vue.reponses.localiser = (args): unknown => {
          arreter(arret)
          return cible(args)
        }

        nav.piloter('conv-a', 'pas-suivant')

        expect(await issueSansAttendre(action)).toMatchObject({ ok: false, refus: code })
        expect(nav.etat('conv-a').demandeAccord).toBeUndefined()
      }
    )

    it('un autre fil sur le même site garde sa question et son geste', async () => {
      preparer('conv-a')
      const autre = preparer('conv-b')
      const abandonne = nav.agir('conv-a', CLIC)
      const garde = nav.agir('conv-b', CLIC)
      await laisserFiler()

      nav.piloter('conv-a', 'reprendre-la-main')

      expect(await issueSansAttendre(abandonne)).toMatchObject({ refus: 'main-reprise' })
      expect(nav.etat('conv-b').demandeAccord?.origine).toBe(SITE)
      expect(autre.evenements).toEqual([])
      nav.repondreAccord(SITE, 'une-fois')
      expect(await garde).toMatchObject({ ok: true })
      expect(autre.evenements.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
    })

    it('un geste du même fil encore en attente garde la question', async () => {
      const vue = preparer()
      const arret = new AbortController()
      const arrete = nav.agir('conv-a', CLIC, arret.signal)
      const suivant = nav.agir('conv-a', CLIC)
      await laisserFiler()

      arret.abort('user')

      expect(await issueSansAttendre(arrete)).toMatchObject({ ok: false })
      expect(nav.etat('conv-a').demandeAccord?.origine).toBe(SITE)
      nav.repondreAccord(SITE, 'une-fois')
      expect(await suivant).toMatchObject({ ok: true })
      expect(vue.evenements.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
    })

    it('main reprise puis rendue aussitôt : le geste abandonné ne repart pas', async () => {
      const vue = preparer()
      const action = nav.agir('conv-a', CLIC)
      await laisserFiler()

      nav.piloter('conv-a', 'reprendre-la-main')
      nav.piloter('conv-a', 'rendre-la-main')

      expect(await issueSansAttendre(action)).toMatchObject({ ok: false, refus: 'main-reprise' })
      expect(vue.evenements).toEqual([])
    })

    it('la question abandonnée n’écourte pas la suivante : elle a ses 120 s', async () => {
      vi.useFakeTimers()
      nav = new GestionnaireNavigateur({ fabrique, racine, delaiSurbrillanceMs: 0 })
      preparer()
      const abandonne = nav.agir('conv-a', CLIC)
      await vi.advanceTimersByTimeAsync(60_000)
      nav.piloter('conv-a', 'reprendre-la-main')
      await abandonne
      nav.piloter('conv-a', 'rendre-la-main')

      const suivant = nav.agir('conv-a', CLIC)
      await vi.advanceTimersByTimeAsync(DELAI_ACCORD_MS - 1)
      expect(nav.etat('conv-a').demandeAccord?.origine).toBe(SITE)
      await vi.advanceTimersByTimeAsync(1)
      expect(await suivant).toMatchObject({ ok: false, refus: 'accord-refuse' })
    })

    // Objection du juge (run-adc12547df2d-1) : après la question, la relecture du site lisait l'adresse
    // d'une page fermée, hors du `try` : `agir` se rejetait et l'agent recevait une phrase technique.
    it.each([
      ['une saisie', SAISIE],
      ['un clic', CLIC]
    ] as const)(
      '%s dont l’onglet est fermé pendant la question : refus clair, rien ne part',
      async (_n, action) => {
        const vue = preparer()
        const enCours = nav.agir('conv-a', action)
        await laisserFiler()
        nav.fermerOnglet(nav.etat('conv-a').ongletActif as string)

        nav.repondreAccord(SITE, 'une-fois')

        expect(await enCours).toMatchObject({
          ok: false,
          refus: 'aucun-onglet',
          message: expect.stringMatching(/onglet a été fermé/)
        })
        expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse'])
        expect(vue.textes).toEqual([])
        expect(vue.evenements).toEqual([])
      }
    )

    it('jumeau : l’onglet fermé pendant la pause donne le même refus', async () => {
      preparer()
      nav.piloter('conv-a', 'pause')
      const enCours = nav.agir('conv-a', CLIC)
      await laisserFiler()
      nav.fermerOnglet(nav.etat('conv-a').ongletActif as string)

      nav.piloter('conv-a', 'pas-suivant')

      expect(await enCours).toMatchObject({ ok: false, refus: 'aucun-onglet' })
    })

    // Objection du juge (run-adc12547df2d-1) : `oublierFil` laissait les gestes dans la question. Seul
    // sur le site, le geste attendait les 120 s ; un autre fil présent, sa réponse relançait le geste
    // du fil supprimé et `this.fil()` recréait ce fil.
    const filConnu = (id: string): boolean =>
      (nav as unknown as { fils: Map<string, unknown> }).fils.has(id)

    it('fil supprimé pendant la question : son geste tombe tout de suite', async () => {
      const vue = preparer()
      const enCours = nav.agir('conv-a', SAISIE)
      await laisserFiler()

      nav.oublierFil('conv-a')

      expect(await issueSansAttendre(enCours)).toMatchObject({
        ok: false,
        refus: 'aucun-onglet',
        message: expect.stringMatching(/onglet a été fermé/)
      })
      expect(vue.textes).toEqual([])
      expect(filConnu('conv-a')).toBe(false)
    })

    it('fil supprimé : la réponse de l’autre fil sur le même site ne relance pas son geste', async () => {
      const supprimee = preparer('conv-a')
      const autre = preparer('conv-b')
      const perdu = nav.agir('conv-a', CLIC)
      const garde = nav.agir('conv-b', CLIC)
      await laisserFiler()

      nav.oublierFil('conv-a')

      expect(await issueSansAttendre(perdu)).toMatchObject({ ok: false, refus: 'aucun-onglet' })
      expect(nav.etat('conv-b').demandeAccord?.origine).toBe(SITE)
      nav.repondreAccord(SITE, 'une-fois')
      expect(await garde).toMatchObject({ ok: true })
      expect(autre.evenements.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
      expect(supprimee.evenements).toEqual([])
      expect(filConnu('conv-a')).toBe(false)
    })

    it('la question du fil supprimé n’écourte pas celle d’un autre fil : elle a ses 120 s', async () => {
      vi.useFakeTimers()
      nav = new GestionnaireNavigateur({ fabrique, racine, delaiSurbrillanceMs: 0 })
      preparer('conv-a')
      const perdu = nav.agir('conv-a', CLIC)
      await vi.advanceTimersByTimeAsync(60_000)
      nav.oublierFil('conv-a')

      preparer('conv-b')
      const suivant = nav.agir('conv-b', CLIC)
      await vi.advanceTimersByTimeAsync(DELAI_ACCORD_MS - 1)
      expect(nav.etat('conv-b').demandeAccord?.origine).toBe(SITE)
      await vi.advanceTimersByTimeAsync(1)
      expect(await suivant).toMatchObject({ ok: false, refus: 'accord-refuse' })
      expect(await perdu).toMatchObject({ ok: false })
    })
  })

  // Objection du juge (run-adc12547df2d-1) : `localiser` partait avec focus et sélection AVANT tout
  // ordre. Main reprise, l'utilisateur avait perdu son focus, et sa prochaine frappe remplaçait le
  // texte sélectionné. En pause, on REGARDE la cible ; on n'y entre qu'une fois le geste libéré.
  describe('saisie en attente : ni focus ni sélection avant l’ordre', () => {
    const SAISIE = {
      type: 'saisir',
      texte: 'Bonjour',
      remplacer: true,
      cible: { ref: 1 }
    } as const
    const SANS_TOUCHER = { focaliser: false, selectionner: false }
    const EN_ENTRANT = { focaliser: true, selectionner: true }
    const regards = (vue: FausseVue): unknown[] =>
      vue.appels.filter((a) => a.methode === 'localiser').map((a) => a.args[1])

    function preparer(): FausseVue {
      nav.ouvrir('conv-a', 'http://localhost:5173')
      const vue = fabrique.vues[0]
      vue.reponses.localiser = cibleTrouvee()
      return vue
    }

    it('en attente : cible lue et tracée, sans focus ni sélection', async () => {
      const vue = preparer()
      nav.piloter('conv-a', 'pause')
      void nav.agir('conv-a', SAISIE)
      await laisserFiler()
      expect(regards(vue)).toEqual([SANS_TOUCHER])
      expect(vue.appels.find((a) => a.methode === 'surligner')?.args[2]).toEqual({ prochain: true })
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])
    })

    it('« Reprendre la main » : focus et sélection n’ont jamais été demandés', async () => {
      const vue = preparer()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', SAISIE)
      await laisserFiler()
      nav.piloter('conv-a', 'reprendre-la-main')
      expect(await action).toMatchObject({ ok: false, refus: 'main-reprise' })
      expect(regards(vue)).toEqual([SANS_TOUCHER])
      expect(vue.textes).toEqual([])
    })

    it('jumeau « Pas suivant » : focus et sélection arrivent une fois le geste libéré', async () => {
      const vue = preparer()
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', SAISIE)
      await laisserFiler()
      nav.piloter('conv-a', 'pas-suivant')
      expect(await action).toMatchObject({ ok: true })
      expect(regards(vue)).toEqual([SANS_TOUCHER, EN_ENTRANT])
      expect(vue.textes).toEqual(['Bonjour'])
    })

    // Objection du juge (run-adc12547df2d-1, réparation 4) : rien ne relisait le Stop ni la main
    // reprise entre la libération et la relocalisation. Le geste était refusé, mais `localiser` était
    // déjà parti avec focus et sélection : focus perdu, et la prochaine frappe remplaçait le texte.
    describe('arrêté aussitôt après « Pas suivant » : le champ n’est pas touché', () => {
      const ARRETS: Array<[string, (arret: AbortController) => void, RegExp]> = [
        ['Stop', (arret) => arret.abort('user'), /arrêté/],
        ['Reprendre la main', () => nav.piloter('conv-a', 'reprendre-la-main'), /repris la main/]
      ]

      it.each(ARRETS)('%s juste après l’ordre', async (_nom, arreter, message) => {
        const vue = preparer()
        const arret = new AbortController()
        nav.piloter('conv-a', 'pause')
        const action = nav.agir('conv-a', SAISIE, arret.signal)
        await laisserFiler()
        nav.piloter('conv-a', 'pas-suivant')
        arreter(arret)
        const r = await action
        expect(r).toMatchObject({ ok: false, message: expect.stringMatching(message) })
        expect(regards(vue)).toEqual([SANS_TOUCHER])
        expect(vue.textes).toEqual([])
      })

      it.each(ARRETS)('%s pendant le retrait du tracé', async (_nom, arreter, message) => {
        const vue = preparer()
        const arret = new AbortController()
        nav.piloter('conv-a', 'pause')
        const action = nav.agir('conv-a', SAISIE, arret.signal)
        await laisserFiler()
        vue.reponses.retirerSurbrillance = (): boolean => {
          arreter(arret)
          return true
        }
        nav.piloter('conv-a', 'pas-suivant')
        const r = await action
        expect(r).toMatchObject({ ok: false, message: expect.stringMatching(message) })
        expect(regards(vue)).toEqual([SANS_TOUCHER])
        expect(vue.textes).toEqual([])
      })
    })

    it('aucun champ actif : la saisie ciblée attend, elle n’est pas refusée d’office', async () => {
      const vue = preparer()
      const vide = { aucun: true, secret: false, cadreIntegre: false, description: 'page' }
      vue.focus = vide
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', SAISIE)
      await laisserFiler()
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])
      vue.focus = { ...vide, aucun: false, description: 'textbox « Nom »' }
      nav.piloter('conv-a', 'pas-suivant')
      expect(await action).toMatchObject({ ok: true })
    })

    it('un mot de passe actif AILLEURS ne bloque pas l’attente ; la garde rejouée le voit encore', async () => {
      const vue = preparer()
      vue.focus = { aucun: false, secret: true, cadreIntegre: false, description: 'secret' }
      nav.piloter('conv-a', 'pause')
      const action = nav.agir('conv-a', SAISIE)
      await laisserFiler()
      expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])
      // Le focus reste sur un champ secret : la frappe partirait là, la garde la refuse.
      nav.piloter('conv-a', 'pas-suivant')
      expect(await action).toMatchObject({ ok: false, refus: 'mot-de-passe' })
      expect(vue.textes).toEqual([])
    })

    it('« Reprendre » pendant le premier regard : la saisie entre quand même dans le champ', async () => {
      const vue = preparer()
      nav.piloter('conv-a', 'pause')
      let vus = 0
      vue.reponses.localiser = (args): unknown => {
        vus += 1
        if (vus === 1) nav.piloter('conv-a', 'reprendre')
        return cibleTrouvee()(args)
      }
      expect(await nav.agir('conv-a', SAISIE)).toMatchObject({ ok: true })
      expect(regards(vue)).toEqual([SANS_TOUCHER, EN_ENTRANT])
      expect(vue.textes).toEqual(['Bonjour'])
    })

    it('jumeau libre : focus et sélection dès le premier regard, sans second', async () => {
      const vue = preparer()
      expect(await nav.agir('conv-a', SAISIE)).toMatchObject({ ok: true })
      expect(regards(vue)).toEqual([EN_ENTRANT])
    })
  })

  // Objection du juge (run-adc12547df2d-1) : le clic partait sur la cible relocalisée, le moteur le
  // disait, mais la frise gardait l'ancienne cible : elle affichait un geste qui n'a jamais eu lieu.
  it('cible relocalisée : le geste affiché et poussé dit ce qui part vraiment', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee({ description: 'button « Annuler »' })
    const pousses: string[][] = []
    nav.surEtat((e) => pousses.push(e.gestes.map((g) => g.description)))
    nav.piloter('conv-a', 'pause')
    const action = nav.agir('conv-a', { type: 'clic', cible: { selecteur: 'button' } })
    await laisserFiler()
    expect(pousses.at(-1)).toEqual(['cliquer sur button « Annuler »'])
    vue.reponses.localiser = cibleTrouvee({ description: 'button « Tout supprimer »' })
    nav.piloter('conv-a', 'pas-suivant')
    const r = await action
    expect(r.message).toContain('Tout supprimer')
    expect(nav.etat('conv-a').gestes[0].description).toBe('cliquer sur button « Tout supprimer »')
    expect(pousses.at(-1)).toEqual(['cliquer sur button « Tout supprimer »'])
  })

  // Objection du juge (run-adc12547df2d-1) : `pause` et `reprendre` faisaient sortir de la main
  // reprise. Le fonctionnement figé dit « jusqu'à Rendre la main » : un ordre en retard du panneau ne
  // rend pas la page à l'agent.
  it('main reprise : seul « Rendre la main » en sort', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    nav.piloter('conv-a', 'reprendre-la-main')
    for (const ordre of ['pause', 'reprendre', 'pas-suivant', 'reprendre-la-main'] as const) {
      nav.piloter('conv-a', ordre)
      expect(nav.etat('conv-a').pilotage).toBe('main')
    }
    expect((await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).refus).toBe(
      'main-reprise'
    )
    nav.piloter('conv-a', 'rendre-la-main')
    expect(nav.etat('conv-a').pilotage).toBe('libre')
    expect(await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).toMatchObject({
      ok: true
    })
  })

  it('jumeau : un ordre sans effet en main reprise repousse quand même l’état au panneau', () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    nav.piloter('conv-a', 'reprendre-la-main')
    const pousses: string[] = []
    nav.surEtat((e) => pousses.push(e.pilotage))
    nav.piloter('conv-a', 'reprendre')
    expect(pousses).toEqual(['main'])
  })

  it('« Reprendre » repasse en libre et joue le geste en attente ; les suivants passent seuls', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    nav.piloter('conv-a', 'pause')
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    nav.piloter('conv-a', 'reprendre')
    expect(nav.etat('conv-a').pilotage).toBe('libre')
    expect(await action).toMatchObject({ ok: true })
    expect(await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).toMatchObject({
      ok: true
    })
    expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['fait', 'fait'])
  })

  it('« Reprendre la main » refuse le geste en attente et TOUS les suivants, sans toucher la page', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    nav.piloter('conv-a', 'pause')
    const enAttente = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await laisserFiler()
    nav.piloter('conv-a', 'reprendre-la-main')
    const r = await enAttente
    expect(r).toMatchObject({ ok: false, refus: 'main-reprise' })
    expect(r.message).toMatch(/repris la main/)
    expect(r.message).toMatch(/sans qu.il te le redemande/)
    expect(nav.etat('conv-a').pilotage).toBe('main')

    const localisations = vue.methodes().filter((m) => m === 'localiser').length
    expect(
      await nav.agir('conv-a', { type: 'saisir', texte: 'x', cible: { ref: 1 } })
    ).toMatchObject({ ok: false, refus: 'main-reprise' })
    await expect(nav.lire('conv-a')).rejects.toThrow(/repris la main/)
    await expect(nav.capturer('conv-a')).rejects.toThrow(/repris la main/)
    expect(await nav.agentOuvrir('conv-a', 'http://localhost:4000')).toMatchObject({ ok: false })
    expect(vue.methodes().filter((m) => m === 'localiser')).toHaveLength(localisations)
    expect(vue.methodes()).not.toContain('instantane')
    expect(vue.evenements).toEqual([])
    expect(vue.textes).toEqual([])
    expect(vue.adresse).toBe('http://localhost:5173/')
    expect(nav.etat('conv-a').gestes.every((g) => g.etat === 'refuse')).toBe(true)
    // Le pilotage est PAR FIL : l'agent d'un autre fil n'est pas touché.
    nav.ouvrir('conv-b', 'http://localhost:6000')
    expect(await nav.lire('conv-b')).toContain(PREFIXE_LECTURE)
  })

  it('main reprise PENDANT la surbrillance : le geste pas encore parti ne part pas', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    vue.reponses.surligner = (): boolean => {
      nav.piloter('conv-a', 'reprendre-la-main')
      return true
    }
    expect(await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).toMatchObject({
      ok: false,
      refus: 'main-reprise'
    })
    expect(vue.evenements).toEqual([])
    expect(nav.etat('conv-a').agentPilote).toBe(false)
  })

  it('jumeau : une PAUSE pendant la surbrillance laisse partir le geste déjà libéré', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    vue.reponses.surligner = (): boolean => {
      nav.piloter('conv-a', 'pause')
      return true
    }
    expect(await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).toMatchObject({
      ok: true
    })
    expect(vue.evenements.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
  })

  it('« Rendre la main » : libre, les gestes de l’agent repassent', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    fabrique.vues[0].reponses.localiser = cibleTrouvee()
    nav.piloter('conv-a', 'reprendre-la-main')
    expect((await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).refus).toBe(
      'main-reprise'
    )
    nav.piloter('conv-a', 'rendre-la-main')
    expect(nav.etat('conv-a').pilotage).toBe('libre')
    expect(await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })).toMatchObject({
      ok: true
    })
  })

  it('pause sans ordre pendant DELAI_PAUSE_MS : refus « pause-expiree », rien n’est envoyé', async () => {
    vi.useFakeTimers()
    nav = new GestionnaireNavigateur({ fabrique, racine, delaiSurbrillanceMs: 0 })
    nav.ouvrir('conv-a', 'http://localhost:5173')
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    nav.piloter('conv-a', 'pause')
    const action = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    await vi.advanceTimersByTimeAsync(DELAI_PAUSE_MS - 1)
    expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['prochain'])
    await vi.advanceTimersByTimeAsync(1)
    const r = await action
    expect(r).toMatchObject({ ok: false, refus: 'pause-expiree' })
    expect(r.message).toMatch(/pause/)
    expect(vue.evenements).toEqual([])
    expect(vue.methodes().at(-1)).toBe('retirerSurbrillance')
    expect(nav.etat('conv-a').gestes.map((g) => g.etat)).toEqual(['refuse'])
    expect(nav.etat('conv-a').pilotage).toBe('pause')
  })

  // Le CLI coupe un appel d'outil direct à `verify` + 2 min (12 min par défaut, `envDelaiOutilsMcp`).
  // Un geste libéré à la dernière seconde de pause peut encore attendre l'accord du site (120 s) et
  // la surbrillance : la somme doit rester sous ce plafond, sinon l'agent reçoit une coupure muette.
  it('la pause la plus longue, accord et surbrillance compris, tient sous le délai des outils directs', () => {
    const plafond = Number(envDelaiOutilsMcp(true, {}).MCP_TOOL_TIMEOUT)
    expect(DELAI_PAUSE_MS + DELAI_ACCORD_MS + DELAI_SURBRILLANCE_MS).toBeLessThan(plafond)
  })

  it('oublierFil et detruire libèrent les gestes en attente', async () => {
    nav.ouvrir('conv-a', 'http://localhost:5173')
    nav.ouvrir('conv-b', 'http://localhost:6000')
    for (const vue of fabrique.vues) vue.reponses.localiser = cibleTrouvee()
    nav.piloter('conv-a', 'pause')
    nav.piloter('conv-b', 'pause')
    const a = nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    const b = nav.lire('conv-b')
    await laisserFiler()
    nav.oublierFil('conv-a')
    expect(await a).toMatchObject({ ok: false })
    expect(nav.etat('conv-a').gestes).toEqual([])
    nav.detruire()
    await expect(b).rejects.toThrow(/fermé/)
    expect(fabrique.vues.every((v) => v.evenements.length === 0)).toBe(true)
  })
})

describe('petites règles', () => {
  it('normaliserUrlNavigateur', () => {
    expect(normaliserUrlNavigateur('exemple.fr/a')).toBe('https://exemple.fr/a')
    expect(normaliserUrlNavigateur('localhost:5173')).toBe('http://localhost:5173/')
    expect(normaliserUrlNavigateur('http://x.fr')).toBe('http://x.fr/')
    expect(normaliserUrlNavigateur('about:blank')).toBe('about:blank')
    expect(normaliserUrlNavigateur('data:text/html,<b>')).toBeNull()
    expect(normaliserUrlNavigateur('  ')).toBeNull()
  })

  it('analyserTouche', () => {
    expect(analyserTouche('Enter')).toEqual({ keyCode: 'Enter', modifiers: [] })
    expect(analyserTouche('ArrowDown')).toEqual({ keyCode: 'Down', modifiers: [] })
    expect(analyserTouche('Control+Shift+k')).toEqual({
      keyCode: 'k',
      modifiers: ['control', 'shift']
    })
    expect(analyserTouche('Hyper+x')).toBeNull()
    expect(analyserTouche('Inconnue')).toBeNull()
  })
})

describe('vraie fabrique Electron (Electron simulé)', () => {
  it('vue isolée dans la bonne partition, liens vers un nouvel onglet refusés et renvoyés au fil', () => {
    const ajoutees: unknown[] = []
    const fenetre = {
      contentView: { addChildView: (v: unknown) => ajoutees.push(v), removeChildView: vi.fn() },
      getContentBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      isDestroyed: () => false
    }
    const vraie = creerFabriqueElectron(fenetre as never)
    const ecouteurs: EcouteursVue = {
      surChangement: vi.fn(),
      surNouvelleFenetre: vi.fn(),
      surFenetreLiee: vi.fn(() => null),
      surFermeture: vi.fn(),
      surConsole: vi.fn(),
      surRequeteEchouee: vi.fn(),
      surTelechargement: vi.fn()
    }
    vraie.creerVue({ partition: PARTITION_PERSISTANTE, ecouteurs })
    const vue = electronSimule.vues.at(-1)
    if (!vue) throw new Error('aucune vue créée')
    expect(vue.options).toEqual({
      webPreferences: expect.objectContaining({
        partition: 'persist:autowin-navigateur',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      })
    })
    expect(vue.visible).toBe(false)
    expect(vue.rayon).toBe(10)
    expect(ajoutees).toEqual([vue])

    expect(
      vue.webContents.ouvertureFenetre?.({ url: 'https://pop.fr', disposition: 'foreground-tab' })
    ).toEqual({
      action: 'deny'
    })
    expect(ecouteurs.surNouvelleFenetre).toHaveBeenCalledWith('https://pop.fr', 'foreground-tab')
    // Une fenêtre liée que le fil refuse (plus de place) : refusée, et pas rouverte en onglet.
    expect(
      vue.webContents.ouvertureFenetre?.({ url: 'https://connexion.fr', disposition: 'new-window' })
    ).toEqual({ action: 'deny' })
    expect(ecouteurs.surFenetreLiee).toHaveBeenCalledWith('https://connexion.fr')
    expect(ecouteurs.surNouvelleFenetre).toHaveBeenCalledTimes(1)

    vue.webContents.ecoutes.get('console-message')?.({
      level: 'error',
      message: 'boum',
      lineNumber: 7,
      sourceId: 'app.js'
    })
    expect(ecouteurs.surConsole).toHaveBeenCalledWith({
      niveau: 'error',
      message: 'boum',
      source: 'app.js',
      ligne: 7
    })

    const ses = electronSimule.sessionsParId.get('unique') as {
      webRequest: { termine: (d: unknown) => void; erreur: (d: unknown) => void }
    }
    const id = vue.webContents.id
    ses.webRequest.termine({
      statusCode: 200,
      webContentsId: id,
      url: 'a',
      method: 'GET',
      resourceType: 'xhr'
    })
    ses.webRequest.termine({
      statusCode: 404,
      webContentsId: id,
      url: 'b',
      method: 'GET',
      resourceType: 'xhr'
    })
    ses.webRequest.erreur({
      error: 'net::ERR_ABORTED',
      webContentsId: id,
      url: 'c',
      method: 'GET',
      resourceType: 'mainFrame'
    })
    ses.webRequest.erreur({
      error: 'net::ERR_NAME_NOT_RESOLVED',
      webContentsId: id,
      url: 'd',
      method: 'GET',
      resourceType: 'mainFrame'
    })
    expect(ecouteurs.surRequeteEchouee).toHaveBeenCalledTimes(2)
    expect(ecouteurs.surRequeteEchouee).toHaveBeenNthCalledWith(1, {
      url: 'b',
      methode: 'GET',
      statut: 404,
      typeRessource: 'xhr'
    })
    expect(ecouteurs.surRequeteEchouee).toHaveBeenNthCalledWith(2, {
      url: 'd',
      methode: 'GET',
      erreur: 'net::ERR_NAME_NOT_RESOLVED',
      typeRessource: 'mainFrame'
    })

    vraie.creerVue({ partition: PARTITION_EPHEMERE, ecouteurs })
    expect(
      (electronSimule.vues.at(-1)?.options as { webPreferences: { partition: string } })
        .webPreferences.partition
    ).toBe('autowin-navigateur')
  })

  /*
   * « Continuer avec Google » ne revenait jamais : la fenêtre de connexion était refusée puis
   * rouverte en onglet NEUF, sans lien avec la page (`window.opener`), seul chemin du résultat.
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : refuser la fenêtre liée, construire l'onglet sur une page
   * neuve au lieu de celle d'Electron, ou laisser l'onglet ouvert quand la page se ferme.
   */
  it('une fenêtre de connexion devient un onglet construit sur la page liée d’Electron', () => {
    const retirees: unknown[] = []
    const fenetre = {
      contentView: { addChildView: vi.fn(), removeChildView: (v: unknown) => retirees.push(v) },
      getContentBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      isDestroyed: () => false
    }
    const vraie = creerFabriqueElectron(fenetre as never)
    const ecouteursOnglet: EcouteursVue = {
      surChangement: vi.fn(),
      surNouvelleFenetre: vi.fn(),
      surFenetreLiee: vi.fn(() => null),
      surFermeture: vi.fn(),
      surConsole: vi.fn(),
      surRequeteEchouee: vi.fn(),
      surTelechargement: vi.fn()
    }
    const adopter = vi.fn()
    const ecouteurs: EcouteursVue = {
      ...ecouteursOnglet,
      surFenetreLiee: vi.fn(() => ({ ecouteurs: ecouteursOnglet, adopter }))
    }
    vraie.creerVue({ partition: PARTITION_PERSISTANTE, ecouteurs })
    const ouvreur = electronSimule.vues.at(-1)
    if (!ouvreur) throw new Error('aucune vue créée')

    const reponse = ouvreur.webContents.ouvertureFenetre?.({
      url: 'https://accounts.google.com/o/oauth2',
      disposition: 'new-window'
    })
    expect(reponse?.action).toBe('allow')
    expect(ecouteurs.surNouvelleFenetre).not.toHaveBeenCalled()
    const pageLiee = electronSimule.pages.creer?.()
    // Electron exige qu'on lui rende SA page : c'est elle qui porte le lien avec l'ouvreur.
    expect(reponse?.createWindow?.({ webContents: pageLiee })).toBe(pageLiee)
    const vueLiee = electronSimule.vues.at(-1)
    expect(vueLiee?.webContents).toBe(pageLiee)
    expect(vueLiee?.options).toEqual({ webContents: pageLiee })
    expect(adopter).toHaveBeenCalledTimes(1)

    // `window.close()` en fin de connexion : la vue quitte la fenêtre, le fil retire l'onglet.
    vueLiee?.webContents.ecoutes.get('destroyed')?.()
    expect(retirees).toEqual([vueLiee])
    expect(ecouteursOnglet.surFermeture).toHaveBeenCalledTimes(1)
  })

  /*
   * Mesuré le 2026-10-29 (lot 5/5) dans l'instance cachée : Ctrl+Shift+B
   * tapé le focus DANS la page laissait le panneau ouvert — ses raccourcis écoutent le rendu de la
   * fenêtre, qui ne voit pas les touches de la vue native. L'entrée qui ferait échouer ce test si
   * la correction était fausse : un keyDown Ctrl+Shift+B venu de la page, non rejoué à la fenêtre.
   */
  function fabriqueAvecFenetre(): {
    vue: VueNavigateur
    touche: (entree: Record<string, unknown>) => { evitee: boolean }
    fenetre: {
      webContents: { focus: ReturnType<typeof vi.fn>; sendInputEvent: ReturnType<typeof vi.fn> }
    }
  } {
    const fenetre = {
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      getContentBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      isDestroyed: () => false,
      webContents: { focus: vi.fn(), sendInputEvent: vi.fn() }
    }
    const vraie = creerFabriqueElectron(fenetre as never)
    const vue = vraie.creerVue({
      partition: PARTITION_EPHEMERE,
      ecouteurs: {
        surChangement: vi.fn(),
        surNouvelleFenetre: vi.fn(),
        surFenetreLiee: vi.fn(() => null),
        surFermeture: vi.fn(),
        surConsole: vi.fn(),
        surRequeteEchouee: vi.fn(),
        surTelechargement: vi.fn()
      }
    })
    const simulee = electronSimule.vues.at(-1)
    if (!simulee) throw new Error('aucune vue créée')
    const touche = (entree: Record<string, unknown>): { evitee: boolean } => {
      const evenement = { evitee: false, preventDefault: () => (evenement.evitee = true) }
      simulee.webContents.ecoutes.get('before-input-event')?.(evenement, {
        type: 'keyDown',
        control: false,
        meta: false,
        shift: false,
        alt: false,
        ...entree
      })
      return evenement
    }
    // L'agent tape par `sendInputEvent` : comme le vrai Electron, il repasse par l'écoute.
    ;(simulee.webContents as unknown as Record<string, unknown>).getZoomFactor = () => 1
    ;(simulee.webContents as unknown as Record<string, unknown>).sendInputEvent = (e: {
      type: string
      keyCode?: string
      modifiers?: string[]
    }) => {
      if (e.type === 'keyDown')
        touche({
          key: e.keyCode,
          control: e.modifiers?.includes('control'),
          shift: e.modifiers?.includes('shift')
        })
    }
    return { vue, touche, fenetre }
  }

  // Mesuré (run-r1-vert.txt) : `capturePage` échoue sur une page jamais dessinée sans la
  // faire dessiner ; la capture du débogueur, elle, attend l'image.
  it.each([
    { dejaAttache: false, journal: ['attach 1.3', 'Page.captureScreenshot', 'detach'] },
    { dejaAttache: true, journal: ['Page.captureScreenshot'] }
  ])(
    'peindre : image attendue par le débogueur, laissé comme trouvé (déjà attaché : $dejaAttache)',
    async ({ dejaAttache, journal }) => {
      const fenetre = {
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
        getContentBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
        isDestroyed: () => false,
        webContents: { focus: vi.fn(), sendInputEvent: vi.fn() }
      }
      const vue = creerFabriqueElectron(fenetre as never).creerVue({
        partition: PARTITION_PERSISTANTE,
        ecouteurs: {
          surChangement: vi.fn(),
          surNouvelleFenetre: vi.fn(),
          surFenetreLiee: vi.fn(() => null),
          surFermeture: vi.fn(),
          surConsole: vi.fn(),
          surRequeteEchouee: vi.fn(),
          surTelechargement: vi.fn()
        }
      })
      const vu: string[] = []
      let attache = dejaAttache
      ;(electronSimule.vues.at(-1)?.webContents as unknown as Record<string, unknown>).debugger = {
        isAttached: () => attache,
        attach: (v: string) => {
          attache = true
          vu.push(`attach ${v}`)
        },
        detach: () => {
          attache = false
          vu.push('detach')
        },
        sendCommand: (methode: string) => {
          vu.push(methode)
          return Promise.resolve({ data: '' })
        }
      }
      await vue.peindre()
      expect(vu).toEqual(journal)
      expect(attache).toBe(dejaAttache)
    }
  )

  /*
   * FIL QUE L'UTILISATEUR NE REGARDE PAS (2026-10-30) : un fil est reste suspendu plus
   * de 20 minutes sur `navigateur_agir`. Mesure dans une fenetre MONTREE : `Page.captureScreenshot`
   * ne revient JAMAIS sur une vue cachee (fromSurface et emulation du focus n'y changent rien), et
   * sans image, le clic est perdu. Une vue visible sur UN pixel de la fenetre dessine en 115 ms et
   * recoit le clic : ni redimensionnee, ni montree a l'utilisateur.
   */
  describe('peindre : vue cachée', () => {
    const preparer = (
      sendCommand: (methode: string) => Promise<unknown>
    ): {
      vue: ReturnType<ReturnType<typeof creerFabriqueElectron>['creerVue']>
      simulee: { visible?: boolean; cadre: { y: number }; gestes: string[] }
      debogueur: { attache: boolean }
    } => {
      const fenetre = {
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
        getContentBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
        isDestroyed: () => false,
        webContents: { focus: vi.fn(), sendInputEvent: vi.fn() }
      }
      const vue = creerFabriqueElectron(fenetre as never).creerVue({
        partition: PARTITION_PERSISTANTE,
        ecouteurs: {
          surChangement: vi.fn(),
          surNouvelleFenetre: vi.fn(),
          surFenetreLiee: vi.fn(() => null),
          surFermeture: vi.fn(),
          surConsole: vi.fn(),
          surRequeteEchouee: vi.fn(),
          surTelechargement: vi.fn()
        }
      })
      const simulee = electronSimule.vues.at(-1) as never as {
        visible?: boolean
        cadre: { y: number }
        gestes: string[]
        webContents: Record<string, unknown>
      }
      const debogueur = { attache: false }
      simulee.webContents.debugger = {
        isAttached: () => debogueur.attache,
        attach: () => {
          debogueur.attache = true
        },
        detach: () => {
          debogueur.attache = false
        },
        sendCommand: (methode: string) => {
          simulee.gestes.push(methode)
          return sendCommand(methode)
        }
      }
      simulee.gestes.length = 0
      return { vue, simulee, debogueur }
    }

    it('une vue jamais affichée a tout de suite une taille : sa page se met en page', () => {
      const { simulee } = preparer(() => Promise.resolve({}))
      expect(simulee.cadre).toEqual({ x: 0, y: 0, width: 900, height: 700 })
      expect(simulee.visible).toBe(false)
    })

    it('la montre sur le dernier pixel de la fenêtre, le temps de l’image, puis la remet', async () => {
      const { vue, simulee } = preparer(() => Promise.resolve({}))
      await vue.peindre()
      expect(simulee.gestes).toEqual([
        'cadre y=699 900x700',
        'visible true',
        'Page.captureScreenshot',
        'visible false',
        'cadre y=0 900x700'
      ])
    })

    it('une vue déjà visible ne bouge pas', async () => {
      const { vue, simulee } = preparer(() => Promise.resolve({}))
      vue.rendreVisible(true)
      simulee.gestes.length = 0
      await vue.peindre()
      expect(simulee.gestes).toEqual(['Page.captureScreenshot'])
    })

    it('image jamais rendue : échoue en nommant la cause, sans laisser la vue en place', async () => {
      vi.useFakeTimers()
      try {
        const { vue, simulee, debogueur } = preparer(() => new Promise(() => undefined))
        const issue = expect(vue.peindre()).rejects.toThrow(/dessin/u)
        await vi.advanceTimersByTimeAsync(6_000)
        await issue
        expect(simulee.visible).toBe(false)
        expect(simulee.cadre.y).toBe(0)
        expect(debogueur.attache).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('le panneau s’ouvre pendant le dessin : sa demande gagne, rien ne la défait', async () => {
      let rendre: (v: unknown) => void = () => undefined
      const { vue, simulee } = preparer(
        () =>
          new Promise((fin) => {
            rendre = fin
          })
      )
      const dessin = vue.peindre()
      vue.poserCadre({ x: 10, y: 20, width: 500, height: 400 })
      vue.rendreVisible(true)
      expect(simulee.visible).toBe(true)
      expect(simulee.cadre.y).toBe(699)
      rendre({})
      await dessin
      expect(simulee.visible).toBe(true)
      expect(simulee.cadre).toEqual({ x: 10, y: 20, width: 500, height: 400 })
    })
  })

  it.each([
    { key: 'B', shift: true, keyCode: 'B', modifiers: ['control', 'shift'] },
    { key: 'S', shift: true, keyCode: 'S', modifiers: ['control', 'shift'] },
    { key: 't', shift: false, keyCode: 'T', modifiers: ['control'] }
  ])(
    'raccourci du panneau tapé DANS la page ($key, Maj $shift) : retenu et rejoué à la fenêtre',
    ({ key, shift, keyCode, modifiers }) => {
      const { touche, fenetre } = fabriqueAvecFenetre()
      expect(touche({ key, control: true, shift }).evitee).toBe(true)
      expect(fenetre.webContents.focus).toHaveBeenCalled()
      expect(fenetre.webContents.sendInputEvent.mock.calls.map((c) => c[0])).toEqual([
        { type: 'keyDown', keyCode, modifiers },
        { type: 'keyUp', keyCode, modifiers }
      ])
    }
  )

  it('jumeaux : Ctrl+B, un relâchement, et la frappe de l’AGENT restent à la page', () => {
    const { vue, touche, fenetre } = fabriqueAvecFenetre()
    expect(touche({ key: 'b', control: true }).evitee).toBe(false)
    expect(touche({ key: 'B', control: true, shift: true, type: 'keyUp' }).evitee).toBe(false)
    expect(touche({ key: 'B', control: true, shift: true, alt: true }).evitee).toBe(false)
    vue.envoyer({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] })
    expect(fenetre.webContents.sendInputEvent).not.toHaveBeenCalled()
    expect(fenetre.webContents.focus).not.toHaveBeenCalled()
  })
})

function readFileSafe(chemin: string): string | null {
  try {
    return readFileSync(chemin, 'utf8')
  } catch {
    return null
  }
}

describe('agentChrome (conv-1569)', () => {
  it('retire Electron et la marque de l’app de l’agent', async () => {
    const { agentChrome } = await import('./navigateur-integre')
    const brut =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) autowin-os/0.1.0 Chrome/140.0.0.0 Electron/44.5.1 Safari/537.36'
    expect(agentChrome(brut)).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    )
  })
})
