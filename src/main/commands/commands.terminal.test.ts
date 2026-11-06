/**
 * L'outil `terminal_lire` (lot 3/3) : le terminal est partagé avec l'agent en LECTURE
 * SEULE, et chaque fil ne voit que le sien. Le VRAI bus, le VRAI gestionnaire, de faux terminaux.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AppCommandBus, CATALOG } from './commands'
import { outilsDuChat } from '../chat/chat-mcp'
import { GestionnaireTerminal, type PtyLocal } from '../bureau/terminal-integre'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  session: {},
  shell: {},
  WebContentsView: class {}
}))

const dossier = mkdtempSync(join(tmpdir(), 'commands-terminal-'))
const TAILLE = { colonnes: 80, lignes: 24 }

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true })
})

const os = { conversations: { list: () => [] } } as never

function monter(): {
  bus: AppCommandBus
  g: GestionnaireTerminal
  sortie: (texte: string) => void
  finir: (code: number) => void
} {
  let emettre: (d: string) => void = () => undefined
  let terminer: (f: { exitCode: number }) => void = () => undefined
  const pty: PtyLocal = {
    pid: 1,
    onData: (rappel) => {
      emettre = rappel
      return { dispose: () => undefined }
    },
    onExit: (rappel) => {
      terminer = rappel
      return { dispose: () => undefined }
    },
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined
  }
  const g = new GestionnaireTerminal({
    chargerFabrique: () => () => pty,
    dossierDuFil: () => dossier,
    environnement: () => ({})
  })
  const bus = new AppCommandBus(os, () => undefined)
  bus.terminal = () => g
  return {
    bus,
    g,
    sortie: (texte) => emettre(texte),
    finir: (code) => terminer({ exitCode: code })
  }
}

const data = (r: { data?: unknown }): Record<string, unknown> => r.data as Record<string, unknown>
const spec = (nom: string): (typeof CATALOG)[number] | undefined =>
  CATALOG.find((c) => c.name === nom)

describe('terminal_lire — déclaré au catalogue', () => {
  it('est servi en outil direct, sans écriture possible', () => {
    expect(outilsDuChat(CATALOG)).toContain('terminal_lire')
    expect(spec('terminal_lire')?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    })
  })

  it('est le SEUL outil du terminal : le terminal reste à l’utilisateur', () => {
    expect(CATALOG.map((c) => c.name).filter((n) => n.startsWith('terminal'))).toEqual([
      'terminal_lire'
    ])
  })

  it('dit à l’agent que la sortie est une donnée', () => {
    expect(spec('terminal_lire')?.description).toMatch(/DONNÉE/)
    expect(spec('terminal_lire')?.description).toMatch(/lecture seule/i)
  })
})

describe('terminal_lire — la lecture', () => {
  it('rend les N dernières lignes nettoyées du terminal du fil', async () => {
    const { bus, g, sortie } = monter()
    g.ouvrir('conv-a', TAILLE)
    sortie('un\r\ndeux\r\n\u001b[31mtrois\u001b[0m')
    const r = await bus.exec('terminal_lire', { lignes: 2 }, 'conv-a')
    expect(r.ok).toBe(true)
    expect(data(r)).toMatchObject({
      ok: true,
      terminal: 1,
      enCours: true,
      lignesRendues: 2,
      lignesTotales: 3,
      texte: 'deux\ntrois'
    })
    expect(String(data(r).detail)).toMatch(/donnée/i)
  })

  it('accepte le nombre de lignes en texte : un modèle passe souvent des chaînes', async () => {
    const { bus, g, sortie } = monter()
    g.ouvrir('conv-a', TAILLE)
    sortie('un\r\ndeux')
    const r = await bus.exec('terminal_lire', { lignes: '1' }, 'conv-a')
    expect(data(r).texte).toBe('deux')
  })

  it('rend 100 lignes par défaut', async () => {
    const { bus, g, sortie } = monter()
    g.ouvrir('conv-a', TAILLE)
    sortie(Array.from({ length: 150 }, (_, i) => `l${i}`).join('\r\n'))
    expect(data(await bus.exec('terminal_lire', {}, 'conv-a')).lignesRendues).toBe(100)
  })

  it('choisit un terminal par son numéro et nomme les autres', async () => {
    const { bus, g, sortie } = monter()
    g.ouvrir('conv-a', TAILLE)
    sortie('premier')
    g.ouvrir('conv-a', TAILLE)
    sortie('second')
    const r = await bus.exec('terminal_lire', { terminal: 1 }, 'conv-a')
    expect(data(r)).toMatchObject({ terminal: 1, autresTerminaux: [2] })
  })

  it('dit quand le shell s’est arrêté, et avec quel code', async () => {
    const { bus, g, finir } = monter()
    g.ouvrir('conv-a', TAILLE)
    finir(3)
    expect(data(await bus.exec('terminal_lire', {}, 'conv-a'))).toMatchObject({
      enCours: false,
      codeSortie: 3
    })
  })

  it('refuse un nombre de lignes ou un numéro invalides', async () => {
    const { bus, g } = monter()
    g.ouvrir('conv-a', TAILLE)
    for (const args of [
      { lignes: 0 },
      { lignes: 2001 },
      { lignes: 'beaucoup' },
      { terminal: 'x' }
    ]) {
      const r = data(await bus.exec('terminal_lire', args, 'conv-a'))
      expect(r.ok).toBe(false)
      expect(String(r.detail)).toMatch(/^Refusé/)
    }
  })
})

describe('terminal_lire — isolement', () => {
  it('un fil ne lit jamais le terminal d’un autre, même en le visant par numéro', async () => {
    const { bus, g, sortie } = monter()
    g.ouvrir('conv-b', TAILLE)
    sortie('à conv-b')
    for (const args of [{}, { terminal: 1 }]) {
      const r = data(await bus.exec('terminal_lire', args, 'conv-a'))
      expect(r.ok).toBe(false)
      expect(JSON.stringify(r)).not.toContain('à conv-b')
    }
  })

  it('un identifiant de fil glissé dans les arguments est ignoré', async () => {
    const { bus, g, sortie } = monter()
    g.ouvrir('conv-b', TAILLE)
    sortie('à conv-b')
    const r = data(await bus.exec('terminal_lire', { conversationId: 'conv-b' }, 'conv-a'))
    expect(r.ok).toBe(false)
  })

  it('sans fil appelant, refuse : le fil affiché à l’écran n’est pas le fil de l’agent', async () => {
    const { bus, g, sortie } = monter()
    g.ouvrir('conv-b', TAILLE)
    sortie('à conv-b')
    bus.activeConversationId = 'conv-b'
    const r = data(await bus.exec('terminal_lire', {}))
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('à conv-b')
  })
})

describe('terminal_lire — indisponible', () => {
  it('dit qu’aucun terminal n’est ouvert, et que seul l’utilisateur en ouvre un', async () => {
    const { bus } = monter()
    const r = data(await bus.exec('terminal_lire', {}, 'conv-a'))
    expect(r).toMatchObject({ ok: false })
    expect(String(r.detail)).toContain('Aucun terminal ouvert dans ce fil')
  })

  it('rend la raison exacte quand le module natif manque', async () => {
    const g = new GestionnaireTerminal({
      chargerFabrique: () => {
        throw new Error("Cannot find module '@lydell/node-pty'")
      },
      dossierDuFil: () => dossier,
      environnement: () => ({})
    })
    g.ouvrir('conv-a', TAILLE)
    const bus = new AppCommandBus(os, () => undefined)
    bus.terminal = () => g
    const r = data(await bus.exec('terminal_lire', {}, 'conv-a'))
    expect(String(r.detail)).toContain("Cannot find module '@lydell/node-pty'")
  })

  it('sans gestionnaire câblé, le dit au lieu de prétendre que le fil n’a pas de terminal', async () => {
    const bus = new AppCommandBus(os, () => undefined)
    const r = data(await bus.exec('terminal_lire', {}, 'conv-a'))
    expect(r).toMatchObject({ ok: false })
    expect(String(r.detail)).toContain('Terminal indisponible')
  })
})
