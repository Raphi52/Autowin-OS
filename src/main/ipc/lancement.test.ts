/**
 * Canaux du bouton « Lancer » : branchement réel (vrais processus), Electron simulé.
 *
 * Ce qui est prouvé : chaque canal passe par le garde d'origine ; le dossier vient de la
 * CONVERSATION côté principal (le renderer ne donne qu'un identifiant) ; la commande vient de la
 * déclaration de CE dossier ; les mises à jour partent sur `lancement:maj` avec l'identifiant.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const envois: Array<{
  canal: string
  charge: { conversationId: string; etat: { statut: string } }
}> = []
const gardes: string[] = []
vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => handlers.set(canal, fn)
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (canal: string, charge: never) => envois.push({ canal, charge })
        }
      }
    ]
  }
}))
vi.mock('../ipc-senders', () => ({
  assertTrustedRendererSender: (_event: unknown, scope: string) => gardes.push(scope)
}))

import { registerLancementIpc } from './lancement'

let racine = ''
let dossierConv = ''
let espaceGlobal = ''
let arreterTout: () => Promise<void> = async () => {}

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), 'lancement-ipc-'))
  dossierConv = join(racine, 'conv')
  espaceGlobal = join(racine, 'global')
  mkdirSync(join(dossierConv, '.autowin'), { recursive: true })
  mkdirSync(espaceGlobal)
  writeFileSync(
    join(dossierConv, '.autowin', 'scripts.json'),
    JSON.stringify({
      lancement: `node -e "require('fs').writeFileSync('lance.txt', process.cwd()); console.log('pret')"`
    })
  )
  ;({ arreterTout } = registerLancementIpc({
    os: {
      executionWorkspace: espaceGlobal,
      conversations: {
        get: (id: string) => (id === 'conv-a' ? { projectPath: dossierConv } : undefined)
      }
    } as never
  }))
})
afterAll(async () => {
  await arreterTout()
  rmSync(racine, { recursive: true, force: true })
})

async function attendre(condition: () => boolean): Promise<void> {
  const fin = Date.now() + 8_000
  while (!condition()) {
    if (Date.now() > fin) throw new Error('condition non atteinte à temps')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('canaux lancement:*', () => {
  it('état : commande lue dans le dossier de LA conversation, garde appliqué', async () => {
    const etat = (await handlers.get('lancement:etat')?.({}, 'conv-a')) as { commande?: string }
    expect(etat.commande).toContain('lance.txt')
    expect(gardes).toContain('LancementEtat')
    // Une autre conversation retombe sur l'espace global, qui ne déclare rien.
    const autre = (await handlers.get('lancement:etat')?.({}, 'conv-b')) as { commande?: string }
    expect(autre.commande).toBeUndefined()
  })

  it('démarrer : tourne DANS le dossier de la conversation et pousse lancement:maj', async () => {
    await handlers.get('lancement:demarrer')?.({}, 'conv-a')
    expect(gardes).toContain('LancementDemarrer')
    await attendre(() =>
      envois.some((e) => e.charge.conversationId === 'conv-a' && e.charge.etat.statut === 'termine')
    )
    expect(envois.every((e) => e.canal === 'lancement:maj')).toBe(true)
    expect(existsSync(join(dossierConv, 'lance.txt'))).toBe(true)
    expect(readFileSync(join(dossierConv, 'lance.txt'), 'utf8').toLowerCase()).toBe(
      dossierConv.toLowerCase()
    )
    expect(existsSync(join(espaceGlobal, 'lance.txt'))).toBe(false)
  })

  it('refuse un identifiant absent ou vide', async () => {
    expect(() => handlers.get('lancement:demarrer')?.({}, 42)).toThrow(/string attendue/)
    expect(() => handlers.get('lancement:arreter')?.({}, '  ')).toThrow(/identifiant vide/)
  })
})
