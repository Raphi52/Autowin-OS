import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildBrainLaunchCommand,
  ensureBrainServerStarted,
  resetBrainLaunchAttempt,
  resolveBrainRuntime
} from './brain-server-launch'

let tooling: string

beforeEach(() => {
  resetBrainLaunchAttempt()
  tooling = mkdtempSync(join(tmpdir(), 'brain-tooling-'))
})
afterEach(() => {
  rmSync(tooling, { recursive: true, force: true })
})

const makeValidTooling = (): void => {
  mkdirSync(join(tooling, '.venv', 'Scripts'), { recursive: true })
  writeFileSync(join(tooling, '.venv', 'Scripts', 'python.exe'), '')
  writeFileSync(join(tooling, 'brain_server.py'), '')
}

describe('ensureBrainServerStarted', () => {
  it('no-op si le serveur répond déjà (aucun spawn)', async () => {
    const spawnFn = vi.fn()
    const r = await ensureBrainServerStarted(async () => true, {}, spawnFn as never)
    expect(r.status).toBe('already-up')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('unavailable si le venv/script est absent (aucun spawn)', async () => {
    const spawnFn = vi.fn()
    const r = await ensureBrainServerStarted(
      async () => false,
      { AUTOWIN_BRAIN_TOOLING: join(tooling, 'nexiste-pas') },
      spawnFn as never
    )
    expect(r.status).toBe('unavailable')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  // Ce test figeait `argv=['/c','start','','/b',python,'brain_server.py']` : deux bugs gelés.
  // (1) le script relatif était résolu contre le cwd RÉEL (C:\Windows dès que le tooling est UNC,
  // cmd.exe refusant un cwd UNC) → python sortait en erreur, avalé par stdio:'ignore'.
  // (2) pas de `/d` → les AutoRun du registre s'exécutaient dans notre cmd.
  // Réécrit sur le contrat corrigé (script ABSOLU + /d), pas assoupli.
  it('spawn détaché, PYTHONPATH retiré, script en chemin ABSOLU', async () => {
    makeValidTooling()
    const child = { unref: vi.fn() }
    const spawnFn = vi.fn().mockReturnValue(child)
    const r = await ensureBrainServerStarted(
      async () => false,
      { AUTOWIN_BRAIN_TOOLING: tooling, PYTHONPATH: '/fuite/hermes' },
      spawnFn as never
    )
    expect(r.status).toBe('starting')
    expect(spawnFn).toHaveBeenCalledOnce()
    const [bin, args, opts] = spawnFn.mock.calls[0]
    const python = join(tooling, '.venv', 'Scripts', 'python.exe')
    const script = join(tooling, 'brain_server.py')
    if (process.platform === 'win32') {
      // Lanceur intermédiaire OBLIGATOIRE sous Windows : sans lui, le python hérite du socket
      // d'écoute DevTools et garde le port 9223 après la mort de l'app.
      expect(bin).toBe('cmd.exe')
      expect(args).toEqual(['/d', '/c', 'start', '', '/b', python, script])
    } else {
      expect(bin).toBe(python)
      expect(args).toEqual([script])
    }
    // Le script étant absolu, aucun cwd n'est nécessaire ; un tooling local reste passé tel quel.
    expect(opts.cwd).toBe(tooling)
    expect(opts.detached).toBe(true)
    expect('PYTHONPATH' in opts.env).toBe(false)
    expect(child.unref).toHaveBeenCalled()
  })

  it('ne tente qu’UNE fois par session (garde anti-spam)', async () => {
    makeValidTooling()
    const spawnFn = vi.fn().mockReturnValue({ unref: vi.fn() })
    const first = await ensureBrainServerStarted(async () => false, { AUTOWIN_BRAIN_TOOLING: tooling }, spawnFn as never)
    const second = await ensureBrainServerStarted(async () => false, { AUTOWIN_BRAIN_TOOLING: tooling }, spawnFn as never)
    expect(first.status).toBe('starting')
    expect(second.status).toBe('unavailable')
    expect(spawnFn).toHaveBeenCalledOnce()
  })

  // Le tooling par défaut est un partage RÉSEAU écrivable par des collègues : un dossier nommé
  // `Brain & calc` suffisait à couper la ligne cmd.exe et à faire exécuter la suite AU DÉMARRAGE
  // de l'app (le preflight appelle ce lanceur, aucun clic requis). On refuse, on ne spawn pas.
  it('refuse un tooling contenant un métacaractère cmd.exe (aucun spawn)', async () => {
    const piege = join(tooling, 'Brain & calc')
    mkdirSync(join(piege, '.venv', 'Scripts'), { recursive: true })
    writeFileSync(join(piege, '.venv', 'Scripts', 'python.exe'), '')
    writeFileSync(join(piege, 'brain_server.py'), '')
    const spawnFn = vi.fn().mockReturnValue({ unref: vi.fn() })
    const r = await ensureBrainServerStarted(
      async () => false,
      { AUTOWIN_BRAIN_TOOLING: piege },
      spawnFn as never
    )
    if (process.platform === 'win32') {
      expect(r.status).toBe('unavailable')
      expect(spawnFn).not.toHaveBeenCalled()
    } else {
      // Hors Windows il n'y a pas de shell dans la chaîne : le `&` est un caractère de chemin banal.
      expect(r.status).toBe('starting')
    }
  })

  it('buildBrainLaunchCommand : fail-closed sur métacaractère, cwd UNC non imposé', () => {
    expect(buildBrainLaunchCommand('C:\\t & x', 'C:\\t & x\\python.exe', 'C:\\t & x\\s.py', 'win32')).toBeNull()
    // cmd.exe REFUSE un cwd UNC (« UNC paths are not supported. Defaulting to Windows directory ») :
    // on n'en impose aucun, et le script absolu rend le cwd inutile.
    const unc = buildBrainLaunchCommand(
      '\\\\ged2\\rig\\tooling',
      '\\\\ged2\\rig\\tooling\\python.exe',
      '\\\\ged2\\rig\\tooling\\brain_server.py',
      'win32'
    )
    expect(unc).not.toBeNull()
    expect(unc?.cwd).toBeUndefined()
    expect(unc?.args.at(-1)).toBe('\\\\ged2\\rig\\tooling\\brain_server.py')
    expect(unc?.args).toContain('/d')
  })

  it('resolveBrainRuntime : env tooling prioritaire sinon vide', () => {
    expect(resolveBrainRuntime({ AUTOWIN_BRAIN_TOOLING: 'X:/t' }).tooling).toBe('X:/t')
    expect(resolveBrainRuntime({}).tooling).toBe('')
  })

  it('resout le runtime INSTALLE localement sans jamais executer le tooling du partage GED', () => {
    const localAppData = mkdtempSync(join(tmpdir(), 'brain-localappdata-'))
    const stateRoot = join(localAppData, 'AmitelBrain')
    const codeRoot = join(stateRoot, 'tooling')
    const python = join(stateRoot, '.venv', 'Scripts', 'python.exe')
    mkdirSync(stateRoot, { recursive: true })
    writeFileSync(
      join(stateRoot, 'config.json'),
      JSON.stringify({
        brain_root: '\\\\ged2\\rig\\Projets IA\\Amitel Brain',
        code_root: codeRoot,
        python
      })
    )
    try {
      const runtime = resolveBrainRuntime({ LOCALAPPDATA: localAppData })
      expect(runtime).toMatchObject({ tooling: codeRoot, python })
      expect(runtime.brainRoot).toContain('Amitel Brain')
      expect(runtime.tooling.startsWith('\\\\')).toBe(false)
      expect(runtime.python.startsWith('\\\\')).toBe(false)
    } finally {
      rmSync(localAppData, { recursive: true, force: true })
    }
  })
})
