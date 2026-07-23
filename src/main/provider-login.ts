import { spawn } from 'node:child_process'

/**
 * Lancement du login OFFICIEL d'un provider depuis l'app (bouton « Se reconnecter » de la page Routeur).
 *
 * SÉCURITÉ : l'app LANCE le flow du CLI/provider (qui gère lui-même la saisie), elle ne capture JAMAIS
 * de credential. Modèle : `kimi.startLogin` (spawn d'un terminal détaché). kimi garde sa propre
 * résolution d'exe (adapter) ; claude/codex passent par une commande terminal.
 *
 * Commandes (confirmées) :
 *  - claude → `claude auth login` (« Sign in to your Anthropic account »).
 *  - codex  → `npm run codex:login` : peuple le store LU par l'app (autowin-os/auth.json). PAS
 *    `codex login` (CLI natif → autre store → faux-fix).
 *  - kimi   → délégué à l'adapter (kimi.startLogin, exe résolu).
 */
export type LoginPlan =
  | { kind: 'adapter'; provider: 'kimi' }
  | { kind: 'terminal'; command: string }

/** Plan de login par provider (pur, testable). Throw si le provider n'a pas de login connu. */
export function planProviderLogin(provider: string): LoginPlan {
  switch (provider) {
    case 'kimi':
      return { kind: 'adapter', provider: 'kimi' }
    case 'claude':
      return { kind: 'terminal', command: 'claude auth login' }
    case 'codex':
      return { kind: 'terminal', command: 'npm run codex:login' }
    default:
      throw new Error(`Aucun login connu pour le provider: ${provider}`)
  }
}

type SpawnLike = typeof spawn

/** Ouvre un terminal PowerShell détaché exécutant `command` (le CLI y gère l'auth). */
export function spawnLoginTerminal(command: string, opts: { spawnFn?: SpawnLike; cwd?: string } = {}): void {
  const spawnFn = opts.spawnFn ?? spawn
  const child = spawnFn('powershell.exe', ['-NoExit', '-Command', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    ...(opts.cwd ? { cwd: opts.cwd } : {})
  })
  child.unref?.()
}
