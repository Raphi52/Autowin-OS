/**
 * Diagnostic de démarrage (#4) : AVANT que l'utilisateur lance un run, on vérifie que les dépendances
 * externes sont là (brain_server joignable, CLI providers présents, token Brain). Sinon l'utilisateur
 * découvre les pannes EN PLEIN run (auth expirée, brain down) au lieu d'un signal clair au lancement.
 *
 * Module PUR (checks injectables) → testable sans Electron ni réseau réel. L'appelant (index.ts)
 * exécute les checks au démarrage et pousse le résultat au renderer comme bannière.
 */
import type { ClaudeSessionState } from './claude-session'
import type { RoutedProvider } from './routed-providers'

export interface PreflightCheck {
  id:
    | 'brain'
    | 'brain-venv'
    | 'codex'
    | 'codex-session'
    | 'claude'
    | 'claude-session'
    | 'kimi'
    | 'brain-token'
  label: string
  ok: boolean
  detail?: string
  standby?: boolean
}

export interface PreflightResult {
  ok: boolean
  checks: PreflightCheck[]
  /** Résumé court prêt à afficher en bannière si dégradé. */
  summary: string
}

export interface PreflightProbes {
  /** brain_server joignable (POST/GET /health ou /query). */
  pingBrain: () => Promise<boolean>
  /** Un exécutable CLI est résolvable dans le PATH / la config. */
  hasBin: (which: 'codex' | 'claude' | 'kimi') => Promise<boolean>
  /** Une session OAuth Codex est enregistrée dans le store utilisé par le runtime. */
  hasCodexSession: () => boolean
  /**
   * État de la session du CLI claude. Tri-état volontaire : `unknown` (sonde ratée) ne doit ni
   * passer pour un vert, ni pour une session prouvée absente.
   */
  claudeSession: () => ClaudeSessionState | Promise<ClaudeSessionState>
  /** Token Brain présent (env ou fichier). */
  hasBrainToken: () => boolean
  /**
   * Le runtime Python du Brain est POSÉ sur cette machine (le `python.exe` que le lancement ira
   * chercher). Sondé à part du ping : « injoignable » et « jamais installé » demandent deux gestes
   * opposés — redémarrer un service, ou l'installer. Les confondre en un seul rouge « brain_server
   * injoignable » offrait un bouton « Démarrer » qui ne pouvait pas aboutir, faute de python.
   */
  hasBrainRuntime: () => boolean
}

export interface PreflightOptions {
  standbyProviders?: RoutedProvider[]
}

/**
 * Détail affiché sous « Session claude ».
 *
 * Le cas `binaire absent` mérite son propre message : prescrire « claude auth login » quand le CLI
 * n'est pas installé envoie l'utilisateur ouvrir une console qui répondra « claude : terme non
 * reconnu ». On le renvoie donc vers le check qui porte la vraie cause.
 */
function claudeSessionDetail(state: ClaudeSessionState, binPresent: boolean): string | undefined {
  if (state === 'authenticated') return undefined
  if (!binPresent) return 'CLI absent — voir « CLI claude » ci-dessus'
  // `unknown` couvre DEUX causes qu'on ne sait pas distinguer ici : un `auth status` muet, et un
  // binaire que le run ne sait pas résoudre (PATH n'exposant que des shims). Le message ne doit donc
  // pas affirmer la première — il enverrait diagnostiquer l'auth alors que c'est l'installation.
  return state === 'absent'
    ? 'session absente — claude auth login'
    : 'état de session indéterminé — le CLI claude n’a pas répondu (session ou installation)'
}

