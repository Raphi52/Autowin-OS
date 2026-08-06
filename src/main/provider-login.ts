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

/**
 * Plan de login par provider (pur, testable). Throw si le provider n'a pas de login connu.
 *
 * `bin` — chemin ABSOLU du binaire à authentifier, quand l'appelant sait lequel le run utilisera.
 * Motif (audit 2026-07-30) : la sonde de session résout son binaire par `resolveClaudeBin` (donc
 * `CLAUDE_BIN`, puis le `claude.exe` natif du préfixe npm) tandis que le login lançait le NOM NU,
 * résolu par le PATH du terminal. Sur un poste à deux installations aux stores d'auth distincts — cas
 * mesuré — l'utilisateur authentifiait l'installation B pendant qu'on sondait l'installation A : login
 * réussi, check qui reste rouge, aucune explication. On authentifie donc le binaire SONDÉ.
 * L'opérateur d'appel `&` et les guillemets sont obligatoires : ces chemins traversent
 * `Program Files` / `AppData`.
 */
export function planProviderLogin(provider: string, bin?: string, configDir?: string): LoginPlan {
  switch (provider) {
    case 'kimi':
      return { kind: 'adapter', provider: 'kimi' }
    case 'claude': {
      // Multi-comptes : le login doit ecrire dans le dossier du compte VISE, pas dans l'identite
      // courante. Sans ce prefixe, ajouter un second compte ecraserait le premier — le CLI ne sait
      // stocker qu'une session par dossier de configuration.
      // Syntaxe PowerShell (le terminal est lance via `powershell -ExecutionPolicy Bypass`), et le
      // dossier est fixe AVANT l'appel pour que le CLI le voie des son demarrage.
      const prefix = configDir ? `$env:CLAUDE_CONFIG_DIR = "${configDir}"; ` : ''
      return {
        kind: 'terminal',
        command: prefix + (bin ? `& "${bin}" auth login` : 'claude auth login')
      }
    }
    case 'codex':
      return { kind: 'terminal', command: 'npm run codex:login' }
    default:
      throw new Error(`Aucun login connu pour le provider: ${provider}`)
  }
}

type SpawnLike = typeof spawn

/**
 * Ouvre une NOUVELLE fenêtre console VISIBLE exécutant `command` (le CLI y gère l'auth).
 * Via `cmd /c start` : le pattern `spawn('powershell', …, {detached, stdio:'ignore'})` seul ne crée
 * PAS de fenêtre fiable sur Windows (DETACHED_PROCESS → invisible → « le bouton ne fait rien »).
 * `start` alloue une console visible ; `-ExecutionPolicy Bypass` exécute les shims .ps1 (ex. claude.ps1).
 * Les arguments de la commande passent APRÈS `-Command` (jamais concaténés dans le titre `start`).
 */
export function spawnLoginTerminal(command: string, opts: { spawnFn?: SpawnLike; cwd?: string } = {}): void {
  const spawnFn = opts.spawnFn ?? spawn
  const args = [
    '/c',
    'start',
    '""', // titre de fenêtre (requis par `start` avant l'exécutable)
    'powershell',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-NoExit',
    '-Command',
    command
  ]
  const child = spawnFn('cmd.exe', args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    ...(opts.cwd ? { cwd: opts.cwd } : {})
  })
  child.unref?.()
}
