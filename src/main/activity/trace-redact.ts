/**
 * Rédaction générique des secrets dans une trace (clés sensibles + motifs de valeurs).
 * Utilitaire NEUTRE, indépendant de toute source de trace — réutilisé par le spool natif et la
 * lecture des traces. Aucune sémantique provider-spécifique.
 */

/**
 * Le motif est SÉPARÉ en deux moitiés de natures différentes — distinction imposée par l'audit du
 * 2026-07-30 :
 *  - `KEYED` reconnaît « <mot-clé> = <n'importe quoi> ». Sans exigence sur la valeur, il attrape aussi
 *    « le champ token: obligatoire ». C'est SANS DANGER pour rédiger (sur-rédiger ne coûte rien) mais
 *    inacceptable pour un garde qui ACCEPTE ou REFUSE : un faux refus bloquerait un fait légitime.
 *  - `SHAPES` reconnaît des formes intrinsèquement discriminantes (clé AWS, JWT, `ghp_`, clé privée…) :
 *    quasi aucun faux positif, donc réutilisable par un garde de décision.
 * La rédaction utilise les DEUX ; `brain-remember.ts` n'importe que `SHAPES`.
 */
const KEYED = String.raw`(Bearer\s+)[^\s"']+|((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,"']+`
const SHAPES = String.raw`\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{30,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`

const SECRET_VALUE = new RegExp(`${KEYED}|${SHAPES}`, 'gi')

/**
 * Les formes de jetons à faible faux-positif, SANS le drapeau `g` : utilisable par un garde de décision
 * sans partager d'état `lastIndex` avec la rédaction.
 */
export const SECRET_TOKEN_SHAPES = new RegExp(SHAPES, 'i')

function secretKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return (
    normalized === 'authorization' ||
    normalized === 'proxyauthorization' ||
    normalized === 'cookie' ||
    normalized === 'setcookie' ||
    normalized === 'token' ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('idtoken') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('password') ||
    normalized.endsWith('credential') ||
    normalized.includes('privatekey')
  )
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function redact(value: unknown, key = ''): unknown {
  if (secretKey(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    return value.replace(
      SECRET_VALUE,
      (_match, bearer: string, assignment: string) => `${bearer || assignment || ''}[REDACTED]`
    )
  }
  if (Array.isArray(value)) return value.map((item) => redact(item))
  const object = toRecord(value)
  if (!object) return value
  return Object.fromEntries(
    Object.entries(object).map(([name, item]) => [name, redact(item, name)])
  )
}

/** Rédige récursivement toute valeur (clés sensibles → [REDACTED], motifs secrets masqués). */
export function redactTrace(value: unknown): unknown {
  return redact(value)
}

/** Exposé pour réutilisation ciblée (ex. normalisation). */
export { secretKey, toRecord as recordOf }
