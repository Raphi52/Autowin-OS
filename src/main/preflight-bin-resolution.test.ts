import { describe, expect, it, vi } from 'vitest'
import { resolveBinOnPath } from './preflight-probes'

/**
 * Régression du faux « CLI introuvable » au démarrage : la présence était testée en LANÇANT
 * `<cli> --version` (timeout 3 s), donc sensible à la charge machine — au boot (Electron + Vite +
 * antivirus, plusieurs spawns en parallèle) le wizard annonçait « introuvable » à tort, et un clic sur
 * « Re-vérifier » repassait tout vert. Ici on prouve qu'une lecture de PATH suffit, sans exécuter.
 */
const NPM_DIR = 'C:\\Users\\moi\\AppData\\Roaming\\npm'
const EMPTY_DIR = 'C:\\dossier-vide'
const env = { PATH: [EMPTY_DIR, NPM_DIR].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' }

describe('resolveBinOnPath', () => {
  it('trouve un shim npm `.CMD` (cas réel de codex/claude/kimi sous Windows)', () => {
    const disk = new Set([`${NPM_DIR}\\codex.CMD`])
    expect(resolveBinOnPath('codex', env, (path) => disk.has(path))).toBe(`${NPM_DIR}\\codex.CMD`)
  })

  it('trouve un binaire SANS extension (shim extensionless, PATH unix-like)', () => {
    const disk = new Set([`${NPM_DIR}\\claude`])
    expect(resolveBinOnPath('claude', env, (path) => disk.has(path))).toBe(`${NPM_DIR}\\claude`)
  })

  it('absent partout → null (le repli par lancement garde alors sa raison d’être)', () => {
    expect(resolveBinOnPath('inexistant', env, () => false)).toBeNull()
  })

  it('PATH vide ou absent → null, jamais d’exception', () => {
    expect(resolveBinOnPath('codex', { PATH: '' }, () => true)).toBeNull()
    expect(resolveBinOnPath('codex', {}, () => true)).toBeNull()
  })

  it('respecte l’ordre du PATH (premier dossier gagnant)', () => {
    const disk = new Set([`${EMPTY_DIR}\\codex`, `${NPM_DIR}\\codex`])
    expect(resolveBinOnPath('codex', env, (path) => disk.has(path))).toBe(`${EMPTY_DIR}\\codex`)
  })
})

/**
 * Comportement de `hasBin` quand le lancement du CLI ne conclut PAS a la presence : c'est le coeur du
 * bug (« introuvable » au demarrage, vert au re-controle). On mocke `spawn` pour simuler un CLI qui
 * sort en code non nul, alors qu'il est bel et bien installe sur le PATH.
 */
describe('hasBin — un lancement rate ne vaut pas « absent »', () => {
  it('CLI present sur le PATH mais `--version` en code 1 → considere PRESENT', async () => {
    const { EventEmitter } = await import('node:events')
    vi.resetModules()
    const spawnMock = vi.fn(() => {
      // `EventEmitter` vient d'un import dynamique : c'est une VALEUR, pas un type → InstanceType.
      const emitter = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        kill: () => void
      }
      emitter.kill = () => undefined
      setTimeout(() => emitter.emit('close', 1), 0)
      return emitter
    })
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))
    // Le PATH REEL de cette machine contient les shims npm (codex/claude/kimi) : c'est precisement
    // la situation de l'utilisateur, ou le CLI existe mais le lancement n'a pas abouti.
    const onPath = resolveBinOnPath('codex') !== null
    const { appPreflightProbes } = await import('./preflight-probes')
    const result = await appPreflightProbes().hasBin('codex')
    expect(spawnMock).toHaveBeenCalled()
    expect(result).toBe(onPath) // installe sur le PATH => present malgre l exit 1
    vi.doUnmock('node:child_process')
    vi.resetModules()
  })
})
