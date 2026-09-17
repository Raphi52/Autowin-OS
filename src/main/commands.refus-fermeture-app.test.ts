import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppCommandBus } from './commands'

/*
 * CABLAGE, pas fonction pure. `garde-fermeture-app.test.ts` prouve que la fonction sait refuser ;
 * il resterait VERT si quelqu'un retirait l'appel dans commands.ts — et l'app de l'utilisateur
 * serait de nouveau fermable. Ce test-ci passe par le bus REEL : il meurt si le cablage disparait.
 * Mesure conv-660 (2026-09-17, turnId 726f9797-7e65-44c7-97ee-c5a1b5d4478b) : « tu arretes pas de
 * fermer mon app c'es trop invasif ».
 */
const os = {
  conversations: {
    // La commande n'est autorisee QUE par un message `user` : on le fournit, sinon le refus
    // viendrait de la politique d'autorisation et ne prouverait rien sur la fermeture.
    get: () => ({
      messages: [{ role: 'user', content: 'tu peux lancer taskkill et Stop-Process' }]
    }),
    list: () => []
  },
  listBrains: () => [],
  executionWorkspace: process.cwd()
} as unknown as ConstructorParameters<typeof AppCommandBus>[0]

let appdata = ''
let appdataPrecedent: string | undefined
beforeEach(() => {
  appdata = mkdtempSync(join(tmpdir(), 'aw-fermeture-'))
  appdataPrecedent = process.env.APPDATA
  process.env.APPDATA = appdata
})
afterEach(() => {
  if (appdataPrecedent === undefined) delete process.env.APPDATA
  else process.env.APPDATA = appdataPrecedent
  rmSync(appdata, { recursive: true, force: true })
})

describe('run — fermeture de l app de l utilisateur', () => {
  for (const commande of [
    'taskkill /IM RigV3Desktop.exe /F',
    'Stop-Process -Name RigV3Desktop -Force',
    'taskkill /F /IM RigV3Desktop.exe'
  ]) {
    it(`refuse « ${commande} » AVANT de lancer quoi que ce soit`, async () => {
      const bus = new AppCommandBus(os, () => undefined)
      const res = await bus.exec('run', { commande }, 'conv-660')
      const texte = JSON.stringify(res)
      expect(texte).toContain('Fermeture de l')
      // Le refus doit NOMMER les deux voies non invasives, sinon il renvoie a la devinette.
      expect(texte).toContain('dotnet msbuild -t:Compile')
      expect(texte).toContain('hdesk-lancer.ps1')
    })
  }

  it('laisse passer une fermeture par PID — un pid est un process que l on suit', async () => {
    const bus = new AppCommandBus(os, () => undefined)
    const res = await bus.exec('run', { commande: 'taskkill /PID 424242' }, 'conv-660')
    expect(JSON.stringify(res)).not.toContain('Fermeture de l')
  })
})
