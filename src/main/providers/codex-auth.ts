import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Entry } from '@napi-rs/keyring'
import { ensureAutowinAppData } from '../app-data'

const nodeRequire = createRequire(__filename)

/**
 * Auth OAuth « abonnement ChatGPT/Codex » — device-code + PKCE (le verifier est
 * renvoyé par OpenAI, pas généré client). Reproduit le flow standard SANS aucune
 * dépendance externe. La SAISIE du user_code dans le navigateur est une action
 * HUMAINE (on ne tape jamais les identifiants de l'utilisateur) : `startDeviceLogin`
 * retourne le code + l'URL, l'app les AFFICHE, puis `pollForToken` attend.
 *
 * Store PROPRE à Autowin OS (jamais un runtime externe) : %APPDATA%\autowin-os\auth.json.
 */

// client_id PUBLIC du produit Codex (identique au CLI codex officiel). Zone grise
// ToS assumée au niveau projet (comme la voie bridge Claude).
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const USERCODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode'
const DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token'
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback'
export const VERIFY_URL = 'https://auth.openai.com/codex/device'

export interface DeviceLogin {
  userCode: string
  deviceAuthId: string
  intervalMs: number
}

export interface Tokens {
  accessToken: string
  refreshToken: string
  obtainedAt: number
  expiresInSec?: number
}

/** Injection de dépendance pour tester hors-ligne (fetch mocké). */
export type FetchLike = typeof fetch

export interface TokenVault {
  get(account: string): string | null
  set(account: string, value: string): void
}

const KEYRING_SERVICE = 'Autowin OS Codex'
const KEYRING_FORMAT = 'autowin-keyring-v1'
const defaultTokenVault: TokenVault = {
  get: (account) => new Entry(KEYRING_SERVICE, account).getPassword(),
  set: (account, value) => new Entry(KEYRING_SERVICE, account).setPassword(value)
}

function keyringAccount(path: string): string {
  return createHash('sha256').update(path).digest('hex')
}

export function defaultAuthPath(): string {
  return join(ensureAutowinAppData(), 'auth.json')
}

/**
 * Coffre OS Electron si dispo (chiffrement DPAPI/Keychain/libsecret). Chargé en LAZY (require) :
 * hors Electron (tests, node pur) → null → repli JSON en clair (0o600). Jamais d'import top-level
 * d'`electron` (casserait les tests unitaires du module).
 */
function safeStorageOrNull(): {
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
} | null {
  try {
    const mod = nodeRequire('electron') as {
      safeStorage?: {
        isEncryptionAvailable(): boolean
        encryptString(s: string): Buffer
        decryptString(b: Buffer): string
      }
    }
    return mod.safeStorage?.isEncryptionAvailable?.() ? mod.safeStorage : null
  } catch {
    return null
  }
}

export function loadTokens(path = defaultAuthPath(), vault: TokenVault = defaultTokenVault): Tokens | null {
  if (!existsSync(path)) return null
  try {
    const buf = readFileSync(path)
    const text = buf.toString('utf8')
    // Legacy : ancien fichier en clair (JSON) → lu puis placé dans le coffre OS à la volée.
    if (text.trimStart().startsWith('{')) {
      const stored = JSON.parse(text) as Tokens | { format: string; account: string }
      if ('format' in stored) {
        if (stored.format !== KEYRING_FORMAT) return null
        const secret = vault.get(stored.account)
        return secret ? (JSON.parse(secret) as Tokens) : null
      }
      const legacy = stored
      try {
        saveTokens(legacy, path, vault)
      } catch {
        /* migration best-effort */
      }
      return legacy
    }
    const ss = safeStorageOrNull()
    if (!ss) return null // fichier chiffré mais coffre indispo → on ne peut pas déchiffrer
    return JSON.parse(ss.decryptString(buf)) as Tokens
  } catch {
    return null
  }
}

export function saveTokens(
  t: Tokens,
  path = defaultAuthPath(),
  vault: TokenVault = defaultTokenVault
): void {
  mkdirSync(dirname(path), { recursive: true })
  const json = JSON.stringify(t, null, 2)
  const ss = safeStorageOrNull()
  // Electron chiffre directement le fichier. Hors Electron, le secret va dans le coffre système :
  // auth.json ne contient qu'un pointeur non secret et il n'existe plus de repli en clair.
  if (ss) writeFileSync(path, ss.encryptString(json), { mode: 0o600 })
  else {
    const account = keyringAccount(path)
    vault.set(account, json)
    writeFileSync(path, JSON.stringify({ format: KEYRING_FORMAT, account }), {
      encoding: 'utf8',
      mode: 0o600
    })
  }
}

/** Étape 1 : demande un user_code. L'app doit afficher userCode + VERIFY_URL. */
export async function startDeviceLogin(fetchFn: FetchLike = fetch): Promise<DeviceLogin> {
  const res = await fetchFn(USERCODE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID })
  })
  if (!res.ok) throw new Error(`usercode HTTP ${res.status}`)
  const j = (await res.json()) as { user_code: string; device_auth_id: string; interval?: number }
  return {
    userCode: j.user_code,
    deviceAuthId: j.device_auth_id,
    intervalMs: (j.interval ?? 5) * 1000
  }
}

/** Étape 3-4 : poll jusqu'à validation, puis échange contre les tokens. */
export async function pollForToken(
  login: DeviceLogin,
  opts: { fetchFn?: FetchLike; sleep?: (ms: number) => Promise<void>; maxAttempts?: number } = {}
): Promise<Tokens> {
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxAttempts = opts.maxAttempts ?? 120

  for (let i = 0; i < maxAttempts; i++) {
    // fix-ok: contrat live vérifié (auth.py:7446) — le poll envoie
    // {device_auth_id, user_code} (PAS client_id) ; pending = 403/404 (le 400 initial
    // venait du user_code manquant, pas d'un « authorization_pending »).
    const res = await fetchFn(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_auth_id: login.deviceAuthId, user_code: login.userCode })
    })
    if (res.status === 200) {
      const j = (await res.json()) as { authorization_code: string; code_verifier: string }
      return await exchangeCode(j.authorization_code, j.code_verifier, fetchFn)
    }
    if (res.status !== 403 && res.status !== 404)
      throw new Error(`deviceauth/token HTTP ${res.status}`)
    await sleep(login.intervalMs)
  }
  throw new Error('device-code expiré (pas validé à temps)')
}

async function exchangeCode(code: string, verifier: string, fetchFn: FetchLike): Promise<Tokens> {
  // fix-ok: contrat live (auth.py:7484) — oauth/token attend un corps
  // application/x-www-form-urlencoded, PAS du JSON.
  const res = await fetchFn(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier
    }).toString()
  })
  if (!res.ok) throw new Error(`oauth/token(exchange) HTTP ${res.status}`)
  const j = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in?: number
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    obtainedAt: Date.now(),
    expiresInSec: j.expires_in
  }
}

/** Rafraîchit un access_token via le refresh_token (usage unique côté OpenAI). */
export async function refreshTokens(current: Tokens, fetchFn: FetchLike = fetch): Promise<Tokens> {
  // fix-ok: contrat live — oauth/token en form-urlencoded (cf. exchange).
  const res = await fetchFn(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CODEX_CLIENT_ID,
      refresh_token: current.refreshToken
    }).toString()
  })
  if (!res.ok) throw new Error(`oauth/token(refresh) HTTP ${res.status}`)
  const j = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? current.refreshToken,
    obtainedAt: Date.now(),
    expiresInSec: j.expires_in
  }
}
