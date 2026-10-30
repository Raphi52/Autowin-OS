/**
 * Canaux du navigateur intégré (conv-1286, lot 2/5) : le VRAI gestionnaire, une fausse fabrique de
 * pages, une fausse fenêtre principale, Electron simulé.
 *
 * Ce qui est prouvé : les canaux branchés sont EXACTEMENT ceux du contrat, tous derrière le contrôle
 * d'expéditeur ; un argument mal formé est refusé avant le moteur (et sa valeur jumelle, à la même
 * borne, passe) ; chaque appel atteint le gestionnaire de la fenêtre principale ; chaque changement
 * d'état part vers cette fenêtre ; fermer la fenêtre ferme ses pages et, sans « garder les cookies »,
 * efface les données. Côté pont, le VRAI preload est chargé : `window.api.navigateur` envoie chaque
 * méthode sur son canal, et la fonction rendue par `surEtat` retire l'écouteur.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const simule = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  gardes: [] as string[],
  // Côté pont (preload) : ce qu'il expose, ce qu'il invoque, qui écoute quel canal.
  exposes: new Map<string, unknown>(),
  invocations: [] as unknown[][],
  ecouteurs: new Map<string, Set<(...args: unknown[]) => void>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => simule.handlers.set(canal, fn)
  },
  app: { getPath: () => tmpdir() },
  session: { fromPartition: () => ({}) },
  shell: { openExternal: async () => undefined },
  WebContentsView: class {},
  contextBridge: {
    exposeInMainWorld: (nom: string, valeur: unknown) => simule.exposes.set(nom, valeur)
  },
  ipcRenderer: {
    invoke: async (...args: unknown[]) => {
      simule.invocations.push(args)
    },
    on: (canal: string, ecouteur: (...args: unknown[]) => void) => {
      const liste = simule.ecouteurs.get(canal) ?? new Set()
      liste.add(ecouteur)
      simule.ecouteurs.set(canal, liste)
    },
    removeListener: (canal: string, ecouteur: (...args: unknown[]) => void) => {
      simule.ecouteurs.get(canal)?.delete(ecouteur)
    }
  },
  webFrame: { getZoomFactor: () => 1, setZoomFactor: () => undefined }
}))
vi.mock('../ipc-senders', () => ({
  assertTrustedRendererSender: (event: { nonFiable?: boolean }, portee: string) => {
    simule.gardes.push(portee)
    if (event?.nonFiable) throw new Error(`Origine renderer non autorisée pour ${portee}`)
  }
}))

import { gestionnaireNavigateur, registerNavigateurIpc, type NavigateurIpcDeps } from './navigateur'
import type {
  CadreFenetre,
  EcouteursVue,
  FabriqueVueNavigateur,
  VueNavigateur
} from '../navigateur-integre'
import { PARTITION_EPHEMERE, PARTITION_PERSISTANTE } from '../navigateur-integre'
import { CANAUX_NAVIGATEUR, type ApiNavigateur, type EtatNavigateur } from '../../shared/navigateur'

class FausseVue implements VueNavigateur {
  adresse = ''
  titrePage = ''
  enChargement = false
  visible = false
  fermee = false
  readonly appels: string[] = []
  constructor(
    readonly partition: string,
    readonly ecouteurs: EcouteursVue
  ) {}
  async charger(url: string): Promise<{ ok: boolean }> {
    this.adresse = url
    this.appels.push(`charger ${url}`)
    return { ok: true }
  }
  url(): string {
    return this.adresse
  }
  titre(): string {
    return this.titrePage
  }
  chargement(): boolean {
    return this.enChargement
  }
  peutReculer(): boolean {
    return true
  }
  peutAvancer(): boolean {
    return true
  }
  reculer(): void {
    this.appels.push('reculer')
  }
  avancer(): void {
    this.appels.push('avancer')
  }
  recharger(): void {
    this.appels.push('recharger')
  }
  arreter(): void {
    this.appels.push('arreter')
  }
  poserCadre(cadre: CadreFenetre): void {
    this.appels.push(`cadre ${cadre.x},${cadre.y},${cadre.width},${cadre.height}`)
  }
  rendreVisible(visible: boolean): void {
    this.visible = visible
  }
  taille(): { largeur: number; hauteur: number } {
    return { largeur: 800, hauteur: 600 }
  }
  async executer(): Promise<unknown> {
    return null
  }
  async capturer(): Promise<string | null> {
    return null
  }
  async peindre(): Promise<void> {
    this.appels.push('peindre')
  }
  envoyer(): void {
    this.appels.push('envoyer')
  }
  async insererTexte(): Promise<void> {
    this.appels.push('insererTexte')
  }
  fermer(): void {
    this.fermee = true
  }
}

class FausseFabrique implements FabriqueVueNavigateur {
  readonly vues: FausseVue[] = []
  effacements = 0
  readonly externes: string[] = []
  creerVue({
    partition,
    ecouteurs
  }: {
    partition: string
    ecouteurs: EcouteursVue
  }): VueNavigateur {
    const vue = new FausseVue(partition, ecouteurs)
    this.vues.push(vue)
    return vue
  }
  async effacerDonnees(): Promise<void> {
    this.effacements += 1
  }
  async ouvrirExterne(url: string): Promise<void> {
    this.externes.push(url)
  }
}

/** Une fenêtre principale : ce que le module en lit (destruction, `closed`, envoi au rendu). */
function fausseFenetre(): {
  fenetre: BrowserWindow
  envois: Array<{ canal: string; etat: EtatNavigateur }>
  fermer: () => void
} {
  let detruite = false
  const surFermeture: Array<() => void> = []
  const envois: Array<{ canal: string; etat: EtatNavigateur }> = []
  const fenetre = {
    isDestroyed: () => detruite,
    once: (nom: string, rappel: () => void) => {
      if (nom === 'closed') surFermeture.push(rappel)
    },
    webContents: {
      isDestroyed: () => detruite,
      send: (canal: string, etat: EtatNavigateur) => envois.push({ canal, etat })
    }
  } as unknown as BrowserWindow
  return {
    fenetre,
    envois,
    fermer: () => {
      detruite = true
      for (const rappel of surFermeture.splice(0)) rappel()
    }
  }
}

