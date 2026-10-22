/**
 * La vraie fenêtre de la carte de fin de tour, Electron simulé (conv-1066, 2026-10-22).
 *
 * Ce qui est prouvé ici, et que `notification-popup.test.ts` ne peut pas voir : le branchement de
 * `loadFile`. Son rejet arrive APRÈS que `fabriquer` a rendu la carte au notifieur ; avant ce test,
 * il partait dans un `void` : rejet non rattrapé, fenêtre cachée laissée ouverte, NI carte NI bulle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContenuNotification, NotificationAffichable } from './notification-fin-de-tour'

type Ecouteur = (...args: unknown[]) => void

const etat = vi.hoisted(() => ({
  fenetres: [] as Array<{
    detruite: boolean
    affichee: boolean
    fichier?: string
    emettre: (evenement: string) => void
  }>,
  chargement: (): Promise<void> => Promise.resolve(),
  ecritureImpossible: false
}))

vi.mock('electron', () => {
  class FausseFenetre {
    detruite = false
    affichee = false
    fichier?: string
    private ecouteurs = new Map<string, Ecouteur[]>()
    webContents = { on: () => {}, setWindowOpenHandler: () => {} }
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
    showInactive(): void {
      this.affichee = true
    }
    /** Dernière place donnée par la pile (la carte se replace quand une autre part). */
    bornes?: unknown
    setBounds(bornes: unknown): void {
      this.bornes = bornes
    }
    close(): void {
      if (this.detruite) return
      this.detruite = true
      this.emettre('closed')
    }
    loadFile(fichier: string): Promise<void> {
      this.fichier = fichier
      return etat.chargement()
    }
  }
  return {
    BrowserWindow: FausseFenetre,
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1032 } })
    }
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const reel = await importOriginal<typeof import('node:fs')>()
  return {
    ...reel,
    writeFileSync: (...args: Parameters<typeof reel.writeFileSync>) => {
      if (etat.ecritureImpossible) throw new Error('ENOSPC: no space left on device')
      return reel.writeFileSync(...args)
    }
  }
})

import { existsSync, readFileSync } from 'node:fs'
import { creerPopupsDeFinDeTour, definirPaletteDeCarte } from './notification-popup-fenetre'
import { PALETTE_HOLOGRAPHIQUE } from './notification-popup'

const PRETE: ContenuNotification = {
  title: 'Corriger le test ChatComposer — réponse prête',
  body: 'Test ChatComposer.test.tsx repassé au vert (exit 0)',
  suites: ['Lance la suite complète du chat'],
  fil: 'Corriger le test ChatComposer',
  issue: 'prete'
}

/** Fausse bulle Windows : on ne regarde que si elle s'affiche. */
function secoursDeTest(bulles: Array<{ contenu: ContenuNotification; montree: boolean }>) {
  return (contenu: ContenuNotification): NotificationAffichable => {
    const b = { contenu, montree: false }
    bulles.push(b)
    return {
      show: () => {
        b.montree = true
      },
      close: () => {},
      on: (() => {}) as NotificationAffichable['on']
    }
  }
}

/** Laisse le rejet (ou la résolution) de `loadFile` arriver, comme dans le vrai processus. */
const laisserCharger = (): Promise<void> => new Promise((fin) => setTimeout(fin, 0))

beforeEach(() => {
  etat.fenetres.length = 0
  etat.chargement = () => Promise.resolve()
  etat.ecritureImpossible = false
})

describe('la vraie fenêtre de la carte — une page qui ne se charge pas', () => {
  // Entrée qui ferait échouer ce test si la correction était fausse : un `loadFile` REJETÉ
  // (did-fail-load, ex. ERR_FILE_NOT_FOUND), après `show()`.
  it('loadFile rejeté : la fenêtre se ferme, son fichier part, la bulle Windows s’affiche', async () => {
    etat.chargement = () => Promise.reject(new Error("ERR_FILE_NOT_FOUND (-6) loading 'file://'"))
    const bulles: Array<{ contenu: ContenuNotification; montree: boolean }> = []
    const popups = creerPopupsDeFinDeTour({ secours: secoursDeTest(bulles) })
    popups.fabriquer(PRETE).show()
    await laisserCharger()
    expect(etat.fenetres).toHaveLength(1)
    expect(etat.fenetres[0].detruite).toBe(true)
    expect(existsSync(etat.fenetres[0].fichier ?? '')).toBe(false)
    expect(bulles).toEqual([{ contenu: PRETE, montree: true }])
  })

  // Jumeau accepté : une page chargée garde sa carte, et aucune bulle ne double l'affichage.
  it('loadFile résolu : la carte reste et s’affiche, aucune bulle', async () => {
    const bulles: Array<{ contenu: ContenuNotification; montree: boolean }> = []
    const popups = creerPopupsDeFinDeTour({ secours: secoursDeTest(bulles) })
    const n = popups.fabriquer(PRETE)
    n.show()
    await laisserCharger()
    etat.fenetres[0].emettre('ready-to-show')
    expect(etat.fenetres[0].detruite).toBe(false)
    expect(etat.fenetres[0].affichee).toBe(true)
    expect(bulles).toHaveLength(0)
    n.close()
    expect(existsSync(etat.fenetres[0].fichier ?? '')).toBe(false)
  })

  // Le fichier de page s'écrit AVANT la fenêtre : écrit après, son échec laissait une fenêtre
  // cachée créée pour rien, jamais fermée (`fabriquer` jette, `index.ts` montre la bulle).
  it('un fichier de page impossible à écrire ne laisse aucune fenêtre cachée derrière', () => {
    etat.ecritureImpossible = true
    const popups = creerPopupsDeFinDeTour({ secours: secoursDeTest([]) })
    expect(() => popups.fabriquer(PRETE)).toThrow('ENOSPC')
    expect(etat.fenetres).toHaveLength(0)
  })
})

describe('la vraie fenêtre de la carte — le thème choisi (conv-1090)', () => {
  const NINJA = {
    fond: '#262624',
    texte: '#faf9f5',
    texteDoux: '#c2c0b6',
    accent: '#d97757',
    accent2: '#a8a59b',
    accent3: '#d97757',
    surAccent: '#ffffff',
    erreur: '#dd5e55'
  }

  // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : une page écrite sans la palette reçue de la page de l'app.
  it('la palette reçue peint les cartes suivantes ; une palette abîmée ne change rien', () => {
    const popups = creerPopupsDeFinDeTour({ secours: secoursDeTest([]) })
    try {
      expect(definirPaletteDeCarte(NINJA)).toBe(true)
      const n = popups.fabriquer(PRETE)
      const page = readFileSync(etat.fenetres[0].fichier ?? '', 'utf8')
      expect(page).toContain('#d97757')
      expect(page).not.toContain('#e63ca0')
      n.close()
      expect(definirPaletteDeCarte({ ...NINJA, accent: 'red' })).toBe(false)
      const m = popups.fabriquer(PRETE)
      expect(readFileSync(etat.fenetres[1].fichier ?? '', 'utf8')).toContain('#d97757')
      m.close()
    } finally {
      definirPaletteDeCarte(PALETTE_HOLOGRAPHIQUE)
    }
  })
})
