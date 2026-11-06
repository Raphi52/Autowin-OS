/**
 * Canaux du terminal intégré (conv-1362, lot 3/3) : le VRAI gestionnaire, une fausse fabrique de
 * terminaux, une fausse fenêtre principale, Electron simulé.
 *
 * Ce qui est prouvé : les canaux branchés sont EXACTEMENT ceux du contrat, tous derrière le contrôle
 * d'expéditeur ; un argument mal formé est refusé avant le moteur ; chaque appel atteint le
 * gestionnaire ; la sortie et l'état partent vers la fenêtre du moment, et un terminal survit à sa
 * fermeture. Côté pont, le VRAI preload est chargé : `window.api.terminal` envoie chaque méthode sur
 * son canal, et les fonctions rendues par `surDonnees` et `surEtat` retirent l'écouteur.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const simule = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  gardes: [] as string[],
  exposes: new Map<string, unknown>(),
  invocations: [] as unknown[][],
  ecouteurs: new Map<string, Set<(...args: unknown[]) => void>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => simule.handlers.set(canal, fn)
  },
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
vi.mock('./ipc-senders', () => ({
  assertTrustedRendererSender: (event: { nonFiable?: boolean }, portee: string) => {
    simule.gardes.push(portee)
    if (event?.nonFiable) throw new Error(`Origine renderer non autorisée pour ${portee}`)
  }
}))

import { registerTerminalIpc } from './terminal'
import { gestionnaireTerminal, type FabriquePty, type PtyLocal } from '../bureau/terminal-integre'
import {
  CANAUX_TERMINAL,
  type ApiTerminal,
  type EtatTerminal,
  type ResultatOuvertureTerminal
} from '../../shared/terminal'

const dossier = mkdtempSync(join(tmpdir(), 'terminal-ipc-'))
const TAILLE = { colonnes: 80, lignes: 24 }

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true })
})

function fauxPty(): PtyLocal & { emettre(d: string): void; ecrit: string[]; arrets: number } {
  const surDonnees = new Set<(d: string) => void>()
  const pty = {
    pid: 7,
    ecrit: [] as string[],
    arrets: 0,
    onData(rappel: (d: string) => void) {
      surDonnees.add(rappel)
      return { dispose: () => surDonnees.delete(rappel) }
    },
    onExit: () => ({ dispose: () => undefined }),
    write(d: string) {
      pty.ecrit.push(d)
    },
    resize: () => undefined,
    kill() {
      pty.arrets += 1
    },
    emettre(d: string) {
      for (const rappel of surDonnees) rappel(d)
    }
  }
  return pty
}

function fausseFenetre(): { fenetre: BrowserWindow; envois: Array<[string, unknown]> } {
  const envois: Array<[string, unknown]> = []
  const fenetre = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (canal: string, valeur: unknown) => envois.push([canal, valeur])
    }
  } as unknown as BrowserWindow
  return { fenetre, envois }
}

let ptys: ReturnType<typeof fauxPty>[]
let fenetreCourante: BrowserWindow | null
let envois: Array<[string, unknown]>

const appeler = (canal: string, ...args: unknown[]): unknown =>
  simule.handlers.get(canal)?.({}, ...args)

function ouvrir(fil = 'conv-a'): string {
  const r = appeler('terminal:ouvrir', fil, TAILLE) as ResultatOuvertureTerminal
  if (!r.ok) throw new Error(r.raison)
  return r.terminal.id
}

beforeEach(() => {
  simule.handlers.clear()
  simule.gardes.length = 0
  ptys = []
  const principale = fausseFenetre()
  fenetreCourante = principale.fenetre
  envois = principale.envois
  const fabrique: FabriquePty = () => {
    const pty = fauxPty()
    ptys.push(pty)
    return pty
  }
  registerTerminalIpc({
    fenetrePrincipale: () => fenetreCourante,
    dossierDuFil: () => dossier,
    environnement: () => ({ PATH: 'x' }),
    chargerFabrique: () => fabrique
  })
})

describe('canaux', () => {
  const contrat = (): string[] =>
    Object.values(CANAUX_TERMINAL).filter((c) => !c.startsWith('terminal:evenement-'))

  it('branche exactement les canaux du contrat', () => {
    expect([...simule.handlers.keys()].sort()).toEqual(contrat().sort())
  })

  it('écrit chaque nom en toutes lettres : le contrôle de sécurité ne voit que les littéraux', () => {
    const source = readFileSync(join(__dirname, 'terminal.ts'), 'utf8')
    for (const canal of contrat()) expect(source).toContain(`ipcMain.handle('${canal}'`)
  })

  it('refuse tout expéditeur non fiable, sur chaque canal, avant le moteur', () => {
    const id = ouvrir()
    const ouverts = ptys.length
    for (const canal of contrat()) {
      const fn = simule.handlers.get(canal)!
      expect(() =>
        fn({ nonFiable: true }, canal === 'terminal:ouvrir' ? 'conv-a' : id, TAILLE)
      ).toThrow('Origine renderer non autorisée pour Terminal intégré du chat')
    }
    expect(ptys).toHaveLength(ouverts)
    expect(ptys[0].arrets).toBe(0)
  })
})

describe('arguments', () => {
  it('refuse un identifiant vide, blanc, trop long ou d’un autre type', () => {
    for (const valeur of ['', '   ', 'x'.repeat(201), 3, null, undefined]) {
      expect(() => appeler('terminal:etat', valeur)).toThrow('IPC terminal.etat')
      expect(() => appeler('terminal:fermer', valeur)).toThrow('IPC terminal.fermer')
      expect(() => appeler('terminal:tampon', valeur)).toThrow('IPC terminal.tampon')
    }
    expect(appeler('terminal:etat', 'x'.repeat(200))).toMatchObject({ terminaux: [] })
  })

  it('refuse une taille mal formée, et accepte ses bornes', () => {
    const fautives: unknown[] = [
      null,
      [],
      {},
      { colonnes: 80 },
      { colonnes: 0, lignes: 24 },
      { colonnes: 80, lignes: 0 },
      { colonnes: 80.5, lignes: 24 },
      { colonnes: '80', lignes: 24 },
      { colonnes: 2001, lignes: 24 },
      { colonnes: 80, lignes: 1001 }
    ]
    for (const taille of fautives) {
      expect(() => appeler('terminal:ouvrir', 'conv-a', taille)).toThrow(
        'IPC terminal.ouvrir.taille'
      )
    }
    expect(ptys).toHaveLength(0)
    expect(appeler('terminal:ouvrir', 'conv-a', { colonnes: 2000, lignes: 1000 })).toMatchObject({
      ok: true
    })
  })

  it('refuse une écriture qui n’est pas du texte, ou trop grande', () => {
    const id = ouvrir()
    expect(() => appeler('terminal:ecrire', id, 3)).toThrow('IPC terminal.ecrire.donnees')
    expect(() => appeler('terminal:ecrire', id, 'x'.repeat(1024 * 1024 + 1))).toThrow(
      'IPC terminal.ecrire.donnees'
    )
    appeler('terminal:ecrire', id, 'x'.repeat(1024 * 1024))
    expect(ptys[0].ecrit).toHaveLength(1)
  })

  it('n’accepte aucun dossier ni aucune commande de l’interface', () => {
    appeler('terminal:ouvrir', 'conv-a', { ...TAILLE, dossier: 'C:\\ailleurs', shell: 'cmd.exe' })
    const etat = appeler('terminal:etat', 'conv-a') as EtatTerminal
    expect(etat.terminaux[0].dossier).toBe(dossier)
  })
})

describe('vers le moteur', () => {
  it('ouvre, écrit, redimensionne, relit et ferme', () => {
    const id = ouvrir()
    appeler('terminal:ecrire', id, 'dir\r')
    appeler('terminal:redimensionner', id, { colonnes: 100, lignes: 30 })
    ptys[0].emettre('sortie')
    expect(ptys[0].ecrit).toEqual(['dir\r'])
    expect(appeler('terminal:etat', 'conv-a')).toMatchObject({
      terminaux: [{ id, colonnes: 100, lignes: 30 }]
    })
    expect(appeler('terminal:tampon', id)).toEqual({
      terminalId: id,
      donnees: 'sortie',
      sequence: 1
    })
    appeler('terminal:fermer', id)
    expect(ptys[0].arrets).toBe(1)
    expect(appeler('terminal:tampon', id)).toBeNull()
  })

  it('l’état d’un fil ne montre pas les terminaux d’un autre', () => {
    ouvrir('conv-a')
    expect(appeler('terminal:etat', 'conv-b')).toEqual({ conversationId: 'conv-b', terminaux: [] })
  })

  it('expose le gestionnaire à l’outil de l’agent et à la fermeture de l’app', () => {
    const id = ouvrir()
    ptys[0].emettre('texte')
    expect(gestionnaireTerminal()?.lire('conv-a', { lignes: 5 })?.texte).toBe('texte')
    gestionnaireTerminal()?.fermerTout()
    expect(appeler('terminal:tampon', id)).toBeNull()
    expect(ptys[0].arrets).toBe(1)
  })
})

describe('vers la fenêtre', () => {
  it('pousse la sortie et l’état sur leurs canaux', () => {
    const id = ouvrir()
    ptys[0].emettre('sortie')
    expect(envois).toEqual([
      [CANAUX_TERMINAL.evenementEtat, expect.objectContaining({ conversationId: 'conv-a' })],
      [
        CANAUX_TERMINAL.evenementDonnees,
        { terminalId: id, conversationId: 'conv-a', donnees: 'sortie', sequence: 1 }
      ]
    ])
  })

  it('un terminal survit à la fenêtre fermée, et la fenêtre rouverte reprend sans se réabonner', () => {
    const id = ouvrir()
    fenetreCourante = null
    ptys[0].emettre('pendant la fermeture')
    expect(ptys[0].arrets).toBe(0)
    const rouverte = fausseFenetre()
    fenetreCourante = rouverte.fenetre
    expect(appeler('terminal:tampon', id)).toMatchObject({ donnees: 'pendant la fermeture' })
    ptys[0].emettre(' suite')
    expect(rouverte.envois).toEqual([
      [
        CANAUX_TERMINAL.evenementDonnees,
        { terminalId: id, conversationId: 'conv-a', donnees: ' suite', sequence: 2 }
      ]
    ])
  })

  it('n’écrit jamais dans une fenêtre détruite', () => {
    ouvrir()
    const envoi = vi.fn()
    fenetreCourante = {
      isDestroyed: () => true,
      webContents: { isDestroyed: () => true, send: envoi }
    } as unknown as BrowserWindow
    ptys[0].emettre('perdu')
    expect(envoi).not.toHaveBeenCalled()
  })
})

describe('pont window.api.terminal (preload)', () => {
  async function chargerPont(): Promise<ApiTerminal> {
    // Le preload refuse de s'exposer hors isolation de contexte : on se place dans le cas réel.
    const avant = (process as { contextIsolated?: boolean }).contextIsolated
    ;(process as { contextIsolated?: boolean }).contextIsolated = true
    try {
      await import('../../preload/index')
    } finally {
      ;(process as { contextIsolated?: boolean }).contextIsolated = avant
    }
    const api = simule.exposes.get('api') as { terminal?: ApiTerminal } | undefined
    if (!api?.terminal) throw new Error('window.api.terminal absent')
    return api.terminal
  }

  it('envoie chaque méthode sur son canal, avec ses arguments', async () => {
    const pont = await chargerPont()
    simule.invocations.length = 0
    await pont.etat('conv-a')
    await pont.ouvrir('conv-a', TAILLE)
    await pont.ecrire('t1', 'dir\r')
    await pont.redimensionner('t1', TAILLE)
    await pont.fermer('t1')
    await pont.tampon('t1')
    expect(simule.invocations).toEqual([
      ['terminal:etat', 'conv-a'],
      ['terminal:ouvrir', 'conv-a', TAILLE],
      ['terminal:ecrire', 't1', 'dir\r'],
      ['terminal:redimensionner', 't1', TAILLE],
      ['terminal:fermer', 't1'],
      ['terminal:tampon', 't1']
    ])
  })

  it('relaie les événements et retire l’écouteur au désabonnement', async () => {
    const pont = await chargerPont()
    const donnees = vi.fn()
    const etat = vi.fn()
    const retirerDonnees = pont.surDonnees(donnees)
    const retirerEtat = pont.surEtat(etat)
    const morceau = { terminalId: 't1', conversationId: 'conv-a', donnees: 'x', sequence: 1 }
    for (const ecouteur of simule.ecouteurs.get(CANAUX_TERMINAL.evenementDonnees) ?? []) {
      ecouteur({}, morceau)
    }
    const nouvelEtat = { conversationId: 'conv-a', terminaux: [] }
    for (const ecouteur of simule.ecouteurs.get(CANAUX_TERMINAL.evenementEtat) ?? []) {
      ecouteur({}, nouvelEtat)
    }
    expect(donnees).toHaveBeenCalledWith(morceau)
    expect(etat).toHaveBeenCalledWith(nouvelEtat)
    retirerDonnees()
    retirerEtat()
    expect(simule.ecouteurs.get(CANAUX_TERMINAL.evenementDonnees)?.size).toBe(0)
    expect(simule.ecouteurs.get(CANAUX_TERMINAL.evenementEtat)?.size).toBe(0)
  })
})
