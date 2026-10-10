import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dossierModAutowin, envFiletElectronAgent, FILET_ELECTRON_AGENT } from './claude'

/**
 * Conv-149 (2026-10-10) : un banc Electron lancé par un agent a ouvert sur l'écran de l'utilisateur
 * la boîte « A JavaScript error occurred in the main process ». Le filet posé par NODE_OPTIONS doit
 * transformer cette boîte en stderr + code 1, et rester neutre partout ailleurs.
 */
const mod = dossierModAutowin([__dirname])!
const filet = envFiletElectronAgent(mod, {}).NODE_OPTIONS
const electron = join(
  __dirname,
  '..',
  '..',
  '..',
  'node_modules',
  'electron',
  'dist',
  'electron.exe'
)
const electronDispo = process.platform === 'win32' && existsSync(electron)

function lancer(bin: string, args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
  const propre = { ...process.env, ...env }
  if (!('ELECTRON_RUN_AS_NODE' in env)) delete propre.ELECTRON_RUN_AS_NODE
  return spawnSync(bin, args, { env: propre, encoding: 'utf8', timeout: 20_000, windowsHide: true })
}

describe('envFiletElectronAgent', () => {
  it('pose --require vers le vrai filet du mod, en barres obliques et entre guillemets', () => {
    expect(existsSync(join(mod, FILET_ELECTRON_AGENT))).toBe(true)
    expect(filet).toMatch(
      /^--require "[^"\\]+\/mods\/autowin\/runtime\/electron-sans-fenetre-erreur\.cjs"$/
    )
  })
  it('conserve un NODE_OPTIONS déjà posé et ne le double pas', () => {
    const r = envFiletElectronAgent(mod, {
      NODE_OPTIONS: '--max-old-space-size=4096'
    }).NODE_OPTIONS!
    expect(r.startsWith('--max-old-space-size=4096 --require "')).toBe(true)
    expect(envFiletElectronAgent(mod, { NODE_OPTIONS: r })).toEqual({})
  })
  it('sans mod ou sans fichier, ne pose rien (un --require manquant casserait tout node)', () => {
    expect(envFiletElectronAgent(undefined, {})).toEqual({})
    expect(envFiletElectronAgent('D:/nulle-part', {}, () => false)).toEqual({})
  })
})

describe('filet Electron — comportement réel', () => {
  it('node seul : aucun écouteur ajouté, un plantage reste un plantage', () => {
    const r = lancer(
      process.execPath,
      ['-e', "console.log(process.listenerCount('uncaughtException'))"],
      {
        NODE_OPTIONS: filet
      }
    )
    expect(r.status).toBe(0)
    expect(String(r.stdout).trim()).toBe('0')
  })

  it.runIf(electronDispo)(
    'Electron en ELECTRON_RUN_AS_NODE : aucun écouteur ajouté',
    () => {
      const r = lancer(
        electron,
        ['-e', "console.log(process.listenerCount('uncaughtException'))"],
        {
          NODE_OPTIONS: filet,
          ELECTRON_RUN_AS_NODE: '1'
        }
      )
      expect(r.status).toBe(0)
      expect(String(r.stdout).trim()).toBe('0')
    },
    30_000
  )

  it.runIf(electronDispo)(
    'processus principal Electron : script cassé -> stderr + code 1, sans boîte d’erreur',
    () => {
      const dossier = mkdtempSync(join(tmpdir(), 'filet-electron-'))
      try {
        // 1. Sans risque : Electron n'ouvre sa boîte que s'il est SEUL à écouter (lib/browser/init.ts).
        writeFileSync(
          join(dossier, 'bon.js'),
          "console.log('ecouteurs=' + process.listenerCount('uncaughtException')); require('electron').app.whenReady().then(() => require('electron').app.quit())"
        )
        const bon = lancer(electron, [join(dossier, 'bon.js')], { NODE_OPTIONS: filet })
        expect(bon.status).toBe(0)
        expect(String(bon.stdout)).toContain('ecouteurs=2')
        // 2. Seulement si 1 a tenu (sinon la boîte s'ouvrirait chez l'utilisateur) : la faute vécue.
        writeFileSync(join(dossier, 'casse.js'), "const c = {\n  masque: 'a'\n  fichier: 'b'\n}\n")
        const debut = Date.now()
        const casse = lancer(electron, [join(dossier, 'casse.js')], { NODE_OPTIONS: filet })
        expect(casse.status).toBe(1)
        expect(String(casse.stderr)).toContain("SyntaxError: Unexpected identifier 'fichier'")
        expect(String(casse.stderr)).toContain("fenetre d'erreur remplacee par cette sortie")
        expect(Date.now() - debut).toBeLessThan(15_000)
      } finally {
        rmSync(dossier, { recursive: true, force: true })
      }
    },
    60_000
  )
})