/** Lance les checks en parallèle et agrège. Ne throw jamais : un check qui casse = ko, pas un crash. */
export async function runPreflight(
  probes: PreflightProbes,
  options: PreflightOptions = {}
): Promise<PreflightResult> {
  const safe = async (fn: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await fn()
    } catch {
      return false
    }
  }
  const standby = new Set(options.standbyProviders ?? [])
  const providerProbe = (provider: 'codex' | 'claude' | 'kimi'): Promise<boolean> =>
    standby.has(provider) ? Promise.resolve(true) : safe(() => probes.hasBin(provider))
  const [brain, codex, claude, kimi] = await Promise.all([
    safe(probes.pingBrain),
    providerProbe('codex'),
    providerProbe('claude'),
    providerProbe('kimi')
  ])
  let token = false
  let codexSession = false
  try {
    token = probes.hasBrainToken()
  } catch {
    token = false
  }
  if (standby.has('codex')) {
    codexSession = true
  } else {
    try {
      codexSession = probes.hasCodexSession()
    } catch {
      codexSession = false
    }
  }
  // Symétrique de codexSession : un provider en standby n'est pas diagnostiqué. Une sonde qui jette
  // vaut `unknown`, jamais `authenticated` — on ne ment pas sur une session qu'on n'a pas pu lire.
  let claudeSession: ClaudeSessionState = 'unknown'
  if (standby.has('claude')) {
    claudeSession = 'authenticated'
  } else if (!claude) {
    // Binaire absent : inutile de sonder une session, et le rouge « CLI claude » porte déjà le motif.
    claudeSession = 'absent'
  } else {
    try {
      claudeSession = await probes.claudeSession()
    } catch {
      claudeSession = 'unknown'
    }
  }
  const cliCheck = (
    id: 'codex' | 'claude' | 'kimi',
    label: string,
    ok: boolean,
    missing: string
  ): PreflightCheck =>
    standby.has(id)
      ? { id, label, ok: true, standby: true, detail: 'standby — diagnostic ignoré' }
      : { id, label, ok, detail: ok ? undefined : missing }
  let brainRuntime = false
  try {
    brainRuntime = probes.hasBrainRuntime()
  } catch {
    // Fail-closed, comme le token juste au-dessus : une sonde muette ne vaut pas un vert. Le coût de
    // l'erreur est asymétrique — un faux rouge propose une installation IDEMPOTENTE (elle répond
    // « déjà installé »), un faux vert laisse un bouton « Démarrer » qui ne peut pas aboutir.
    brainRuntime = false
  }
  const checks: PreflightCheck[] = [
    {
      id: 'brain',
      label: 'brain_server (:8765)',
      ok: brain,
      detail: brain ? undefined : 'injoignable — RAG désactivé'
    },
    // Placé APRÈS le brain et AVANT le token : c'est l'ordre du geste. Sans runtime, le serveur ne
    // peut pas démarrer ; sans token, il démarre mais le RAG reste fermé.
    {
      id: 'brain-venv',
      label: 'runtime Brain (Python)',
      ok: brainRuntime,
      detail: brainRuntime
        ? undefined
        : 'non installé sur cette machine — venv + tooling à poser une fois'
    },
    {
      id: 'brain-token',
      label: 'token Brain',
      ok: token,
      detail: token ? undefined : 'absent — définir AMITEL_BRAIN_TOKEN'
    },
    cliCheck('codex', 'CLI codex', codex, 'introuvable — installer Codex CLI'),
    standby.has('codex')
      ? {
          id: 'codex-session',
          label: 'Session OAuth Codex',
          ok: true,
          standby: true,
          detail: 'standby — diagnostic ignoré'
        }
      : {
          id: 'codex-session',
          label: 'Session OAuth Codex',
          ok: codexSession,
          detail: codexSession
            ? undefined
            : 'session OAuth absente ou expirée — npm run codex:login'
        },
    cliCheck('claude', 'CLI claude', claude, 'introuvable — installer claude'),
    standby.has('claude')
      ? {
          id: 'claude-session',
          label: 'Session claude',
          ok: true,
          standby: true,
          detail: 'standby — diagnostic ignoré'
        }
      : {
          id: 'claude-session',
          label: 'Session claude',
          ok: claudeSession === 'authenticated',
          detail: claudeSessionDetail(claudeSession, claude)
        },
    cliCheck('kimi', 'CLI kimi', kimi, 'introuvable — installer/authentifier kimi')
  ]
  const failed = checks.filter((c) => !c.ok)
  return {
    ok: failed.length === 0,
    checks,
    summary: failed.length
      ? `Configuration incomplète : ${failed.map((c) => c.label).join(', ')}. Certaines fonctions seront dégradées.`
      : 'Tous les prérequis sont OK.'
  }
}
