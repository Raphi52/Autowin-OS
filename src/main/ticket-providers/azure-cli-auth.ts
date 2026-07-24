import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** GUID de ressource Azure DevOps (constant Microsoft) — cible du token AAD. */
const AZURE_DEVOPS_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'

let cached: { token: string; expiresAt: number } | null = null

/**
 * Obtient un token AAD Azure DevOps via la session `az login` de l'utilisateur (aucun secret à saisir).
 * Renvoie null si `az` absent ou pas de session. Mis en cache ~45 min (les tokens AAD durent ~1 h).
 * C'est le fallback d'auth « standard RIG » quand aucun PAT (AUTOWIN_AZDO_PAT) n'est fourni.
 */
export async function getAzureDevOpsAadToken(now: number = Date.now()): Promise<string | null> {
  if (cached && now < cached.expiresAt) return cached.token
  try {
    const { stdout } = await run(
      'az',
      [
        'account',
        'get-access-token',
        '--resource',
        AZURE_DEVOPS_RESOURCE,
        '--query',
        'accessToken',
        '-o',
        'tsv'
      ],
      { windowsHide: true, shell: true, timeout: 15_000 }
    )
    const token = stdout.trim()
    if (!token) return null
    cached = { token, expiresAt: now + 45 * 60_000 }
    return token
  } catch {
    return null
  }
}

/** Réinitialise le cache (tests / après un `az login` frais). */
export function resetAadTokenCache(): void {
  cached = null
}
