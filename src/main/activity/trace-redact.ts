/**
 * Rédaction générique des secrets dans une trace (clés sensibles + motifs de valeurs).
 * Utilitaire NEUTRE, indépendant de toute source de trace — réutilisé par le spool natif et la
 * lecture des traces. Aucune sémantique provider-spécifique.
 */

const SECRET_VALUE =
  /(Bearer\s+)[^\s"']+|((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,"']+|\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{30,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi

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
