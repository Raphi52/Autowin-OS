/**
 * Diagnostic de démarrage (#4) : AVANT que l'utilisateur lance un run, on vérifie que les dépendances
 * externes sont là (brain_server joignable, CLI providers présents, token Brain). Sinon l'utilisateur
 * découvre les pannes EN PLEIN run (auth expirée, brain down) au lieu d'un signal clair au lancement.
 *
 * Module PUR (checks injectables) → testable sans Electron ni réseau réel. L'appelant (index.ts)
 * exécute les checks au démarrage et pousse le résultat au renderer comme bannière.
 */
export interface PreflightCheck {
  id: 'brain' | 'codex' | 'codex-session' | 'claude' | 'kimi' | 'brain-token'
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
  /** Token Brain présent (env ou fichier). */
  hasBrainToken: () => boolean
}

export interface PreflightOptions {
  standbyProviders?: Array<'codex' | 'claude' | 'kimi'>
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
  const cliCheck = (
    id: 'codex' | 'claude' | 'kimi',
    label: string,
    ok: boolean,
    missing: string
  ): PreflightCheck =>
    standby.has(id)
      ? { id, label, ok: true, standby: true, detail: 'standby — diagnostic ignoré' }
      : { id, label, ok, detail: ok ? undefined : missing }
  const checks: PreflightCheck[] = [
    {
      id: 'brain',
      label: 'brain_server (:8765)',
      ok: brain,
      detail: brain ? undefined : 'injoignable — RAG désactivé'
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
    cliCheck('claude', 'CLI claude', claude, 'introuvable — installer/authentifier claude'),
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
