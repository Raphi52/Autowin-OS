import { createCipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto'

export interface SignedBrainPayload {
  service?: unknown
  protocol?: unknown
  authenticated?: unknown
  context?: unknown
  signature?: unknown
  navigation?: unknown
}

export interface VerifiedBrainPayload {
  context: string
  navigation?: unknown
  corpus?: readonly string[]
  structuredContext?: {
    preamble: string
    sources: ReadonlyArray<{ path: string; content: string }>
  }
}

const SERVICE = 'amitel-brain'
const REQUEST_AAD = Buffer.from('amitel-brain/request-v1', 'utf8')
const MAX_AUTHENTICATED_BYTES = 1024 * 1024
export const MAX_BRAIN_CONTEXT_CHARS = 3_000
export const MAX_SIGNED_BRAIN_RESPONSE_BYTES = 3 * 1024 * 1024

type BrainResponseLike = {
  headers?: { get(name: string): string | null }
  body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>
      cancel(reason?: unknown): Promise<void> | void
    }
  } | null
  text?: () => Promise<string>
  json?: () => Promise<unknown>
}

/** Chiffre le POST pour qu'une reprise de port entre challenge et requête n'expose aucun prompt. */
export function sealBrainRequest(
  payload: Record<string, unknown>,
  token: string,
  nonce: string
): { nonce: string; ciphertext: string } {
  if (!/^[0-9a-f]{24}$/.test(nonce)) throw new Error('Nonce Amitel Brain invalide')
  const key = createHash('sha256').update(token, 'utf8').digest()
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'hex'))
  cipher.setAAD(REQUEST_AAD)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ])
  return { nonce, ciphertext: encrypted.toString('base64') }
}

function assertContextBound(context: string): void {
  // Protocole: caractères Unicode (points de code), identique à len(str) côté Python.
  if (Array.from(context).length > MAX_BRAIN_CONTEXT_CHARS) {
    throw new Error('Contexte Amitel Brain trop volumineux')
  }
}

function parseCorpusAttestation(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error('Attestation de corpus Amitel Brain invalide')
  }
  return value.map((entry) => {
    if (
      typeof entry !== 'string' ||
      !entry ||
      entry.length > 100 ||
      entry !== entry.trim().toLowerCase() ||
      entry === '*' ||
      !entry.startsWith('knowledge/') ||
      entry.includes('\\') ||
      entry.includes('//') ||
      entry.replace(/\/$/, '').split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error('Attestation de corpus Amitel Brain invalide')
    }
    return entry
  })
}

function parseStructuredContext(
  value: unknown
): VerifiedBrainPayload['structuredContext'] | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Contexte structuré Amitel Brain invalide')
  }
  const structured = value as Record<string, unknown>
  if (typeof structured.preamble !== 'string' || !Array.isArray(structured.sources)) {
    throw new Error('Contexte structuré Amitel Brain invalide')
  }
  if (structured.sources.length > 100) {
    throw new Error('Contexte structuré Amitel Brain invalide')
  }
  const sources = structured.sources.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Contexte structuré Amitel Brain invalide')
    }
    const source = entry as Record<string, unknown>
    if (
      typeof source.path !== 'string' ||
      !source.path.trim() ||
      source.path.length > 4096 ||
      typeof source.content !== 'string'
    ) {
      throw new Error('Contexte structuré Amitel Brain invalide')
    }
    return { path: source.path, content: source.content }
  })
  const reconstructed = [structured.preamble, ...sources.map((source) => source.content)]
    .filter(Boolean)
    .join('\n\n---\n\n')
  assertContextBound(reconstructed)
  return { preamble: structured.preamble, sources }
}

function renderStructuredContext(
  structured: NonNullable<VerifiedBrainPayload['structuredContext']>
): string {
  return structured.preamble + structured.sources.map((source) => source.content).join('\n\n---\n\n')
}

