/**
 * Le bouton « Démarrer » du wizard doit RÉARMER la garde anti-spam de `ensureBrainServerStarted`.
 *
 * Constaté le 2026-09-01 : brain_server était mort (index publié sans signature d'embedding, donc
 * refusé fail-closed au warm-up). Le démarrage AUTOMATIQUE du lancement avait déjà consommé l'unique
 * tentative de la session ; le wizard affichait alors un bouton « Démarrer » qui, cliqué, répondait
 * « démarrage déjà tenté cette session — pas de nouveau spawn » SANS rien tenter, et restait inopérant
 * jusqu'au redémarrage complet de l'app.
 *
 * La garde existe pour empêcher le BACKOFF automatique de spammer des spawns — pas pour désarmer un
 * clic humain. Ce test exerce le chemin RÉEL du bouton (aucun `startBrain` injecté) : c'est la seule
 * façon de voir la garde, que les tests à double injecté court-circuitent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repairPreflightCheck } from './preflight-repair'
import { ensureBrainServerStarted, resetBrainLaunchAttempt } from './brain-server-launch'

afterEach(() => {
  vi.unstubAllEnvs()
  resetBrainLaunchAttempt()
})

describe('bouton « Démarrer » — un clic manuel n’est pas désarmé par la garde anti-spam', () => {
  it('tente RÉELLEMENT même quand le démarrage automatique a déjà consommé la tentative', async () => {
    resetBrainLaunchAttempt()

    // 1) Le démarrage AUTOMATIQUE du lancement a déjà brûlé la tentative unique de la session.
    const tooling = mkdtempSync(join(tmpdir(), 'brain-tooling-'))
    mkdirSync(join(tooling, '.venv', 'Scripts'), { recursive: true })
    writeFileSync(join(tooling, '.venv', 'Scripts', 'python.exe'), '')
    writeFileSync(join(tooling, 'brain_server.py'), '')
    const spawnFn = vi.fn().mockReturnValue({ unref: vi.fn() })
    const auto = await ensureBrainServerStarted(
      async () => false,
      { AUTOWIN_BRAIN_TOOLING: tooling },
      spawnFn as never
    )
    expect(auto.status).toBe('starting')

    // 2) L'utilisateur clique « Démarrer ». On pointe le tooling vers un dossier INEXISTANT : le
    //    chemin réel s'arrête alors sur un diagnostic de fichiers, sans jamais spawner un process —
    //    le test reste donc hermétique (aucun brain_server réel lancé par la suite de tests).
    vi.stubEnv('AUTOWIN_BRAIN_TOOLING', join(tmpdir(), 'brain-tooling-absent-pour-ce-test'))
    const clic = await repairPreflightCheck('brain')

    // Sans le réarmement, le détail serait « démarrage déjà tenté cette session — pas de nouveau
    // spawn » : le bouton mentirait à l'utilisateur en n'ayant rien tenté du tout.
    expect(clic.detail).not.toContain('déjà tenté cette session')
    expect(clic.detail).toContain('venv Python introuvable')
    // Le clic n'a pas relancé le spawn du tour automatique : on réarme, on ne double pas.
    expect(spawnFn).toHaveBeenCalledOnce()
  })
})
