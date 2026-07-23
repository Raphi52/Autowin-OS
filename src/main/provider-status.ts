/**
 * Statut d'authentification par provider pour la page Routeur.
 *
 * INVARIANT ANTI-MENSONGE : un provider n'est JAMAIS marqué `authenticated` sans preuve réelle.
 *  - codex : preuve cheap au chargement = expiry du token (auth.json). authenticated si non expiré,
 *    `expired` si dépassé, `absent` si pas de token.
 *  - claude / kimi : l'OAuth est privé au CLI → `--version` ne prouve QUE la présence (`installed-untested`).
 *    La vraie validité vient d'un PROBE réel à la demande (bouton « Tester ») ; un probe qui timeout/jette
 *    → `unknown` (jamais `authenticated` par défaut).
 *
 * Module PUR (aucune I/O directe) : les entrées (tokens, présence CLI, résultat de probe) sont injectées,
 * donc entièrement testable hors réseau. Le câblage réel (loadTokens, adapter.auth(), appel minimal) vit
 * dans l'IPC main.
 */
export type AuthStatus =
  | 'authenticated' // preuve réelle de validité
  | 'expired' // preuve réelle d'expiration
  | 'installed-untested' // CLI présent, validité non testée (claude/kimi au chargement)
  | 'absent' // ni token ni CLI
  | 'unknown' // le check lui-même a échoué (timeout/erreur) — surtout PAS « authenticated »

export type ProviderDisplayStatus = AuthStatus | 'standby'

export interface ProviderStatus {
  provider: string
  status: ProviderDisplayStatus
  /** true si un bouton « Tester » (probe réel) a du sens pour ce provider dans cet état. */
  testable: boolean
  detail?: string
  lastCheckedAt?: number
}

interface ProviderStateSnapshot {
  mode: 'active' | 'standby'
  lastProbe?: { status: AuthStatus; checkedAt: number }
}

/** Coupe le callback avant tout spawn/réseau lorsque le provider est volontairement en veille. */
export async function probePresenceUnlessStandby(
  state: Pick<ProviderStateSnapshot, 'mode'>,
  probe: () => Promise<boolean>
): Promise<boolean> {
  return state.mode === 'standby' ? false : probe()
}

/** Statut codex depuis le token (cheap, exact) : expiry vs horloge. */
export function codexTokenStatus(
  tokens: { obtainedAt: number; expiresInSec?: number } | null,
  now: number
): AuthStatus {
  if (!tokens) return 'absent'
  if (tokens.expiresInSec == null) return 'authenticated' // pas d'expiry déclaré → présent, réputé valide
  const expiresAt = tokens.obtainedAt + tokens.expiresInSec * 1000
  return expiresAt > now ? 'authenticated' : 'expired'
}

/** Statut de PRÉSENCE (claude/kimi au chargement) : CLI répond ou non — jamais « authenticated ». */
export function presenceStatus(cliResponds: boolean): AuthStatus {
  return cliResponds ? 'installed-untested' : 'absent'
}

/**
 * Traduit le résultat d'un PROBE réel (appel minimal claude/kimi, à la demande) en statut.
 * `errored` (timeout / exception) → `unknown` : on ne ment JAMAIS « authenticated » sur un check raté.
 */
export function probeResultStatus(result: {
  errored?: boolean
  expired?: boolean
  ok?: boolean
}): AuthStatus {
  if (result.errored) return 'unknown'
  if (result.expired) return 'expired'
  return result.ok ? 'authenticated' : 'expired'
}

/** Un statut « authenticated » ou « expired » est définitif ; les autres méritent un bouton « Tester ». */
export function isTestable(status: AuthStatus): boolean {
  return status === 'installed-untested' || status === 'unknown'
}

/** Assemble la liste de statuts au chargement depuis des entrées déjà résolues (injectées). */
export function buildProviderStatuses(inputs: {
  codexTokens: { obtainedAt: number; expiresInSec?: number } | null
  claudeResponds: boolean
  kimiResponds: boolean
  now: number
  states?: Partial<Record<'codex' | 'claude' | 'kimi', ProviderStateSnapshot>>
}): ProviderStatus[] {
  const codex = codexTokenStatus(inputs.codexTokens, inputs.now)
  const claude = presenceStatus(inputs.claudeResponds)
  const kimi = presenceStatus(inputs.kimiResponds)
  const display = (provider: 'codex' | 'claude' | 'kimi', fallback: AuthStatus): ProviderStatus => {
    const state = inputs.states?.[provider]
    if (state?.mode === 'standby') {
      return {
        provider,
        status: 'standby',
        testable: false,
        detail: 'En standby — aucun probe ni reconnexion automatique.'
      }
    }
    // Codex possède un oracle token local plus actuel. Pour les CLI opaques, le dernier mini-tour
    // explicite est la meilleure preuve disponible et doit survivre au redémarrage.
    if (provider !== 'codex' && state?.lastProbe) {
      return {
        provider,
        status: state.lastProbe.status,
        testable: isTestable(state.lastProbe.status),
        lastCheckedAt: state.lastProbe.checkedAt
      }
    }
    return { provider, status: fallback, testable: isTestable(fallback) }
  }
  return [display('codex', codex), display('claude', claude), display('kimi', kimi)]
}