/** Lit une réponse JSON avec une borne avant allocation si Content-Length est disponible. */
export async function readSignedBrainPayload(
  response: BrainResponseLike
): Promise<SignedBrainPayload> {
  const declared = Number(response.headers?.get('content-length'))
  if (Number.isFinite(declared) && (declared < 0 || declared > MAX_SIGNED_BRAIN_RESPONSE_BYTES)) {
    throw new Error('Réponse Amitel Brain trop volumineuse')
  }

  let decoded: unknown
  if (response.body) {
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_SIGNED_BRAIN_RESPONSE_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // La réponse est déjà rejetée ; une erreur de cancel ne doit pas masquer la borne franchie.
        }
        throw new Error('Réponse Amitel Brain trop volumineuse')
      }
      chunks.push(Buffer.from(value))
    }
    const raw = Buffer.concat(chunks, total).toString('utf8')
    try {
      decoded = JSON.parse(raw)
    } catch {
      throw new Error('Réponse Amitel Brain invalide')
    }
  } else if (typeof response.text === 'function') {
    const raw = await response.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_SIGNED_BRAIN_RESPONSE_BYTES) {
      throw new Error('Réponse Amitel Brain trop volumineuse')
    }
    try {
      decoded = JSON.parse(raw)
    } catch {
      throw new Error('Réponse Amitel Brain invalide')
    }
  } else if (typeof response.json === 'function') {
    // Repli réservé aux doubles de test historiques. Les Response natives passent toujours par text().
    decoded = await response.json()
    let encoded: string
    try {
      encoded = JSON.stringify(decoded)
    } catch {
      throw new Error('Réponse Amitel Brain invalide')
    }
    if (Buffer.byteLength(encoded, 'utf8') > MAX_SIGNED_BRAIN_RESPONSE_BYTES) {
      throw new Error('Réponse Amitel Brain trop volumineuse')
    }
  } else {
    throw new Error('Réponse Amitel Brain invalide')
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('Réponse Amitel Brain invalide')
  }
  return decoded as SignedBrainPayload
}

function verifySignature(message: string, signature: unknown, token: string): void {
  if (typeof signature !== 'string') throw new Error('Reponse Amitel Brain invalide')
  const expected = createHmac('sha256', token).update(message, 'utf8').digest('hex')
  const actualBuffer = Buffer.from(signature, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Signature Amitel Brain invalide')
  }
}

/** Vérifie l'enveloppe avant d'exposer le contexte ou la navigation au reste de l'app. */
export function verifySignedBrainPayload(
  payload: SignedBrainPayload,
  token: string
): VerifiedBrainPayload {
  if (payload.service !== SERVICE) {
    throw new Error('Identite du service Amitel Brain invalide')
  }

  // Compatibilité avec un runtime v1 : son contexte reste authentifié, mais ses champs additionnels
  // ne l'étaient pas. Ils sont donc volontairement écartés plutôt que présentés comme fiables.
  if (payload.protocol === 1) {
    if (typeof payload.context !== 'string') throw new Error('Reponse Amitel Brain invalide')
    verifySignature(`${SERVICE}\n1\n${payload.context}`, payload.signature, token)
    assertContextBound(payload.context)
    return { context: payload.context }
  }

  if (payload.protocol !== 2 || typeof payload.authenticated !== 'string') {
    throw new Error('Identite du service Amitel Brain invalide')
  }
  if (Buffer.byteLength(payload.authenticated, 'utf8') > MAX_AUTHENTICATED_BYTES) {
    throw new Error('Reponse Amitel Brain trop volumineuse')
  }
  verifySignature(`${SERVICE}\n2\n${payload.authenticated}`, payload.signature, token)

  let decoded: unknown
  try {
    decoded = JSON.parse(payload.authenticated)
  } catch {
    throw new Error('Reponse Amitel Brain invalide')
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('Reponse Amitel Brain invalide')
  }
  const body = decoded as Record<string, unknown>
  if (typeof body.context !== 'string') throw new Error('Reponse Amitel Brain invalide')
  assertContextBound(body.context)
  const structuredContext = parseStructuredContext(body.structuredContext)
  if (structuredContext && renderStructuredContext(structuredContext) !== body.context) {
    throw new Error('Les frontières du contexte Amitel Brain sont incohérentes')
  }
  return {
    context: body.context,
    ...('navigation' in body ? { navigation: body.navigation } : {}),
    ...(body.corpus !== undefined ? { corpus: parseCorpusAttestation(body.corpus) } : {}),
    ...(structuredContext ? { structuredContext } : {})
  }
}
