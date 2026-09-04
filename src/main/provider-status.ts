/**
 * Statut d'authentification par provider pour la page Routeur.
 *
 * INVARIANT ANTI-MENSONGE : un provider n'est JAMAIS marqué `authenticated` sans preuve réelle.
 *  - claude : l'OAuth est privé au CLI → `--version` ne prouve QUE la présence (`installed-untested`).
 *    La vraie validité vient d'un PROBE réel à la demande (bouton « Tester ») ; un probe qui timeout/jette
 *    → `unknown` (jamais `authenticated` par défaut).
 *
 * Claude est le SEUL moteur dont un statut est publié. Codex, Kimi et Gemini sont retirés : plus de
 * lecture de jeton, plus de sondage, plus d'entrée dans la signature. Un état ENCORE enregistré sur
 * disque pour l'un d'eux est ignoré, jamais republié (contrôle négatif dans le banc).
 *
 * Module PUR (aucune I/O directe) : les entrées (présence CLI, résultat de probe) sont injectées,
 * donc entièrement testable hors réseau. Le câblage réel (adapter.auth(), appel minimal) vit dans
 * l'IPC main.
 */
export type AuthStatus =
  | 'authenticated' // preuve réelle de validité
  | 'expired' // preuve réelle d'expiration
  | 'installed-untested' // CLI présent, validité non testée (claude au chargement)
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

/** Statut de PRÉSENCE (claude au chargement) : le CLI répond ou non — jamais « authenticated ». */
export function presenceStatus(cliResponds: boolean): AuthStatus {
  return cliResponds ? 'installed-untested' : 'absent'
}

/**
 * Traduit le résultat d'un PROBE réel (appel minimal claude, à la demande) en statut.
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
function isTestable(status: AuthStatus): boolean {
  return status === 'installed-untested' || status === 'unknown'
}

/** Assemble la liste de statuts au chargement depuis des entrées déjà résolues (injectées). */
export function buildProviderStatuses(inputs: {
  claudeResponds: boolean
  now: number
  /**
   * États persistés, indexés par identifiant de provider. Volontairement ouvert (`string`) : le
   * disque peut encore porter des entrées de moteurs RETIRÉS, et la garde est de ne pas les
   * publier — pas de refuser de les lire.
   */
  states?: Partial<Record<string, ProviderStateSnapshot>>
}): ProviderStatus[] {
  const state = inputs.states?.claude
  if (state?.mode === 'standby') {
    return [
      {
        provider: 'claude',
        status: 'standby',
        testable: false,
        detail: 'En standby — aucun probe ni reconnexion automatique.'
      }
    ]
  }
  if (state?.lastProbe) {
    return [
      {
        provider: 'claude',
        status: state.lastProbe.status,
        // Un probe persisté est une preuve datée, jamais un oracle courant : toujours retestable.
        testable: true,
        lastCheckedAt: state.lastProbe.checkedAt
      }
    ]
  }
  const fallback = presenceStatus(inputs.claudeResponds)
  return [{ provider: 'claude', status: fallback, testable: isTestable(fallback) }]
}
