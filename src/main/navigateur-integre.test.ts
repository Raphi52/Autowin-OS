/**
 * Le moteur du navigateur intégré, sans Electron (conv-1286, lot 1/5) : une fausse fabrique rend des
 * pages en mémoire, et les scripts de page sont relus par `decoderAppelPage` pour répondre comme la
 * vraie page. La vraie fabrique est vérifiée en fin de fichier sur un Electron simulé.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronSimule = vi.hoisted(() => {
  const vues: Array<{
    options: unknown
    visible: boolean | undefined
    webContents: {
      id: number
      session: unknown
      ecoutes: Map<string, (...args: unknown[]) => void>
      ouvertureFenetre?: (d: { url: string; disposition: string }) => { action: string }
    }
  }> = []
  const sessionsParId = new Map<string, unknown>()
  return { vues, sessionsParId }
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
    on: vi.fn()
  }
  electronSimule.sessionsParId.set('unique', sessionPartagee)
  let prochainId = 100
  class WebContentsView {
    options: unknown
    visible: boolean | undefined
    webContents: {
      id: number
      session: unknown
      ecoutes: Map<string, (...args: unknown[]) => void>
      ouvertureFenetre?: (d: { url: string; disposition: string }) => { action: string }
      on: (nom: string, f: (...args: unknown[]) => void) => void
      setWindowOpenHandler: (
        f: (d: { url: string; disposition: string }) => { action: string }
      ) => void
    }
    constructor(options: unknown) {
      this.options = options
      const ecoutes = new Map<string, (...args: unknown[]) => void>()
      const contenu = {
        id: prochainId++,
        session: sessionPartagee,
        ecoutes,
        ouvertureFenetre: undefined as
          undefined | ((d: { url: string; disposition: string }) => { action: string }),
        on(nom: string, f: (...args: unknown[]) => void): void {
          ecoutes.set(nom, f)
        },
        setWindowOpenHandler(
          f: (d: { url: string; disposition: string }) => { action: string }
        ): void {
          contenu.ouvertureFenetre = f
        }
      }
      this.webContents = contenu
      electronSimule.vues.push(this)
    }
    setVisible(v: boolean): void {
      this.visible = v
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
import { normaliserUrlNavigateur } from '../shared/navigateur'
import { envDelaiOutilsMcp } from './providers/claude'

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
    return this.adresse
  }
  titre(): string {
    return ''
  }
  chargement(): boolean {
    return false
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
    // `capturePage` sur une page sans image : Chromium échoue ainsi (conv-1286, navigateur_capture).
    if (this.sansImage) return Promise.reject(new Error('UnknownVizError'))
    return Promise.resolve('data:image/png;base64,AAAA')
  }
  /**
   * Règle de Chromium reproduite à la demande (conv-1293, lot 5/5 de conv-1286) : tant que la page
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

  // Objection du juge (conv-1287, réparation 1) : sans cible, la frappe partait sans surbrillance —
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
 * Objection du juge (conv-1293, réparation 1) — mesuré dans l'instance cachée (run8) : sur une page
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
   * Mesuré dans l'app (conv-1286, 2026-10-29) : `navigateur_capture` sur `localhost:5173` rouvert,
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

  // Objection du juge (conv-1287, réparation 1) : l'origine n'était lue qu'AVANT l'attente ; une
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

describe('annotations : le canal de retour de la page', () => {
  it('le signal console n’est pas gardé et déclenche la relève ; l’annotation porte sa capture', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr/page')
    const vue = fabrique.vues[0]
    let file: unknown[] = [
      {
        type: 'annotation',
        idPage: 'p1',
        selecteur: '#titre',
        texteElement: 'Bonjour',
        styles: {
          police: 'Arial',
          taille: '32px',
          couleur: 'rgb(0, 0, 0)',
          fond: 'white',
          marges: 'marge 0'
        },
        rect: { x: 10, y: 20, largeur: 100, hauteur: 30 },
        commentaire: 'Plus gros'
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
    const [annotation] = nav.annotations('conv-a')
    expect(annotation).toMatchObject({
      ongletId: nav.etat('conv-a').ongletActif,
      url: 'https://exemple.fr/page',
      selecteur: '#titre',
      commentaire: 'Plus gros',
      captureDataUrl: 'data:image/png;base64,AAAA'
    })
    expect(nav.etat('conv-a').nombreAnnotations).toBe(1)

    nav.supprimerAnnotation(annotation.id)
    expect(nav.annotations('conv-a')).toEqual([])
    expect(vue.appels.find((a) => a.methode === 'retirerPastille')?.args).toEqual(['p1'])
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
        idPage: 'c1',
        selecteur: 'button',
        texteElement: 'Payer',
        styles: {},
        rect: { x: 0, y: 0, largeur: 0, hauteur: 0 },
        commentaire: ''
      }
    ]
    vue.ecouteurs.surConsole({ niveau: 'debug', message: PING_NAVIGATEUR, source: '', ligne: 0 })
    await laisserFiler()
    expect(nav.annotations('conv-a')).toMatchObject([{ selecteur: 'button', commentaire: '' }])
    expect(nav.annotations('conv-a')[0].captureDataUrl).toBeUndefined()
    expect(nav.etat('conv-a').mode).toBeNull()

    await nav.basculerMode('annoter')
    nav.afficherFil('conv-b')
    expect(nav.etat('conv-a').mode).toBeNull()
  })

  it('sans onglet visible, le mode reste éteint', async () => {
    nav.ouvrir('conv-a', 'https://exemple.fr')
    await nav.basculerMode('annoter')
    expect(nav.etat('conv-a').mode).toBeNull()
  })

  /*
   * Mesuré le 2026-10-29 (conv-1293, lot 5/5 de conv-1286) dans l'instance cachée : après « Envoyer
   * au chat », le mode Annoter reste allumé ; le clic de l'agent part, la page l'AVALE (écoutes
   * click/pointerdown du mode) et l'outil répond « Clic sur … » sans que rien ne change. L'entrée
   * qui ferait échouer ce test si la correction était fausse : un mode encore « annoter » au moment
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

  it('un clic de l’agent sur l’onglet en mode Annoter éteint d’abord le mode : la page ne l’avale pas', async () => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    nav.afficherFil('conv-a')
    nav.poserCadre({ x: 0, y: 0, largeur: 800, hauteur: 600 }, 1)
    const vue = fabrique.vues[0]
    vue.reponses.localiser = cibleTrouvee()
    await nav.basculerMode('annoter')
    expect(nav.etat('conv-a').mode).toBe('annoter')
    const modeVu = modeAuPremierEvenement(vue)
    const resultat = await nav.agir('conv-a', { type: 'clic', cible: { ref: 1 } })
    expect(resultat).toMatchObject({ ok: true })
    expect(resultat.message).toContain('Annoter')
    expect(modeVu).toEqual([null])
    expect(nav.etat('conv-a').mode).toBeNull()
  })

  it('jumeau : défiler ne fait que lire, le mode Annoter de l’utilisateur reste allumé', async () => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    nav.afficherFil('conv-a')
    nav.poserCadre({ x: 0, y: 0, largeur: 800, hauteur: 600 }, 1)
    const vue = fabrique.vues[0]
    await nav.basculerMode('annoter')
    const resultat = await nav.agir('conv-a', { type: 'defiler', dy: 300 })
    expect(resultat).toMatchObject({ ok: true })
    expect(vue.appels.filter((a) => a.methode === 'activerMode').map((a) => a.args[0])).toEqual([
      'annoter'
    ])
    expect(nav.etat('conv-a').mode).toBe('annoter')
  })

  it('jumeau : une action refusée (cible introuvable) laisse le mode allumé', async () => {
    nav.ouvrir('conv-a', 'http://127.0.0.1:8080')
    nav.afficherFil('conv-a')
    nav.poserCadre({ x: 0, y: 0, largeur: 800, hauteur: 600 }, 1)
    const vue = fabrique.vues[0]
    vue.reponses.localiser = () => ({ trouve: false })
    await nav.basculerMode('annoter')
    const resultat = await nav.agir('conv-a', { type: 'clic', cible: { ref: 9 } })
    expect(resultat).toMatchObject({ ok: false, refus: 'cible-introuvable' })
    expect(nav.etat('conv-a').mode).toBe('annoter')
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
 * PAS-À-PAS (conv-1286, maquette « 1 · Jalons · Aperçu du geste suivant », 2026-10-30). Ce qui fait
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
  it('vue isolée dans la bonne partition, fenêtres surgissantes refusées et renvoyées en onglet', () => {
    const ajoutees: unknown[] = []
    const fenetre = {
      contentView: { addChildView: (v: unknown) => ajoutees.push(v), removeChildView: vi.fn() },
      isDestroyed: () => false
    }
    const vraie = creerFabriqueElectron(fenetre as never)
    const ecouteurs: EcouteursVue = {
      surChangement: vi.fn(),
      surNouvelleFenetre: vi.fn(),
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
    expect(ajoutees).toEqual([vue])

    expect(
      vue.webContents.ouvertureFenetre?.({ url: 'https://pop.fr', disposition: 'new-window' })
    ).toEqual({
      action: 'deny'
    })
    expect(ecouteurs.surNouvelleFenetre).toHaveBeenCalledWith('https://pop.fr', 'new-window')

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
   * Mesuré le 2026-10-29 (conv-1293, lot 5/5 de conv-1286) dans l'instance cachée : Ctrl+Shift+B
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
      isDestroyed: () => false,
      webContents: { focus: vi.fn(), sendInputEvent: vi.fn() }
    }
    const vraie = creerFabriqueElectron(fenetre as never)
    const vue = vraie.creerVue({
      partition: PARTITION_EPHEMERE,
      ecouteurs: {
        surChangement: vi.fn(),
        surNouvelleFenetre: vi.fn(),
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

  // Mesuré (conv-1293, run-r1-vert.txt) : `capturePage` échoue sur une page jamais dessinée sans la
  // faire dessiner ; la capture du débogueur, elle, attend l'image.
  it.each([
    { dejaAttache: false, journal: ['attach 1.3', 'Page.captureScreenshot', 'detach'] },
    { dejaAttache: true, journal: ['Page.captureScreenshot'] }
  ])(
    'peindre : image attendue par le débogueur, laissé comme trouvé (déjà attaché : $dejaAttache)',
    async ({ dejaAttache, journal }) => {
      const fenetre = {
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
        isDestroyed: () => false,
        webContents: { focus: vi.fn(), sendInputEvent: vi.fn() }
      }
      const vue = creerFabriqueElectron(fenetre as never).creerVue({
        partition: PARTITION_PERSISTANTE,
        ecouteurs: {
          surChangement: vi.fn(),
          surNouvelleFenetre: vi.fn(),
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
