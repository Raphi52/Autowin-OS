/**
 * La vraie fenêtre de la mascotte, Electron simulé (conv-1227, 2026-10-28).
 *
 * Ce qui est prouvé ici : la RECRÉATION de la fenêtre au déverrouillage de la session. Une
 * fenêtre transparente née pendant une coupure du Bureau à distance ne dessinait plus rien après
 * la reconnexion (Autowin relancé à 22:04:27 pendant la coupure 22:03:53 → 23:01:54 : fenêtre
 * affichée, page « visible », mais « capture sans image en 4 s ») ; une fenêtre recréée se
 * dessine. La reconnexion déverrouille la session (journal Windows : 4778 puis 4801), ce
 * qu'Electron signale par `unlock-screen`.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Ecouteur = (...args: unknown[]) => void

const etat = vi.hoisted(() => ({
  fenetres: [] as Array<{
    detruite: boolean
    fichier?: string
  }>,
  alimentation: new Map<string, Array<(...args: unknown[]) => void>>()
}))

vi.mock('electron', () => {
  class FausseFenetre {
    detruite = false
    visible = false
    fichier?: string
    private ecouteurs = new Map<string, Ecouteur[]>()
    webContents = {
      on: () => {},
      setWindowOpenHandler: () => {},
      isDestroyed: () => this.detruite
    }
    constructor() {
      etat.fenetres.push(this)
    }
    on(evenement: string, ecouteur: Ecouteur): void {
      this.ecouteurs.set(evenement, [...(this.ecouteurs.get(evenement) ?? []), ecouteur])
    }
    once(evenement: string, ecouteur: Ecouteur): void {
      this.on(evenement, ecouteur)
    }
    emettre(evenement: string): void {
      for (const ecouteur of this.ecouteurs.get(evenement) ?? []) ecouteur()
    }
    isDestroyed(): boolean {
      return this.detruite
    }
    isVisible(): boolean {
      return this.visible
    }
    showInactive(): void {
      this.visible = true
    }
    hide(): void {
      this.visible = false
    }
    bornes: unknown = null
    setBounds(bornes: unknown): void {
      this.bornes = bornes
    }
    getPosition(): [number, number] {
      return [0, 0]
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 0, y: 0, width: 128, height: 124 }
    }
    traversante = false
    setIgnoreMouseEvents(oui: boolean): void {
      this.traversante = oui
    }
    /** Comme Electron : `closed` part APRÈS que `close` a rendu la main. */
    close(): void {
      if (this.detruite) return
      this.detruite = true
      queueMicrotask(() => this.emettre('closed'))
    }
    loadFile(fichier: string): Promise<void> {
      this.fichier = fichier
      return Promise.resolve()
    }
  }
  const ecran = { workArea: { x: 0, y: 0, width: 1920, height: 1032 } }
  return {
    BrowserWindow: FausseFenetre,
    app: { whenReady: () => Promise.resolve(), on: () => {} },
    ipcMain: { on: () => {} },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    powerMonitor: {
      on: (evenement: string, ecouteur: (...args: unknown[]) => void) => {
        etat.alimentation.set(evenement, [...(etat.alimentation.get(evenement) ?? []), ecouteur])
      }
    },
    screen: {
      getAllDisplays: () => [ecran],
      getPrimaryDisplay: () => ecran,
      getDisplayMatching: () => ecran,
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      on: () => {}
    }
  }
})

// Ni lecture ni écriture du vrai réglage du poste.
vi.mock('./mascotte-reglage', () => ({
  lirePositionMascotte: () => null,
  ecrirePositionMascotte: () => {},
  ecrireMascotteAffichee: () => {}
}))

import { creerMascotteDuBureau, type DependancesMascotte } from './mascotte-fenetre'

const DEPS: DependancesMascotte = {
  toursEnCours: () => 0,
  autowinRegardee: () => false,
  ouvrirFil: () => {},
  ouvrirAutowin: () => {},
  titreDuFil: () => null
}