const EVENEMENT = { senderFrame: { url: 'app://autowin' } }
const EVENEMENT_NON_FIABLE = { nonFiable: true }

let fenetreCourante: ReturnType<typeof fausseFenetre> | null = null
const fabriques: Array<{ fenetre: BrowserWindow; fabrique: FausseFabrique }> = []
const deps: NavigateurIpcDeps & { racine: string } = {
  fenetrePrincipale: () => fenetreCourante?.fenetre ?? null,
  creerFabrique: (fenetre) => {
    const fabrique = new FausseFabrique()
    fabriques.push({ fenetre, fabrique })
    return fabrique
  },
  racine: ''
}

/** Appelle le canal comme `ipcRenderer.invoke` : une promesse, même si le handler lance. */
function appeler(canal: string, ...args: unknown[]): Promise<unknown> {
  const handler = simule.handlers.get(canal)
  if (!handler) throw new Error(`canal non branché : ${canal}`)
  return Promise.resolve().then(() => handler(EVENEMENT, ...args))
}

function derniereFabrique(): FausseFabrique {
  const derniere = fabriques.at(-1)
  if (!derniere) throw new Error('aucun gestionnaire créé')
  return derniere.fabrique
}

beforeAll(() => {
  registerNavigateurIpc(deps)
})

beforeEach(() => {
  deps.racine = mkdtempSync(join(tmpdir(), 'navigateur-ipc-'))
  fenetreCourante = fausseFenetre()
  fabriques.length = 0
  simule.gardes.length = 0
})

afterEach(() => {
  fenetreCourante?.fermer()
  fenetreCourante = null
  rmSync(deps.racine, { recursive: true, force: true })
})

