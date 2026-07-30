/**
 * SE SOUVENIR — la commande `remember`, et la seule régression mécanique face à claude.exe.
 *
 * claude.exe a une mémoire que le modèle ÉCRIT : il édite des fiches dans un dossier, et elles sont
 * relues au tour suivant. Autowin avait coupé la LECTURE automatique de ces fiches
 * (`autoMemoryDirectory: ''` dans `providers/claude.ts`) parce qu'elles pesaient 552 Ko à chaque appel
 * — soit ~9 200 tokens. La lecture à la demande, elle, existait déjà (`brain_query`).
 * Restait donc un seul trou : le modèle ne pouvait RIEN écrire. « Retiens ça » était impossible.
 *
 * DESTINATION : le Brain partagé, pas un dossier local — choix de l'utilisateur. Conséquences assumées :
 *  - ce qu'on retient sert à TOUTE la boîte, et remplit un corpus Autowin qui ne pesait que 0,19 % de
 *    l'index (15 342 chunks, dont 99 % de doc RIG — mesuré le 2026-07-29) ;
 *  - un candidat va dans `inbox/`, JAMAIS dans `knowledge/` : la promotion reste HUMAINE. Le serveur
 *    l'impose, ce module ne fait que l'annoncer honnêtement à l'agent ;
 *  - ce n'est PAS relu au tour suivant. L'index se reconstruit par générations, donc un fait retenu
 *    aujourd'hui devient trouvable plus tard. C'est la différence de mécanique avec claude.exe, et elle
 *    doit être DITE au modèle plutôt que découverte.
 *
 * Ce module est PUR côté décision (validation, forme du candidat) ; l'appel réseau est injectable.
 */

/** Types acceptés par le garde du Brain (`brain_propose.ALLOWED_TYPES`). Liste FERMÉE. */
export const REMEMBER_TYPES = ['lesson', 'decision', 'preference', 'domain'] as const
export type RememberType = (typeof REMEMBER_TYPES)[number]

/**
 * Schémas de source vérifiables (`brain_propose.ALLOWED_SOURCE_SCHEMES`). Un fait sans source traçable
 * est refusé par le serveur : autant le dire ici, sinon l'agent ne comprend pas le refus.
 */
export const REMEMBER_SOURCE_SCHEMES = [
  'session',
  'file',
  'url',
  'git',
  'email',
  'ticket',
  'meeting'
] as const

export const REMEMBER_TITLE_MAX = 200
export const REMEMBER_BODY_MAX = 4_000

export type RememberDecision =
  | {
      allowed: true
      title: string
      body: string
      type: RememberType
      scope: string
      source: string
      tags: string[]
      confidence: 'low' | 'medium' | 'high'
    }
  | { allowed: false; reason: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/**
 * Valide une demande « retiens ça » AVANT tout appel réseau.
 *
 * On refuse tôt et en DISANT pourquoi : un candidat rejeté en silence ferait croire à une mémoire
 * écrite alors que rien ne l'a été — le même défaut que le coût jeté et la carte de livraison jetée.
 * La validation de fond (secrets, données personnelles, confinement du chemin) reste au serveur : on ne
 * la duplique pas, on ne peut que la devancer sur la forme.
 */
export function decideRemember(args: Record<string, unknown>): RememberDecision {
  const title = text(args.title).slice(0, REMEMBER_TITLE_MAX)
  const body = text(args.fact ?? args.body).slice(0, REMEMBER_BODY_MAX)
  if (!title) return { allowed: false, reason: 'titre manquant — un fait sans titre est introuvable' }
  if (!body) return { allowed: false, reason: 'rien à retenir : le fait est vide' }

  const rawType = text(args.type).toLowerCase()
  const type = (REMEMBER_TYPES as readonly string[]).includes(rawType)
    ? (rawType as RememberType)
    : undefined
  if (!type) {
    return {
      allowed: false,
      reason: `type invalide — attendu l'un de : ${REMEMBER_TYPES.join(', ')}`
    }
  }

  const source = text(args.source)
  const scheme = source.split(':')[0]?.toLowerCase() ?? ''
  if (!source || !(REMEMBER_SOURCE_SCHEMES as readonly string[]).includes(scheme)) {
    return {
      allowed: false,
      reason: `source non traçable — préfixe attendu : ${REMEMBER_SOURCE_SCHEMES.map((s) => `${s}:`).join(' ')}`
    }
  }

  const scope = text(args.scope)
  if (!scope) {
    return { allowed: false, reason: 'portée manquante — le projet concerné, ou « global »' }
  }

  const rawConfidence = text(args.confidence).toLowerCase()
  const confidence =
    rawConfidence === 'low' || rawConfidence === 'high' ? rawConfidence : ('medium' as const)

  const rawTags = Array.isArray(args.tags) ? args.tags : []
  const tags = rawTags.map((tag) => text(tag)).filter(Boolean).slice(0, 8)

  return { allowed: true, title, body, type, scope, source, tags, confidence }
}

export interface RememberOutcome {
  /** Le candidat a été DÉPOSÉ. Ne dit pas qu'il est promu : la promotion est humaine. */
  stored: boolean
  /** Ce qui s'est passé, à afficher tel quel. */
  detail: string
  /** Nom du fichier candidat, quand le serveur le rend. */
  note?: string
}

export interface RememberDeps {
  origin?: string
  token?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  authorAgent?: string
  model?: string
}

/**
 * Dépose le candidat sur `POST /ingest`. Ne throw JAMAIS : un échec d'écriture est un résultat à
 * afficher, pas une exception qui casse le tour.
 */
export async function rememberFact(
  args: Record<string, unknown>,
  deps: RememberDeps = {}
): Promise<RememberOutcome & { allowed: boolean; reason?: string }> {
  const decision = decideRemember(args)
  if (!decision.allowed) {
    return { allowed: false, reason: decision.reason, stored: false, detail: decision.reason }
  }
  const token = deps.token ?? ''
  if (!token) {
    return {
      allowed: true,
      stored: false,
      detail: 'jeton du Brain absent — rien n’a été écrit (définir AMITEL_BRAIN_TOKEN)'
    }
  }
  const origin = deps.origin ?? 'http://127.0.0.1:8765'
  const doFetch = deps.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 2_000) // sleep-ok: borne d'abort d'un fetch, pas un sleep de polling
  try {
    const response = await doFetch(`${origin}/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        title: decision.title,
        body: decision.body,
        type: decision.type,
        scope: decision.scope,
        source: decision.source,
        tags: decision.tags,
        confidence: decision.confidence,
        author_agent: deps.authorAgent ?? 'autowin-os',
        model: deps.model ?? 'autowin'
      })
    })
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean
      note?: string
      error?: string
    }
    if (!response.ok || payload.ok !== true) {
      // Le motif du refus vient du serveur : on le rend TEL QUEL, sans le reformuler en succès.
      return {
        allowed: true,
        stored: false,
        detail: `refusé par le Brain : ${payload.error ?? `HTTP ${response.status}`}`
      }
    }
    return {
      allowed: true,
      stored: true,
      ...(payload.note ? { note: payload.note } : {}),
      detail:
        'retenu comme CANDIDAT dans la boîte de réception du Brain — un humain le promeut, et il ne sera relisible qu’après réindexation'
    }
  } catch (error) {
    return {
      allowed: true,
      stored: false,
      detail: `Brain injoignable : ${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    clearTimeout(timer)
  }
}
