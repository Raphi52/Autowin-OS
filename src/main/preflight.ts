/**
 * Diagnostic de démarrage (#4) : AVANT que l'utilisateur lance un run, on vérifie que les dépendances
 * externes sont là (brain_server joignable, CLI providers présents, token Brain). Sinon l'utilisateur
 * découvre les pannes EN PLEIN run (auth expirée, brain down) au lieu d'un signal clair au lancement.
 *
 * Module PUR (checks injectables) → testable sans Electron ni réseau réel. L'appelant (index.ts)
 * exécute les checks au démarrage et pousse le résultat au renderer comme bannière.
 */
export interface PreflightCheck {
  id: 'brain' | 'codex' | 'claude' | 'brain-token'
  label: string
  ok: boolean
  detail?: string
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
  hasBin: (which: 'codex' | 'claude') => Promise<boolean>
  /** Token Brain présent (env ou fichier). */
  hasBrainToken: () => boolean
}

/** Lance les checks en parallèle et agrège. Ne throw jamais : un check qui casse = ko, pas un crash. */
export async function runPreflight(probes: PreflightProbes): Promise<PreflightResult> {
  const safe = async (fn: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await fn()
    } catch {
      return false
    }
  }
  const [brain, codex, claude] = await Promise.all([
    safe(probes.pingBrain),
    safe(() => probes.hasBin('codex')),
    safe(() => probes.hasBin('claude'))
  ])
  let token = false
  try {
    token = probes.hasBrainToken()
  } catch {
    token = false
  }
  const checks: PreflightCheck[] = [
    { id: 'brain', label: 'brain_server (:8765)', ok: brain, detail: brain ? undefined : 'injoignable — RAG désactivé' },
    { id: 'brain-token', label: 'token Brain', ok: token, detail: token ? undefined : 'absent — définir AMITEL_BRAIN_TOKEN' },
    { id: 'codex', label: 'CLI codex', ok: codex, detail: codex ? undefined : 'introuvable / non authentifié — npm run codex:login' },
    { id: 'claude', label: 'CLI claude', ok: claude, detail: claude ? undefined : 'introuvable — installer/authentifier claude' }
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
