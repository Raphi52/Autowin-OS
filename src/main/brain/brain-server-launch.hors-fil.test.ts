import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import * as childProcess from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureBrainServerStarted, resetBrainLaunchAttempt } from './brain-server-launch'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { lancerDetacheHorsFil } from '../gel/lancement-hors-fil'

/**
 * LE LANCEMENT DU brain_server NE TIENT PLUS LE FIL PRINCIPAL (2026-10-31).
 *
 * Mesure `gels.jsonl` sur 7 jours : `spawn cmd.exe start` de `brain-server-launch.ts:344` a figé la
 * fenêtre 18,5 s en 4 appels, dont 7,7 s d'un seul coup. `child_process.spawn` n'est asynchrone que
 * pour la suite : la création du processus, elle, bloque le fil qui l'appelle.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : le lancement par défaut qui repasse par le `spawn` du fil principal.
 */
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return { ...real, default: real, spawn: vi.fn(real.spawn) }
})

vi.mock('../gel/lancement-hors-fil', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../gel/lancement-hors-fil')>()
  return { ...reel, lancerDetacheHorsFil: vi.fn(reel.lancerDetacheHorsFil) }
})

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aos-brain-hors-fil-'))
  vi.mocked(childProcess.spawn).mockClear()
  vi.mocked(lancerDetacheHorsFil).mockClear()
  resetBrainLaunchAttempt()
})
// Le processus détaché vit encore un instant dans ce dossier : la suppression doit savoir patienter.
afterEach(async () => {
  await supprimerArbre(dir)
})

const attendreFichier = async (chemin: string): Promise<string> => {
  for (let essai = 0; essai < 100; essai += 1) {
    if (existsSync(chemin)) return readFileSync(chemin, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`jamais écrit : ${chemin}`)
}

describe('lancerDetacheHorsFil', () => {
  it('lance un vrai processus détaché, avec son dossier et son environnement, hors du fil', async () => {
    const marque = join(dir, 'marque.txt')
    await lancerDetacheHorsFil(
      process.execPath,
      ['-e', `require('fs').writeFileSync(${JSON.stringify(marque)}, process.env.MARQUE + process.cwd())`],
      {
        cwd: dir,
        env: { ...process.env, MARQUE: 'vu-dans-' },
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }
    )

    expect((await attendreFichier(marque)).startsWith('vu-dans-')).toBe(true)
    // L'assertion qui garde le correctif : le fil principal n'a pas créé ce processus.
    expect(vi.mocked(childProcess.spawn)).not.toHaveBeenCalled()
  })

  it('rend une erreur lisible pour un programme introuvable, sans tuer le processus', async () => {
    await expect(
      lancerDetacheHorsFil(join(dir, 'programme-absent.exe'), [], {
        env: process.env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
    ).rejects.toThrow(/ENOENT/)
  })
})

describe('ensureBrainServerStarted — lancement par défaut', () => {
  const toolingValide = (): string => {
    const tooling = join(dir, 'tooling')
    mkdirSync(join(tooling, '.venv', 'Scripts'), { recursive: true })
    writeFileSync(join(tooling, '.venv', 'Scripts', 'python.exe'), '')
    writeFileSync(join(tooling, 'brain_server.py'), '')
    return tooling
  }

  it('passe par le lanceur injecté et ne touche jamais au spawn du fil principal', async () => {
    const lancer = vi.fn(async () => undefined)
    const r = await ensureBrainServerStarted(
      async () => false,
      { AUTOWIN_BRAIN_TOOLING: toolingValide() },
      lancer
    )
    expect(r.status).toBe('starting')
    expect(lancer).toHaveBeenCalledOnce()
    expect(vi.mocked(childProcess.spawn)).not.toHaveBeenCalled()
  })

  it('n’appelle pas le spawn du fil principal quand aucun lanceur n’est injecté', async () => {
    // Le double évite de lancer pour de vrai un serveur depuis ce test.
    vi.mocked(lancerDetacheHorsFil).mockResolvedValueOnce(undefined)
    const r = await ensureBrainServerStarted(async () => false, {
      AUTOWIN_BRAIN_TOOLING: toolingValide()
    })
    expect(r.status).toBe('starting')
    expect(vi.mocked(lancerDetacheHorsFil)).toHaveBeenCalledOnce()
    expect(vi.mocked(childProcess.spawn)).not.toHaveBeenCalled()
  })

  it('reste sans exception quand le lancement échoue : le contrat « ne lève jamais »', async () => {
    const r = await ensureBrainServerStarted(
      async () => false,
      { AUTOWIN_BRAIN_TOOLING: toolingValide() },
      async () => {
        throw new Error('ENOENT cmd.exe')
      }
    )
    expect(r.status).toBe('unavailable')
    expect(r.detail).toContain('ENOENT cmd.exe')
  })
})
