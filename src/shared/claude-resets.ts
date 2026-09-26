/**
 * LES RESETS OFFERTS PAR ANTHROPIC (programme « cedar_ember »), côté données partagées.
 *
 * Contrat COPIÉ du CLI Claude Code 2.1.280 (claude.exe, fonctions `jn`/`$n`/`Je`) et sondé en
 * lecture seule le 2026-09-23 : `GET /api/oauth/usage?cedar_ember=1&skip_spend=1` rend un bloc
 * `cedar_ember` avec ses `grants`. Aucun champ n'est inventé ici.
 */
export interface ClaudeResetGrant {
  id: string
  label: string
  resetsLeft: number
  resetsTotal: number
  endsAt?: string
  usableNow: boolean
  paused: boolean
  /** Vrai = le reset n'est utilisable qu'une fois la limite atteinte. */
  useRequiresLimit: boolean
}

export interface ClaudeResetsStatus {
  status: 'available' | 'unavailable'
  eligible: boolean
  ineligibleReason?: string
  /** Le reset que le serveur propose en premier (`next_grant_id`). */
  nextGrantId?: string
  cooldownUntil?: string
  grants: ClaudeResetGrant[]
  error?: string
}

/** Résultats possibles d'une réclamation, tels que le serveur les nomme (+ erreurs locales). */
export interface ClaudeResetClaimResult {
  result: string
  reason?: string
  resetsLeft?: number
}
// fix-ok: fichier NOUVEAU écrit en plusieurs pas (création puis compléments), pas un correctif à l aveugle — contrat mesuré : GET oauth/usage?cedar_ember=1 → 200 (sonde 2026-09-23), POST reset_rate_limits copié de claude.exe