describe('canaux navigateur:*', () => {
  it('branche EXACTEMENT les canaux du contrat, chacun derrière le contrôle d’expéditeur', async () => {
    const attendus = Object.values(CANAUX_NAVIGATEUR)
      .filter((canal) => canal !== CANAUX_NAVIGATEUR.evenementEtat)
      .sort()
    expect([...simule.handlers.keys()].sort()).toEqual(attendus)

    for (const canal of attendus) {
      const handler = simule.handlers.get(canal)!
      await expect(
        Promise.resolve().then(() => handler(EVENEMENT_NON_FIABLE, 'conv-a', 'exemple.fr')),
        canal
      ).rejects.toThrow('Origine renderer non autorisée pour Navigateur intégré du chat')
    }
    expect(simule.gardes).toHaveLength(attendus.length)
    // Refusé au contrôle : aucun gestionnaire, donc aucune page, n'a été créé.
    expect(fabriques).toHaveLength(0)
  })

  it.each([
    ['navigateur:etat', [42]],
    ['navigateur:etat', ['   ']],
    ['navigateur:afficher-fil', [12]],
    ['navigateur:afficher-fil', ['']],
    ['navigateur:ouvrir', ['conv-a', 7]],
    ['navigateur:ouvrir', [undefined, 'exemple.fr']],
    ['navigateur:naviguer', ['onglet-1', null]],
    ['navigateur:reculer', [{}]],
    ['navigateur:fermer-onglet', ['x'.repeat(201)]],
    ['navigateur:poser-cadre', [{ x: '1', y: 0, largeur: 1, hauteur: 1 }, 1]],
    ['navigateur:poser-cadre', [{ x: 0, y: 0, largeur: -1, hauteur: 1 }, 1]],
    ['navigateur:poser-cadre', [{ x: 0, y: 0, largeur: 1, hauteur: Infinity }, 1]],
    ['navigateur:poser-cadre', [[0, 0, 1, 1], 1]],
    ['navigateur:poser-cadre', [undefined, 1]],
    ['navigateur:poser-cadre', [{ x: 0, y: 0, largeur: 1, hauteur: 1 }, 0]],
    ['navigateur:poser-cadre', [{ x: 0, y: 0, largeur: 1, hauteur: 1 }, Number.NaN]],
    ['navigateur:basculer-mode', ['detruire']],
    ['navigateur:basculer-mode', [undefined]],
    ['navigateur:supprimer-annotation', [5]],
    ['navigateur:repondre-accord', ['https://exemple.fr', 'peut-etre']],
    ['navigateur:repondre-accord', ['', 'une-fois']],
    ['navigateur:reglages-ecrire', [null]],
    ['navigateur:reglages-ecrire', [[true]]],
    ['navigateur:reglages-ecrire', [{ garderCookies: 'oui' }]],
    ['navigateur:ouvrir-dans-navigateur-par-defaut', [42]],
    ['navigateur:piloter', ['conv-a', 'arreter']],
    ['navigateur:piloter', ['conv-a', undefined]],
    ['navigateur:piloter', ['', 'pause']]
  ] as Array<[string, unknown[]]>)('refuse %s %j avant le moteur', async (canal, args) => {
    await expect(appeler(canal, ...args)).rejects.toThrow(/^IPC navigateur\./)
    // Rien n'a atteint le moteur : le gestionnaire n'a même pas été créé.
    expect(fabriques).toHaveLength(0)
  })

  it('accepte les valeurs jumelles, à la même borne', async () => {
    await expect(appeler('navigateur:afficher-fil', null)).resolves.toBeUndefined()
    await expect(appeler('navigateur:poser-cadre', null, 1)).resolves.toBeUndefined()
    // Coordonnées négatives et dimensions nulles : un panneau replié ou décalé reste un cadre.
    await expect(
      appeler('navigateur:poser-cadre', { x: -10, y: 0, largeur: 0, hauteur: 0 }, 0.25)
    ).resolves.toBeUndefined()
    await expect(appeler('navigateur:basculer-mode', null)).resolves.toBeUndefined()
    await expect(appeler('navigateur:basculer-mode', 'annoter')).resolves.toBeUndefined()
    await expect(
      appeler('navigateur:repondre-accord', 'https://exemple.fr', 'refuser')
    ).resolves.toBeUndefined()
    await expect(appeler('navigateur:reglages-ecrire', {})).resolves.toEqual({
      garderCookies: true,
      ouvrirLiensDuChatIci: true
    })
    await expect(appeler('navigateur:etat', 'x'.repeat(200))).resolves.toMatchObject({
      onglets: []
    })
    // Pas-à-pas (conv-1286) : chacun des cinq ordres passe, et vaut pour CE fil seulement.
    for (const ordre of [
      'pas-suivant',
      'reprendre',
      'reprendre-la-main',
      'rendre-la-main',
      'pause'
    ]) {
      await expect(appeler('navigateur:piloter', 'conv-a', ordre), ordre).resolves.toBeUndefined()
    }
    await expect(appeler('navigateur:etat', 'conv-a')).resolves.toMatchObject({
      pilotage: 'pause'
    })
    await expect(appeler('navigateur:etat', 'conv-b')).resolves.toMatchObject({
      pilotage: 'libre'
    })
  })

  it('transmet chaque appel au gestionnaire UNIQUE de la fenêtre principale', async () => {
    const id = await appeler('navigateur:ouvrir', 'conv-a', 'exemple.fr')
    expect(id).toBe('onglet-1')
    expect(fabriques).toHaveLength(1)
    expect(fabriques[0].fenetre).toBe(fenetreCourante!.fenetre)
    const vue = derniereFabrique().vues[0]
    expect(vue.partition).toBe(PARTITION_PERSISTANTE)
    expect(vue.appels).toContain('charger https://exemple.fr/')

    await appeler('navigateur:naviguer', 'onglet-1', 'localhost:5173')
    await appeler('navigateur:reculer', 'onglet-1')
    await appeler('navigateur:avancer', 'onglet-1')
    await appeler('navigateur:recharger', 'onglet-1')
    await appeler('navigateur:arreter', 'onglet-1')
    expect(vue.appels).toEqual([
      'charger https://exemple.fr/',
      'charger http://localhost:5173/',
      'reculer',
      'avancer',
      'recharger',
      'arreter'
    ])

    await appeler('navigateur:afficher-fil', 'conv-a')
    await appeler('navigateur:poser-cadre', { x: 10, y: 20, largeur: 300, hauteur: 200 }, 1.5)
    expect(vue.appels.at(-1)).toBe('cadre 15,30,450,300')
    expect(vue.visible).toBe(true)

    const second = await appeler('navigateur:ouvrir', 'conv-a', 'https://exemple.org')
    await appeler('navigateur:activer-onglet', 'onglet-1')
    const etat = (await appeler('navigateur:etat', 'conv-a')) as EtatNavigateur
    expect(etat.onglets.map((o) => o.id)).toEqual(['onglet-1', second])
    expect(etat.ongletActif).toBe('onglet-1')
    await appeler('navigateur:fermer-onglet', second)
    expect(derniereFabrique().vues[1].fermee).toBe(true)

    await expect(appeler('navigateur:annotations', 'conv-a')).resolves.toEqual([])
    await expect(appeler('navigateur:vider-annotations', 'conv-a')).resolves.toBeUndefined()
    await expect(
      appeler('navigateur:supprimer-annotation', 'annotation-absente')
    ).resolves.toBeUndefined()

    await expect(appeler('navigateur:reglages-ecrire', { garderCookies: false })).resolves.toEqual({
      garderCookies: false,
      ouvrirLiensDuChatIci: true
    })
    await expect(appeler('navigateur:reglages-lire')).resolves.toEqual({
      garderCookies: false,
      ouvrirLiensDuChatIci: true
    })
    // Le réglage vaut pour les onglets ouverts ENSUITE : session en mémoire.
    await appeler('navigateur:ouvrir', 'conv-a', 'exemple.net')
    expect(derniereFabrique().vues[2].partition).toBe(PARTITION_EPHEMERE)

    await appeler('navigateur:effacer-donnees')
    expect(derniereFabrique().effacements).toBe(1)
    await appeler('navigateur:ouvrir-dans-navigateur-par-defaut', 'https://exemple.fr/doc')
    expect(derniereFabrique().externes).toEqual(['https://exemple.fr/doc'])

    // Les refus du MOTEUR remontent tels quels à l'interface.
    await expect(appeler('navigateur:ouvrir', 'conv-a', 'javascript:alert(1)')).rejects.toThrow(
      'Adresse refusée'
    )
    await expect(
      appeler('navigateur:ouvrir-dans-navigateur-par-defaut', 'file:///C:/Windows')
    ).rejects.toThrow('http ou https')

    // Un seul gestionnaire pour toute la vie de la fenêtre, le même que celui du lot 4.
    expect(fabriques).toHaveLength(1)
    expect(gestionnaireNavigateur()).toBe(gestionnaireNavigateur())
  })

  it('pousse l’état à la fenêtre principale à chaque changement (onglet, titre, chargement, annotations)', async () => {
    const envois = fenetreCourante!.envois
    await appeler('navigateur:ouvrir', 'conv-a', 'exemple.fr')
    const vue = derniereFabrique().vues[0]
    expect(envois.length).toBeGreaterThan(0)
    expect(envois.every((e) => e.canal === CANAUX_NAVIGATEUR.evenementEtat)).toBe(true)
    expect(envois.at(-1)!.etat).toMatchObject({
      conversationId: 'conv-a',
      ongletActif: 'onglet-1',
      onglets: [{ id: 'onglet-1', url: 'https://exemple.fr/' }]
    })

    vue.titrePage = 'Exemple'
    vue.enChargement = true
    vue.ecouteurs.surChangement()
    expect(envois.at(-1)!.etat.onglets[0]).toMatchObject({ titre: 'Exemple', chargement: true })

    const avant = envois.length
    await appeler('navigateur:vider-annotations', 'conv-a')
    expect(envois).toHaveLength(avant + 1)
    expect(envois.at(-1)!.etat.nombreAnnotations).toBe(0)

    await appeler('navigateur:fermer-onglet', 'onglet-1')
    expect(envois.at(-1)!.etat).toMatchObject({ onglets: [], ongletActif: null })
  })

  it('ferme les pages avec la fenêtre ; sans « garder les cookies », efface les données', async () => {
    await appeler('navigateur:reglages-ecrire', { garderCookies: false })
    await appeler('navigateur:ouvrir', 'conv-a', 'exemple.fr')
    await appeler('navigateur:ouvrir', 'conv-b', 'exemple.org')
    const fabrique = derniereFabrique()
    const envois = fenetreCourante!.envois
    const vue = fabrique.vues[0]

    fenetreCourante!.fermer()
    fenetreCourante = null
    await Promise.resolve()
    expect(fabrique.vues.every((v) => v.fermee)).toBe(true)
    expect(fabrique.effacements).toBe(1)
    // Plus de fenêtre : plus de gestionnaire, et l'interface reçoit un refus lisible.
    expect(gestionnaireNavigateur()).toBeNull()
    await expect(appeler('navigateur:etat', 'conv-a')).rejects.toThrow(
      'fenêtre principale est fermée'
    )
    // Une page qui bougerait encore ne pousse plus rien vers la fenêtre détruite.
    const avant = envois.length
    vue.ecouteurs.surChangement()
    expect(envois).toHaveLength(avant)

    // La fenêtre rouverte reçoit un gestionnaire NEUF, lié à elle, sans les onglets d'avant.
    fenetreCourante = fausseFenetre()
    const etat = (await appeler('navigateur:etat', 'conv-a')) as EtatNavigateur
    expect(etat.onglets).toEqual([])
    expect(fabriques).toHaveLength(2)
    expect(fabriques[1].fenetre).toBe(fenetreCourante.fenetre)
  })

  it('garde les données à la fermeture quand « garder les cookies » est actif', async () => {
    await appeler('navigateur:ouvrir', 'conv-a', 'exemple.fr')
    const fabrique = derniereFabrique()
    fenetreCourante!.fermer()
    fenetreCourante = null
    await Promise.resolve()
    expect(fabrique.vues[0].fermee).toBe(true)
    expect(fabrique.effacements).toBe(0)
  })
})

