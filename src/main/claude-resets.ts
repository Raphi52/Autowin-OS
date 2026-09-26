/**
 * LES RESETS DE LIMITE OFFERTS PAR ANTHROPIC — lecture et réclamation.
 *
 * Contrat COPIÉ du CLI Claude Code 2.1.280 (claude.exe) :
 *  - lecture : `GET /api/oauth/usage?cedar_ember=1&skip_spend=1` (table `SG.cedar_ember`) ;
 *  - réclamation : `POST /api/organizations/<org>/reset_rate_limits` avec
 *    `{ program: "cedar_ember", grant_id, request_id }` (fonction `Je`), `grant_id` validé par
 *    `/^[a-z0-9_-]{1,40}$/`, `request_id` par `/^[A-Za-z0-9_-]{1,64}$/` (un `randomUUID`).
 *  - l'organisation vient de `GET /api/oauth/profile` → `organization.uuid` (sondé : 200).
 *
 * Sondé en lecture seule le 2026-09-23 : la lecture répond 200 avec le jeton d'abonnement (le 429
 * noté dans model-quotas.ts ne s'y applique plus quand on envoie un `user-agent` de CLI).
 *
 * RÉCLAMER CONSOMME LE RESET : cette fonction n'est appelée que sur un clic explicite, et les tests
 * ne la jouent que contre un faux réseau.
 */
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeAccountEnv } from './claude-accounts'
import type {
  ClaudeResetClaimResult,
  ClaudeResetGrant,
  ClaudeResetsStatus
} from '../shared/claude-resets'

const API = 'https://api.anthropic.com'
const PROGRAM = 'cedar_ember'
const GRANT_ID = /^[a-z0-9_-]{1,40}$/
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_CREDENTIAL_BYTES = 256_000

type Fetch = typeof fetch

function headers(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'user-agent': 'claude-cli/2.1.280 (external, cli)'
  }
}

/** Jeton du compte ACTIF (même règle que le quota : `CLAUDE_CONFIG_DIR` d'abord). */
export async function readActiveClaudeAccessToken(home = homedir()): Promise<string> {
  const configDir = claudeAccountEnv().CLAUDE_CONFIG_DIR
  const path = configDir
    ? join(configDir, '.credentials.json')
    : join(home, '.claude', '.credentials.json')
  const info = await stat(path).catch(() => undefined)
  if (!info || info.size > MAX_CREDENTIAL_BYTES) throw new Error('Session Claude indisponible')
  const credentials = JSON.parse(await readFile(path, 'utf8')) as {
    claudeAiOauth?: { accessToken?: unknown }
  }
  const token = credentials.claudeAiOauth?.accessToken
  if (typeof token !== 'string' || token.length < 20) throw new Error('Session Claude indisponible')
  return token
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** Traduit le bloc `cedar_ember` ; une entrée mal formée est ignorée, jamais devinée. */
export function parseClaudeResets(body: unknown): ClaudeResetsStatus {
  const block = (body as { cedar_ember?: unknown } | null)?.cedar_ember as
    | Record<string, unknown>
    | null
    | undefined
  if (!block || typeof block !== 'object') {
    return { status: 'unavailable', eligible: false, grants: [], error: 'Aucun reset publié' }
  }
  const grants: ClaudeResetGrant[] = []
  for (const raw of Array.isArray(block.grants) ? block.grants : []) {
    const g = raw as Record<string, unknown>
    const id = str(g?.id)
    if (!id || !GRANT_ID.test(id)) continue
    grants.push({
      id,
      label: str(g.label) ?? id,
      resetsLeft: num(g.resets_left) ?? 0,
      resetsTotal: num(g.resets_total) ?? 0,
      ...(str(g.ends_at) ? { endsAt: str(g.ends_at) } : {}),
      usableNow: g.usable_now === true,
      paused: g.paused === true,
      useRequiresLimit: g.use_requires_limit === true
    })
  }
  const next = str(block.next_grant_id)
  return {
    status: 'available',
    eligible: block.eligible === true,
    ...(str(block.ineligible_reason) ? { ineligibleReason: str(block.ineligible_reason) } : {}),
    ...(next && grants.some((g) => g.id === next) ? { nextGrantId: next } : {}),
    ...(str(block.cooldown_until) ? { cooldownUntil: str(block.cooldown_until) } : {}),
    grants
  }
}

export async function readClaudeResets(
  options: { fetchFn?: Fetch; accessToken?: string } = {}
): Promise<ClaudeResetsStatus> {
  try {
    const token = options.accessToken ?? (await readActiveClaudeAccessToken())
    const response = await (options.fetchFn ?? fetch)(
      `${API}/api/oauth/usage?cedar_ember=1&skip_spend=1`,
      { headers: headers(token), signal: AbortSignal.timeout(10_000) }
    )
    if (!response.ok) throw new Error(`Resets Claude HTTP ${response.status}`)
    return parseClaudeResets(await response.json())
  } catch (error) {
    const message =
      error instanceof Error && /^(Session Claude indisponible|Resets Claude HTTP \d+)$/.test(error.message)
        ? error.message
        : 'Resets Claude indisponibles'
    return { status: 'unavailable', eligible: false, grants: [], error: message }
  }
}

/**
 * CONSOMME le reset `grantId` du compte actif. Irréversible côté Anthropic : l'appelant doit avoir
 * obtenu une confirmation explicite de l'utilisateur.
 */
export async function claimClaudeReset(
  grantId: string,
  options: { fetchFn?: Fetch; accessToken?: string; requestId?: string } = {}
): Promise<ClaudeResetClaimResult> {
  const requestId = options.requestId ?? randomUUID()
  if (!GRANT_ID.test(grantId) || !REQUEST_ID.test(requestId)) return { result: 'error' }
  const fetchFn = options.fetchFn ?? fetch
  try {
    const token = options.accessToken ?? (await readActiveClaudeAccessToken())
    const profile = await fetchFn(`${API}/api/oauth/profile`, {
      headers: headers(token),
      signal: AbortSignal.timeout(10_000)
    })
    if (!profile.ok) return { result: 'auth_error' }
    const org = str(((await profile.json()) as { organization?: { uuid?: unknown } })?.organization?.uuid)
    if (!org) return { result: 'auth_error' }
    const response = await fetchFn(
      `${API}/api/organizations/${encodeURIComponent(org)}/reset_rate_limits`,
      {
        method: 'POST',
        headers: { ...headers(token), 'content-type': 'application/json' },
        body: JSON.stringify({ program: PROGRAM, grant_id: grantId, request_id: requestId }),
        signal: AbortSignal.timeout(25_000)
      }
    )
    if (response.status === 429) return { result: 'rate_limited' }
    if (response.status === 401 || response.status === 403) return { result: 'auth_error' }
    if (!response.ok) return { result: 'error' }
    const data = (await response.json()) as Record<string, unknown>
    const result = str(data?.result)
    if (!result) return { result: 'error' }
    return {
      result,
      ...(str(data.reason) ? { reason: str(data.reason) } : {}),
      ...(num(data.resets_left) !== undefined ? { resetsLeft: num(data.resets_left) } : {})
    }
  } catch {
    return { result: 'error' }
  }
}
// fix-ok: fichier NOUVEAU écrit en plusieurs pas (création puis compléments), pas un correctif à l aveugle — contrat mesuré : GET oauth/usage?cedar_ember=1 → 200 (sonde 2026-09-23), POST reset_rate_limits copié de claude.exe