/** Laisse passer `app.whenReady` et les `closed` différés, comme dans le vrai processus. */
const laisserPasser = (): Promise<void> => new Promise((fin) => setTimeout(fin, 0))

const deverrouiller = (): void => {
  for (const ecouteur of etat.alimentation.get('unlock-screen') ?? []) ecouteur()
}

beforeEach(() => {
  etat.fenetres.length = 0
  etat.alimentation.clear()
})

describe('la vraie fenêtre de la mascotte — reconnexion du Bureau à distance', () => {
  // Entrée qui ferait échouer ce test sans la correction : un `unlock-screen` après la création.
  // Avant, rien ne l'écoutait : la fenêtre née pendant la coupure restait la seule, muette.
  it('le déverrouillage de la session ferme la fenêtre et en recrée une neuve, chargée', async () => {
    const mascotte = creerMascotteDuBureau()
    mascotte.demarrer(DEPS, true)
    await laisserPasser()
    expect(etat.fenetres).toHaveLength(1)
    const ancienne = etat.fenetres[0]

    deverrouiller()
    await laisserPasser()

    expect(ancienne.detruite).toBe(true)
    expect(etat.fenetres).toHaveLength(2)
    const neuve = etat.fenetres[1]
    expect(neuve.detruite).toBe(false)
    expect(neuve.fichier).toMatch(/autowin-mascotte-\d+\.html$/)
    // C'est la neuve que l'app reconnaît comme la mascotte, plus l'ancienne.
    expect(mascotte.estLaMascotte(neuve as never)).toBe(true)
    expect(mascotte.estLaMascotte(ancienne as never)).toBe(false)
  })

  it('chaque reconnexion recrée la fenêtre, une seule reste vivante', async () => {
    const mascotte = creerMascotteDuBureau()
    mascotte.demarrer(DEPS, true)
    await laisserPasser()
    deverrouiller()
    await laisserPasser()
    deverrouiller()
    await laisserPasser()

    expect(etat.fenetres).toHaveLength(3)
    expect(etat.fenetres.filter((f) => !f.detruite)).toHaveLength(1)
  })

  it('masquée dans les réglages, le déverrouillage ne fait renaître aucune fenêtre', async () => {
    const mascotte = creerMascotteDuBureau()
    mascotte.demarrer(DEPS, false)
    await laisserPasser()
    deverrouiller()
    await laisserPasser()

    expect(etat.fenetres).toHaveLength(0)
  })
})

describe('la vraie fenêtre de la mascotte — style magicien ou basique (conv-1249)', () => {
  const page = (fenetre: { fichier?: string }): string => readFileSync(fenetre.fichier!, 'utf8')

  it('démarre dans le style gardé, et changer de style recrée la fenêtre dans le nouveau', async () => {
    const mascotte = creerMascotteDuBureau()
    mascotte.demarrer(DEPS, true, 'basique')
    await laisserPasser()
    expect(etat.fenetres).toHaveLength(1)
    expect(page(etat.fenetres[0])).toContain('<i class="n"></i>')

    mascotte.changerStyle('magicien')
    await laisserPasser()
    expect(etat.fenetres).toHaveLength(2)
    expect(etat.fenetres[0].detruite).toBe(true)
    const neuve = etat.fenetres[1]
    expect(neuve.detruite).toBe(false)
    expect(page(neuve)).toContain('class="cps"')
    expect(mascotte.estLaMascotte(neuve as never)).toBe(true)

    // Le même style ne recrée rien.
    mascotte.changerStyle('magicien')
    await laisserPasser()
    expect(etat.fenetres).toHaveLength(2)
  })

  it('masquée, changer de style ne fait naître aucune fenêtre', async () => {
    const mascotte = creerMascotteDuBureau()
    mascotte.demarrer(DEPS, false)
    await laisserPasser()
    mascotte.changerStyle('basique')
    await laisserPasser()
    expect(etat.fenetres).toHaveLength(0)
  })
})