describe('pont window.api.navigateur (preload)', () => {
  async function chargerPont(): Promise<ApiNavigateur> {
    // Le preload refuse de s'exposer hors isolation de contexte : on se place dans le cas réel.
    const avant = (process as { contextIsolated?: boolean }).contextIsolated
    ;(process as { contextIsolated?: boolean }).contextIsolated = true
    try {
      await import('../../preload/index')
    } finally {
      ;(process as { contextIsolated?: boolean }).contextIsolated = avant
    }
    const api = simule.exposes.get('api') as { navigateur?: ApiNavigateur } | undefined
    if (!api?.navigateur) throw new Error('window.api.navigateur absent')
    return api.navigateur
  }

  it('envoie chaque méthode sur SON canal, arguments dans l’ordre du contrat', async () => {
    const pont = await chargerPont()
    simule.invocations.length = 0
    const rect = { x: 1, y: 2, largeur: 3, hauteur: 4 }
    await pont.etat('conv-a')
    await pont.afficherFil(null)
    await pont.ouvrir('conv-a', 'exemple.fr')
    await pont.naviguer('onglet-1', 'exemple.org')
    await pont.reculer('onglet-1')
    await pont.avancer('onglet-1')
    await pont.recharger('onglet-1')
    await pont.arreter('onglet-1')
    await pont.activerOnglet('onglet-1')
    await pont.fermerOnglet('onglet-1')
    await pont.poserCadre(rect, 1.25)
    await pont.basculerMode('annoter')
    await pont.annotations('conv-a')
    await pont.supprimerAnnotation('annotation-1')
    await pont.viderAnnotations('conv-a')
    await pont.repondreAccord('https://exemple.fr', 'une-fois')
    await pont.reglages.lire()
    await pont.reglages.ecrire({ garderCookies: false })
    await pont.effacerDonnees()
    await pont.ouvrirDansNavigateurParDefaut('https://exemple.fr')
    await pont.piloter('conv-a', 'pas-suivant')
    expect(simule.invocations).toEqual([
      [CANAUX_NAVIGATEUR.etat, 'conv-a'],
      [CANAUX_NAVIGATEUR.afficherFil, null],
      [CANAUX_NAVIGATEUR.ouvrir, 'conv-a', 'exemple.fr'],
      [CANAUX_NAVIGATEUR.naviguer, 'onglet-1', 'exemple.org'],
      [CANAUX_NAVIGATEUR.reculer, 'onglet-1'],
      [CANAUX_NAVIGATEUR.avancer, 'onglet-1'],
      [CANAUX_NAVIGATEUR.recharger, 'onglet-1'],
      [CANAUX_NAVIGATEUR.arreter, 'onglet-1'],
      [CANAUX_NAVIGATEUR.activerOnglet, 'onglet-1'],
      [CANAUX_NAVIGATEUR.fermerOnglet, 'onglet-1'],
      [CANAUX_NAVIGATEUR.poserCadre, rect, 1.25],
      [CANAUX_NAVIGATEUR.basculerMode, 'annoter'],
      [CANAUX_NAVIGATEUR.annotations, 'conv-a'],
      [CANAUX_NAVIGATEUR.supprimerAnnotation, 'annotation-1'],
      [CANAUX_NAVIGATEUR.viderAnnotations, 'conv-a'],
      [CANAUX_NAVIGATEUR.repondreAccord, 'https://exemple.fr', 'une-fois'],
      [CANAUX_NAVIGATEUR.reglagesLire],
      [CANAUX_NAVIGATEUR.reglagesEcrire, { garderCookies: false }],
      [CANAUX_NAVIGATEUR.effacerDonnees],
      [CANAUX_NAVIGATEUR.ouvrirDansNavigateurParDefaut, 'https://exemple.fr'],
      [CANAUX_NAVIGATEUR.piloter, 'conv-a', 'pas-suivant']
    ])
    // Chaque canal invoqué par le pont a son handler côté principal.
    for (const [canal] of simule.invocations)
      expect(simule.handlers.has(canal as string)).toBe(true)
  })

  it('surEtat écoute le canal d’événement, et sa fonction rendue retire l’écouteur', async () => {
    const pont = await chargerPont()
    const recus: EtatNavigateur[] = []
    const desabonner = pont.surEtat((etat) => recus.push(etat))
    const ecouteurs = simule.ecouteurs.get(CANAUX_NAVIGATEUR.evenementEtat)!
    expect(ecouteurs.size).toBe(1)

    const etat = {
      conversationId: 'conv-a',
      onglets: [],
      ongletActif: null
    } as unknown as EtatNavigateur
    for (const ecouteur of ecouteurs) ecouteur({}, etat)
    expect(recus).toEqual([etat])

    desabonner()
    expect(ecouteurs.size).toBe(0)
  })
})
