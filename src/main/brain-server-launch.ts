/**
 * Auto-démarrage du brain_server local (loopback :8765) quand le preflight le trouve ROUGE.
 *
 * brain_server.py est un service Python EXTERNE (tooling du Brain, cf. README). L'app ne le
 * packageait pas ; ici on tente de le LANCER localement s'il est absent — jamais de le tuer/redémarrer
 * (127.0.0.1 = instance PAR MACHINE ; une instance vivante ne doit pas être touchée, cf. mémoire).
 *
 * Garde anti-doublon : on ping AVANT de spawn (déjà up → no-op) et on ne tente qu'UNE fois par session.
 * Chemin du tooling : env `AUTOWIN_BRAIN_TOOLING` (override), sinon défaut Amitel documenté ci-dessous
 * (jamais une racine utilisateur devinée — un défaut d'intégration explicite, surchargé par env).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Défaut d'intégration Amitel (surclassable par AUTOWIN_BRAIN_TOOLING). */
const DEFAULT_BRAIN_TOOLING = '\\\\ged2\\rig\\Projets IA\\Amitel Brain\\tooling'

export interface BrainLaunchResult {
  status: 'already-up' | 'starting' | 'unavailable'
  detail: string
}

/** Tentative unique par session : évite de spammer des spawns pendant le backoff de re-probe. */
let attempted = false

export function resolveBrainTooling(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUTOWIN_BRAIN_TOOLING || DEFAULT_BRAIN_TOOLING
}

/** Réarme la tentative (ex. brain repassé up puis re-tombé, ou déclenchement manuel explicite). */
export function resetBrainLaunchAttempt(): void {
  attempted = false
}

/**
 * S'assure que le brain_server tourne : si `isUp()` répond, no-op ; sinon tente un spawn détaché.
 * `spawnFn` injectable pour test (défaut: child_process.spawn). Ne throw jamais.
 */
export async function ensureBrainServerStarted(
  isUp: () => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
  spawnFn: typeof spawn = spawn
): Promise<BrainLaunchResult> {
  try {
    if (await isUp()) {
      attempted = false // il tourne → réarme pour une éventuelle chute future
      return { status: 'already-up', detail: 'brain_server déjà joignable' }
    }
  } catch {
    /* ping en erreur = traité comme down */
  }
  if (attempted) {
    return { status: 'unavailable', detail: 'démarrage déjà tenté cette session — pas de nouveau spawn' }
  }
  const tooling = resolveBrainTooling(env)
  const python = join(tooling, '.venv', 'Scripts', 'python.exe')
  const script = join(tooling, 'brain_server.py')
  if (!existsSync(python)) {
    return { status: 'unavailable', detail: `venv Python introuvable (${python}) — venv par machine à créer (uv venv)` }
  }
  if (!existsSync(script)) {
    return { status: 'unavailable', detail: `brain_server.py introuvable (${script})` }
  }
  attempted = true
  // ⚠️ PYTHONPATH retiré : sinon un PYTHONPATH hérité (Hermes) shadow les deps du venv isolé (cf. README).
  const childEnv: NodeJS.ProcessEnv = { ...env }
  delete childEnv.PYTHONPATH
  // cwd = tooling ; brain_server fait os.chdir(AMITEL_BRAIN_ROOT=parent) lui-même. Détaché + unref :
  // survit à l'app, stdio ignoré (pas de pipe qui bloque). windowsHide : pas de console qui pop.
  const child = spawnFn(python, ['brain_server.py'], {
    cwd: tooling,
    env: childEnv,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref?.()
  return {
    status: 'starting',
    detail: 'brain_server lancé — warm-up fastembed ~30-40 s (le preflight re-sonde avec backoff)'
  }
}
